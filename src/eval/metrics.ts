import type { EvalCaseResult, FailureType, MetricsReport, ValidatorSanityResult } from "./types.js";
import { severityWeight } from "./types.js";

export function computeMetrics(results: EvalCaseResult[], validatorSanityResults: ValidatorSanityResult[] = []): MetricsReport {
  const cases = results.length;
  const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
  const totalValidators = results.reduce((sum, result) => sum + result.validatorPasses + result.validatorFailures, 0);
  const passedValidators = results.reduce((sum, result) => sum + result.validatorPasses, 0);
  const criticalValidatorTotal = results.reduce((sum, result) => sum + result.criticalValidatorFailures + result.criticalValidatorPasses, 0);
  const criticalValidatorPasses = results.reduce((sum, result) => sum + result.criticalValidatorPasses, 0);
  const forbiddenFailures = results.reduce((sum, result) => sum + result.forbiddenBehaviorFailures, 0);
  const weightedFailure = results.reduce((sum, result) => {
    const misses = result.missingPolicies.length + result.validatorFailures;
    return sum + misses * severityWeight[result.severity];
  }, 0);

  const criticalCases = results.filter((result) => result.severity === "critical");

  return {
    cases,
    policyPrecision: average(results.map((result) => result.policyPrecision)),
    policyRecall: average(results.map((result) => result.policyRecall)),
    criticalPolicyRecall: average(criticalCases.map((result) => result.policyRecall)),
    dependencyClosureCompleteness: average(results.map((result) => (result.dependencyClosureComplete ? 1 : 0))),
    averageFullPromptTokens: average(results.map((result) => result.fullPromptTokens)),
    averageCompiledPromptTokens: average(results.map((result) => result.compiledTokens)),
    averageMinimalPromptTokens: average(results.map((result) => result.minimalPromptTokens)),
    averageNaiveSummaryTokens: undefined,
    promptStrategyAverages: {
      fullPrompt: average(results.map((result) => result.fullPromptTokens)),
      compiledPrompt: average(results.map((result) => result.compiledTokens)),
      minimalPrompt: average(results.map((result) => result.minimalPromptTokens)),
      naiveSummary: undefined
    },
    averageTokenReductionPercentage: average(results.map((result) => 1 - result.compiledTokens / Math.max(1, result.fullPromptTokens))),
    tokenCountingMethod: "exact:o200k_base",
    obligationPassRate: totalValidators ? passedValidators / totalValidators : 1,
    criticalObligationPassRate: criticalValidatorTotal ? criticalValidatorPasses / criticalValidatorTotal : 1,
    forbiddenBehaviorRate: cases ? forbiddenFailures / cases : 0,
    severityWeightedFailureScore: weightedFailure,
    failureTypeCounts: countFailureTypes(results),
    overInclusionCategoryCounts: countOverInclusionCategories(results),
    validatorSanityResults,
    topFailures: results
      .filter((result) => result.failureTypes.length || result.missingPolicies.length || result.extraPolicies.length || result.validatorFailures)
      .sort(
        (left, right) =>
          right.missingPolicies.length +
          right.extraPolicies.length +
          right.validatorFailures +
          right.missingDependencies.length -
          (left.missingPolicies.length + left.extraPolicies.length + left.validatorFailures + left.missingDependencies.length)
      )
      .slice(0, 10)
  };
}

function countOverInclusionCategories(results: EvalCaseResult[]): Array<{ category: NonNullable<EvalCaseResult["overInclusionCategory"]>; count: number }> {
  const counts = new Map<NonNullable<EvalCaseResult["overInclusionCategory"]>, number>();
  for (const result of results) {
    if (!result.overInclusionCategory) continue;
    counts.set(result.overInclusionCategory, (counts.get(result.overInclusionCategory) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => right.count - left.count || left.category.localeCompare(right.category));
}

function countFailureTypes(results: EvalCaseResult[]): Array<{ type: FailureType; count: number }> {
  const counts = new Map<FailureType, number>();
  for (const result of results) {
    for (const failureType of result.failureTypes) {
      counts.set(failureType, (counts.get(failureType) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type));
}
