import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import type { Policy, PolicyPackFile } from "./types.js";

const DEFAULT_POLICY_DIR = "policies";

export function loadPolicies(policyDir = DEFAULT_POLICY_DIR): Policy[] {
  const files = readdirSync(policyDir)
    .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"))
    .sort();

  const policies: Policy[] = [];
  for (const file of files) {
    const path = join(policyDir, file);
    const parsed = YAML.parse(readFileSync(path, "utf8")) as PolicyPackFile;
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
