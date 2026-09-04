import type { ArtifactContext, Policy, PolicySelection, PolicySelectionReason } from "../policy/types.js";
import { computeDependencyClosure } from "../policy/closure.js";
import { selectPolicies } from "../policy/selector.js";
import type { CompilationStrategy } from "./artifact.js";
import type { AuthorizationReader } from "./authorization.js";
import { specializeSelection } from "./specialize.js";

/**
 * Builds every candidate strategy for one request. `reader` is the authorization
 * reader the specialization stage uses; the planner passes the same reader for
 * every candidate so a run's artifacts are produced under one read, and the
 * artifact trace records what it returned.
 */
export function generateCandidateSelections(policies: Policy[], input: string, context?: ArtifactContext | null, reader?: AuthorizationReader): Array<{ strategy: CompilationStrategy; selection: PolicySelection }> {
  const compiled = selectPolicies(policies, { input, context });
  const directIds = new Set(compiled.reasons.filter((reason) => !reason.reasons.every((item) => item === "dependency closure")).map((reason) => reason.policyId));
  const directPolicies = compiled.policies.filter((policy) => directIds.has(policy.id));
  const directReasons = compiled.reasons.filter((reason) => directIds.has(reason.policyId)).map((reason) => ({ ...reason, dependencyOf: undefined }));
  const kernel = policies.filter((policy) => policy.alwaysActive);
  const expandedSeeds = uniquePolicies([...compiled.policies, ...policies.filter((policy) => policy.kind === "content_gated" && ["safety", "privacy", "tool"].includes(policy.severity))]);
  const expandedReasons: PolicySelectionReason[] = expandedSeeds.map((policy) => compiled.reasons.find((reason) => reason.policyId === policy.id) ?? { policyId: policy.id, reasons: ["conservative expansion"] });
  const specialize = (selection: PolicySelection) => specializeSelection(selection, input, context, reader);

  return [
    { strategy: "full_policy", selection: selectionFrom(policies, policies, policies.map((policy) => ({ policyId: policy.id, reasons: ["full policy baseline"] })), compiled.detectedIntents, []) },
    { strategy: "compiler_slice", selection: specialize(compiled) },
    { strategy: "kernel_only", selection: specialize(selectionFrom(policies, kernel, kernel.map((policy) => ({ policyId: policy.id, reasons: ["always-active kernel"] })), compiled.detectedIntents, [])) },
    { strategy: "direct_matches", selection: specialize(selectionFrom(policies, directPolicies, directReasons, compiled.detectedIntents, [])) },
    { strategy: "conservative_expanded", selection: specialize(selectionFrom(policies, expandedSeeds, expandedReasons, compiled.detectedIntents, "closure")) }
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
