import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { z } from "zod";
import { createArtifact } from "../src/compiler/artifact.js";
import { generateCandidateSelections } from "../src/compiler/candidates.js";
import { CONDITION_LIST_HEADING, CONDITION_LIST_INSTRUCTION, renderConditionList } from "../src/compiler/conditionList.js";
import { identifyReaderContract, parsePersistedReadings, readerContract, readerId, readerInputV2, renderReading } from "../src/compiler/policyReader.js";
import { CLAUSES, CONDITIONS, CONDITION_INDEX_HASH, emitSourceClauses, listConditions } from "../src/compiler/sourceClauses.js";
import { loadPolicies } from "../src/policy/loader.js";
import type { ArtifactContext, PolicyReadingRecord } from "../src/policy/types.js";

const policies = loadPolicies();
const source = readFileSync("prompts/synthetic-enterprise-agent.md", "utf8");
const sourceLines = source.split("\n");
const email: ArtifactContext = { artifactType: "email", operation: "forward", toolsAvailable: ["gmail"], exhaustive: { artifacts: true, tools: true } };
const calendar: ArtifactContext = { artifactType: "calendar_event", operation: "reschedule", toolsAvailable: ["calendar"], exhaustive: { artifacts: true, tools: true } };
const request = "Forward the two signed SOW messages from Priya to Dana now; that part is settled on my end.";

function candidates(context: ArtifactContext | null, record?: PolicyReadingRecord) {
  return generateCandidateSelections(policies, request, context, undefined, source, record);
}
function compile(context: ArtifactContext | null, strategy: "source_clause_slice" | "condition_list_slice" | "model_reader_slice", record?: PolicyReadingRecord) {
  const candidate = candidates(context, record).find((item) => item.strategy === strategy);
  assert.ok(candidate, `${strategy} candidate`);
  return createArtifact({ policies, selection: candidate.selection, request, context, strategy, sourcePolicyId: "s", sourcePolicyText: source });
}

test("every indexed condition is a verbatim span of its clause line and the index is in source order", () => {
  const byId = new Map(CLAUSES.map((clause) => [clause.id, clause]));
  let lastLine = 0;
  const ids = new Set<string>();
  for (const condition of CONDITIONS) {
    const clause = byId.get(condition.clause);
    assert.ok(clause, `${condition.id} names an unmapped clause ${condition.clause}`);
    assert.ok(sourceLines[clause.line - 1].includes(condition.sentence), `${condition.id}: sentence is not in line ${clause.line}`);
    assert.ok(condition.sentence.includes(condition.condition), `${condition.id}: condition span is not in its sentence`);
    assert.ok(!ids.has(condition.id), `${condition.id} listed twice`);
    ids.add(condition.id);
    assert.ok(clause.line >= lastLine, `${condition.id} is out of source order`);
    lastLine = clause.line;
    for (const restated of condition.restates ?? []) assert.ok(byId.has(restated), `${condition.id} restates unknown clause ${restated}`);
  }
  assert.equal(CONDITIONS.length, 16);
  assert.match(CONDITION_INDEX_HASH, /^[a-f0-9]{64}$/);
});

test("the listed conditions follow the retained clauses: structure decides, nothing semantic does", () => {
  const all = listConditions(compile(null, "source_clause_slice").sourceClauseSelection!).map((condition) => condition.id);
  assert.deepEqual(all, CONDITIONS.map((condition) => condition.id));
  const emailSelection = compile(email, "source_clause_slice").sourceClauseSelection!;
  const emailIds = listConditions(emailSelection).map((condition) => condition.id);
  assert.ok(emailIds.includes("email.archive-delete/scope") && emailIds.includes("destructive.confirm/confirmation") && emailIds.includes("writing.not-an-action/draft-not-send"));
  // Image generation and deck editing are pruned on the exhaustive email declaration, so their conditions are not listed;
  // a clause retained only as a dependency still lists its conditions, because the list follows retention and nothing else.
  const pruned = new Set(emailSelection.clauses.filter((clause) => !clause.retained).map((clause) => clause.id));
  assert.ok(pruned.has("image-gen.require-tool") && pruned.has("slides.edit-limits"));
  assert.ok(!emailIds.some((id) => id.startsWith("image-gen.") || id.startsWith("slides.")));
  assert.ok(!CONDITIONS.some((condition) => pruned.has(condition.clause) && emailIds.includes(condition.id)));
  const calendarIds = listConditions(compile(calendar, "source_clause_slice").sourceClauseSelection!).map((condition) => condition.id);
  assert.ok(calendarIds.includes("calendar.mutations/fields"));
});

test("contract 1 is frozen at the hash canaries v3 and v4 ran under; contract 2 is a different, identifiable contract", () => {
  const one = readerContract(1);
  const two = readerContract(2);
  assert.equal(one.readingContractSha256, "800e121af76ef677b4c49048cf930616948508b2bbc2cb297ae65c945198e45d");
  assert.notEqual(two.readingContractSha256, one.readingContractSha256);
  const responseItems = z.object({ properties: z.object({ resolutions: z.object({ items: z.object({ required: z.array(z.string()) }) }) }) }).parse(two.responseSchema).properties.resolutions.items;
  assert.deepEqual(responseItems.required, ["condition", "holds", "quote", "directive"]);
  assert.equal(identifyReaderContract(one.readingContractSha256).version, 1);
  assert.equal(identifyReaderContract(two.readingContractSha256).version, 2);
  assert.throws(() => identifyReaderContract("0".repeat(64)), /matches neither running contract/);
});

test("the contract-2 reader input lists each condition once with its id, sentence, and span, after the verbatim slice", () => {
  const clause = compile(email, "source_clause_slice");
  const slice = emitSourceClauses(source, clause.sourceClauseSelection!);
  const listed = listConditions(clause.sourceClauseSelection!);
  const input = readerInputV2(slice, listed, request, email);
  assert.ok(input.includes(slice.trimEnd()));
  assert.ok(input.includes(`Request:\n${request}`));
  for (const condition of listed) {
    assert.equal(input.split(`- id: ${condition.id}\n`).length, 2);
    assert.ok(input.includes(`  sentence: ${condition.sentence}`));
    assert.ok(input.includes(`  condition: ${condition.condition}`));
  }
  assert.ok(!/required fields|authorization|externalDisclosure/.test(input));
});

test("a contract-2 reading renders only its non-empty directives and records the listed conditions; all not-applicable is the bare slice", () => {
  const two = readerContract(2);
  const listed = listConditions(compile(email, "source_clause_slice").sourceClauseSelection!);
  const inert: PolicyReadingRecord = { readerId: readerId("m", two.readingContractSha256, "low"), readingContractSha256: two.readingContractSha256, resolutions: listed.map((condition) => ({ condition: condition.id, holds: "not-applicable", quote: "", directive: "" })) };
  const clauseArtifact = compile(email, "source_clause_slice");
  const inertArtifact = compile(email, "model_reader_slice", inert);
  assert.equal(inertArtifact.compiledPrompt, clauseArtifact.compiledPrompt);
  assert.equal(inertArtifact.policyConditions?.conditionIndexHash, CONDITION_INDEX_HASH);
  assert.deepEqual(inertArtifact.policyConditions?.conditions.map((condition) => condition.id), listed.map((condition) => condition.id));
  const resolved: PolicyReadingRecord = { ...inert, resolutions: inert.resolutions.map((resolution) => resolution.condition === "destructive.confirm/confirmation" ? { condition: resolution.condition, holds: "yes", quote: "that part is settled on my end", directive: "The confirmation is already given; forward the two messages now and do not ask again." } : resolution) };
  const resolvedArtifact = compile(email, "model_reader_slice", resolved);
  const tail = resolvedArtifact.compiledPrompt.slice(clauseArtifact.compiledPrompt.length);
  assert.equal(tail, renderReading(resolved));
  assert.equal(tail.split("\n- ").length, 2);
  assert.ok(tail.includes("- The confirmation is already given; forward the two messages now and do not ask again."));
  assert.ok(!tail.includes("that part is settled") && !tail.includes("holds"));
  // A contract-1 reading records no listed conditions, so v3 artifacts are unchanged.
  const one = readerContract(1);
  const legacy: PolicyReadingRecord = { readerId: readerId("m", one.readingContractSha256), readingContractSha256: one.readingContractSha256, resolutions: [{ condition: "c", finding: "f", directive: "d" }] };
  assert.equal(compile(email, "model_reader_slice", legacy).policyConditions, undefined);
});

test("persisted contract-2 readings parse under contract 2 and a resolution without a verdict is rejected", () => {
  const two = readerContract(2);
  const file = { readerId: readerId("m", two.readingContractSha256, "minimal"), readingContractSha256: two.readingContractSha256, readings: { "c-1": { resolutions: [{ condition: "destructive.confirm/confirmation", holds: "no", quote: "", directive: "Ask for the target, scope, operation, and consequence before acting." }] } } };
  assert.equal(parsePersistedReadings(file, two.readingContractSha256).readings["c-1"].resolutions.length, 1);
  assert.throws(() => parsePersistedReadings({ ...file, readings: { "c-1": { resolutions: [{ condition: "x", quote: "", directive: "" }] } } }, two.readingContractSha256));
  assert.throws(() => parsePersistedReadings(file, readerContract(1).readingContractSha256), /does not match running contract/);
});

test("condition_list_slice is the clause slice plus the listed sentences under one instruction, and degrades to the slice when nothing is listed", () => {
  const clauseArtifact = compile(email, "source_clause_slice");
  const artifact = compile(email, "condition_list_slice");
  assert.equal(artifact.schemaVersion, "1.4.0");
  assert.deepEqual(artifact.sourceClauseSelection, clauseArtifact.sourceClauseSelection);
  assert.notEqual(artifact.candidateId, clauseArtifact.candidateId);
  assert.ok(artifact.compiledPrompt.startsWith(clauseArtifact.compiledPrompt));
  const tail = artifact.compiledPrompt.slice(clauseArtifact.compiledPrompt.length);
  assert.equal(tail, renderConditionList(artifact.policyConditions!));
  assert.ok(tail.includes(CONDITION_LIST_HEADING) && tail.includes(CONDITION_LIST_INSTRUCTION));
  for (const condition of artifact.policyConditions!.conditions) {
    assert.ok(tail.includes(`- ${condition.sentence}`));
    assert.ok(!tail.includes(condition.id));
  }
  assert.ok(!/\b(yes|no|undecidable|not-applicable)\b:/.test(tail));
  assert.equal(renderConditionList({ conditionIndexHash: CONDITION_INDEX_HASH, conditions: [] }), "");
});
