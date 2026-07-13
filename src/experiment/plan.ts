import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalJson, COMPILER_VERSION, createArtifact, sha256, type CompilationStrategy } from "../compiler/artifact.js";
import { generateCandidateSelections } from "../compiler/candidates.js";
import { loadPolicies } from "../policy/loader.js";
import { loadBehavioralCases } from "./cases.js";

const STRATEGIES: CompilationStrategy[] = ["full_policy", "compiler_slice", "kernel_only", "direct_matches", "conservative_expanded"];
const INPUT_TOKEN_OVERHEAD_PER_CALL = 64;
type Options = {
  cases: string; strategies: CompilationStrategy[]; provider: "fake" | "openai"; model: string;
  samples: number; concurrency: number; maxOutputTokens: number; maxCalls: number; maxInputTokens?: number;
  maxOutputTokensTotal?: number; maxCostUsd: number; retries: number; output: string; dryRun: boolean;
  yes: boolean; retryAmbiguous: boolean;
  runLabel?: string;
};

export function runExperimentCommand(argv: string[]): void {
  const options = parseOptions(argv);
  const sourceControl = gitProvenance();
  const caseSet = loadBehavioralCases(options.cases);
  const policies = loadPolicies();
  const sourcePolicyText = readFileSync("prompts/synthetic-enterprise-agent.md", "utf8");
  const output = resolve(options.output);
  const manifestPath = resolve(output, "manifest.v2.json");
  const existingManifest = readExistingManifest(manifestPath);
  const artifactDir = resolve(output, "artifacts");
  mkdirSync(artifactDir, { recursive: true });
  const createdAt = existingManifest?.createdAt ?? new Date().toISOString();
  const pendingArtifacts: Array<{ path: string; artifact: ReturnType<typeof createArtifact> }> = [];
  const casePlans = caseSet.cases.map((testCase) => {
    const executionContext = {
      ...(testCase.artifactContext ?? {}),
      toolsAvailable: testCase.tools.map((tool) => tool.name),
    };
    const available = generateCandidateSelections(policies, testCase.request, executionContext);
    const selected = options.strategies.map((strategy) => {
      const candidate = available.find((item) => item.strategy === strategy);
      if (!candidate) throw new Error(`unsupported strategy ${strategy}`);
      const artifact = createArtifact({ policies, selection: candidate.selection, request: testCase.request, context: executionContext, strategy, sourcePolicyId: "synthetic-enterprise-agent", sourcePolicyText, model: options.model, createdAt });
      const filename = `${testCase.caseId}--${strategy}--${artifact.candidateId}.json`;
      pendingArtifacts.push({ path: resolve(artifactDir, filename), artifact });
      return { strategy, candidateId: artifact.candidateId, artifactPath: `artifacts/${filename}` };
    });
    return { caseId: testCase.caseId, case: testCase, candidates: selected };
  });
  const logicalTrials = casePlans.length * options.strategies.length * options.samples;
  const maxAttempts = options.retries + 1;
  const estimatedInputTokens = pendingArtifacts.reduce((sum, item) => sum + item.artifact.tokenCount.tokens * options.samples, 0) + logicalTrials * INPUT_TOKEN_OVERHEAD_PER_CALL;
  const derivedInputLimit = options.maxInputTokens ?? estimatedInputTokens * maxAttempts;
  const derivedOutputLimit = options.maxOutputTokensTotal ?? logicalTrials * options.maxOutputTokens * maxAttempts;
  if (options.provider === "openai" && options.maxCalls < logicalTrials) throw new Error(`--max-calls ${options.maxCalls} is below ${logicalTrials} logical trials`);
  const compilerHash = sha256(canonicalJson({ compilerVersion: COMPILER_VERSION, policyPackHash: casePlans[0].candidates.map((item) => item.candidateId), strategies: options.strategies }));
  const identityCore = {
    schemaVersion: "2.0.0", experimentName: "paired-policy-preservation", dataset: { path: resolve(options.cases), hash: caseSet.datasetHash, version: caseSet.datasetVersion, split: caseSet.split },
    ...(options.runLabel ? { runLabel: options.runLabel } : {}),
    sourceControl,
    compilerHash, casePlans, strategies: options.strategies, provider: options.provider, model: options.model,
    modelParameters: { max_output_tokens: options.maxOutputTokens, max_tool_calls: 1, store: false }, sampleCount: options.samples,
    inputTokenOverheadPerCall: INPUT_TOKEN_OVERHEAD_PER_CALL,
    maxConcurrency: options.concurrency, timeoutSeconds: 60,
    retryPolicy: { maxAttempts, initialBackoffSeconds: 1, maxBackoffSeconds: 30, jitterFraction: 0.1, retryAmbiguous: options.retryAmbiguous },
    rateLimit: { requestsPerWindow: 60, windowSeconds: 60, maxConcurrentRequests: options.concurrency },
    evaluator: { id: "independent-rules", version: "2.4.0" }, grader: { type: "manual", version: "1.0.0", blind: true },
    budget: { maxLogicalTrials: logicalTrials, maxCalls: options.maxCalls, maxInputTokens: derivedInputLimit, maxOutputTokens: derivedOutputLimit, maxCostUsd: options.maxCostUsd },
    pricing: { registryPath: resolve("pricing/openai-v2.json"), registryVersion: "openai-2026-07-12" },
    outputDirectory: ".", rawResponseRetention: "full"
  };
  const runId = `run_${sha256(canonicalJson(identityCore)).slice(0, 16)}`;
  if (existingManifest && existingManifest.runId !== runId) throw new Error(`output directory already belongs to incompatible run ${existingManifest.runId}; choose a new --output directory`);
  const manifest = { ...identityCore, createdAt, runId };
  mkdirSync(output, { recursive: true });
  for (const item of pendingArtifacts) writeFileSync(item.path, `${canonicalJson(item.artifact)}\n`);
  writeFileSync(manifestPath, `${canonicalJson(manifest)}\n`);
  const runtime = resolve(".venv/bin/policyc-runtime");
  const runtimeArgs = ["experiment", manifestPath, ...(options.dryRun ? ["--dry-run"] : []), ...(options.yes ? ["--yes"] : [])];
  const result = spawnSync(runtime, runtimeArgs, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`experiment runtime exited with status ${result.status}`);
}

function gitProvenance(): { system: "git"; commit: string; dirty: boolean } {
  const revision = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  const status = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8" });
  if (revision.status !== 0 || status.status !== 0 || !revision.stdout.trim()) {
    throw new Error("experiment requires readable Git provenance");
  }
  return { system: "git", commit: revision.stdout.trim(), dirty: Boolean(status.stdout.trim()) };
}

function readExistingManifest(path: string): { runId: string; createdAt: string } | undefined {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as { runId?: unknown; createdAt?: unknown };
    if (typeof value.runId !== "string" || typeof value.createdAt !== "string") throw new Error(`existing manifest is missing runId or createdAt: ${path}`);
    return { runId: value.runId, createdAt: value.createdAt };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    throw error;
  }
}

function parseOptions(argv: string[]): Options {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (["--dry-run", "--yes", "--retry-ambiguous"].includes(arg)) flags.add(arg);
    else if (arg.startsWith("--")) { const next = argv[index + 1]; if (!next || next.startsWith("--")) throw new Error(`${arg} requires a value`); values.set(arg, next); index += 1; }
    else throw new Error(`unexpected experiment argument: ${arg}`);
  }
  const required = (name: string): string => { const value = values.get(name); if (!value) throw new Error(`experiment requires ${name}`); return value; };
  const integer = (name: string, fallback?: number, allowZero = false): number => { const raw = values.get(name); const value = raw === undefined ? fallback : Number(raw); if (value === undefined || !Number.isInteger(value) || value < (allowZero ? 0 : 1)) throw new Error(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer`); return value; };
  const provider = (values.get("--provider") ?? "fake") as string;
  if (!['fake', 'openai'].includes(provider)) throw new Error(`unknown provider: ${provider}`);
  const strategies = required("--strategies").split(",") as CompilationStrategy[];
  if (!strategies.length || strategies.some((item) => !STRATEGIES.includes(item))) throw new Error("--strategies contains an unsupported strategy");
  if (!strategies.includes("full_policy") || !strategies.includes("compiler_slice")) throw new Error("paired experiments require full_policy and compiler_slice");
  const maxCostUsd = Number(required("--max-cost-usd"));
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) throw new Error("--max-cost-usd must be positive");
  const runLabel = values.get("--run-label");
  if (runLabel && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runLabel)) throw new Error("--run-label must contain only letters, numbers, dots, underscores, and hyphens");
  return {
    cases: required("--cases"), strategies, provider: provider as "fake" | "openai", model: required("--model"),
    samples: integer("--samples", 1), concurrency: integer("--concurrency", 1), maxOutputTokens: integer("--max-output-tokens"),
    maxCalls: integer("--max-calls"), maxInputTokens: values.has("--max-input-tokens") ? integer("--max-input-tokens") : undefined,
    maxOutputTokensTotal: values.has("--max-output-tokens-total") ? integer("--max-output-tokens-total") : undefined,
    maxCostUsd, retries: integer("--retries", 0, true), output: required("--output"), dryRun: flags.has("--dry-run"), yes: flags.has("--yes"), retryAmbiguous: flags.has("--retry-ambiguous"), runLabel
  };
}
