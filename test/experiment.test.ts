import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalJson } from "../src/compiler/artifact.js";
import { loadBehavioralCases } from "../src/experiment/cases.js";
import { deriveInputLimit, estimateCallInputTokens, INPUT_ESTIMATE_HEADROOM, providerToolPayload, type ProviderToolPayload } from "../src/experiment/plan.js";
import { generateCandidateSelections } from "../src/compiler/candidates.js";
import { emitRuntimePrompt } from "../src/compiler/emitter.js";
import { countTokens } from "../src/compiler/tokenCounter.js";
import { loadPolicies } from "../src/policy/loader.js";

test("loads and hashes the one-case smoke set", () => {
  const first = loadBehavioralCases("eval/behavioral/smoke-v1.jsonl");
  const second = loadBehavioralCases("eval/behavioral/smoke-v1.jsonl");
  assert.equal(first.cases.length, 1);
  assert.equal(first.split, "smoke");
  assert.equal(first.datasetHash, second.datasetHash);
});

test("pilot set has exactly 20 independently declared cases", () => {
  const dataset = loadBehavioralCases("eval/behavioral/pilot-v2.jsonl");
  assert.equal(dataset.cases.length, 20);
  assert.equal(dataset.split, "pilot");
  assert.equal(new Set(dataset.cases.map((item) => item.caseId)).size, 20);
  assert.ok(dataset.cases.every((item) => item.criticalObligationIds.length > 0));
});

test("compiler 0.6 regression set contains the nine promoted development cases", () => {
  const dataset = loadBehavioralCases("eval/behavioral/compiler-v0.6-regression-v1.jsonl");
  assert.equal(dataset.cases.length, 9);
  assert.equal(dataset.datasetVersion, "compiler-v0.6-regression-v1");
  assert.equal(dataset.split, "development");
  assert.equal(new Set(dataset.cases.map((item) => item.caseId)).size, 9);
  assert.ok(dataset.cases.every((item) => item.criticalObligationIds.length > 0));
});

test("compiler 0.7 regression set contains four spent held-out-v2 development cases", () => {
  const dataset = loadBehavioralCases("eval/behavioral/compiler-v0.7-regressions.jsonl");
  assert.equal(dataset.cases.length, 4);
  assert.equal(dataset.datasetVersion, "compiler-v0.7-regressions");
  assert.equal(dataset.split, "development");
  assert.equal(new Set(dataset.cases.map((item) => item.caseId)).size, 4);
  assert.ok(dataset.cases.every((item) => item.tags.includes("spent-evidence")));
  assert.ok(dataset.cases.every((item) => item.tags.includes("promoted-from-held-out-v2")));
});

test("held-out v3 is frozen at 60 independently declared cases", () => {
  const dataset = loadBehavioralCases("eval/behavioral/held-out-v3.jsonl");
  assert.equal(dataset.cases.length, 60);
  assert.equal(dataset.datasetVersion, "held-out-v3");
  assert.equal(dataset.split, "held-out");
  assert.equal(new Set(dataset.cases.map((item) => item.caseId)).size, 60);
  assert.ok(dataset.cases.every((item) => item.criticalObligationIds.length > 0));
  assert.equal(dataset.datasetHash, "8d6bf6999fcb7232e92633412f1eaf93be53a910dbfc1993f4fef7b6d49a7de3");
});

test("template datasets cannot execute", () => {
  assert.throws(
    () => loadBehavioralCases("eval/behavioral/adversarial-template-v1.jsonl"),
    /template case cannot be executed/,
  );
});

test("per-call input estimates bound every provider-reported input from the compiler 0.8 smoke", () => {
  // run_b9daf24a2c394e8d: provider-reported input tokens per compiler_slice call. The old
  // estimate (artifact + 64) was 378-461 for these, 37-76 tokens short, and starved the last trial.
  const observed: Record<string, number> = { "cv08-007": 429, "cv08-010": 471, "cv08-047": 498, "cv08-051": 458, "cv08-053": 489, "cv08-058": 447 };
  const model = "gpt-5-mini-2025-08-07";
  const policies = loadPolicies();
  for (const item of loadBehavioralCases("eval/behavioral/compiler-v0.8-regressions.jsonl").cases) {
    const context = { ...(item.artifactContext ?? {}), toolsAvailable: item.tools.map((tool) => tool.name) };
    const selection = generateCandidateSelections(policies, item.request, context)[1].selection;
    const artifactTokens = countTokens(emitRuntimePrompt(selection, item.request, context), model).tokens;
    const estimate = estimateCallInputTokens(artifactTokens, item.request, item.tools, model);
    assert.ok(estimate >= observed[item.caseId], `${item.caseId}: estimate ${estimate} below observed ${observed[item.caseId]}`);
    assert.ok(estimate - observed[item.caseId] < 160, `${item.caseId}: estimate ${estimate} is not a tight bound`);
  }
});

test("providerToolPayload mirrors the Python provider_dict payloads byte for byte", () => {
  // Fixture written by runtime/python/tests/test_tool_payload_parity.py from ToolDefinition.provider_dict().
  const expected: unknown = JSON.parse(readFileSync("protocol/fixtures/tool-payload-parity.json", "utf8"));
  const actual: Record<string, ProviderToolPayload[]> = {};
  for (const item of loadBehavioralCases("eval/behavioral/compiler-v0.8-regressions.jsonl").cases) {
    actual[item.caseId] = item.tools.map(providerToolPayload);
  }
  actual["web"] = [providerToolPayload({ type: "web_search", name: "web" })];
  actual["empty-parameters"] = [providerToolPayload({ type: "function", name: "ping", description: "Ping.", parameters: { type: "object", properties: {}, additionalProperties: true } })];
  actual["strict-eligible"] = [providerToolPayload({ type: "function", name: "echo", description: "Echo.", parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } })];
  assert.equal(canonicalJson(actual), canonicalJson(expected));
  const [strictEligible] = actual["strict-eligible"];
  const [gmail] = actual["cv08-007"];
  assert.ok(strictEligible.type === "function" && strictEligible.strict === true);
  assert.ok(gmail.type === "function" && gmail.strict === false);
});

test("derived input ceiling carries headroom over the estimate and honors an explicit override", () => {
  const estimate = 99_973;
  assert.equal(deriveInputLimit(estimate, 1), Math.ceil(estimate * INPUT_ESTIMATE_HEADROOM));
  assert.equal(deriveInputLimit(estimate, 2), Math.ceil(estimate * INPUT_ESTIMATE_HEADROOM) * 2);
  assert.equal(deriveInputLimit(estimate, 1, 5_000_000), 5_000_000);
});

test("compiler 0.8 development regressions are six copied held-out-v3 cases", () => {
  const dataset = loadBehavioralCases("eval/behavioral/compiler-v0.8-regressions.jsonl");
  assert.equal(dataset.split, "development");
  assert.deepEqual(dataset.cases.map((item) => item.caseId), ["cv08-007", "cv08-010", "cv08-047", "cv08-051", "cv08-053", "cv08-058"]);
  assert.equal(dataset.datasetHash, "e50214e49d5a37dee334d3dfe777b07f33386b704ce1f0198e6b8798b12843dc");
});
