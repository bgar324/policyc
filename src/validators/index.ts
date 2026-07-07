import type { Policy } from "../policy/types.js";
import type { Trace } from "../traces/types.js";
import { validators, type ValidatorResult } from "./rules.js";

export function runValidators(trace: Trace, selectedPolicies: Policy[]): ValidatorResult[] {
  const validatorIds = Array.from(new Set(selectedPolicies.flatMap((policy) => policy.validators)));
  return validatorIds.map((id) => {
    const validator = validators[id];
    if (!validator) {
      return { id, passed: false, message: `unknown validator ${id}`, critical: false };
    }
    return validator(trace);
  });
}
