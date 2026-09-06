import type { ArtifactContext, Policy, PolicySelection, PolicySelectionReason } from "../policy/types.js";
import { computeDependencyClosure } from "../policy/closure.js";
import { selectPolicies } from "../policy/selector.js";
import type { CompilationStrategy } from "./artifact.js";
import type { Frontend } from "../ir/requestState.js";
import { defaultFrontend, evaluateSelection } from "./evaluate.js";
import { projectSourceSelection } from "./sourceSlice.js";
import { projectSourceClauses } from "./sourceClauses.js";
import { bindSourceEvidence } from "./sourceEvidence.js";
import { policyConditionsRecord } from "./conditionList.js";
import type { PolicyReadingRecord } from "../policy/types.js";

/**
 * Builds every candidate strategy for one request. The frontend is read once
 * here and that state is passed to every candidate, so a run's artifacts for
 * one case share one read even when the frontend is paid or nondeterministic.
 * Every compiled candidate records the state and every evaluation; the
 * full-policy baseline records the state only.
 */
export function generateCandidateSelections(policies: Policy[], input: string, context?: ArtifactContext | null, frontend?: Frontend, sourcePolicyText?: string, reading?: PolicyReadingRecord): Array<{ strategy: CompilationStrategy; selection: PolicySelection }> {
  const state = (frontend ?? defaultFrontend)(input, context);
  const compiled = selectPolicies(policies, { input, context, state });
  const directIds = new Set(compiled.reasons.filter((reason) => !reason.reasons.every((item) => item === "dependency closure")).map((reason) => reason.policyId));
  const directPolicies = compiled.policies.filter((policy) => directIds.has(policy.id));
  const directReasons = compiled.reasons.filter((reason) => directIds.has(reason.policyId)).map((reason) => ({ ...reason, dependencyOf: undefined }));
  const kernel = policies.filter((policy) => policy.alwaysActive);
  const expandedSeeds = uniquePolicies([...compiled.policies, ...policies.filter((policy) => policy.kind === "content_gated" && ["safety", "privacy", "tool"].includes(policy.severity))]);
  const expandedReasons: PolicySelectionReason[] = expandedSeeds.map((policy) => compiled.reasons.find((reason) => reason.policyId === policy.id) ?? { policyId: policy.id, reasons: ["conservative expansion"] });
  const specialize = (selection: PolicySelection) => evaluateSelection(selection, state);
  const compilerSelection = specialize(compiled);

  const candidates: Array<{ strategy: CompilationStrategy; selection: PolicySelection }> = [
    // The full-policy baseline is not compiled: its prompt is the source text.
    // It records the same request state so the paired artifacts share one read.
    { strategy: "full_policy", selection: { ...selectionFrom(policies, policies, policies.map((policy) => ({ policyId: policy.id, reasons: ["full policy baseline"] })), compiled.detectedIntents, []), requestState: state, evaluations: [], conflicts: [] } },
    { strategy: "compiler_slice", selection: compilerSelection },
    { strategy: "kernel_only", selection: specialize(selectionFrom(policies, kernel, kernel.map((policy) => ({ policyId: policy.id, reasons: ["always-active kernel"] })), compiled.detectedIntents, [])) },
    { strategy: "direct_matches", selection: specialize(selectionFrom(policies, directPolicies, directReasons, compiled.detectedIntents, [])) },
    { strategy: "conservative_expanded", selection: specialize(selectionFrom(policies, expandedSeeds, expandedReasons, compiled.detectedIntents, "closure")) }
  ];
  if (sourcePolicyText !== undefined) {
    const shared = projectSourceSelection(policies, { ...compiled, requestState: state, evaluations: [], conflicts: [] }, sourcePolicyText);
    candidates.push(
      { strategy: "source_preserving_slice", selection: shared },
      { strategy: "source_matched_authored", selection: shared },
      { strategy: "source_matched_semantic", selection: { ...compilerSelection, sourceSelection: shared.sourceSelection } },
    );
    const clause = projectSourceClauses(policies, { ...compiled, requestState: state, evaluations: [], conflicts: [] }, sourcePolicyText, context);
    const evidence = { ...clause, sourceEvidence: bindSourceEvidence(input, context, clause.sourceClauseSelection!) };
    // The listed conditions are a structural projection of the retained clauses onto the frozen index.
    const policyConditions = policyConditionsRecord(clause.sourceClauseSelection!);
    candidates.push(
      { strategy: "source_clause_slice", selection: clause },
      { strategy: "source_evidence_bare", selection: evidence },
      { strategy: "source_evidence_apply", selection: evidence },
      { strategy: "condition_list_slice", selection: { ...clause, policyConditions } },
    );
    // The reader arm exists only when a persisted reading was supplied for
    // this request; without one the arm is undefined, not silently the slice.
    if (reading) candidates.push({ strategy: "model_reader_slice", selection: { ...clause, policyReading: reading, policyConditions } });
  }
  return candidates;
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
