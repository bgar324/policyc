import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createArtifact } from "../src/compiler/artifact.js";
import { generateCandidateSelections } from "../src/compiler/candidates.js";
import { parsePersistedReadings, readerContract, readerId, readerInput, renderReading } from "../src/compiler/policyReader.js";
import { emitSourceClauses } from "../src/compiler/sourceClauses.js";
import { loadPolicies } from "../src/policy/loader.js";
import type { ArtifactContext, PolicyReadingRecord } from "../src/policy/types.js";

const policies = loadPolicies();
const source = readFileSync("prompts/synthetic-enterprise-agent.md", "utf8");
const email: ArtifactContext = { artifactType: "email", operation: "send", toolsAvailable: ["gmail"], exhaustive: { artifacts: true, tools: true } };
const request = "Send the Thursday reminder to the whole team now.";
const contract = readerContract();
const reading = (resolutions: PolicyReadingRecord["resolutions"]): PolicyReadingRecord => ({ readerId: readerId("m", contract.readingContractSha256), readingContractSha256: contract.readingContractSha256, resolutions });

function arms(record?: PolicyReadingRecord) {
  return generateCandidateSelections(policies, request, email, undefined, source, record);
}

test("the reader arm exists only when a reading is supplied, and an empty reading is byte-identical to the clause slice", () => {
  assert.ok(!arms().some((item) => item.strategy === "model_reader_slice"));
  const withReading = arms(reading([]));
  const reader = withReading.find((item) => item.strategy === "model_reader_slice");
  const clause = withReading.find((item) => item.strategy === "source_clause_slice");
  assert.ok(reader && clause);
  const readerArtifact = createArtifact({ policies, selection: reader.selection, request, context: email, strategy: "model_reader_slice", sourcePolicyId: "s", sourcePolicyText: source });
  const clauseArtifact = createArtifact({ policies, selection: clause.selection, request, context: email, strategy: "source_clause_slice", sourcePolicyId: "s", sourcePolicyText: source });
  assert.equal(readerArtifact.compiledPrompt, clauseArtifact.compiledPrompt);
  assert.deepEqual(readerArtifact.sourceClauseSelection, clauseArtifact.sourceClauseSelection);
  assert.equal(readerArtifact.schemaVersion, "1.4.0");
  assert.deepEqual(readerArtifact.policyReading, reading([]));
  // Identity still separates the arms: same prompt, different strategy and provenance.
  assert.notEqual(readerArtifact.candidateId, clauseArtifact.candidateId);
});

test("only directives are rendered, after the unchanged slice; the condition and finding stay in the artifact", () => {
  const record = reading([
    { condition: "Require explicit user intent and confirmation when appropriate.", finding: "The request says 'now' but names no confirmation act.", directive: "Ask for confirmation before sending, naming the recipients and the message." },
    { condition: "Confirm the exact action, scope, and target messages before acting.", finding: "No target messages are named.", directive: "Do not send until the user names the exact message and recipients." },
  ]);
  const reader = arms(record).find((item) => item.strategy === "model_reader_slice")!;
  const artifact = createArtifact({ policies, selection: reader.selection, request, context: email, strategy: "model_reader_slice", sourcePolicyId: "s", sourcePolicyText: source });
  const slice = emitSourceClauses(source, artifact.sourceClauseSelection!);
  assert.ok(artifact.compiledPrompt.startsWith(slice));
  const tail = artifact.compiledPrompt.slice(slice.length);
  assert.equal(tail, renderReading(record));
  for (const resolution of record.resolutions) {
    assert.ok(tail.includes(`- ${resolution.directive}`));
    assert.ok(!tail.includes(resolution.finding));
    assert.ok(!tail.includes(resolution.condition));
  }
  assert.deepEqual(artifact.policyReading, record);
});

test("the reader arm refuses to compile without a reading", () => {
  const clause = arms().find((item) => item.strategy === "source_clause_slice")!;
  assert.throws(() => createArtifact({ policies, selection: clause.selection, request, context: email, strategy: "model_reader_slice", sourcePolicyId: "s", sourcePolicyText: source }), /requires a persisted reading/);
});

test("persisted readings are bound to the running contract", () => {
  const good = { readerId: readerId("m", contract.readingContractSha256), readingContractSha256: contract.readingContractSha256, readings: { "c-1": { resolutions: [] } } };
  assert.deepEqual(parsePersistedReadings(good, contract.readingContractSha256).readings["c-1"].resolutions, []);
  const stale = "0".repeat(64);
  assert.throws(() => parsePersistedReadings({ ...good, readingContractSha256: stale }, contract.readingContractSha256), /does not match running contract/);
  assert.throws(() => parsePersistedReadings({ ...good, readerId: `reader:m:${stale.slice(0, 12)}` }, contract.readingContractSha256), /does not name contract/);
  assert.throws(() => parsePersistedReadings({ ...good, readings: { "c-1": { resolutions: [{ condition: "x", finding: "y" }] } } }, contract.readingContractSha256));
});

test("the reader sees the clause slice verbatim, the request, and the declared structural context only", () => {
  const clause = arms().find((item) => item.strategy === "source_clause_slice")!;
  const slice = emitSourceClauses(source, clause.selection.sourceClauseSelection!);
  const input = readerInput(slice, request, email);
  assert.ok(input.includes(slice.trimEnd()));
  assert.ok(input.includes(`Request:\n${request}`));
  assert.ok(input.includes("- tools available on this turn: gmail"));
  assert.ok(!/required fields|authorization|externalDisclosure/.test(input));
});
