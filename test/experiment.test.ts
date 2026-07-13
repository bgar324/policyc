import assert from "node:assert/strict";
import test from "node:test";
import { loadBehavioralCases } from "../src/experiment/cases.js";

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
