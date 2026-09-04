import { readFileSync } from "node:fs";
import { generateCandidateSelections } from "../src/compiler/candidates.js";
import { emitRuntimePrompt } from "../src/compiler/emitter.js";
import { loadPolicies } from "../src/policy/loader.js";

const [file, ...ids] = process.argv.slice(2);
const policies = loadPolicies();
for (const line of readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean)) {
  const item = JSON.parse(line);
  if (ids.length && !ids.includes(item.caseId)) continue;
  const context = { ...(item.artifactContext ?? {}), toolsAvailable: (item.tools ?? []).map((t: { name: string }) => t.name) };
  const selection = generateCandidateSelections(policies, item.request, context)[1].selection;
  console.log(`=== ${item.caseId} intents=${selection.detectedIntents.join(",")}`);
  console.log(`policies: ${selection.policies.filter((p) => p.kind !== "universal").map((p) => p.id).join(", ")}`);
  const prompt = emitRuntimePrompt(selection, item.request, context);
  console.log(prompt.slice(prompt.indexOf("Active rules:")).replace(/User request:.*$/s, ""));
}
