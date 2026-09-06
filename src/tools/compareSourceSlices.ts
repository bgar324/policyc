/**
 * Offline source-slice comparison lever.
 *
 *   pnpm compare:source --baseline <checkpoint-root> --output <json-file>
 *
 * No provider call, no experiment command, no catalog write. It compiles the
 * prior explicit 97-case visible allowlist twice - once through the
 * checkpoint's own compiler loaded from `--baseline`, once through the working
 * tree - and asserts:
 *
 *   1. Legacy identity: the four compiled strategies (4 x 97 = 388 prompts)
 *      and the full-policy baseline are unchanged against the checkpoint, by
 *      `compiledPromptHash` and by the stronger `candidateId`.
 *   2. Matched selection: every experimental arm carries exactly the current
 *      selector's dependency-closed node set, asserted against the
 *      `compiler_slice` artifact's own selected ids and dependency edges.
 *   3. Source fidelity: arm B's prompt is rebuilt here from the declared UTF-8
 *      byte spans with `Buffer.subarray`, with no compiler code, and compared
 *      for byte equality; the common context bytes are proven to reach arms C
 *      and D unchanged.
 *
 * Every recorded number is a prompt, byte, hash, span, section, or token
 * measurement. No behavioral score is produced or implied.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createArtifact, sha256, type CompilationStrategy, type CompiledPolicyArtifact } from "../compiler/artifact.js";
import { generateCandidateSelections } from "../compiler/candidates.js";
import { loadVisibleCorpus, VISIBLE_ALLOWLIST, CORPUS_DIR } from "./visibleAllowlist.js";
import { loadPolicies } from "../policy/loader.js";
import type { ArtifactContext, Policy, PolicySelection, SourceSelection } from "../policy/types.js";

/** Control checkpoint. Another commit, or a modified compiler input, is refused. */
const BASELINE_COMMIT = "1fbe449b4b9972f63b132bac92abda42a9f7430b";
const SOURCE_POLICY_PATH = "prompts/synthetic-enterprise-agent.md";
const SOURCE_POLICY_ID = "synthetic-enterprise-agent";
/** Pinned original source bytes; both roots must hold exactly this file. */
const SOURCE_POLICY_SHA256 = "961150058da20550d6004e52bdbd9a35954028d182883b3a4fcf19ff71ec803a";
/** Fixed so a rerun is byte-stable; `createdAt` sits outside the candidate identity. */
const CREATED_AT = "1970-01-01T00:00:00.000Z";


const LEGACY_STRATEGIES = ["full_policy", "compiler_slice", "kernel_only", "direct_matches", "conservative_expanded"] as const;
/** The four compiled strategies whose 388 prompts must not move. */
const LEGACY_COMPILED = ["compiler_slice", "kernel_only", "direct_matches", "conservative_expanded"] as const;
/** B, D, C: whole-source projection, authored defaults, evaluated bundle. */
const EXPERIMENTAL_STRATEGIES = ["source_preserving_slice", "source_matched_authored", "source_matched_semantic"] as const;
/** C and D prepend the same context bytes to the existing emitter output. */
const CONTEXT_PREPENDING = ["source_matched_authored", "source_matched_semantic"] as const;
/** F: clause map with audited dedupe; measured and reconstructed separately from the section arms. */
const CLAUSE_ARM = "source_clause_slice";
/** G/H: the clause slice plus bound verbatim evidence, bare and apply frames. */
const EVIDENCE_ARMS = ["source_evidence_bare", "source_evidence_apply"] as const;

/** The checkpoint's own compiler, loaded from its checkout so the control is its code. */
type BaselineCompiler = {
  loadPolicies: (dir?: string) => Policy[];
  generateCandidateSelections: (policies: Policy[], input: string, context?: ArtifactContext | null) => Candidate[];
  createArtifact: (options: Parameters<typeof createArtifact>[0]) => CompiledPolicyArtifact;
};
type Candidate = { strategy: CompilationStrategy; selection: PolicySelection };
type ArmMeasurement = { candidateId: string; compiledPromptHash: string; schemaVersion: string; compilerVersion: string; tokens: number };

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const currentRoot = process.cwd();
  const baselineRoot = resolve(args.baseline);
  assert(baselineRoot !== resolve(currentRoot), "--baseline must be a separate checkout of the checkpoint, not the working tree");

  const head = git(baselineRoot, ["rev-parse", "HEAD"]).trim();
  assert(head === BASELINE_COMMIT, `baseline mismatch: ${baselineRoot} is at ${head}, expected ${BASELINE_COMMIT}`);
  const modified = git(baselineRoot, ["status", "--porcelain", "--", "src", "policies", "prompts", "protocol", "runtime", ...VISIBLE_ALLOWLIST.map(({ file }) => `${CORPUS_DIR}/${file}`), "package.json", "pnpm-lock.yaml"])
    .split("\n").map((line) => line.trim()).filter(Boolean);
  assert(modified.length === 0, `baseline mismatch: compiler inputs are modified in ${baselineRoot}: ${modified.join(", ")}`);

  const sourceBytes = readFileSync(join(currentRoot, SOURCE_POLICY_PATH));
  const sourceText = sourceBytes.toString("utf8");
  const sourceHash = sha256(sourceText);
  assert(sourceHash === SOURCE_POLICY_SHA256, `source mismatch: ${SOURCE_POLICY_PATH} is ${sourceHash}, expected ${SOURCE_POLICY_SHA256}`);
  const originalSections = sourceText.split(/(?=^## )/m).map((text) => Buffer.from(text));
  const baselineSourceText = readFileSync(join(baselineRoot, SOURCE_POLICY_PATH), "utf8");
  assert(sha256(baselineSourceText) === SOURCE_POLICY_SHA256, `baseline mismatch: ${SOURCE_POLICY_PATH} differs from the pinned source bytes`);

  const corpus = loadVisibleCorpus(currentRoot);
  const corpusFiles = corpus.files;
  const testCases = corpus.cases.map(({ item }) => item);
  const fileOf: Record<string, string> = Object.fromEntries(corpus.cases.map(({ file, item }) => [item.caseId, file]));
  for (const entry of VISIBLE_ALLOWLIST) {
    const controlHash = sha256(readFileSync(join(baselineRoot, CORPUS_DIR, entry.file), "utf8"));
    assert(controlHash === entry.sha256, `allowlist mismatch: the checkpoint's ${CORPUS_DIR}/${entry.file} is ${controlHash}`);
  }

  const baseline = await loadBaselineCompiler(baselineRoot);
  const baselinePolicies = baseline.loadPolicies(join(baselineRoot, "policies"));
  const policies = loadPolicies(join(currentRoot, "policies"));

  const cases: Array<Record<string, unknown>> = [];
  const identicalPrompt: Record<string, number> = {};
  const identicalCandidate: Record<string, number> = {};
  const tokensByArm: Record<string, number[]> = {};
  const reductionByArm: Record<string, number[]> = {};
  const sectionTotals = { sections: 0, retained: 0, context: 0, excluded: 0, sourceOnlyRetained: 0 };
  const retainedReasons: Record<string, number> = {};
  const excludedReasons: Record<string, number> = {};
  const sourceOnlyHeadings = new Set<string>();
  const excludedHeadings = new Set<string>();
  const extraCoverage = new Set<string>();
  const seedIdsWithoutSection = new Set<string>();
  const sourceMapHashes = new Set<string>();
  let retainAllCases = 0;

  const clauseTotals = { clauses: 0, retained: 0, boilerplateGroups: 0, subsumedCopies: 0, casesWithPruning: 0 };
  const clauseMapHashes = new Set<string>();
  const evidenceTotals = { bindings: 0, quotes: 0, actions: 0 };
  const evidenceContractHashes = new Set<string>();
  for (const testCase of testCases) {
    const context: ArtifactContext = { ...(testCase.artifactContext ?? {}), toolsAvailable: testCase.tools.map((tool) => tool.name) };
    const compile = (candidate: Candidate, root: "current" | "baseline"): CompiledPolicyArtifact => {
      const options: Parameters<typeof createArtifact>[0] = {
        policies: root === "current" ? policies : baselinePolicies,
        selection: candidate.selection,
        request: testCase.request,
        context,
        strategy: candidate.strategy,
        sourcePolicyId: SOURCE_POLICY_ID,
        sourcePolicyText: root === "current" ? sourceText : baselineSourceText,
        createdAt: CREATED_AT
      };
      return root === "current" ? createArtifact(options) : baseline.createArtifact(options);
    };
    const byStrategy = (candidates: Candidate[]): Record<string, Candidate> => Object.fromEntries(candidates.map((item) => [item.strategy, item]));

    const control = byStrategy(baseline.generateCandidateSelections(baselinePolicies, testCase.request, context));
    const legacyOnly = byStrategy(generateCandidateSelections(policies, testCase.request, context));
    const current = byStrategy(generateCandidateSelections(policies, testCase.request, context, undefined, sourceText));
    assert(Object.keys(control).length === LEGACY_STRATEGIES.length, `${testCase.caseId}: the checkpoint produced ${Object.keys(control).length} candidates`);
    assert(Object.keys(legacyOnly).length === LEGACY_STRATEGIES.length, `${testCase.caseId}: the four-argument call produced ${Object.keys(legacyOnly).length} candidates, expected ${LEGACY_STRATEGIES.length}`);
    assert(Object.keys(current).length === LEGACY_STRATEGIES.length + EXPERIMENTAL_STRATEGIES.length + 1 + EVIDENCE_ARMS.length, `${testCase.caseId}: the five-argument call produced ${Object.keys(current).length} candidates`);

    const arms: Record<string, ArmMeasurement> = {};
    const baselineArms: Record<string, { candidateId: string; compiledPromptHash: string; tokens: number }> = {};
    const prompts: Record<string, string> = {};

    for (const strategy of LEGACY_STRATEGIES) {
      const artifact = compile(current[strategy], "current");
      const legacyArtifact = compile(legacyOnly[strategy], "current");
      const controlArtifact = compile(control[strategy], "baseline");
      assert(artifact.compiledPromptHash === controlArtifact.compiledPromptHash, `${testCase.caseId}/${strategy}: compiled prompt drifted from the checkpoint (${controlArtifact.compiledPromptHash} -> ${artifact.compiledPromptHash})`);
      assert(artifact.candidateId === controlArtifact.candidateId, `${testCase.caseId}/${strategy}: candidate id drifted from the checkpoint (${controlArtifact.candidateId} -> ${artifact.candidateId})`);
      assert(legacyArtifact.candidateId === artifact.candidateId, `${testCase.caseId}/${strategy}: the source-text argument perturbed a legacy candidate`);
      assert(artifact.schemaVersion === "1.3.0" && artifact.compilerVersion === "0.10.0", `${testCase.caseId}/${strategy}: legacy artifact declares ${artifact.compilerVersion}/${artifact.schemaVersion}`);
      assert(artifact.sourceSelection === undefined, `${testCase.caseId}/${strategy}: legacy artifact carries sourceSelection`);
      identicalPrompt[strategy] = (identicalPrompt[strategy] ?? 0) + 1;
      identicalCandidate[strategy] = (identicalCandidate[strategy] ?? 0) + 1;
      prompts[strategy] = artifact.compiledPrompt;
      arms[strategy] = measure(artifact);
      baselineArms[strategy] = { candidateId: controlArtifact.candidateId, compiledPromptHash: controlArtifact.compiledPromptHash, tokens: controlArtifact.tokenCount.tokens };
      (tokensByArm[strategy] ??= []).push(artifact.tokenCount.tokens);
    }

    const seed = compile(current["compiler_slice"], "current");
    const seedEdges = seed.dependencyEdges.map((edge) => `${edge.from}:${edge.requires}`);
    let trace: SourceSelection | undefined;
    for (const strategy of EXPERIMENTAL_STRATEGIES) {
      const artifact = compile(current[strategy], "current");
      assert(artifact.schemaVersion === "1.4.0" && artifact.compilerVersion === "0.10.0-source-slice.1", `${testCase.caseId}/${strategy}: experimental artifact declares ${artifact.compilerVersion}/${artifact.schemaVersion}`);
      assert(sameOrder(artifact.selectedPolicyIds, seed.selectedPolicyIds), `${testCase.caseId}/${strategy}: selected policy ids are not the current selector's dependency-closed set`);
      assert(sameOrder(artifact.dependencyEdges.map((edge) => `${edge.from}:${edge.requires}`), seedEdges), `${testCase.caseId}/${strategy}: dependency edges are not the current selector's dependency-closed set`);
      const selection = artifact.sourceSelection;
      assert(selection !== undefined, `${testCase.caseId}/${strategy}: experimental artifact has no sourceSelection`);
      if (trace === undefined) trace = selection;
      else assert(JSON.stringify(selection) === JSON.stringify(trace), `${testCase.caseId}/${strategy}: the source selection trace differs from the other experimental arms`);
      prompts[strategy] = artifact.compiledPrompt;
      arms[strategy] = measure(artifact);
      (tokensByArm[strategy] ??= []).push(artifact.tokenCount.tokens);
    }
    assert(trace !== undefined, `${testCase.caseId}: no source selection trace`);
    assert(sameOrder(trace.seedPolicyIds, seed.selectedPolicyIds), `${testCase.caseId}: seedPolicyIds are not the compiler_slice selectedPolicyIds`);
    sourceMapHashes.add(trace.sourceMapHash);

    // Independent reconstruction: original bytes only, no compiler code.
    const seedSet = new Set(seed.selectedPolicyIds);
    assert(trace.sections.length === originalSections.length, `${testCase.caseId}: source section inventory is incomplete`);
    trace.sections.forEach((section, position) => {
      const span = sourceBytes.subarray(section.startByte, section.endByte);
      assert(span.equals(originalSections[position]), `${testCase.caseId}: section ${position} is not a complete original source section`);
      const label = `${testCase.caseId}: section ${position} (${section.heading})`;
      assert(section.endByte > section.startByte && section.endByte <= sourceBytes.length, `${label} is not a half-open span inside the source`);
      assert(span.length === section.endByte - section.startByte, `${label} span is truncated`);
      assert(sha256(span.toString("utf8")) === section.sha256, `${label} sha256 does not match its own byte span`);
      assert(!section.context || section.retained, `${label} is common context but not retained`);
      assert(position === 0 || section.startByte >= trace.sections[position - 1].endByte, `${label} overlaps the previous section`);
      assert(section.retained || !section.policyIds.some((id) => seedSet.has(id)), `${label} is excluded yet maps selected policy ids`);
    });
    const retained = trace.sections.filter((section) => section.retained);
    const retainedBlob = Buffer.concat(retained.map((section) => sourceBytes.subarray(section.startByte, section.endByte)));
    assert(retainedBlob.equals(Buffer.from(prompts["source_preserving_slice"], "utf8")), `${testCase.caseId}: arm B is not the retained original byte spans concatenated in source order`);
    const contextBlob = Buffer.concat(trace.sections.filter((section) => section.context).map((section) => sourceBytes.subarray(section.startByte, section.endByte))).toString("utf8");
    for (const strategy of CONTEXT_PREPENDING) {
      assert(prompts[strategy].startsWith(`${contextBlob}\n`), `${testCase.caseId}/${strategy}: the common context source bytes do not lead the emitter output`);
    }

    // Clause arm: every kept span is one whole original line; the prompt is those lines, in order, plus headings.
    const clauseArtifact = compile(current[CLAUSE_ARM], "current");
    const clauseTrace = clauseArtifact.sourceClauseSelection;
    assert(clauseTrace !== undefined, `${testCase.caseId}: clause artifact has no sourceClauseSelection`);
    assert(clauseArtifact.schemaVersion === "1.4.0", `${testCase.caseId}/${CLAUSE_ARM}: declares ${clauseArtifact.schemaVersion}`);
    assert(sameOrder(clauseArtifact.selectedPolicyIds, seed.selectedPolicyIds), `${testCase.caseId}/${CLAUSE_ARM}: selected policy ids drifted from the shared seed`);
    const lineOf = (span: { startByte: number; endByte: number }) => sourceBytes.subarray(span.startByte, span.endByte).toString("utf8");
    const keptSpans = [...clauseTrace.clauses.filter((clause) => clause.retained), ...clauseTrace.boilerplate.filter((group) => group.retained)].sort((a, b) => a.line - b.line);
    for (const span of [...clauseTrace.clauses, ...clauseTrace.boilerplate, ...clauseTrace.boilerplate.flatMap((group) => group.subsumes)]) {
      const text = lineOf(span);
      assert(text.endsWith("\n") && !text.slice(0, -1).includes("\n"), `${testCase.caseId}/${CLAUSE_ARM}: span at line ${span.line} is not one whole line`);
      assert(sha256(text.slice(0, -1)) === span.sha256, `${testCase.caseId}/${CLAUSE_ARM}: span at line ${span.line} does not hash to its text`);
    }
    const emittedLines = clauseArtifact.compiledPrompt.split("\n").filter((line) => line !== "" && !line.startsWith("## ") && !line.endsWith(":"));
    assert(sameOrder(emittedLines, keptSpans.map((span) => lineOf(span).slice(0, -1))), `${testCase.caseId}/${CLAUSE_ARM}: the prompt is not the kept clause and boilerplate lines in source order`);
    for (const clause of clauseTrace.clauses) {
      if (!clause.retained) assert(clause.reasons.every((reason) => reason.startsWith("pruned by trusted structural fact")), `${testCase.caseId}/${CLAUSE_ARM}: ${clause.id} pruned without a structural fact`);
      else for (const dependency of clause.dependsOn) assert(clauseTrace.clauses.find((entry) => entry.id === dependency)?.retained, `${testCase.caseId}/${CLAUSE_ARM}: ${clause.id} retained without its dependency ${dependency}`);
    }
    const declared = testCase.artifactContext?.exhaustive;
    assert((declared?.artifacts === true) === clauseTrace.exhaustive.artifacts && (declared?.tools === true) === clauseTrace.exhaustive.tools, `${testCase.caseId}/${CLAUSE_ARM}: exhaustive record does not match the case context`);
    if (!declared) assert(clauseTrace.clauses.every((clause) => clause.retained), `${testCase.caseId}/${CLAUSE_ARM}: pruned without an exhaustive declaration`);
    prompts[CLAUSE_ARM] = clauseArtifact.compiledPrompt;
    arms[CLAUSE_ARM] = measure(clauseArtifact);
    (tokensByArm[CLAUSE_ARM] ??= []).push(clauseArtifact.tokenCount.tokens);
    clauseTotals.clauses += clauseTrace.clauses.length;
    clauseTotals.retained += clauseTrace.clauses.filter((clause) => clause.retained).length;
    clauseTotals.boilerplateGroups += clauseTrace.boilerplate.length;
    clauseTotals.subsumedCopies += clauseTrace.boilerplate.reduce((sum, group) => sum + group.subsumes.length, 0);
    if (clauseTrace.clauses.some((clause) => !clause.retained)) clauseTotals.casesWithPruning += 1;
    clauseMapHashes.add(clauseTrace.clauseMapHash);

    // Evidence arms: the clause slice verbatim, then a block whose every quote is a whole request sentence at its offsets.
    for (const strategy of EVIDENCE_ARMS) {
      const artifact = compile(current[strategy], "current");
      const evidence = artifact.sourceEvidence;
      assert(evidence !== undefined, `${testCase.caseId}/${strategy}: no sourceEvidence`);
      assert(artifact.compiledPrompt.startsWith(clauseArtifact.compiledPrompt), `${testCase.caseId}/${strategy}: does not begin with the clause slice`);
      assert(sameOrder(artifact.selectedPolicyIds, seed.selectedPolicyIds), `${testCase.caseId}/${strategy}: selection drifted`);
      for (const binding of evidence.bindings) for (const quote of binding.quotes) {
        assert(testCase.request.slice(quote.start, quote.end).trim() === quote.text, `${testCase.caseId}/${strategy}: quote at ${quote.start} is not the request text at those offsets`);
        assert(artifact.compiledPrompt.includes(`"${quote.text}"`), `${testCase.caseId}/${strategy}: quoted sentence missing from the prompt`);
      }
      const serialized = JSON.stringify(evidence);
      for (const token of ["\"present\"", "\"absent\"", "satisfied", "verdict"]) assert(!serialized.includes(token), `${testCase.caseId}/${strategy}: evidence carries a verdict token ${token}`);
      prompts[strategy] = artifact.compiledPrompt;
      arms[strategy] = measure(artifact);
      (tokensByArm[strategy] ??= []).push(artifact.tokenCount.tokens);
      evidenceTotals.bindings += evidence.bindings.length;
      evidenceTotals.quotes += evidence.bindings.reduce((sum, binding) => sum + binding.quotes.length, 0);
      evidenceTotals.actions += evidence.actions.length;
      evidenceContractHashes.add(evidence.evidenceContractHash);
    }

    sectionTotals.sections += trace.sections.length;
    if (retained.length === trace.sections.length) retainAllCases += 1;
    for (const section of trace.sections) {
      if (section.retained) sectionTotals.retained += 1;
      else {
        sectionTotals.excluded += 1;
        excludedHeadings.add(section.heading);
      }
      if (section.context) sectionTotals.context += 1;
      for (const reason of section.reasons) {
        const bucket = section.retained ? retainedReasons : excludedReasons;
        bucket[reason] = (bucket[reason] ?? 0) + 1;
      }
      if (section.retained && !section.policyIds.length) {
        sectionTotals.sourceOnlyRetained += 1;
        sourceOnlyHeadings.add(section.heading);
      }
      for (const id of section.policyIds) if (section.retained && !seedSet.has(id)) extraCoverage.add(id);
    }
    const mapped = new Set(trace.sections.flatMap((section) => section.policyIds));
    for (const id of seed.selectedPolicyIds) if (!mapped.has(id)) seedIdsWithoutSection.add(id);

    const fullTokens = arms["full_policy"].tokens;
    const reductions: Record<string, number> = {};
    for (const [strategy, arm] of Object.entries(arms)) {
      if (strategy === "full_policy") continue;
      reductions[strategy] = (fullTokens - arm.tokens) / fullTokens;
      (reductionByArm[strategy] ??= []).push(reductions[strategy]);
    }

    cases.push({
      caseId: testCase.caseId,
      corpusFile: fileOf[testCase.caseId],
      arms,
      baselineArms,
      selectedPolicyIds: seed.selectedPolicyIds,
      dependencyEdges: seedEdges,
      sourceSelection: trace,
      sourceClauseSelection: clauseTrace,
      sourceFidelity: {
        retainedSections: retained.length,
        sections: trace.sections.length,
        retainedBytes: retainedBlob.length,
        retainedByteFraction: retainedBlob.length / sourceBytes.length,
        reconstructedSha256: sha256(retainedBlob.toString("utf8")),
        contextBytes: Buffer.byteLength(contextBlob, "utf8"),
        extraCoveragePolicyIds: [...new Set(retained.flatMap((section) => section.policyIds))].filter((id) => !seedSet.has(id)).sort()
      },
      tokenReductionAgainstFull: reductions
    });
  }

  assert(seedIdsWithoutSection.size === 0, `selected policies have no source mapping: ${[...seedIdsWithoutSection].join(", ")}`);
  const compiledCompared = LEGACY_COMPILED.length * testCases.length;
  const report = {
    tool: "compareSourceSlices",
    generatedAt: new Date().toISOString(),
    tokenizer: "o200k_base",
    checkpoint: { root: baselineRoot, head, modifiedPaths: modified },
    current: { root: currentRoot, codeHashes: codeInventory(currentRoot) },
    sourcePolicy: { path: SOURCE_POLICY_PATH, sha256: sourceHash, byteLength: sourceBytes.length },
    corpus: { directory: CORPUS_DIR, files: corpusFiles, distinctCases: testCases.length },
    legacyEquivalence: {
      identicalPrompt,
      identicalCandidate,
      compiledCompared,
      compiledIdenticalPrompt: LEGACY_COMPILED.reduce((sum, strategy) => sum + identicalPrompt[strategy], 0),
      compiledIdenticalCandidate: LEGACY_COMPILED.reduce((sum, strategy) => sum + identicalCandidate[strategy], 0)
    },
    experimental: { matchedSelectionCases: testCases.length, sourceByteExactCases: testCases.length, retainAllSectionCases: retainAllCases, sourceMapHashes: [...sourceMapHashes] },
    clauseArm: { ...clauseTotals, clauseMapHashes: [...clauseMapHashes] },
    evidenceArms: { ...evidenceTotals, evidenceContractHashes: [...evidenceContractHashes] },
    sections: {
      totals: sectionTotals,
      retainedReasons,
      excludedReasons,
      sourceOnlyRetainedHeadings: [...sourceOnlyHeadings].sort(),
      excludedHeadings: [...excludedHeadings].sort(),
      extraCoveragePolicyIds: [...extraCoverage].sort(),
      seedPolicyIdsWithoutMappedSection: [...seedIdsWithoutSection].sort()
    },
    tokens: Object.fromEntries(Object.keys(tokensByArm).sort().map((arm) => [arm, summarize(tokensByArm[arm])])),
    tokenReductionAgainstFull: Object.fromEntries(Object.keys(reductionByArm).sort().map((arm) => [arm, summarize(reductionByArm[arm])])),
    cases
  };
  mkdirSync(dirname(resolve(args.output)), { recursive: true });
  writeFileSync(resolve(args.output), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`legacy compiled prompt identities: ${report.legacyEquivalence.compiledIdenticalPrompt}/${compiledCompared}`);
  console.log(`legacy compiled candidate identities: ${report.legacyEquivalence.compiledIdenticalCandidate}/${compiledCompared}`);
  console.log(`full-policy identities: ${identicalPrompt["full_policy"]}/${testCases.length}`);
  console.log(`matched experimental selections: ${testCases.length}/${testCases.length}`);
  console.log(`source byte-exact reconstructions: ${testCases.length}/${testCases.length}`);
  console.log(`clause reconstructions: ${testCases.length}/${testCases.length}; cases with pruning: ${clauseTotals.casesWithPruning}; clauses retained ${clauseTotals.retained}/${clauseTotals.clauses}; boilerplate copies subsumed ${clauseTotals.subsumedCopies}`);
  console.log(`evidence arms: ${evidenceTotals.bindings} bindings, ${evidenceTotals.quotes} verbatim quotes, ${evidenceTotals.actions} proposed actions across ${testCases.length * EVIDENCE_ARMS.length} prompts`);
  console.log(`written: ${resolve(args.output)}`);
}

function measure(artifact: CompiledPolicyArtifact): ArmMeasurement {
  return { candidateId: artifact.candidateId, compiledPromptHash: artifact.compiledPromptHash, schemaVersion: artifact.schemaVersion, compilerVersion: artifact.compilerVersion, tokens: artifact.tokenCount.tokens };
}

function git(root: string, args: string[]): string {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  assert(result.status === 0, `git ${args.join(" ")} failed in ${root}: ${result.stderr.trim() || String(result.status)}`);
  return result.stdout;
}

async function loadBaselineCompiler(root: string): Promise<BaselineCompiler> {
  assert(existsSync(join(root, "node_modules")), `the baseline checkout has no resolvable node_modules: link or install dependencies in ${root}`);
  const load = async (relativePath: string): Promise<Record<string, unknown>> => {
    const path = join(root, relativePath);
    assert(existsSync(path), `baseline mismatch: ${path} does not exist`);
    return import(pathToFileURL(path).href) as Promise<Record<string, unknown>>;
  };
  const [candidates, artifact, loader] = await Promise.all([load("src/compiler/candidates.ts"), load("src/compiler/artifact.ts"), load("src/policy/loader.ts")]);
  const exported = { generateCandidateSelections: candidates["generateCandidateSelections"], createArtifact: artifact["createArtifact"], loadPolicies: loader["loadPolicies"] };
  for (const [name, value] of Object.entries(exported)) assert(typeof value === "function", `baseline mismatch: ${name} is not exported by the checkpoint`);
  // Checked above: every member is a function, and the signatures are pinned by BASELINE_COMMIT.
  const compiler = exported as unknown as BaselineCompiler;
  return compiler;
}

/**
 * Hashes only the code that could move a prompt: compiler, tests, policies,
 * protocol, runtime, packaging, and the source prompt. Evidence, environment,
 * run, and corpus trees are deliberately out of scope.
 */
function codeInventory(root: string): Array<{ path: string; sha256: string }> {
  const trees: Array<{ dir: string; extensions: string[] }> = [
    { dir: "src", extensions: [".ts"] },
    { dir: "test", extensions: [".ts"] },
    { dir: "policies", extensions: [".yaml", ".yml"] },
    { dir: "protocol", extensions: [".json"] },
    { dir: "runtime", extensions: [".py", "pyproject.toml"] }
  ];
  const paths = ["package.json", "pnpm-lock.yaml", "tsconfig.json", SOURCE_POLICY_PATH];
  for (const tree of trees) {
    for (const entry of readdirSync(join(root, tree.dir), { recursive: true, encoding: "utf8" })) {
      if (tree.extensions.some((suffix) => entry.endsWith(suffix))) paths.push(`${tree.dir}/${entry}`);
    }
  }
  return paths.sort().map((path) => ({ path, sha256: sha256(readFileSync(join(root, path), "utf8")) }));
}

function parseArgs(argv: string[]): { baseline: string; output: string } {
  const values: Record<string, string> = {};
  for (let position = 0; position < argv.length; position += 2) {
    assert(argv[position].startsWith("--") && argv[position + 1] !== undefined, "usage: pnpm compare:source --baseline <checkpoint-root> --output <json-file>");
    values[argv[position].slice(2)] = argv[position + 1];
  }
  assert(Boolean(values["baseline"] && values["output"]), "usage: pnpm compare:source --baseline <checkpoint-root> --output <json-file>");
  return { baseline: values["baseline"], output: values["output"] };
}

function summarize(values: number[]): { count: number; mean: number; min: number; max: number } {
  return { count: values.length, mean: values.reduce((sum, value) => sum + value, 0) / values.length, min: Math.min(...values), max: Math.max(...values) };
}

/** Order-sensitive list identity, used for every selection pair assertion. */
function sameOrder(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, position) => value === right[position]);
}

await main();
