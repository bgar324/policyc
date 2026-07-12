#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { emitRuntimePrompt } from "./compiler/emitter.js";
import { countTokens, tokenReduction } from "./compiler/tokenCounter.js";
import { runEval } from "./eval/runner.js";
import { compareModels } from "./model/compare.js";
import type { PromptStrategy } from "./model/types.js";
import { getPolicyById, loadPolicies } from "./policy/loader.js";
import type { ArtifactContext } from "./policy/types.js";
import { selectPolicies } from "./policy/selector.js";
import { formatJson, formatMetrics, formatModelComparison, formatPolicySummary, formatSelection } from "./util/format.js";
import { runExperimentCommand } from "./experiment/plan.js";
import { loadBehavioralCases } from "./experiment/cases.js";

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

  if (command === "experiment") {
    runExperimentCommand(process.argv.slice(3));
    return;
  }

  if (command === "runs") {
    const runtime = resolve(".venv/bin/policyc-runtime");
    const result = spawnSync(runtime, ["runs", ...process.argv.slice(3)], { stdio: "inherit", env: process.env });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`runs command exited with status ${result.status}`);
    return;
  }

  if (command === "cases") {
    const action = process.argv[3];
    const caseFlag = process.argv.indexOf("--cases");
    const path = caseFlag >= 0 ? process.argv[caseFlag + 1] : undefined;
    if (!path || !["validate", "freeze"].includes(action)) throw new Error("usage: policyc cases <validate|freeze> --cases <jsonl>");
    const loaded = loadBehavioralCases(path);
    console.log(JSON.stringify({ action, path, caseCount: loaded.cases.length, datasetVersion: loaded.datasetVersion, split: loaded.split, datasetHash: loaded.datasetHash }, null, 2));
    return;
  }

  if (command === "compare-models" || command === "eval-model") {
    const strategies = args.strategy ? [args.strategy] : undefined;
    console.log(formatModelComparison(await compareModels({ limit: args.limit, strategies })));
    return;
  }

  const policies = loadPolicies();

  if (command === "compile-candidates") {
    throw new Error("compile-candidates is deprecated; use policyc experiment with explicit strategies, samples, provider, model, and budgets");
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
  policyc compile-candidates  # deprecated; use experiment
  policyc experiment --cases eval/behavioral/smoke-v1.jsonl --strategies full_policy,compiler_slice --provider openai --model gpt-5-mini-2025-08-07 --samples 1 --concurrency 1 --max-output-tokens 256 --max-calls 2 --max-cost-usd 0.02 --retries 0 --run-label smoke-1 --output runs/openai-smoke --dry-run
  policyc cases validate --cases eval/behavioral/smoke-v1.jsonl
  policyc cases freeze --cases eval/behavioral/held-out-pilot-v1.jsonl
  policyc runs list
  policyc runs show <run-id>
  policyc runs rebuild --root runs

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
