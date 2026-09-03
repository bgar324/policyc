import assert from "node:assert/strict";
import test from "node:test";
import { loadBehavioralCases } from "../src/experiment/cases.js";
import { deriveInputLimit, INPUT_ESTIMATE_HEADROOM } from "../src/experiment/plan.js";

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

test("derived input ceiling carries headroom over the estimate and honors an explicit override", () => {
  // compiler-v0.8-smoke: 99,973 estimated, 84,359 actual after 11 of 12 calls, 12th trial needed 16,255.
  const estimate = 99_973;
  assert.ok(deriveInputLimit(estimate, 1) >= 84_359 + 16_255, "one smoke's observed overshoot must fit");
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
