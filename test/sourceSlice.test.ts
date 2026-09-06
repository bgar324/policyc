import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createArtifact, sha256, type CompilationStrategy, type CompiledPolicyArtifact } from "../src/compiler/artifact.js";
import { generateCandidateSelections } from "../src/compiler/candidates.js";
import { projectSourceSelection } from "../src/compiler/sourceSlice.js";
import { conservativeState, type Frontend } from "../src/ir/requestState.js";
import { loadPolicies } from "../src/policy/loader.js";
import type { ArtifactContext } from "../src/policy/types.js";

const policies = loadPolicies();
const source = readFileSync("prompts/synthetic-enterprise-agent.md", "utf8");
const context: ArtifactContext = { artifactType: "email", operation: "forward", toolsAvailable: ["gmail"] };
const request = "Forward the report to Dana.";
const experimental: CompilationStrategy[] = ["source_preserving_slice", "source_matched_authored", "source_matched_semantic", "source_clause_slice", "source_evidence_bare", "source_evidence_apply", "condition_list_slice"];

function artifacts(frontend?: Frontend, ctx = context) {
  const candidates = generateCandidateSelections(policies, request, ctx, frontend, source);
  return candidates.map((candidate) => createArtifact({
    policies, selection: candidate.selection, request, context: ctx, strategy: candidate.strategy,
    sourcePolicyId: "synthetic-enterprise-agent", sourcePolicyText: source,
  }));
}

function arm(items: CompiledPolicyArtifact[], strategy: CompilationStrategy) {
  const item = items.find((candidate) => candidate.compilationStrategy === strategy);
  assert.ok(item, `missing ${strategy}`);
  return item;
}

test("source projection preserves whole original UTF-8 sections and shared node closure", () => {
  const items = artifacts();
  const sliced = arm(items, "source_preserving_slice");
  const trace = sliced.sourceSelection;
  assert.ok(trace);
  const originalSections = source.split(/(?=^## )/m);
  const bytes = Buffer.from(source);
  const retained = trace.sections.filter((section) => section.retained);
  for (const section of trace.sections) {
    const text = bytes.subarray(section.startByte, section.endByte).toString("utf8");
    assert.ok(originalSections.includes(text), `${section.heading}: not a whole source section`);
    assert.equal(sha256(text), section.sha256);
    assert.ok(section.reasons.length, `${section.heading}: missing inclusion/exclusion rationale`);
  }
  assert.equal(sliced.compiledPrompt, retained.map((section) => bytes.subarray(section.startByte, section.endByte).toString("utf8")).join(""));
  assert.ok(retained.some((section) => section.heading === "Destructive and irreversible actions"), "forwarding keeps the original consequence and confirmation definition");
  const common = retained.filter((section) => section.context).map((section) => bytes.subarray(section.startByte, section.endByte).toString("utf8")).join("");
  const control = arm(items, "compiler_slice");
  for (const strategy of experimental) {
    const item = arm(items, strategy);
    assert.deepEqual(item.selectedPolicyIds, control.selectedPolicyIds, "whole source coverage must not select extra authored nodes");
    assert.deepEqual(item.dependencyEdges, control.dependencyEdges);
    if (!item.sourceSelection) continue;
    assert.deepEqual(item.sourceSelection, trace);
    if (strategy !== "source_preserving_slice") assert.ok(item.compiledPrompt.startsWith(common + "\n"));
  }
  assert.equal(arm(items, "source_matched_semantic").compiledPrompt, common + "\n" + control.compiledPrompt);
});

test("undecided applicability retains full source without inventing an action or question", () => {
  let reads = 0;
  const unknown: Frontend = (_request, ctx) => { reads += 1; return conservativeState(ctx, "test:unknown", "applicability unresolved"); };
  const sliced = arm(artifacts(unknown, { toolsAvailable: [] }), "source_preserving_slice");
  assert.equal(reads, 1);
  assert.equal(sliced.compiledPrompt, source);
  assert.equal(sliced.compiledPromptHash, sha256(source));
  assert.ok(sliced.sourceSelection?.sections.every((section) => section.retained));
});

test("authorization and disclosure readings cannot specialize the source arm", () => {
  const state = { ...conservativeState(context, "test:controlled", "controlled selection contrast"),
    currentInformation: false, deferredWork: false, slideTask: false,
    operationNamed: true, fields: { recipient: true, scope: true },
  };
  const absent = artifacts(() => ({ ...state, authorization: "absent", externalDisclosure: "unknown" }));
  const present = artifacts(() => ({ ...state, authorization: "present", externalDisclosure: "safe" }));
  const before = arm(absent, "source_preserving_slice");
  const after = arm(present, "source_preserving_slice");
  assert.deepEqual(before.selectedPolicyIds, after.selectedPolicyIds);
  assert.equal(before.compiledPrompt, after.compiledPrompt);
  assert.notEqual(arm(absent, "source_matched_semantic").compiledPrompt, arm(present, "source_matched_semantic").compiledPrompt, "positive control: evaluator actually changes the matched prompt");
});

test("source maps reject changed source or unmapped policies rather than silently slicing", () => {
  const candidate = generateCandidateSelections(policies, request, context)[1];
  assert.throws(() => projectSourceSelection(policies, candidate.selection, source + "\nNew policy."), /audited original policy bytes/);
  assert.throws(() => projectSourceSelection([...policies, { ...policies[0], id: "new_unmapped_rule" }], candidate.selection, source), /missing policies/);
  const projected = generateCandidateSelections(policies, request, context, undefined, source).find((item) => item.strategy === "source_preserving_slice");
  assert.ok(projected);
  assert.throws(() => createArtifact({ policies, selection: projected.selection, request, context, strategy: projected.strategy, sourcePolicyId: "source", sourcePolicyText: source + "\n" }), /audited source map/);
  const items = artifacts();
  assert.equal(new Set(items.map((item) => item.candidateId)).size, items.length, "strategy and provenance belong in artifact identity even for identical prompts");
  for (const item of items.filter((value) => !experimental.includes(value.compilationStrategy))) {
    assert.equal(item.schemaVersion, "1.3.0");
    assert.equal(item.compilerVersion, "0.10.0");
    assert.equal(Object.hasOwn(item, "sourceSelection"), false);
  }
});
