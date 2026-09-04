import { readFileSync } from "node:fs";
import type { ArtifactContext } from "../policy/types.js";
import { canonicalJson, sha256 } from "../compiler/artifact.js";
import {
  fieldAssignments,
  fieldContract,
  requiredFieldRules,
  type RequiredField,
} from "../ir/deterministicFrontend.js";
import { extractorResponseJsonSchema } from "../ir/persistedFrontend.js";

export const EXTRACTOR_PROMPT_PATH = "prompts/request-state-extractor.md";

export function inputBlock(
  request: string,
  context: ArtifactContext | null,
  requiredFields: Pick<RequiredField, "name" | "description">[],
): string {
  const lines = [
    "Request:",
    request,
    "",
    "Declared context:",
    `- artifact type: ${context?.artifactType ?? "none declared"}`,
    `- operation: ${context?.operation ?? "none declared"}`,
    `- features: ${context?.features?.length ? context.features.join(", ") : "none"}`,
    `- domain hints: ${context?.domainHints?.length ? context.domainHints.join(", ") : "none"}`,
    `- risk hints: ${context?.riskHints?.length ? context.riskHints.join(", ") : "none"}`,
    `- tools available on this turn: ${context?.toolsAvailable?.length ? context.toolsAvailable.join(", ") : "none"}`,
    `- tools requested for this turn: ${context?.toolsRequested?.length ? context.toolsRequested.join(", ") : "none"}`,
    `- required fields for this operation: ${requiredFields.length ? "" : "none"}`,
    ...requiredFields.map((field) => `  - ${field.name}: ${field.description}`),
  ];
  return lines.join("\n");
}

export type InputEnvelopeContractProbe = { id: string; envelope: string };

/**
 * Canonical outputs for every branch of the request envelope. The contract
 * hashes behavior rather than a build-dependent function string: null and
 * explicitly empty context, every populated context list with multiple values,
 * and zero/one/many required fields.
 */
export function inputEnvelopeContractProbes(): InputEnvelopeContractProbe[] {
  const fields = fieldContract();
  const emptyContext: ArtifactContext = {
    features: [],
    domainHints: [],
    riskHints: [],
    toolsAvailable: [],
    toolsRequested: [],
  };
  const populatedContext: ArtifactContext = {
    artifactType: "document",
    operation: "update",
    features: ["slides", "charts"],
    domainHints: ["contract-probe-domain-a", "contract-probe-domain-b"],
    riskHints: ["contract-probe-risk-a", "contract-probe-risk-b"],
    toolsAvailable: ["slides_edit", "file_inspect"],
    toolsRequested: ["web", "pdf_read"],
  };
  return [
    { id: "null-context-zero-fields", envelope: inputBlock("Contract probe with null context.", null, []) },
    { id: "empty-context-one-field", envelope: inputBlock("Contract probe with empty context.", emptyContext, fields.slice(0, 1)) },
    { id: "populated-context-many-fields", envelope: inputBlock("Contract probe request.\nSecond request line.", populatedContext, fields.slice(0, 3)) },
  ];
}

export type ExtractorContractIdentity = {
  promptSha256: string;
  fieldInventory: ReturnType<typeof fieldContract>;
  fieldAssignments: ReturnType<typeof fieldAssignments>;
  responseSchema: Record<string, unknown>;
  inputEnvelopeSha256: string;
};

export type ExtractorContract = ExtractorContractIdentity & {
  instructions: string;
  readContractSha256: string;
};
 
export function extractorContractHash(identity: ExtractorContractIdentity): string {
  return sha256(canonicalJson(identity));
}

/** Hashes every semantic input that can change an extractor read. */
export function extractorContract(): ExtractorContract {
  const instructions = readFileSync(EXTRACTOR_PROMPT_PATH, "utf8");
  const promptSha256 = sha256(instructions);
  const fieldInventory = fieldContract();
  const assignments = fieldAssignments();
  const responseSchema = extractorResponseJsonSchema();
  const inputEnvelopeSha256 = sha256(canonicalJson(inputEnvelopeContractProbes()));
  const identity = {
    promptSha256,
    fieldInventory,
    fieldAssignments: assignments,
    responseSchema,
    inputEnvelopeSha256,
  };
  return {
    instructions,
    ...identity,
    readContractSha256: extractorContractHash(identity),
  };
}

export function extractorFrontendId(model: string, readContractSha256 = extractorContract().readContractSha256): string {
  return `extractor:${model}:${readContractSha256.slice(0, 12)}`;
}
