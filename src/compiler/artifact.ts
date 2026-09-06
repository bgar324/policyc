import { createHash } from "node:crypto";
import type { ArtifactContext, EvaluationRecord, Policy, PolicySelection, PolicySelectionReason } from "../policy/types.js";
import type { RequestState } from "../ir/requestState.js";
import { emitRuntimePrompt } from "./emitter.js";
import { countTokens, type TokenCount } from "./tokenCounter.js";
import { emitSourceSections, SOURCE_POLICY_SHA256 } from "./sourceSlice.js";
import { emitSourceClauses } from "./sourceClauses.js";
import { renderEvidence } from "./sourceEvidence.js";
import { renderReading } from "./policyReader.js";
import { renderConditionList } from "./conditionList.js";

export const PROTOCOL_VERSION = "1.3.0";
export const COMPILER_VERSION = "0.10.0";
export type CompilationStrategy = "full_policy" | "compiler_slice" | "kernel_only" | "direct_matches" | "conservative_expanded"
  | "source_preserving_slice" | "source_matched_authored" | "source_matched_semantic" | "source_clause_slice"
  | "source_evidence_bare" | "source_evidence_apply" | "model_reader_slice" | "condition_list_slice";

export type CompiledPolicyArtifact = {
  schemaVersion: string;
  compilerVersion: string;
  candidateId: string;
  policyPackHash: string;
  sourcePolicyId: string;
  sourcePolicyHash: string;
  request: string;
  artifactContext: ArtifactContext | null;
  selectedPolicyIds: string[];
  directlySelectedPolicyIds: string[];
  dependencyAddedPolicyIds: string[];
  criticalPolicyIds: string[];
  dependencyEdges: Array<{ from: string; requires: string }>;
  selectionReasons: PolicySelectionReason[];
  sourceSelection?: PolicySelection["sourceSelection"];
  sourceClauseSelection?: PolicySelection["sourceClauseSelection"];
  sourceEvidence?: PolicySelection["sourceEvidence"];
  policyReading?: PolicySelection["policyReading"];
  policyConditions?: PolicySelection["policyConditions"];
  requestState: RequestState | null;
  evaluations: EvaluationRecord[];
  conflicts: string[];
  orderedRuntimeInstructions: string[];
  compiledPrompt: string;
  compiledPromptHash: string;
  tokenCount: TokenCount;
  compilationStrategy: CompilationStrategy;
  createdAt: string;
};

export function createArtifact(options: {
  policies: Policy[];
  selection: PolicySelection;
  request: string;
  context?: ArtifactContext | null;
  strategy: CompilationStrategy;
  sourcePolicyId: string;
  sourcePolicyText: string;
  model?: string;
  createdAt?: string;
}): CompiledPolicyArtifact {
  const direct = options.selection.reasons.filter((reason) => !reason.reasons.every((value) => value === "dependency closure")).map((reason) => reason.policyId);
  const directSet = new Set(direct);
  const sectionArm = options.strategy === "source_preserving_slice" || options.strategy === "source_matched_authored" || options.strategy === "source_matched_semantic";
  const evidenceFrame = options.strategy === "source_evidence_bare" ? "bare" : options.strategy === "source_evidence_apply" ? "apply" : undefined;
  const readerArm = options.strategy === "model_reader_slice";
  const conditionArm = options.strategy === "condition_list_slice";
  const clauseArm = options.strategy === "source_clause_slice" || evidenceFrame !== undefined || readerArm || conditionArm;
  const experimental = sectionArm || clauseArm;
  const sourcePolicyHash = sha256(options.sourcePolicyText);
  const sourceSelection = sectionArm ? options.selection.sourceSelection : undefined;
  const sourceClauseSelection = clauseArm ? options.selection.sourceClauseSelection : undefined;
  const sourceEvidence = evidenceFrame ? options.selection.sourceEvidence : undefined;
  const policyReading = readerArm ? options.selection.policyReading : undefined;
  // The listed conditions are provenance for the arm that renders them and for a contract-2 reading, which answered them.
  const policyConditions = conditionArm || (readerArm && policyReading?.resolutions.some((resolution) => "holds" in resolution)) ? options.selection.policyConditions : undefined;
  let sourcePrompt: string | undefined;
  let compiledPrompt: string;
  if (experimental && sourcePolicyHash !== SOURCE_POLICY_SHA256) throw new Error("Source artifact does not match the audited source map");
  if (clauseArm) {
    if (!sourceClauseSelection) throw new Error(`${options.strategy} requires a clause-projected selection`);
    if (evidenceFrame && !sourceEvidence) throw new Error(`${options.strategy} requires bound evidence`);
    if (readerArm && !policyReading) throw new Error(`${options.strategy} requires a persisted reading`);
    if (conditionArm && !policyConditions) throw new Error(`${options.strategy} requires the listed conditions`);
    const slice = emitSourceClauses(options.sourcePolicyText, sourceClauseSelection);
    compiledPrompt = evidenceFrame && sourceEvidence
      ? `${slice}\n${renderEvidence(sourceEvidence, sourceClauseSelection, options.sourcePolicyText, evidenceFrame)}`
      : policyReading ? `${slice}${renderReading(policyReading)}`
      : conditionArm && policyConditions ? `${slice}${renderConditionList(policyConditions)}`
      : slice;
  } else if (sectionArm) {
    if (!sourceSelection) throw new Error(`${options.strategy} requires a source-projected selection`);
    sourcePrompt = emitSourceSections(options.sourcePolicyText, sourceSelection, options.strategy !== "source_preserving_slice");
    compiledPrompt = options.strategy === "source_preserving_slice"
      ? sourcePrompt
      : `${sourcePrompt}\n${emitRuntimePrompt(options.selection, options.request, options.context)}`;
  } else {
    compiledPrompt = options.strategy === "full_policy" ? options.sourcePolicyText : emitRuntimePrompt(options.selection, options.request, options.context);
  }
  const stableCore = {
    schemaVersion: experimental ? "1.4.0" : PROTOCOL_VERSION,
    compilerVersion: experimental ? "0.10.0-source-slice.1" : COMPILER_VERSION,
    policyPackHash: sha256(canonicalJson(options.policies.map(stripPack))),
    sourcePolicyId: options.sourcePolicyId,
    sourcePolicyHash,
    request: options.request,
    artifactContext: options.context ?? null,
    selectedPolicyIds: options.selection.policies.map((policy) => policy.id),
    directlySelectedPolicyIds: direct,
    dependencyAddedPolicyIds: options.selection.policies.map((policy) => policy.id).filter((id) => !directSet.has(id)),
    criticalPolicyIds: options.selection.policies.filter((policy) => ["safety", "privacy", "tool"].includes(policy.severity)).map((policy) => policy.id),
    dependencyEdges: [...options.selection.dependencyEdges].sort((a, b) => `${a.from}:${a.requires}`.localeCompare(`${b.from}:${b.requires}`)),
    selectionReasons: options.selection.policies.map((policy) => options.selection.reasons.find((reason) => reason.policyId === policy.id) ?? { policyId: policy.id, reasons: ["selected"] }),
    ...(sourceSelection ? { sourceSelection } : {}),
    ...(sourceClauseSelection ? { sourceClauseSelection } : {}),
    ...(sourceEvidence ? { sourceEvidence } : {}),
    ...(policyReading ? { policyReading } : {}),
    ...(policyConditions ? { policyConditions } : {}),
    requestState: options.selection.requestState ?? null,
    evaluations: options.selection.evaluations ?? [],
    conflicts: options.selection.conflicts ?? [],
    orderedRuntimeInstructions: options.strategy === "source_preserving_slice" || clauseArm
      ? [compiledPrompt]
      : [...(sourcePrompt === undefined ? [] : [sourcePrompt]), ...options.selection.policies.map((policy) => policy.runtimeInstruction).filter(Boolean)],
    compiledPrompt,
    compiledPromptHash: sha256(compiledPrompt),
    tokenCount: countTokens(compiledPrompt, options.model),
    compilationStrategy: options.strategy
  };
  return { ...stableCore, candidateId: `cand_${sha256(canonicalJson(stableCore)).slice(0, 16)}`, createdAt: options.createdAt ?? new Date().toISOString() };
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortValue(item)]));
  return value;
}

function stripPack(policy: Policy): Omit<Policy, "pack"> {
  const { pack: _pack, ...rest } = policy;
  return rest;
}
