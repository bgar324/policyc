/**
 * Stage trace for one visible case, or a semantic-decision summary over all 97.
 *
 *   pnpm trace:source --summary [--output <json-file>]
 *   pnpm trace:source --case <caseId>
 *
 * Reads only the visible allowlist. No provider call, no experiment command,
 * no catalog write. The trace prints what each pipeline stage did to the
 * request: the frontend read, selection reasons, branch evaluations, masks,
 * tool lowering, the limit instruction, the emitted prompt, and the source
 * sections the source arm retained, beside the dataset's own expectations.
 */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createArtifact, type CompiledPolicyArtifact } from "../compiler/artifact.js";
import { generateCandidateSelections } from "../compiler/candidates.js";
import { loadPolicies } from "../policy/loader.js";
import type { ArtifactContext, Policy } from "../policy/types.js";
import { loadVisibleCorpus, type VisibleCase } from "./visibleAllowlist.js";

const SOURCE_POLICY_PATH = "prompts/synthetic-enterprise-agent.md";
const CREATED_AT = "1970-01-01T00:00:00.000Z";

type Arms = { control: CompiledPolicyArtifact; source: CompiledPolicyArtifact; limit: string | undefined };

function compileArms(policies: Policy[], source: string, item: VisibleCase["item"]): Arms {
  const context: ArtifactContext = { ...(item.artifactContext ?? {}), toolsAvailable: item.tools.map((tool) => tool.name) };
  const candidates = generateCandidateSelections(policies, item.request, context, undefined, source);
  const candidate = (strategy: CompiledPolicyArtifact["compilationStrategy"]) => {
    const found = candidates.find((entry) => entry.strategy === strategy);
    assert(found, `missing ${strategy}`);
    return found;
  };
  const artifact = (strategy: CompiledPolicyArtifact["compilationStrategy"]): CompiledPolicyArtifact =>
    createArtifact({ policies, selection: candidate(strategy).selection, request: item.request, context, strategy, sourcePolicyId: "synthetic-enterprise-agent", sourcePolicyText: source, createdAt: CREATED_AT });
  const limit = candidate("compiler_slice").selection.limit;
  return { control: artifact("compiler_slice"), source: artifact("source_preserving_slice"), limit: limit ? `${limit.verdict}: ${limit.instruction}` : undefined };
}

/** The decisions that change the emitted prompt beyond selection: taken branches, masks, and lowerings. */
function decisions(artifact: CompiledPolicyArtifact): { branches: string[]; masks: string[]; lowered: string[] } {
  const taken = artifact.evaluations.filter((record) => record.truth === "true");
  return {
    branches: taken.filter((record) => !record.branchId.includes(":")).map((record) => `${record.policyId}#${record.branchId}`),
    masks: taken.filter((record) => record.branchId.startsWith("mask:")).map((record) => `${record.policyId}: ${record.evidence.join("; ")}`),
    lowered: taken.filter((record) => record.branchId.startsWith("unavailable:")).map((record) => `${record.policyId}: ${record.evidence.join("; ")}`),
  };
}

function summarize(corpus: VisibleCase[], policies: Policy[], source: string): Record<string, unknown> {
  const rows = corpus.map(({ file, item }) => {
    const { control, source: sourceArm, limit } = compileArms(policies, source, item);
    const state = control.requestState;
    assert(state, `${item.caseId}: no request state`);
    const retained = sourceArm.sourceSelection?.sections.filter((section) => section.retained && !section.context).map((section) => section.heading) ?? [];
    return {
      caseId: item.caseId, file, tags: item.tags,
      state: { authorization: state.authorization, limit: state.limit, deliverable: state.deliverable, externalDisclosure: state.externalDisclosure, currentInformation: state.currentInformation, fieldsComplete: Object.keys(state.fields).length ? Object.values(state.fields).every(Boolean) : null },
      selected: control.selectedPolicyIds.length, direct: control.directlySelectedPolicyIds.length,
      ...decisions(control), limit,
      conflicts: control.conflicts,
      controlTokens: control.tokenCount.tokens, sourceTokens: sourceArm.tokenCount.tokens, sourceSectionsRetained: retained,
      expected: { critical: item.criticalObligationIds, required: item.toolExpectation.required, forbidden: item.toolExpectation.forbidden, refusal: item.expectedRefusal },
    };
  });
  const count = (key: "branches" | "masks" | "lowered"): Record<string, number> => {
    const totals: Record<string, number> = {};
    for (const row of rows) for (const value of row[key]) { const label = value.split(":")[0]; totals[label] = (totals[label] ?? 0) + 1; }
    return totals;
  };
  return {
    cases: rows.length,
    casesWithBranch: rows.filter((row) => row.branches.length).length,
    casesWithMask: rows.filter((row) => row.masks.length).length,
    casesWithLowering: rows.filter((row) => row.lowered.length).length,
    casesWithLimit: rows.filter((row) => row.limit).length,
    branchTotals: count("branches"), maskTotals: count("masks"), loweredTotals: count("lowered"),
    rows,
  };
}

function trace(entry: VisibleCase, policies: Policy[], source: string): string {
  const { item, file } = entry;
  const { control, source: sourceArm, limit } = compileArms(policies, source, item);
  const state = control.requestState;
  assert(state, `${item.caseId}: no request state`);
  const reasons = Object.fromEntries(control.selectionReasons.map((reason) => [reason.policyId, reason.reasons.join(", ")]));
  const lines = [
    `# ${item.caseId} (${file})`, "",
    `Request: ${item.request}`,
    `Context: ${JSON.stringify(item.artifactContext)}`,
    `Tools: ${item.tools.map((tool) => tool.name).join(", ") || "none"}`, "",
    "## Dataset expectations",
    ...item.applicableObligations.map((obligation) => `- ${item.criticalObligationIds.includes(obligation.id) ? "CRITICAL " : ""}${obligation.id} [${obligation.validator}${obligation.value ? `:${obligation.value}` : ""}] ${obligation.description}`),
    ...item.prohibitions.map((prohibition) => `- FORBIDDEN ${prohibition.id} [${prohibition.validator}${prohibition.value ? `:${prohibition.value}` : ""}] ${prohibition.description}`),
    `- tools required ${JSON.stringify(item.toolExpectation.required)}, forbidden ${JSON.stringify(item.toolExpectation.forbidden)}, refusal ${item.expectedRefusal}`, "",
    "## Stage 1: frontend read",
    `- authorization=${state.authorization} limit=${state.limit} deliverable=${state.deliverable} disclosure=${state.externalDisclosure} currentInformation=${state.currentInformation} deferredWork=${state.deferredWork} slideTask=${state.slideTask}`,
    `- operationNamed=${state.operationNamed} operationNegated=${state.operationNegated} fields=${JSON.stringify(state.fields)} format=${state.format} purpose=${state.purpose}`,
    ...state.evidence.map((line) => `- evidence: ${line}`), "",
    "## Stage 2: selection and closure",
    ...control.selectedPolicyIds.map((id) => `- ${control.directlySelectedPolicyIds.includes(id) ? "direct " : "closure"} ${id}: ${reasons[id]}`), "",
    "## Stage 3: evaluation (branches, masks, lowering, limit)",
    ...control.evaluations.map((record) => `- ${record.truth === "true" ? "TAKEN " : record.truth === "unknown" ? "unknown " : "false "}${record.policyId}#${record.branchId}${record.truth === "true" ? `: ${record.evidence.join("; ")}` : ""}`),
    `- limit: ${limit ?? "none"}`,
    `- conflicts: ${control.conflicts.length ? control.conflicts.join("; ") : "none"}`, "",
    `## Stage 4: emitted prompt (compiler_slice, ${control.tokenCount.tokens} tokens)`, "", control.compiledPrompt, "",
    `## Source arm (${sourceArm.tokenCount.tokens} tokens)`,
    ...(sourceArm.sourceSelection?.sections ?? []).map((section) => `- ${section.retained ? "retained" : "omitted "} ${section.heading}${section.context ? " (context)" : ""}: ${section.reasons.join("; ")}`),
  ];
  return lines.join("\n");
}

function main(): void {
  const argv = process.argv.slice(2);
  const root = process.cwd();
  const source = readFileSync(resolve(root, SOURCE_POLICY_PATH), "utf8");
  const policies = loadPolicies(resolve(root, "policies"));
  const corpus = loadVisibleCorpus(root).cases;
  if (argv[0] === "--summary") {
    const report = summarize(corpus, policies, source);
    const output = argv[1] === "--output" ? argv[2] : undefined;
    if (output) { mkdirSync(dirname(resolve(output)), { recursive: true }); writeFileSync(resolve(output), `${JSON.stringify(report, null, 2)}\n`); }
    const { rows: _rows, ...totals } = report;
    console.log(JSON.stringify(totals, null, 2));
    return;
  }
  assert(argv[0] === "--case" && argv[1], "usage: pnpm trace:source --summary [--output <json>] | --case <caseId>");
  const entry = corpus.find(({ item }) => item.caseId === argv[1]);
  assert(entry, `${argv[1]} is not in the visible allowlist`);
  console.log(trace(entry, policies, source));
}

main();
