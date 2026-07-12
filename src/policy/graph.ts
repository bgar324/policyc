import type { Policy } from "./types.js";

export type GraphDiagnostic = { code: string; policyId: string; message: string; pack?: string };

export function validatePolicyGraph(policies: Policy[], knownValidators: ReadonlySet<string>): void {
  const diagnostics: GraphDiagnostic[] = [];
  const byId = new Map(policies.map((policy) => [policy.id, policy]));

  for (const policy of policies) {
    const seenEdges = new Set<string>();
    for (const requiredId of policy.requires) {
      if (requiredId === policy.id) diagnostics.push(diag("self_dependency", policy, `self-dependency ${policy.id} -> ${requiredId}`));
      if (seenEdges.has(requiredId)) diagnostics.push(diag("duplicate_edge", policy, `duplicate dependency ${policy.id} -> ${requiredId}`));
      seenEdges.add(requiredId);
      if (!byId.has(requiredId)) diagnostics.push(diag("missing_reference", policy, `requires unknown policy ${requiredId}`));
    }
    for (const validator of policy.validators) {
      if (!knownValidators.has(validator)) diagnostics.push(diag("unknown_validator", policy, `references unknown validator ${validator}`));
    }
    if (policy.alwaysActive && policy.kind !== "universal") {
      diagnostics.push(diag("invalid_always_active", policy, "alwaysActive is only valid for universal policies"));
    }
    if (policy.kind === "universal" && !policy.alwaysActive) {
      diagnostics.push(diag("invalid_universal", policy, "universal policies must be alwaysActive"));
    }
  }

  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === 1) {
      const start = path.indexOf(id);
      diagnostics.push(diag("cycle", byId.get(id)!, `dependency cycle: ${[...path.slice(start), id].join(" -> ")}`));
      return;
    }
    if (state.get(id) === 2) return;
    state.set(id, 1);
    for (const next of byId.get(id)?.requires ?? []) if (byId.has(next)) visit(next, [...path, id]);
    state.set(id, 2);
  };
  for (const id of [...byId.keys()].sort()) visit(id, []);

  const reachable = new Set(policies.filter((policy) => policy.kind !== "structural" || policy.alwaysActive).map((policy) => policy.id));
  const queue = [...reachable];
  for (let index = 0; index < queue.length; index += 1) {
    for (const next of byId.get(queue[index])?.requires ?? []) if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
  }
  for (const policy of policies) {
    if (policy.kind === "structural" && !reachable.has(policy.id)) diagnostics.push(diag("unreachable_structural", policy, "structural policy is unreachable from selectable policies"));
  }

  if (diagnostics.length) {
    const message = diagnostics.map((item) => `${item.pack ?? "unknown"}:${item.policyId} [${item.code}] ${item.message}`).join("\n");
    throw new Error(`Invalid policy graph:\n${message}`);
  }
}

function diag(code: string, policy: Policy, message: string): GraphDiagnostic {
  return { code, policyId: policy.id, pack: policy.pack, message };
}
