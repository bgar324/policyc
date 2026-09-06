import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson, sha256 } from "../compiler/artifact.js";
import { generateCandidateSelections } from "../compiler/candidates.js";
import { READER_PROMPT_PATHS, readerContract, readerId, readerInput, readerInputV2, type ReaderContractVersion } from "../compiler/policyReader.js";
import { emitSourceClauses, listConditions } from "../compiler/sourceClauses.js";
import { countTokens } from "../compiler/tokenCounter.js";
import { loadBehavioralCases } from "../experiment/cases.js";
import { gitProvenance } from "../experiment/plan.js";
import { loadPolicies } from "../policy/loader.js";

/**
 * The model-as-reader arm, planning half. For every case the reader is shown
 * the same clause slice the source_clause_slice arm emits, plus the request
 * and the declared context, and asked to resolve the policy's own conditions.
 * TypeScript fixes what is read and prices it; the Python runtime makes the
 * calls under the extraction ceilings, confirmation, raw retention, and resume
 * rules, and writes the readings file that `policyc experiment
 * --policy-readings` loads at the persisted-readings boundary.
 */

type Options = {
  cases: string;
  output: string;
  provider: "fake" | "openai";
  model: string;
  maxOutputTokens: number;
  maxCostUsd: number;
  concurrency: number;
  dryRun: boolean;
  yes: boolean;
  label?: string;
  /** Provider reasoning effort for the reader call; absent means the model default. Part of plan identity and reader cost. */
  reasoningEffort?: ReasoningEffort;
  /** Reader contract: 1 finds the conditions itself; 2 resolves the indexed conditions of the retained clauses, each exactly once. */
  contract: ReaderContractVersion;
};

const REASONING_EFFORTS = ["minimal", "low", "medium", "high"] as const;
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** Fixed request-envelope overhead the provider bills beyond the instructions and input. */
const INPUT_TOKEN_OVERHEAD = 24;

export function runReadCommand(argv: string[]): void {
  const options = parseOptions(argv);
  const sourceControl = gitProvenance();
  const contract = readerContract(options.contract);
  const policies = loadPolicies();
  const sourcePolicyText = readFileSync("prompts/synthetic-enterprise-agent.md", "utf8");
  const set = loadBehavioralCases(options.cases);
  const items = set.cases.map((testCase) => {
    const context = { ...(testCase.artifactContext ?? {}), toolsAvailable: testCase.tools.map((tool) => tool.name) };
    const clause = generateCandidateSelections(policies, testCase.request, context, undefined, sourcePolicyText).find((item) => item.strategy === "source_clause_slice");
    if (!clause?.selection.sourceClauseSelection) throw new Error(`no clause slice for ${testCase.caseId}`);
    const slice = emitSourceClauses(sourcePolicyText, clause.selection.sourceClauseSelection);
    // Contract 2 lists the retained clauses' indexed conditions; the ids are the set a reading must answer exactly once.
    const conditions = options.contract === 2 ? listConditions(clause.selection.sourceClauseSelection) : [];
    const input = options.contract === 2 ? readerInputV2(slice, conditions, testCase.request, context) : readerInput(slice, testCase.request, context);
    return { key: testCase.caseId, input, requiredFields: conditions.map((condition) => condition.id), estimatedInputTokens: countTokens(`${contract.instructions}\n${input}`, options.model).tokens + INPUT_TOKEN_OVERHEAD };
  });
  const output = resolve(options.output);
  const planPath = resolve(output, "reading-plan.json");
  const existing = readExistingPlan(planPath);
  const createdAt = existing?.createdAt ?? new Date().toISOString();
  const identityCore = {
    schemaVersion: "1.0.0",
    kind: "policy-reading",
    ...(options.label ? { label: options.label } : {}),
    sourceControl,
    frontendId: readerId(options.model, contract.readingContractSha256, options.reasoningEffort),
    promptPath: resolve(READER_PROMPT_PATHS[options.contract]),
    promptSha256: contract.promptSha256,
    readContractSha256: contract.readingContractSha256,
    source: { kind: "cases", path: resolve(options.cases), hash: set.datasetHash, count: set.cases.length },
    provider: options.provider,
    model: options.model,
    modelParameters: { max_output_tokens: options.maxOutputTokens, store: false, ...(options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort } } : {}) },
    responseSchema: contract.responseSchema,
    instructions: contract.instructions,
    items,
    maxConcurrency: options.concurrency,
    budget: { maxCalls: items.length, maxCostUsd: options.maxCostUsd },
    pricing: { registryPath: resolve("pricing/openai-v2.json"), registryVersion: "openai-2026-07-12" },
    outputDirectory: ".",
    rawResponseRetention: "full",
  };
  const planId = `read_${sha256(canonicalJson(identityCore)).slice(0, 16)}`;
  if (existing && existing.planId !== planId) throw new Error(`output directory already belongs to incompatible reading ${existing.planId}; choose a new --output directory`);
  mkdirSync(output, { recursive: true });
  writeFileSync(planPath, `${canonicalJson({ ...identityCore, createdAt, planId })}\n`);
  const runtime = resolve(".venv/bin/policyc-runtime");
  const runtimeArgs = ["extract", planPath, ...(options.dryRun ? ["--dry-run"] : []), ...(options.yes ? ["--yes"] : [])];
  const result = spawnSync(runtime, runtimeArgs, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`reading runtime exited with status ${result.status}`);
}

function readExistingPlan(path: string): { planId: string; createdAt: string } | undefined {
  if (!existsSync(path)) return undefined;
  const value = JSON.parse(readFileSync(path, "utf8")) as { planId?: unknown; createdAt?: unknown };
  if (typeof value.planId !== "string" || typeof value.createdAt !== "string") throw new Error(`existing plan is missing planId or createdAt: ${path}`);
  return { planId: value.planId, createdAt: value.createdAt };
}

function parseOptions(argv: string[]): Options {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (["--dry-run", "--yes"].includes(arg)) flags.add(arg);
    else if (arg.startsWith("--")) { const next = argv[index + 1]; if (!next || next.startsWith("--")) throw new Error(`${arg} requires a value`); values.set(arg, next); index += 1; }
    else throw new Error(`unexpected read argument: ${arg}`);
  }
  const required = (name: string): string => { const value = values.get(name); if (!value) throw new Error(`read requires ${name}`); return value; };
  const integer = (name: string, fallback?: number): number => { const raw = values.get(name); const value = raw === undefined ? fallback : Number(raw); if (value === undefined || !Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`); return value; };
  const provider = values.get("--provider") ?? "fake";
  if (!["fake", "openai"].includes(provider)) throw new Error(`unknown provider: ${provider}`);
  const maxCostUsd = Number(required("--max-cost-usd"));
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) throw new Error("--max-cost-usd must be positive");
  const label = values.get("--label");
  if (label && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(label)) throw new Error("--label must contain only letters, numbers, dots, underscores, and hyphens");
  const reasoningEffort = values.get("--reasoning-effort");
  if (reasoningEffort !== undefined && !(REASONING_EFFORTS as readonly string[]).includes(reasoningEffort)) throw new Error(`--reasoning-effort must be one of ${REASONING_EFFORTS.join(", ")}`);
  const contractRaw = values.get("--contract") ?? "1";
  if (!["1", "2"].includes(contractRaw)) throw new Error("--contract must be 1 or 2");
  return {
    cases: required("--cases"), output: required("--output"), provider: provider as "fake" | "openai", model: required("--model"),
    maxOutputTokens: integer("--max-output-tokens", 4096), maxCostUsd, concurrency: integer("--concurrency", 2),
    dryRun: flags.has("--dry-run"), yes: flags.has("--yes"), label, reasoningEffort: reasoningEffort as ReasoningEffort | undefined,
    contract: Number(contractRaw) as ReaderContractVersion,
  };
}
