#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { emitRuntimePrompt } from "./compiler/emitter.js";
import { canonicalJson, createArtifact, sha256 } from "./compiler/artifact.js";
import { generateCandidateSelections } from "./compiler/candidates.js";
import { countTokens, tokenReduction } from "./compiler/tokenCounter.js";
import { runEval } from "./eval/runner.js";
import { compareModels } from "./model/compare.js";
import type { PromptStrategy } from "./model/types.js";
import { getPolicyById, loadPolicies } from "./policy/loader.js";
import type { ArtifactContext } from "./policy/types.js";
import { selectPolicies } from "./policy/selector.js";
import { formatJson, formatMetrics, formatModelComparison, formatPolicySummary, formatSelection } from "./util/format.js";

type ParsedArgs = {
  command?: string;
  input?: string;
  context?: ArtifactContext | null;
  policy?: string;
  strategy?: PromptStrategy;
  limit?: number;
  output?: string;
  model?: string;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const command = args.command;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "eval") {
    console.log(formatMetrics(runEval()));
    return;
  }

  if (command === "compare-models" || command === "eval-model") {
    const strategies = args.strategy ? [args.strategy] : undefined;
    console.log(formatModelComparison(await compareModels({ limit: args.limit, strategies })));
    return;
  }

  const policies = loadPolicies();

  if (command === "compile-candidates") {
    if (!args.input) throw new Error("compile-candidates requires --input");
    const output = resolve(args.output ?? "experiment");
    const artifactDir = resolve(output, "artifacts");
    mkdirSync(artifactDir, { recursive: true });
    const sourcePolicyId = "synthetic-enterprise-agent";
    const sourcePolicyText = readFileSync("prompts/synthetic-enterprise-agent.md", "utf8");
    const createdAt = new Date().toISOString();
    const artifacts = generateCandidateSelections(policies, args.input, args.context).map(({ strategy, selection }) =>
      createArtifact({ policies, selection, request: args.input!, context: args.context, strategy, sourcePolicyId, sourcePolicyText, model: args.model, createdAt })
    );
    for (const artifact of artifacts) writeFileSync(resolve(artifactDir, `${artifact.candidateId}.json`), `${canonicalJson(artifact)}\n`);
    const full = artifacts.find((artifact) => artifact.compilationStrategy === "full_policy")!;
    const runId = `run_${sha256(canonicalJson({ candidates: artifacts.map((artifact) => artifact.candidateId), model: args.model ?? "fake-v1", request: args.input })).slice(0, 16)}`;
    const manifest = {
      schemaVersion: "1.0.0", runId, experimentName: "policy-slice-non-inferiority", candidates: artifacts.map((artifact) => `artifacts/${artifact.candidateId}.json`),
      fullPolicyCandidateId: full.candidateId, provider: "fake", model: args.model ?? "fake-v1", modelParameters: { temperature: 0 }, sampleCount: 3,
      maxConcurrency: 4, timeoutSeconds: 10, retryPolicy: { maxAttempts: 3, initialBackoffSeconds: 0.05, maxBackoffSeconds: 0.5, jitterFraction: 0 },
      rateLimit: { requestsPerWindow: 100, windowSeconds: 1, maxConcurrentRequests: 4 }, evaluator: { id: "rule-based", version: "1.0.0", nonInferiorityMargin: 0.05 },
      seed: 0, outputDirectory: ".", rawResponseRetention: "text"
    };
    writeFileSync(resolve(output, "manifest.json"), `${canonicalJson(manifest)}\n`);
    console.log(`wrote ${artifacts.length} candidate artifacts and manifest to ${output}`);
    return;
  }

  if (command === "inspect") {
    if (!args.policy) throw new Error("inspect requires --policy <id>");
    const policy = getPolicyById(policies, args.policy);
    if (!policy) throw new Error(`Unknown policy: ${args.policy}`);
    console.log(formatJson(policy));
    return;
  }

  if (command === "select") {
    if (!args.input) throw new Error("select requires --input");
    const selection = selectPolicies(policies, { input: args.input, context: args.context });
    console.log(formatSelection(selection));
    return;
  }

  if (command === "compile") {
    if (!args.input) throw new Error("compile requires --input");
    const selection = selectPolicies(policies, { input: args.input, context: args.context });
    const compiledPrompt = emitRuntimePrompt(selection, args.input, args.context);
    const fullPrompt = readFileSync("prompts/synthetic-enterprise-agent.md", "utf8");
    const fullCount = countTokens(fullPrompt, args.model);
    const compiledCount = countTokens(compiledPrompt, args.model);
    const fullTokens = fullCount.tokens;
    const compiledTokens = compiledCount.tokens;
    console.log("Selected policies:");
    for (const policy of selection.policies) {
      console.log(`- ${formatPolicySummary(policy).split("\n")[0]}`);
    }
    console.log("");
    console.log("Compiled runtime prompt:");
    console.log(compiledPrompt);
    console.log("");
    console.log(`estimated full prompt tokens: ${fullTokens}`);
    console.log(`estimated compiled tokens: ${compiledTokens}`);
    console.log(`token reduction: ${(tokenReduction(fullTokens, compiledTokens) * 100).toFixed(1)}%`);
    console.log(`token counting: ${compiledCount.method} (${compiledCount.tokenizer})`);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { command: argv[0] };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--input") {
      args.input = next;
      index += 1;
    } else if (arg === "--context") {
      args.context = JSON.parse(next) as ArtifactContext;
      index += 1;
    } else if (arg === "--policy") {
      args.policy = next;
      index += 1;
    } else if (arg === "--strategy") {
      args.strategy = parseStrategy(next);
      index += 1;
    } else if (arg === "--limit") {
      args.limit = Number.parseInt(next, 10);
      if (!Number.isFinite(args.limit)) throw new Error("--limit must be a number");
      index += 1;
    } else if (arg === "--output") {
      args.output = next;
      index += 1;
    } else if (arg === "--model") {
      args.model = next;
      index += 1;
    }
  }
  return args;
}

function parseStrategy(value: string): PromptStrategy {
  const strategies: PromptStrategy[] = ["full_prompt", "compiled_prompt", "naive_summary", "minimal_prompt"];
  if (!strategies.includes(value as PromptStrategy)) {
    throw new Error(`Unknown strategy: ${value}`);
  }
  return value as PromptStrategy;
}

function printHelp(): void {
  console.log(`policyc

Commands:
  policyc select --input "what's the latest OpenAI news?"
  policyc compile --input "rewrite this email professionally: yo send it"
  policyc inspect --policy current_info_requires_web
  policyc eval
  policyc compare-models --limit 20
  policyc eval-model --strategy compiled_prompt --limit 20
  policyc compile-candidates --input "what's the latest news?" --output experiment

Options:
  --input <text>
  --context <json>
  --policy <id>
  --strategy <full_prompt|compiled_prompt|naive_summary|minimal_prompt>
  --limit <n>`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`policyc error: ${message}`);
  process.exitCode = 1;
});
