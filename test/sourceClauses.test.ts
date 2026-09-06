import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createArtifact, sha256, type CompiledPolicyArtifact } from "../src/compiler/artifact.js";
import { generateCandidateSelections } from "../src/compiler/candidates.js";
import { CLAUSES, projectSourceClauses } from "../src/compiler/sourceClauses.js";
import { conservativeState } from "../src/ir/requestState.js";
import { loadPolicies } from "../src/policy/loader.js";
import type { ArtifactContext } from "../src/policy/types.js";

const policies = loadPolicies();
const source = readFileSync("prompts/synthetic-enterprise-agent.md", "utf8");
const sourceBytes = Buffer.from(source);
const request = "Forward the report to Dana.";

function clauseArtifact(ctx: ArtifactContext, input = request): CompiledPolicyArtifact {
  const candidate = generateCandidateSelections(policies, input, ctx, undefined, source).find((item) => item.strategy === "source_clause_slice");
  assert.ok(candidate);
  return createArtifact({ policies, selection: candidate.selection, request: input, context: ctx, strategy: "source_clause_slice", sourcePolicyId: "synthetic-enterprise-agent", sourcePolicyText: source });
}

const lineText = (span: { startByte: number; endByte: number }) => sourceBytes.subarray(span.startByte, span.endByte).toString("utf8").replace(/\n$/, "");

test("every emitted line is an original source line and the prompt reconstructs from provenance alone", () => {
  const artifact = clauseArtifact({ artifactType: "email", operation: "forward", toolsAvailable: ["gmail"], exhaustive: { artifacts: true, tools: true } });
  const trace = artifact.sourceClauseSelection;
  assert.ok(trace);
  const sourceLines = new Set(source.split("\n"));
  for (const line of artifact.compiledPrompt.split("\n")) assert.ok(sourceLines.has(line), `not a source line: ${line.slice(0, 60)}`);
  for (const clause of trace.clauses) assert.equal(sha256(lineText(clause)), clause.sha256, clause.id);
  for (const group of trace.boilerplate) {
    assert.equal(sha256(lineText(group)), group.sha256);
    const strip = (text: string) => text.replace(/^- .+? (rule|example) /, "- ");
    for (const copy of group.subsumes) assert.equal(strip(lineText(copy)), strip(lineText(group)), `copy at line ${copy.line} is not label-only`);
  }
  // Reconstruction: the kept clause and boilerplate lines, in source order, are exactly the prompt's non-heading, non-subheading lines.
  const kept = [...trace.clauses.filter((c) => c.retained), ...trace.boilerplate.filter((b) => b.retained)].sort((a, b) => a.line - b.line).map(lineText);
  const emitted = artifact.compiledPrompt.split("\n").filter((line) => line !== "" && !line.startsWith("## ") && !line.endsWith(":"));
  assert.deepEqual(emitted, kept);
});

test("without an exhaustive declaration nothing is pruned, whatever the hints say", () => {
  for (const ctx of [{}, { artifactType: "spreadsheet" as const, operation: "edit" as const, toolsAvailable: [] }, { toolsAvailable: ["gmail"] }]) {
    const trace = clauseArtifact(ctx).sourceClauseSelection;
    assert.ok(trace);
    assert.equal(trace.clauses.filter((clause) => !clause.retained).length, 0);
    assert.deepEqual(trace.exhaustive, { artifacts: false, tools: false });
  }
});

test("pruning cites the exhaustive fact and never removes a dependency of a retained clause", () => {
  const trace = clauseArtifact({ artifactType: "email", operation: "forward", toolsAvailable: ["gmail"], exhaustive: { artifacts: true, tools: true } }).sourceClauseSelection;
  assert.ok(trace);
  const byId = new Map(trace.clauses.map((clause) => [clause.id, clause]));
  const pruned = trace.clauses.filter((clause) => !clause.retained);
  assert.ok(pruned.length > 0, "an exhaustive email context prunes image and slide clauses");
  for (const clause of pruned) {
    assert.ok(clause.reasons.every((reason) => reason.startsWith("pruned by trusted structural fact")), clause.id);
    assert.ok(CLAUSES.find((entry) => entry.id === clause.id)?.scope, `${clause.id} was pruned without a declared scope`);
  }
  for (const clause of trace.clauses.filter((entry) => entry.retained)) {
    for (const dependency of clause.dependsOn) assert.ok(byId.get(dependency)?.retained, `${clause.id} retained but its dependency ${dependency} was pruned`);
  }
  // Unscoped clauses survive every declaration; the destructive definition and confirmation rule are always present.
  for (const id of ["destructive.definition", "destructive.confirm", "privacy.private-by-default", "tools.use-and-failure", "core.honesty"]) assert.ok(byId.get(id)?.retained, id);
});

test("semantic state cannot change the clause slice; only structure can", () => {
  const ctx: ArtifactContext = { artifactType: "email", operation: "send", toolsAvailable: ["gmail"], exhaustive: { artifacts: true, tools: true } };
  const base = conservativeState(ctx, "test", "controlled");
  const compile = (state: Partial<ReturnType<typeof conservativeState>>) => {
    const candidate = generateCandidateSelections(policies, request, ctx, () => ({ ...base, ...state }), source).find((item) => item.strategy === "source_clause_slice");
    assert.ok(candidate);
    return createArtifact({ policies, selection: candidate.selection, request, context: ctx, strategy: "source_clause_slice", sourcePolicyId: "s", sourcePolicyText: source }).compiledPromptHash;
  };
  const absent = compile({ authorization: "absent", externalDisclosure: "unknown", limit: "limited", deliverable: "text" });
  const present = compile({ authorization: "present", externalDisclosure: "safe", limit: "none", deliverable: "open", operationNamed: true, fields: { recipient: true, body: true, "attachment scope": true } });
  assert.equal(absent, present);
  const withoutDeclaration = clauseArtifact({ artifactType: "email", operation: "send", toolsAvailable: ["gmail"] }).compiledPromptHash;
  assert.notEqual(absent, withoutDeclaration, "positive control: the exhaustive declaration does change the slice");
});

test("tool unavailability never prunes the clauses that govern reporting it", () => {
  const trace = clauseArtifact({ toolsAvailable: [], exhaustive: { artifacts: true, tools: true } }, "What is the latest FDA guidance? Do not browse.").sourceClauseSelection;
  assert.ok(trace);
  const byId = new Map(trace.clauses.map((clause) => [clause.id, clause]));
  for (const id of ["web.verify-first", "citations.when-required", "tools.use-and-failure", "core.no-false-success"]) assert.ok(byId.get(id)?.retained, id);
});

test("the clause map refuses a source it was not audited against", () => {
  const seed = generateCandidateSelections(policies, request, null)[1].selection;
  assert.throws(() => projectSourceClauses(policies, seed, source.replace("Archive and delete are distinct.", "Archive and delete are distinct!"), null), /audited original policy bytes/);
});
