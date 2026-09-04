import type { ArtifactContext, EvaluationRecord, Policy, PolicyBranch, PolicySelection } from "../policy/types.js";
import { selectPolicies } from "../policy/selector.js";
import { evaluateCondition } from "../ir/conditions.js";
import { deterministicFrontend } from "../ir/deterministicFrontend.js";
import { guardedFrontend, type Frontend, type RequestState } from "../ir/requestState.js";
import { callEffect, MASK_ORIGIN, maskFor, stateMasks, type Mask } from "../ir/obligations.js";
import { limitInstruction } from "./limits.js";

/** The frontend used when none is injected: the deterministic baseline, guarded. */
export const defaultFrontend: Frontend = guardedFrontend(deterministicFrontend(), "deterministic");

/** One read, then selection and partial evaluation: the path a single compiled prompt goes through. */
export function compileSelection(policies: Policy[], input: string, context?: ArtifactContext | null, frontend: Frontend = defaultFrontend): PolicySelection {
  const state = frontend(input, context);
  return evaluateSelection(selectPolicies(policies, { input, context, state }), state);
}

/**
 * Partial evaluation. Runs after selection and dependency closure and before
 * emission. It takes the request state, never a frontend: the frontend is read
 * exactly once per request by the caller, so every candidate compiled for one
 * request is evaluated against the same read, whatever that read cost. It
 * never adds or removes policies, and the emitter prints what it returns
 * without further judgment. Three ordered steps, each recorded on the
 * selection and persisted in the artifact:
 *
 *  1. Branches. Each node's declared branches are evaluated in order against
 *     the request state; the first decided true replaces the node's text,
 *     obligations, and prohibitions. Unknown does not match, so an undecidable
 *     request falls through to the node's conservative default.
 *
 *  2. Masks. The active masks are the state's (`src/ir/obligations.ts`) plus
 *     `ask` when the resolved program asks for confirmation. Every obligation
 *     of a type that yields to an active mask is withheld, unless the node is
 *     `mandated` and the mask is of user origin. The limit instruction is
 *     emitted when a user-origin mask is active and no selected node is
 *     mandated, because printing "do not call tools" beside a node the source
 *     policy mandates to call one would contradict it.
 *
 *  3. Lowering. A tool obligation whose tool is not available on this turn
 *     cannot be met; the node emits the unavailable-tool statement instead and
 *     the obligation is dropped. Skipped when the context declares no tool list.
 */
export function evaluateSelection(selection: PolicySelection, state: RequestState): PolicySelection {
  const evaluations: EvaluationRecord[] = [];

  const resolved = selection.policies.map((policy) => {
    // Every branch is evaluated and recorded; the first decided true is taken.
    let taken: PolicyBranch | undefined;
    for (const branch of policy.branches ?? []) {
      const result = evaluateCondition(branch.when, state);
      evaluations.push({ policyId: policy.id, branchId: branch.id, truth: result.truth, evidence: result.evidence });
      if (result.truth === "true") taken ??= branch;
    }
    return taken ? { ...policy, runtimeInstruction: taken.runtimeInstruction, obligations: taken.obligations, prohibitions: taken.prohibitions } : policy;
  });

  const active = stateMasks(state);
  if (resolved.some((policy) => policy.obligations.some((obligation) => obligation.type === "ask_confirmation"))) active.add("ask");

  const masked = resolved.map((policy) => {
    const withheld = new Map<Mask, string[]>();
    const obligations = policy.obligations.filter((obligation) => {
      const mask = maskFor(obligation, active, policy.mandated === true, state);
      if (!mask) return true;
      withheld.set(mask, [...(withheld.get(mask) ?? []), obligation.value ? `${obligation.type} ${obligation.value}` : obligation.type]);
      return false;
    });
    for (const [mask, names] of withheld) {
      evaluations.push({ policyId: policy.id, branchId: `mask:${mask}`, truth: "true", evidence: [`${names.join(", ")} withheld by ${mask}`] });
    }
    return withheld.size === 0 ? policy : { ...policy, obligations };
  });

  const available = state.toolsAvailable === undefined ? undefined : new Set(state.toolsAvailable);
  const policies = masked.map((policy) => {
    if (!available) return policy;
    const unavailable = policy.obligations.find((obligation) => obligation.type === "call_tool" && obligation.value && !available.has(obligation.value.toLowerCase()));
    if (!unavailable) return policy;
    evaluations.push({ policyId: policy.id, branchId: `unavailable:${unavailable.value}`, truth: "true", evidence: [`required tool ${unavailable.value} is not available on this turn`] });
    return {
      ...policy,
      runtimeInstruction: unavailableToolInstruction(unavailable.value!),
      obligations: policy.obligations.filter((obligation) => !(obligation.type === "call_tool" && obligation.value && !available.has(obligation.value.toLowerCase()))),
    };
  });

  const userMask = [...active].find((mask) => MASK_ORIGIN[mask] === "user");
  const mandated = selection.policies.some((policy) => policy.mandated);
  let limit: PolicySelection["limit"];
  if (userMask && state.limit !== "none" && !mandated) {
    limit = { verdict: state.limit, instruction: limitInstruction(state.limit, state.toolsAvailable ?? []) };
  } else if (active.has("ask")) {
    // Ask outranks act, said in words the model can apply to its tools: the
    // available acting tools wait for the user's answer. Required reads survive;
    // every acting call should already have been masked.
    const waiting = (state.toolsAvailable ?? []).filter((tool) =>
      callEffect({ type: "call_tool", value: tool }, state) === "act"
    );
    if (waiting.length) limit = { verdict: "ask", instruction: askInstruction(waiting) };
  }

  return { ...selection, policies, requestState: state, evaluations, limit, conflicts: findConflicts(policies, limit, state) };
}

export function askInstruction(tools: string[]): string {
  return `This turn ends in a question, not an action: do not call ${[...tools].sort().join(", ")} until the user has confirmed the exact target, scope, and operation in a later turn.`;
}

export function unavailableToolInstruction(tool: string): string {
  return `The required ${tool} tool is unavailable. Do not answer as though it was used; state the limitation briefly.`;
}

/**
 * Compile-time consistency over the resolved program, which a paid run would
 * otherwise be the first to reveal. Two classes, both decidable from the
 * program alone: a tool one node requires and another forbids, and a tool
 * obligation that survived while the limit instruction tells the model not to
 * call tools. Each conflict names the nodes involved. The emitter still prints
 * the program; the record makes the contradiction visible offline.
 */
export function findConflicts(policies: Policy[], limit: PolicySelection["limit"], state: Pick<RequestState, "operation">): string[] {
  const conflicts: string[] = [];
  const requires = new Map<string, string[]>();
  const forbids = new Map<string, string[]>();
  const asks = policies.some((policy) => policy.obligations.some((obligation) => obligation.type === "ask_confirmation"));
  for (const policy of policies) {
    for (const obligation of policy.obligations) {
      if (obligation.type === "call_tool" && obligation.value) push(requires, obligation.value.toLowerCase(), policy.id);
    }
    for (const prohibition of policy.prohibitions) {
      if (prohibition.type === "forbidden_tool_call" && prohibition.value) push(forbids, prohibition.value.toLowerCase(), policy.id);
    }
  }
  for (const [tool, requirers] of requires) {
    const forbidders = forbids.get(tool);
    if (forbidders) conflicts.push(`tool ${tool} required by ${requirers.join(", ")} and forbidden by ${forbidders.join(", ")}`);
    if (limit && limit.verdict !== "ask") conflicts.push(`tool ${tool} required by ${requirers.join(", ")} while the limit instruction withholds tools`);
    if (asks && callEffect({ type: "call_tool", value: tool }, state) === "act") {
      conflicts.push(`acting tool ${tool} required by ${requirers.join(", ")} while the program asks for confirmation`);
    }
  }
  return conflicts;
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export type { RequestState };
