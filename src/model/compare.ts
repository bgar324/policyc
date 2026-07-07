import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emitRuntimePrompt } from "../compiler/emitter.js";
import { countApproxTokens } from "../compiler/tokenCounter.js";
import { severityWeight, type EvalCase, type FailureType } from "../eval/types.js";
import { loadEvalCases } from "../eval/runner.js";
import { loadPolicies } from "../policy/loader.js";
import { obligationToString } from "../policy/triggers.js";
import { selectPolicies } from "../policy/selector.js";
import { runValidators } from "../validators/index.js";
import type { Trace } from "../traces/types.js";
import { buildSystemPrompt } from "./promptStrategies.js";
import { MockModelRunner } from "./mockRunner.js";
import type { ModelComparisonReport, ModelRunner, ModelTrace, PromptStrategy, StrategyComparisonMetrics } from "./types.js";

const DEFAULT_STRATEGIES: PromptStrategy[] = ["full_prompt", "compiled_prompt", "naive_summary", "minimal_prompt"];

export async function compareModels(options: {
  limit?: number;
  strategies?: PromptStrategy[];
  evalFile?: string;
  runner?: ModelRunner;
}): Promise<ModelComparisonReport> {
  const runner = options.runner ?? new MockModelRunner();
  const policies = loadPolicies();
  const cases = loadModelEvalCases(options.evalFile ?? "evals/model-smoke.jsonl", options.limit);
  const fullPrompt = readText("prompts/synthetic-enterprise-agent.md");
  const strategies = options.strategies ?? DEFAULT_STRATEGIES;
  const runDir = createRunDir();
  const traces: ModelTrace[] = [];
  const metrics: StrategyComparisonMetrics[] = [];

  for (const strategy of strategies) {
    const strategyTraces: ModelTrace[] = [];
    for (const testCase of cases) {
      const selection = selectPolicies(policies, { input: testCase.input, context: testCase.context });
      const selectedPolicies = selection.policies;
      const compiledPrompt = emitRuntimePrompt(selection, testCase.input, testCase.context);
      const systemPrompt = buildSystemPrompt({ strategy, selection, input: testCase.input, context: testCase.context, fullPrompt });
      const modelResult = await runner.runModel({ strategy, systemPrompt, input: testCase.input, context: testCase.context });
      const traceForValidation: Trace = {
        input: testCase.input,
        context: testCase.context,
        selectedPolicyIds: selectedPolicies.map((policy) => policy.id),
        compiledPrompt,
        toolsCalled: modelResult.toolsCalled,
        output: modelResult.output
      };
      const validatorResults = runValidators(traceForValidation, selectedPolicies);
      const failureCategories = classifyModelFailures(testCase, validatorResults, selectedPolicies.flatMap((policy) => policy.obligations.map(obligationToString)));
      const trace: ModelTrace = {
        caseId: testCase.id,
        input: testCase.input,
        context: testCase.context,
        strategy,
        selectedPolicies: selectedPolicies.map((policy) => policy.id),
        compiledPromptTokens: countApproxTokens(compiledPrompt),
        fullPromptTokens: countApproxTokens(fullPrompt),
        systemPromptUsed: systemPrompt,
        output: modelResult.output,
        toolsCalled: modelResult.toolsCalled,
        validatorResults,
        failureCategories
      };
      traces.push(trace);
      strategyTraces.push(trace);
    }
    metrics.push(computeStrategyMetrics(strategy, cases, strategyTraces));
  }

  const report: ModelComparisonReport = {
    runDir,
    cases: cases.length,
    strategies: metrics
  };
  writeFileSync(join(runDir, "traces.jsonl"), `${traces.map((trace) => JSON.stringify(trace)).join("\n")}\n`);
  writeFileSync(join(runDir, "summary.json"), JSON.stringify(report, null, 2));
  return report;
}

function loadModelEvalCases(evalFile: string, limit?: number): EvalCase[] {
  const allCases = evalFile === "evals" ? loadEvalCases("evals") : readText(evalFile).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as EvalCase);
  return typeof limit === "number" ? allCases.slice(0, limit) : allCases;
}

function computeStrategyMetrics(strategy: PromptStrategy, cases: EvalCase[], traces: ModelTrace[]): StrategyComparisonMetrics {
  const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
  const validatorResults = traces.flatMap((trace) => trace.validatorResults);
  const criticalResults = validatorResults.filter((result) => result.critical);
  const validatorFailures = validatorResults.filter((result) => !result.passed);
  const criticalFailures = criticalResults.filter((result) => !result.passed);
  const forbiddenFailures = traces.filter((trace, index) =>
    cases[index].forbiddenBehaviors.some((behavior) =>
      trace.validatorResults.some((result) => !result.passed && (result.id.includes(behavior) || result.message.includes(behavior)))
    )
  ).length;
  const latentDutyMisses = traces.filter((trace) => trace.failureCategories.includes("artifact_trigger_miss")).length;
  const weightedFailure = traces.reduce((sum, trace, index) => {
    const misses = trace.validatorResults.filter((result) => !result.passed).length;
    return sum + misses * severityWeight[cases[index].severity];
  }, 0);

  return {
    strategy,
    cases: traces.length,
    averagePromptTokens: average(traces.map((trace) => countApproxTokens(trace.systemPromptUsed))),
    validatorPassRate: validatorResults.length ? (validatorResults.length - validatorFailures.length) / validatorResults.length : 1,
    criticalValidatorPassRate: criticalResults.length ? (criticalResults.length - criticalFailures.length) / criticalResults.length : 1,
    forbiddenBehaviorRate: traces.length ? forbiddenFailures / traces.length : 0,
    latentDutyMissRate: traces.length ? latentDutyMisses / traces.length : 0,
    severityWeightedFailureScore: weightedFailure
  };
}

function classifyModelFailures(testCase: EvalCase, validatorResults: Array<{ id: string; passed: boolean }>, obligations: string[]): FailureType[] {
  const failures = new Set<FailureType>();
  if (validatorResults.some((result) => !result.passed)) failures.add("validator_failure");
  const hasLatentContext = Boolean(testCase.context?.artifactType || testCase.context?.features?.length || testCase.context?.riskHints?.length);
  const latentValidatorMiss = validatorResults.some(
    (result) => !result.passed && /(inspect|precision|formula|page|section|citation|person|attribute)/i.test(result.id)
  );
  if (hasLatentContext && latentValidatorMiss) failures.add("artifact_trigger_miss");
  if (obligations.length === 0 && validatorResults.some((result) => !result.passed)) failures.add("unknown");
  return Array.from(failures);
}

function createRunDir(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join("runs", timestamp);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}
