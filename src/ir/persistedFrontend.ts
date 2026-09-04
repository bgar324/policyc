import { z } from "zod";
import {
  authorizationStateSchema,
  conservativeState,
  formatSchema,
  guardedFrontend,
  limitStateSchema,
  provesAction,
  purposeSchema,
  resolveDeliverable,
  type Frontend,
} from "./requestState.js";
import { requiredFieldNames } from "./deterministicFrontend.js";

/**
 * What an extractor reads from one request: the semantic facts a policy
 * condition can test, each with the evidence the extractor quoted. Facts the
 * planner already knows (operation, artifact type, tools) are not read; the
 * persisted frontend takes them from the context, so a read cannot contradict
 * the case it belongs to.
 */
export const extractedReadSchema = z.object({
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

export function parsePersistedReads(raw: unknown): PersistedReads {
  return persistedReadsSchema.parse(raw);
}

/**
 * A frontend backed by persisted reads. Keys are looked up by the caller's key
 * first and then by exact request text; a request with no entry gets the
 * conservative state (authorization absent, limit ambiguous) and says so,
 * rather than falling back to the deterministic frontend silently, so an
 * artifact trace always shows which frontend produced its state. A required
 * field the read did not name counts as missing.
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
    const proved = provesAction({ authorization: hit.authorization, operationNamed: hit.operationNamed, operationNegated: hit.operationNegated, fields });
    return {
      operation: context?.operation,
      artifactType: context?.artifactType,
      authorization: hit.authorization,
      limit: hit.limit,
      deliverable: resolveDeliverable(hit.limit, proved),
      purpose: hit.purpose,
      permittedTask: hit.permittedTask,
      format: hit.format,
      fields,
      operationNamed: hit.operationNamed,
      operationNegated: hit.operationNegated,
      toolsAvailable: context?.toolsAvailable?.map((tool) => tool.toLowerCase()),
      frontend: persisted.frontendId,
      evidence,
    };
  }, persisted.frontendId);
}
