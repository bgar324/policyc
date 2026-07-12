import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import type { Policy, PolicyPackFile } from "./types.js";
import { policyPackSchema } from "./schema.js";
import { validatePolicyGraph } from "./graph.js";
import { validators } from "../validators/rules.js";

const DEFAULT_POLICY_DIR = "policies";

export function loadPolicies(policyDir = DEFAULT_POLICY_DIR): Policy[] {
  const files = readdirSync(policyDir)
    .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"))
    .sort();

  const policies: Policy[] = [];
  for (const file of files) {
    const path = join(policyDir, file);
    const raw: unknown = YAML.parse(readFileSync(path, "utf8"));
    const result = policyPackSchema.safeParse(raw);
    if (!result.success) {
      throw new Error(`Invalid policy pack ${path}: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    }
    const parsed: PolicyPackFile = result.data;
    const pack = file.replace(/\.ya?ml$/, "");
    for (const policy of parsed.policies ?? []) {
      policies.push({
        ...policy,
        pack,
        triggers: policy.triggers ?? {},
        requires: policy.requires ?? [],
        obligations: policy.obligations ?? [],
        prohibitions: policy.prohibitions ?? [],
        validators: policy.validators ?? []
      });
    }
  }

  assertUniquePolicyIds(policies);
  validatePolicyGraph(policies, new Set(Object.keys(validators)));
  return policies;
}

export function getPolicyById(policies: Policy[], id: string): Policy | undefined {
  return policies.find((policy) => policy.id === id);
}

function assertUniquePolicyIds(policies: Policy[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const policy of policies) {
    if (seen.has(policy.id)) duplicates.add(policy.id);
    seen.add(policy.id);
  }
  if (duplicates.size) {
    throw new Error(`Duplicate policy ids: ${Array.from(duplicates).join(", ")}`);
  }
}
