import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ArtifactContext } from "../policy/types.js";
import { canonicalJson, sha256 } from "../compiler/artifact.js";
import { countTokens } from "../compiler/tokenCounter.js";
import { loadBehavioralCases } from "../experiment/cases.js";
import { gitProvenance } from "../experiment/plan.js";
import { requiredFieldNames } from "../ir/deterministicFrontend.js";
import { extractorResponseJsonSchema } from "../ir/persistedFrontend.js";

/**
 * The extractor frontend, planning half. One model call per request, at
 * compile time, reads the request into the facts a policy condition tests.
 * TypeScript decides what is read (the instructions, the response schema, and
 * each request's input block) and prices it; the Python runtime makes the
 * calls under the same ceilings, confirmation, raw retention, and resume rules
 * as every other paid call, and writes the reads file that
 * `policyc experiment --request-state-reads` loads through the persisted
 * frontend boundary.
 */

export const EXTRACTOR_PROMPT_PATH = "prompts/request-state-extractor.md";

type Options = {
  cases?: string;
  fixtures?: string;
  output: string;
  provider: "fake" | "openai";
  model: string;
  maxOutputTokens: number;
  maxCostUsd: number;
  concurrency: number;
  dryRun: boolean;
  yes: boolean;
  label?: string;
};

export type ExtractionItem = { key: string; input: string; requiredFields: string[]; estimatedInputTokens: number };

export function runExtractCommand(argv: string[]): void {
  const options = parseOptions(argv);
  const sourceControl = gitProvenance();
  const instructions = readFileSync(EXTRACTOR_PROMPT_PATH, "utf8");
  const promptSha256 = sha256(instructions);
  const frontendId = `extractor:${options.model}:${promptSha256.slice(0, 12)}`;
  const responseSchema = extractorResponseJsonSchema();
  const source = options.cases ? loadCaseItems(options.cases) : loadFixtureItems(options.fixtures!);
  const items: ExtractionItem[] = source.items.map((item) => {
    const requiredFields = requiredFieldNames(item.context);
    const input = inputBlock(item.request, item.context, requiredFields);
    return { key: item.key, input, requiredFields, estimatedInputTokens: countTokens(`${instructions}\n${input}`, options.model).tokens + INPUT_TOKEN_OVERHEAD };
  });
  const output = resolve(options.output);
  const planPath = resolve(output, "extraction-plan.json");
  const existing = readExistingPlan(planPath);
  const createdAt = existing?.createdAt ?? new Date().toISOString();
  const identityCore = {
    schemaVersion: "1.0.0",
    kind: "request-state-extraction",
    ...(options.label ? { label: options.label } : {}),
    sourceControl,
    frontendId,
    promptPath: resolve(EXTRACTOR_PROMPT_PATH),
    promptSha256,
    source: source.record,
    provider: options.provider,
    model: options.model,
    modelParameters: { max_output_tokens: options.maxOutputTokens, store: false },
    responseSchema,
    instructions,
    items,
    maxConcurrency: options.concurrency,
    budget: { maxCalls: items.length, maxCostUsd: options.maxCostUsd },
    pricing: { registryPath: resolve("pricing/openai-v2.json"), registryVersion: "openai-2026-07-12" },
    outputDirectory: ".",
    rawResponseRetention: "full",
  };
  const planId = `ext_${sha256(canonicalJson(identityCore)).slice(0, 16)}`;
  if (existing && existing.planId !== planId) throw new Error(`output directory already belongs to incompatible extraction ${existing.planId}; choose a new --output directory`);
  mkdirSync(output, { recursive: true });
  writeFileSync(planPath, `${canonicalJson({ ...identityCore, createdAt, planId })}\n`);
  const runtime = resolve(".venv/bin/policyc-runtime");
  const runtimeArgs = ["extract", planPath, ...(options.dryRun ? ["--dry-run"] : []), ...(options.yes ? ["--yes"] : [])];
  const result = spawnSync(runtime, runtimeArgs, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`extraction runtime exited with status ${result.status}`);
}

/** Fixed request-envelope overhead the provider bills beyond the instructions and input. */
const INPUT_TOKEN_OVERHEAD = 24;

type SourceItem = { key: string; request: string; context: ArtifactContext | null };
type Source = { record: { kind: "cases" | "fixtures"; path: string; hash: string; count: number }; items: SourceItem[] };

function loadCaseItems(path: string): Source {
  const set = loadBehavioralCases(path);
  return {
    record: { kind: "cases", path: resolve(path), hash: set.datasetHash, count: set.cases.length },
    items: set.cases.map((item) => ({ key: item.caseId, request: item.request, context: { ...(item.artifactContext ?? {}), toolsAvailable: item.tools.map((tool) => tool.name) } })),
  };
}

/** Paraphrase fixtures (`eval/behavioral/compiler-v0.9-paraphrases.jsonl`): id, text, optional tools; no declared operation. */
function loadFixtureItems(path: string): Source {
  const text = readFileSync(path, "utf8");
  const items = text.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line) as { id: string; text: string; tools?: string[] });
  for (const item of items) {
    if (typeof item.id !== "string" || typeof item.text !== "string") throw new Error(`fixture without id and text in ${path}`);
  }
  return {
    record: { kind: "fixtures", path: resolve(path), hash: sha256(text), count: items.length },
    items: items.map((item) => ({ key: item.id, request: item.text, context: { toolsAvailable: item.tools ?? [] } })),
  };
}

export function inputBlock(request: string, context: ArtifactContext | null, requiredFields: string[]): string {
  const lines = [
    "Request:",
    request,
    "",
    "Declared context:",
    `- artifact type: ${context?.artifactType ?? "none declared"}`,
    `- operation: ${context?.operation ?? "none declared"}`,
    `- features: ${context?.features?.length ? context.features.join(", ") : "none"}`,
    `- tools available on this turn: ${context?.toolsAvailable?.length ? context.toolsAvailable.join(", ") : "none"}`,
    `- required fields for this operation: ${requiredFields.length ? requiredFields.join(", ") : "none"}`,
  ];
  return lines.join("\n");
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
    else throw new Error(`unexpected extract argument: ${arg}`);
  }
  const required = (name: string): string => { const value = values.get(name); if (!value) throw new Error(`extract requires ${name}`); return value; };
  const integer = (name: string, fallback?: number): number => { const raw = values.get(name); const value = raw === undefined ? fallback : Number(raw); if (value === undefined || !Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`); return value; };
  const provider = values.get("--provider") ?? "fake";
  if (!["fake", "openai"].includes(provider)) throw new Error(`unknown provider: ${provider}`);
  const cases = values.get("--cases");
  const fixtures = values.get("--fixtures");
  if (Boolean(cases) === Boolean(fixtures)) throw new Error("extract requires exactly one of --cases or --fixtures");
  const maxCostUsd = Number(required("--max-cost-usd"));
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) throw new Error("--max-cost-usd must be positive");
  const label = values.get("--label");
  if (label && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(label)) throw new Error("--label must contain only letters, numbers, dots, underscores, and hyphens");
  return {
    cases, fixtures, output: required("--output"), provider: provider as "fake" | "openai", model: required("--model"),
    maxOutputTokens: integer("--max-output-tokens", 2048), maxCostUsd, concurrency: integer("--concurrency", 2),
    dryRun: flags.has("--dry-run"), yes: flags.has("--yes"), label,
  };
}
