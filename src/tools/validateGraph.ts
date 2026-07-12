import { loadPolicies } from "../policy/loader.js";

const policies = loadPolicies();
const edges = policies.reduce((sum, policy) => sum + policy.requires.length, 0);
console.log(`valid policy graph: ${policies.length} policies, ${edges} dependency edges`);
