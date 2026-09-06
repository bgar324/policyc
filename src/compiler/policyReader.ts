import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { ArtifactContext, PolicyReadingRecord } from "../policy/types.js";
import { CLAUSE_MAP_HASH, CONDITION_INDEX_HASH, type PolicyCondition } from "./sourceClauses.js";

/**
 * The model-as-reader arm. One model call at compile time reads the request
 * against the clause slice (the verbatim source rules that apply to it) and
 * resolves the policy's own conditions into directives. Nothing here decides
 * a condition: the reader's output is persisted, parsed at this boundary, and
 * rendered after the clause slice. An empty reading renders nothing, so the
 * arm degrades to the source clause slice, never to a manufactured directive.
 *
 * Two contracts exist. Contract 1 (canaries v3 and v4) asks the reader to find
 * the conditions itself. Contract 2 hands it the indexed conditions of the
 * retained clauses (`CONDITIONS` in sourceClauses.ts) and requires exactly one
 * resolution per listed condition, so the search is done once offline and a
 * reading can be neither empty nor an enumeration. Contract 1 is frozen; its
 * hash is pinned by test so persisted v3/v4 readings keep loading.
 */

export type ReaderContractVersion = 1 | 2;

export const READER_PROMPT_PATH = "prompts/policy-reader.md";
export const READER_PROMPT_PATHS: Record<ReaderContractVersion, string> = { 1: READER_PROMPT_PATH, 2: "prompts/policy-reader-v2.md" };

export const HOLDS = ["yes", "no", "undecidable", "not-applicable"] as const;

const resolutionV1Schema = z.object({
  condition: z.string().min(1),
  finding: z.string().min(1),
  directive: z.string().min(1),
}).strict();

const resolutionV2Schema = z.object({
  condition: z.string().min(1),
  holds: z.enum(HOLDS),
  quote: z.string(),
  directive: z.string(),
}).strict();

export const policyReadingSchema = z.object({ resolutions: z.array(z.union([resolutionV1Schema, resolutionV2Schema])) }).strict();

export type PolicyReading = z.infer<typeof policyReadingSchema>;

/** Persisted readings: one reading per case id, produced by one reader under one contract. */
export const persistedReadingsSchema = z.object({
  readerId: z.string().min(1),
  readingContractSha256: z.string().regex(/^[a-f0-9]{64}$/),
  readings: z.record(z.string(), policyReadingSchema),
}).strict();

export type PersistedReadings = z.infer<typeof persistedReadingsSchema>;

/** Strict structured-output schema sent to the provider; derived once, hashed into the contract. */
export function readerResponseJsonSchema(version: ReaderContractVersion = 1): Record<string, unknown> {
  const properties = version === 1
    ? {
      condition: { type: "string", description: "The policy's own words for the condition, quoted from the excerpt." },
      finding: { type: "string", description: "What the request establishes about the condition, quoting the request." },
      directive: { type: "string", description: "One or two imperative sentences for the assistant that answers the request." },
    }
    : {
      condition: { type: "string", description: "The id of the listed condition this resolution answers." },
      holds: { type: "string", enum: [...HOLDS], description: "Whether the request's own words meet the condition as the policy states it." },
      quote: { type: "string", description: "The request's words that decide it, verbatim; empty when nothing in the request bears on it." },
      directive: { type: "string", description: "One imperative sentence for the assistant that answers the request; empty when not applicable." },
    };
  return {
    type: "object",
    properties: {
      resolutions: {
        type: "array",
        items: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
      },
    },
    required: ["resolutions"],
    additionalProperties: false,
  };
}

/** What the reader is shown: the clause slice, the request, and the structural context the planner declared. */
export function readerInput(slice: string, request: string, context: ArtifactContext | null | undefined): string {
  return [
    "Policy excerpt (the rules that apply to this request, quoted verbatim):",
    "",
    slice.trimEnd(),
    "",
    "Request:",
    request,
    "",
    "Declared context:",
    `- artifact type: ${context?.artifactType ?? "none declared"}`,
    `- operation: ${context?.operation ?? "none declared"}`,
    `- tools available on this turn: ${context?.toolsAvailable?.length ? context.toolsAvailable.join(", ") : "none"}`,
  ].join("\n");
}

/**
 * Contract 2 input: the slice, then the indexed conditions of the retained
 * clauses, each with its id, the policy's sentence, and the span the request
 * must meet. The `- id:` lines are the list the runtime checks a reading
 * against and the fake reader answers from.
 */
export function readerInputV2(slice: string, conditions: readonly PolicyCondition[], request: string, context: ArtifactContext | null | undefined): string {
  const list = conditions.flatMap((condition) => [
    `- id: ${condition.id}`,
    `  sentence: ${condition.sentence}`,
    `  condition: ${condition.condition}`,
  ]);
  return [
    "Policy excerpt (the rules that apply to this request, quoted verbatim):",
    "",
    slice.trimEnd(),
    "",
    "Conditions to resolve (each once, by id):",
    ...list,
    "",
    "Request:",
    request,
    "",
    "Declared context:",
    `- artifact type: ${context?.artifactType ?? "none declared"}`,
    `- operation: ${context?.operation ?? "none declared"}`,
    `- tools available on this turn: ${context?.toolsAvailable?.length ? context.toolsAvailable.join(", ") : "none"}`,
  ].join("\n");
}

export type ReaderContract = {
  version: ReaderContractVersion;
  instructions: string;
  promptSha256: string;
  responseSchema: Record<string, unknown>;
  readingContractSha256: string;
};

/** Hashes every input that can change a reading: the prompt, the response schema, the clause map (and for contract 2 the condition index), and the input envelope. */
export function readerContract(version: ReaderContractVersion = 1): ReaderContract {
  const instructions = readFileSync(READER_PROMPT_PATHS[version], "utf8");
  const promptSha256 = digest(instructions);
  const responseSchema = readerResponseJsonSchema(version);
  const probeContext: ArtifactContext = { artifactType: "email", operation: "send", toolsAvailable: ["gmail", "calendar"] };
  // Key order is fixed by construction, so the plain JSON text is canonical.
  const identity = version === 1
    ? { promptSha256, responseSchema, clauseMapHash: CLAUSE_MAP_HASH, inputEnvelopeSha256: digest(readerInput("<slice>", "<request>", probeContext)) }
    : {
      contractVersion: 2, promptSha256, responseSchema, clauseMapHash: CLAUSE_MAP_HASH, conditionIndexHash: CONDITION_INDEX_HASH,
      inputEnvelopeSha256: digest(readerInputV2("<slice>", [{ clause: "<clause>", id: "<id>", sentence: "<sentence>", condition: "<condition>" }], "<request>", probeContext)),
    };
  return { version, instructions, promptSha256, responseSchema, readingContractSha256: digest(JSON.stringify(identity)) };
}

/** The contract a persisted readings file was produced under, or a refusal when it matches neither. */
export function identifyReaderContract(readingContractSha256: string): ReaderContract {
  for (const version of [1, 2] as const) {
    const contract = readerContract(version);
    if (contract.readingContractSha256 === readingContractSha256) return contract;
  }
  throw new Error(`policy reading contract ${readingContractSha256} matches neither running contract; re-read the cases`);
}

function digest(text: string): string { return createHash("sha256").update(text).digest("hex"); }

/** Names the reader: model, optional provider reasoning effort, and the contract it read under. */
export function readerId(model: string, readingContractSha256 = readerContract().readingContractSha256, reasoningEffort?: string): string {
  return `reader:${model}${reasoningEffort ? `:${reasoningEffort}` : ""}:${readingContractSha256.slice(0, 12)}`;
}

export function parsePersistedReadings(raw: unknown, expectedReadingContractSha256: string): PersistedReadings {
  const persisted = persistedReadingsSchema.parse(raw);
  if (persisted.readingContractSha256 !== expectedReadingContractSha256) {
    throw new Error(`policy reading contract ${persisted.readingContractSha256} does not match running contract ${expectedReadingContractSha256}; re-read the cases`);
  }
  if (!persisted.readerId.endsWith(`:${expectedReadingContractSha256.slice(0, 12)}`)) {
    throw new Error(`policy reader id ${persisted.readerId} does not name contract ${expectedReadingContractSha256}; re-read the cases`);
  }
  return persisted;
}

/**
 * Renders the directives after the clause slice. Only the directives are
 * emitted: the condition, finding, holds, and quote stay in the artifact,
 * because quoting the evidence beside the rule made the answering model
 * re-verify it (canary v2). A contract-2 resolution with an empty directive
 * (a condition the request does not touch) renders nothing. An empty reading
 * renders nothing.
 */
export function renderReading(reading: Pick<PolicyReadingRecord, "resolutions">): string {
  const directives = reading.resolutions.map((resolution) => resolution.directive.trim()).filter(Boolean);
  if (!directives.length) return "";
  const lines = ["", "## Directives for this request", "", "The following directives resolve the policy above for this request.", ""];
  for (const directive of directives) lines.push(`- ${directive}`);
  lines.push("");
  return lines.join("\n");
}
