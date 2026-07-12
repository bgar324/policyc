import type { ArtifactContext, Policy, PolicySelection, PolicySelectionReason } from "../policy/types.js";
import { computeDependencyClosure } from "../policy/closure.js";
import { selectPolicies } from "../policy/selector.js";
import type { CompilationStrategy } from "./artifact.js";

export function generateCandidateSelections(policies: Policy[], input: string, context?: ArtifactContext | null): Array<{ strategy: CompilationStrategy; selection: PolicySelection }> {
  const compiled = selectPolicies(policies, { input, context });
  const directIds = new Set(compiled.reasons.filter((reason) => !reason.reasons.every((item) => item === "dependency closure")).map((reason) => reason.policyId));
  const directPolicies = compiled.policies.filter((policy) => directIds.has(policy.id));
  const directReasons = compiled.reasons.filter((reason) => directIds.has(reason.policyId)).map((reason) => ({ ...reason, dependencyOf: undefined }));
  const kernel = policies.filter((policy) => policy.alwaysActive);
  const expandedSeeds = uniquePolicies([...compiled.policies, ...policies.filter((policy) => policy.kind === "content_gated" && ["safety", "privacy", "tool"].includes(policy.severity))]);
  const expandedReasons: PolicySelectionReason[] = expandedSeeds.map((policy) => compiled.reasons.find((reason) => reason.policyId === policy.id) ?? { policyId: policy.id, reasons: ["conservative expansion"] });

  return [
    { strategy: "full_policy", selection: selectionFrom(policies, policies, policies.map((policy) => ({ policyId: policy.id, reasons: ["full policy baseline"] })), compiled.detectedIntents, []) },
    { strategy: "compiler_slice", selection: compiled },
    { strategy: "kernel_only", selection: selectionFrom(policies, kernel, kernel.map((policy) => ({ policyId: policy.id, reasons: ["always-active kernel"] })), compiled.detectedIntents, []) },
    { strategy: "direct_matches", selection: selectionFrom(policies, directPolicies, directReasons, compiled.detectedIntents, []) },
    { strategy: "conservative_expanded", selection: selectionFrom(policies, expandedSeeds, expandedReasons, compiled.detectedIntents, "closure") }
  ];
}

function selectionFrom(all: Policy[], seeds: Policy[], reasons: PolicySelectionReason[], intents: PolicySelection["detectedIntents"], close: "closure" | []): PolicySelection {
  if (close === "closure") {
    const result = computeDependencyClosure(all, seeds, reasons);
    return { policies: result.policies.sort(compare), reasons: result.reasons.sort((a, b) => index(result.policies, a.policyId) - index(result.policies, b.policyId)), detectedIntents: intents, dependencyEdges: result.edges };
  }
  return { policies: [...seeds].sort(compare), reasons: reasons.sort((a, b) => a.policyId.localeCompare(b.policyId)), detectedIntents: intents, dependencyEdges: [] };
}

function compare(a: Policy, b: Policy): number { return b.priority - a.priority || a.id.localeCompare(b.id); }
function index(policies: Policy[], id: string): number { return policies.findIndex((policy) => policy.id === id); }
function uniquePolicies(policies: Policy[]): Policy[] { return [...new Map(policies.map((policy) => [policy.id, policy])).values()]; }
