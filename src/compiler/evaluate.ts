import type { ArtifactContext, EvaluationRecord, Obligation, Policy, PolicySelection } from "../policy/types.js";
import { selectPolicies } from "../policy/selector.js";
import { evaluateCondition } from "../ir/conditions.js";
import { deterministicFrontend } from "../ir/deterministicFrontend.js";
import { guardedFrontend, type Frontend, type RequestState } from "../ir/requestState.js";
import { limitInstruction } from "./limits.js";
import type { AuthorizationReader } from "./authorization.js";

/** The frontend used when none is injected: the deterministic baseline, guarded. */
export const defaultFrontend: Frontend = guardedFrontend(deterministicFrontend(), "deterministic");

/** Builds a guarded frontend around an injected authorization reader. */
export function frontendWithReader(reader: AuthorizationReader): Frontend {
  return guardedFrontend(deterministicFrontend(reader), "deterministic");
}

/** Selection, then partial evaluation: the one path every emitted compiled prompt goes through. */
export function compileSelection(policies: Policy[], input: string, context?: ArtifactContext | null, frontend: Frontend = defaultFrontend): PolicySelection {
  return evaluateSelection(selectPolicies(policies, { input, context }), input, context, frontend);
}

const isToolBound = (obligation: Obligation) => obligation.type === "call_tool" || obligation.type === "inspect_artifact";

/**
 * Partial evaluation. Runs after selection and dependency closure and before
 * emission. It never adds or removes policies. For each selected node:
 *
 *  1. Its branches are evaluated in order against the request state. The first
 *     branch whose condition is decided true replaces the node's instruction,
 *     obligations, and prohibitions. An unknown condition does not match, so an
 *     undecidable request falls through to the node's conservative default.
 *
 *  2. The request-level limit is applied: when the user has bounded the turn to
 *     text (limit `limited`) or the reading is ambiguous, the node's tool-bound
 *     obligations are withheld, unless the node is `mandated` by the source
 *     policy or a branch that proved the exact action and every required field
 *     has just matched and the limit is only `ambiguous`. These two exceptions
 *     are the only precedence in the compiler, and both are declared: one on
 *     the node, one by the branch's own condition.
 *
 *  3. Emission precedence that the source policy states: an inspection
 *     obligation is withheld beside an ask-for-confirmation obligation (ask
 *     outranks act) and when the request's purpose is one the policy forbids
 *     serving (declining outranks inspecting for that purpose).
 *
 * The request state and every branch evaluation are recorded on the selection
 * and persisted in the artifact.
 */
export function evaluateSelection(selection: PolicySelection, input: string, context: ArtifactContext | null | undefined, frontend: Frontend = defaultFrontend): PolicySelection {
  const state = frontend(input, context);
  const evaluations: EvaluationRecord[] = [];

  // Pass 1: per-node branch evaluation. Each node resolves independently.
  const resolved = selection.policies.map((policy) => {
    for (const branch of policy.branches ?? []) {
      const result = evaluateCondition(branch.when, state);
      evaluations.push({ policyId: policy.id, branchId: branch.id, truth: result.truth, evidence: result.evidence });
      if (result.truth === "true") {
        const proved = branch.when.authorization === "present" && branch.when.fields === "complete";
        return { policy: { ...policy, runtimeInstruction: branch.runtimeInstruction, obligations: branch.obligations, prohibitions: branch.prohibitions }, proved };
      }
    }
    return { policy, proved: false };
  });

  // Pass 2: cross-node precedence, derived from the resolved set, not the
  // authored one. A branch that removed ask_confirmation must not still count
  // as asking.
  const asksFirst = resolved.some(({ policy }) => policy.obligations.some((obligation) => obligation.type === "ask_confirmation"));
  const purposeForbidden = state.purpose !== "none";
  const anyProved = resolved.some(({ proved }) => proved);

  const policies = resolved.map(({ policy, proved }) => {
    let next = policy;
    const limitApplies = !policy.mandated && (state.limit === "limited" || (state.limit === "ambiguous" && !proved));
    if (limitApplies && next.obligations.some(isToolBound)) {
      evaluations.push({ policyId: policy.id, branchId: "limit", truth: "true", evidence: [`limit is ${state.limit}; tool obligations withheld`] });
      next = { ...next, obligations: next.obligations.filter((obligation) => !isToolBound(obligation)) };
    }
    if ((asksFirst || purposeForbidden) && next.obligations.some((obligation) => obligation.type === "inspect_artifact")) {
      evaluations.push({ policyId: policy.id, branchId: "inspection_precedence", truth: "true", evidence: [asksFirst ? "ask outranks inspect" : `purpose ${state.purpose} outranks inspect`] });
      next = { ...next, obligations: next.obligations.filter((obligation) => obligation.type !== "inspect_artifact") };
    }
    return next;
  });

  const anyMandated = selection.policies.some((policy) => policy.mandated);
  const emitLimit = !anyMandated && (state.limit === "limited" || (state.limit === "ambiguous" && !anyProved));
  const limit = emitLimit && state.limit !== "none" ? { verdict: state.limit, instruction: limitInstruction(state.limit, state.toolsAvailable) } : undefined;

  return { ...selection, policies, requestState: state, evaluations, limit, conflicts: findConflicts(policies, limit !== undefined) };
}

/**
 * Compile-time consistency: contradictions between resolved nodes that a paid
 * run would otherwise be the first to reveal. Each conflict names both nodes.
 * The emitter still prints a conflicting program; the record makes it visible
 * offline, in the artifact and in the corpus tests.
 */
export function findConflicts(policies: Policy[], limited: boolean): string[] {
  const conflicts: string[] = [];
  const requires = new Map<string, string[]>();
  const forbids = new Map<string, string[]>();
  const executes: string[] = [];
  const asks: string[] = [];
  for (const policy of policies) {
    for (const obligation of policy.obligations) {
      if (obligation.type === "call_tool" && obligation.value) push(requires, obligation.value.toLowerCase(), policy.id);
      if (obligation.type === "ask_confirmation") asks.push(policy.id);
    }
    for (const prohibition of policy.prohibitions) {
      if (prohibition.type === "forbidden_tool_call" && prohibition.value) push(forbids, prohibition.value.toLowerCase(), policy.id);
    }
    if (policy.branches?.length && !policy.obligations.some((obligation) => obligation.type === "ask_confirmation")
      && policy.obligations.some((obligation) => obligation.type === "call_tool")) {
      executes.push(policy.id);
    }
  }
  for (const [tool, requirers] of requires) {
    const forbidders = forbids.get(tool);
    if (forbidders) conflicts.push(`tool ${tool} required by ${requirers.join(", ")} and forbidden by ${forbidders.join(", ")}`);
    if (limited) conflicts.push(`tool ${tool} required by ${requirers.join(", ")} while the turn is limited to text`);
  }
  if (executes.length && asks.length) conflicts.push(`${executes.join(", ")} resolved to execute while ${asks.join(", ")} still asks for confirmation`);
  return conflicts;
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export type { RequestState };
