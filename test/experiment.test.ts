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

test("template datasets cannot execute", () => {
  assert.throws(
    () => loadBehavioralCases("eval/behavioral/adversarial-template-v1.jsonl"),
    /template case cannot be executed/,
  );
});
