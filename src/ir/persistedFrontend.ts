import { z } from "zod";
import {
  authorizationStateSchema,
  conservativeState,
  externalDisclosureSchema,
  formatSchema,
  guardedFrontend,
  limitStateSchema,
  provesAction,
  purposeSchema,
  resolveDeliverable,
  type Frontend,
} from "./requestState.js";
import {
  requiredFieldNames,
  resolveCurrentInformation,
  resolveDeferredWork,
  resolveExternalDisclosure,
  resolveOperationFacts,
  resolveRequestedSlideReorder,
  resolveSlideTask,
} from "./deterministicFrontend.js";
import { authorizationDisqualifier } from "../compiler/authorization.js";
import { isInlineTextRewrite } from "../compiler/limits.js";

/**
 * What an extractor reads from one request: the semantic facts a policy
 * condition can test, each with the evidence the extractor quoted. Facts the
 * planner already knows (operation, artifact type, tools) are not read; the
 * persisted frontend takes them from the context, so a read cannot contradict
 * the case it belongs to.
 */
export const extractedReadSchema = z.object({
  currentInformation: z.boolean().nullable(),
  deferredWork: z.boolean().nullable(),
  slideTask: z.boolean().nullable(),
  externalDisclosure: externalDisclosureSchema,
  requestedSlideReorder: z.boolean().nullable(),
  authorization: authorizationStateSchema,
  limit: limitStateSchema,
  purpose: purposeSchema,
  permittedTask: z.boolean(),
  format: formatSchema,
  operationNamed: z.boolean(),
  operationNegated: z.boolean(),
  /** Required field name (from the policy's field rule for the operation) to whether the request states it. */
  fields: z.record(z.string(), z.boolean()),
  evidence: z.array(z.string()),
}).strict();

/**
 * Persisted reads: a JSON map from a request key (the case id the planner
 * passes, or the request text) to a read produced earlier by some extractor.
 * This is the boundary for anything that arrives as JSON: every entry is
 * parsed by the schema here, before compilation, and a malformed entry rejects
 * the whole file. `frontendId` names the extractor and goes into the compiler
 * hash of any run that uses the file.
 */
export const persistedReadsSchema = z.object({
  frontendId: z.string().min(1),
  readContractSha256: z.string().regex(/^[a-f0-9]{64}$/),
  reads: z.record(z.string(), extractedReadSchema),
}).strict();

/**
 * The shape an extractor model returns. It differs from `extractedReadSchema`
 * in one place: strict structured output cannot express a map with open keys,
 * so `fields` is a list of named entries; `toExtractedRead` folds it back.
 * The JSON schema sent to the provider is derived from this object, so the
 * boundary and the extractor's contract cannot drift apart.
 */
export const extractorResponseSchema = z.object({
  currentInformation: z.boolean().nullable(),
  deferredWork: z.boolean().nullable(),
  slideTask: z.boolean().nullable(),
  externalDisclosure: externalDisclosureSchema,
  requestedSlideReorder: z.boolean().nullable(),
  authorization: authorizationStateSchema,
  limit: limitStateSchema,
  purpose: purposeSchema,
  permittedTask: z.boolean(),
  format: formatSchema,
  operationNamed: z.boolean(),
  operationNegated: z.boolean(),
  fields: z.array(z.object({ name: z.string(), stated: z.boolean() }).strict()),
  evidence: z.array(z.string()),
}).strict();

export type ExtractorResponse = z.infer<typeof extractorResponseSchema>;

export function extractorResponseJsonSchema(): Record<string, unknown> {
  const { $schema: _omit, ...schema } = z.toJSONSchema(extractorResponseSchema, { target: "draft-7" }) as Record<string, unknown>;
  return schema;
}

export function toExtractedRead(response: ExtractorResponse): ExtractedRead {
  const { fields, ...rest } = response;
  return { ...rest, fields: Object.fromEntries(fields.map((entry) => [entry.name, entry.stated])) };
}

export type ExtractedRead = z.infer<typeof extractedReadSchema>;
export type PersistedReads = z.infer<typeof persistedReadsSchema>;

export function parsePersistedReads(raw: unknown, expectedReadContractSha256: string): PersistedReads {
  if (!raw || typeof raw !== "object" || typeof (raw as { readContractSha256?: unknown }).readContractSha256 !== "string") {
    throw new Error("request-state reads predate the current extractor contract; re-extract them");
  }
  const persisted = persistedReadsSchema.parse(raw);
  if (persisted.readContractSha256 !== expectedReadContractSha256) {
    throw new Error(`request-state read contract ${persisted.readContractSha256} does not match running contract ${expectedReadContractSha256}; re-extract the reads`);
  }
  if (!persisted.frontendId.endsWith(`:${expectedReadContractSha256.slice(0, 12)}`)) {
    throw new Error(`request-state frontend id ${persisted.frontendId} does not name contract ${expectedReadContractSha256}; re-extract the reads`);
  }
  return persisted;
}

/**
 * A frontend backed by persisted reads. Keys are looked up by the caller's key
 * first and then by exact request text; a request with no entry gets the
 * conservative state (authorization absent, limit ambiguous) and says so,
 * rather than falling back to the deterministic frontend silently, so an
 * artifact trace always shows which frontend produced its state. A required
 * field the read did not name counts as missing. A read of `present` beside a
 * disqualifier the request states in plain words (a conditional clause, or a
 * negated review or approval) is capped: the disqualifier outranks every other
 * act, and the cap only moves a read toward asking.
 */
export function persistedFrontend(persisted: PersistedReads, key?: string): Frontend {
  return guardedFrontend((input, context) => {
    const hit = (key ? persisted.reads[key] : undefined) ?? persisted.reads[input];
    if (!hit) return conservativeState(context, persisted.frontendId, `no persisted read from ${persisted.frontendId} for this request`);
    const names = requiredFieldNames(context);
    const fields = Object.fromEntries(names.map((name) => [name, hit.fields[name] === true]));
    const unread = names.filter((name) => !(name in hit.fields));
    const evidence = [`read by ${persisted.frontendId}`, ...hit.evidence];
    if (unread.length) evidence.push(`fields not read, treated as missing: ${unread.join(", ")}`);
    let authorization = hit.authorization;
    const disqualifier = authorization === "present" ? authorizationDisqualifier(input) : undefined;
    if (disqualifier) {
      authorization = disqualifier.state;
      evidence.push(`present read capped to ${disqualifier.state}: ${disqualifier.evidence}`);
    }
    const sourceOperation = resolveOperationFacts(input, context?.operation, hit.operationNamed, hit.operationNegated);
    const operationNamed = sourceOperation.operationNamed && !isInlineTextRewrite(input, context);
    const operationNegated = operationNamed && sourceOperation.operationNegated;
    evidence.push(...sourceOperation.evidence.map((line) => `operation read capped: ${line}`));
    if (operationNamed !== sourceOperation.operationNamed) evidence.push("operation-named read capped: rewrite applies only to supplied text");
    const currentInformation = resolveCurrentInformation(input, context, hit.currentInformation);
    const deferredWork = resolveDeferredWork(input, context, hit.deferredWork);
    const slideTask = resolveSlideTask(input, context, hit.slideTask);
    const externalDisclosure = resolveExternalDisclosure(input, context, hit.externalDisclosure);
    const requestedSlideReorder = resolveRequestedSlideReorder(input, context, slideTask, hit.requestedSlideReorder);
    if (currentInformation !== hit.currentInformation) evidence.push(`current-information read capped to ${currentInformation}`);
    if (deferredWork !== hit.deferredWork) evidence.push(`deferred-work read capped to ${deferredWork}`);
    if (slideTask !== hit.slideTask) evidence.push(`slide-task read capped to ${slideTask}`);
    if (externalDisclosure !== hit.externalDisclosure) evidence.push(`external-disclosure read capped to ${externalDisclosure}`);
    if (requestedSlideReorder !== hit.requestedSlideReorder) evidence.push(`slide-reorder read capped to ${requestedSlideReorder}`);
    const proved = provesAction({ authorization, operationNamed, operationNegated, fields });
    return {
      operation: context?.operation,
      artifactType: context?.artifactType,
      currentInformation,
      deferredWork,
      slideTask,
      externalDisclosure,
      requestedSlideReorder,
      authorization,
      limit: hit.limit,
      deliverable: resolveDeliverable(hit.limit, proved),
      purpose: hit.purpose,
      permittedTask: hit.permittedTask,
      format: hit.format,
      fields,
      operationNamed,
      operationNegated,
      toolsAvailable: context?.toolsAvailable?.map((tool) => tool.toLowerCase()),
      frontend: persisted.frontendId,
      evidence,
    };
  }, persisted.frontendId);
}
