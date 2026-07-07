import type { Policy, PolicySelectionReason } from "./types.js";

export type ClosureResult = {
  policies: Policy[];
  reasons: PolicySelectionReason[];
  edges: Array<{ from: string; requires: string }>;
};

export function computeDependencyClosure(
  allPolicies: Policy[],
  initialPolicies: Policy[],
  initialReasons: PolicySelectionReason[]
): ClosureResult {
  const byId = new Map(allPolicies.map((policy) => [policy.id, policy]));
  const selected = new Map(initialPolicies.map((policy) => [policy.id, policy]));
  const reasons = new Map(initialReasons.map((reason) => [reason.policyId, { ...reason }]));
  const edges: Array<{ from: string; requires: string }> = [];
  const queue = [...initialPolicies];

  while (queue.length) {
    const policy = queue.shift()!;
    for (const requiredId of policy.requires ?? []) {
      edges.push({ from: policy.id, requires: requiredId });
      const required = byId.get(requiredId);
      if (!required) {
        throw new Error(`Policy ${policy.id} requires missing policy ${requiredId}`);
      }

      const existingReason = reasons.get(requiredId);
      if (existingReason) {
        existingReason.dependencyOf = Array.from(new Set([...(existingReason.dependencyOf ?? []), policy.id]));
        if (!existingReason.reasons.includes("dependency closure")) {
          existingReason.reasons.push("dependency closure");
        }
      } else {
        reasons.set(requiredId, {
          policyId: requiredId,
          reasons: ["dependency closure"],
          dependencyOf: [policy.id]
        });
      }

      if (!selected.has(requiredId)) {
        selected.set(requiredId, required);
        queue.push(required);
      }
    }
  }

  return {
    policies: Array.from(selected.values()),
    reasons: Array.from(reasons.values()),
    edges
  };
}
