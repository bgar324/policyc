import { createHash } from "node:crypto";
import type { ArtifactContext, Policy, PolicySelection, PolicySelectionReason } from "../policy/types.js";
import { emitRuntimePrompt } from "./emitter.js";
import { countTokens, type TokenCount } from "./tokenCounter.js";

export const PROTOCOL_VERSION = "1.0.0";
export const COMPILER_VERSION = "0.7.0";
export type CompilationStrategy = "full_policy" | "compiler_slice" | "kernel_only" | "direct_matches" | "conservative_expanded";

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
  const compiledPrompt = options.strategy === "full_policy"
    ? options.sourcePolicyText
    : emitRuntimePrompt(options.selection, options.request, options.context);
  const stableCore = {
    schemaVersion: PROTOCOL_VERSION,
    compilerVersion: COMPILER_VERSION,
    policyPackHash: sha256(canonicalJson(options.policies.map(stripPack))),
    sourcePolicyId: options.sourcePolicyId,
    sourcePolicyHash: sha256(options.sourcePolicyText),
    request: options.request,
    artifactContext: options.context ?? null,
    selectedPolicyIds: options.selection.policies.map((policy) => policy.id),
    directlySelectedPolicyIds: direct,
    dependencyAddedPolicyIds: options.selection.policies.map((policy) => policy.id).filter((id) => !directSet.has(id)),
    criticalPolicyIds: options.selection.policies.filter((policy) => ["safety", "privacy", "tool"].includes(policy.severity)).map((policy) => policy.id),
    dependencyEdges: [...options.selection.dependencyEdges].sort((a, b) => `${a.from}:${a.requires}`.localeCompare(`${b.from}:${b.requires}`)),
    selectionReasons: options.selection.policies.map((policy) => options.selection.reasons.find((reason) => reason.policyId === policy.id) ?? { policyId: policy.id, reasons: ["selected"] }),
    orderedRuntimeInstructions: options.selection.policies.map((policy) => policy.runtimeInstruction).filter(Boolean),
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
