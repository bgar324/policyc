import type { Policy, PolicySelection } from "../policy/types.js";
import type { MetricsReport } from "../eval/types.js";
import { describeContext } from "../eval/baselines.js";
import type { ModelComparisonReport } from "../model/types.js";

export function formatPolicySummary(policy: Policy): string {
  const validators = policy.validators.length ? policy.validators.join(", ") : "none";
  return [
    `${policy.id} (${policy.kind}, ${policy.severity}, priority ${policy.priority})`,
    `  ${policy.title}`,
    `  validators: ${validators}`
  ].join("\n");
}

export function formatSelection(selection: PolicySelection): string {
  const reasonMap = new Map(selection.reasons.map((reason) => [reason.policyId, reason]));
  const lines = [
    `Detected intents: ${selection.detectedIntents.length ? selection.detectedIntents.join(", ") : "none"}`,
    "",
    "Selected policies:"
  ];

  for (const policy of selection.policies) {
    const reason = reasonMap.get(policy.id);
    lines.push(`- ${policy.id}: ${policy.title}`);
    lines.push(`  why: ${reason?.reasons.join("; ") ?? "selected"}`);
    if (reason?.dependencyOf?.length) {
      lines.push(`  dependency of: ${reason.dependencyOf.join(", ")}`);
    }
    lines.push(`  validators: ${policy.validators.length ? policy.validators.join(", ") : "none"}`);
  }

  const edges = selection.dependencyEdges.map((edge) => `${edge.from} -> ${edge.requires}`);
  lines.push("");
  lines.push(`Dependencies pulled in: ${edges.length ? edges.join(", ") : "none"}`);
  return lines.join("\n");
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function formatMetrics(report: MetricsReport): string {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const lines = [
    "policyc eval report",
    "",
    `cases: ${report.cases}`,
    `policy precision: ${pct(report.policyPrecision)}`,
    `policy recall: ${pct(report.policyRecall)}`,
    `critical policy recall: ${pct(report.criticalPolicyRecall)}`,
    `dependency closure completeness: ${pct(report.dependencyClosureCompleteness)}`,
    `average full prompt tokens: ${report.averageFullPromptTokens.toFixed(0)}`,
    `average compiled prompt tokens: ${report.averageCompiledPromptTokens.toFixed(0)}`,
    `average token reduction: ${pct(report.averageTokenReductionPercentage)}`,
    `token counting: ${report.tokenCountingMethod}`,
    `obligation pass rate: ${pct(report.obligationPassRate)}`,
    `critical obligation pass rate: ${pct(report.criticalObligationPassRate)}`,
    `forbidden behavior rate: ${pct(report.forbiddenBehaviorRate)}`,
    `severity-weighted failure score: ${report.severityWeightedFailureScore.toFixed(1)}`
  ];

  lines.push("");
  lines.push("prompt strategy token averages:");
  lines.push("Strategy          Avg tokens");
  lines.push(`Full prompt       ${report.promptStrategyAverages.fullPrompt.toFixed(0)}`);
  lines.push(`Compiled prompt   ${report.promptStrategyAverages.compiledPrompt.toFixed(0)}`);
  lines.push(`Minimal prompt    ${report.promptStrategyAverages.minimalPrompt.toFixed(0)}`);
  lines.push(
    report.promptStrategyAverages.naiveSummary === undefined
      ? "Naive summary     future work"
      : `Naive summary     ${report.promptStrategyAverages.naiveSummary.toFixed(0)}`
  );

  lines.push("");
  lines.push("validator sanity:");
  const sanityFailures = report.validatorSanityResults.filter((result) => !result.passed);
  lines.push(`${report.validatorSanityResults.length - sanityFailures.length}/${report.validatorSanityResults.length} passed`);
  for (const failure of sanityFailures) {
    lines.push(`- ${failure.name} (${failure.validatorId}): ${failure.message}`);
  }

  lines.push("");
  lines.push("failure categories:");
  if (report.failureTypeCounts.length) {
    for (const item of report.failureTypeCounts) {
      lines.push(`- ${item.type}: ${item.count}`);
    }
  } else {
    lines.push("- none");
  }

  lines.push("");
  lines.push("over-inclusion breakdown:");
  if (report.overInclusionCategoryCounts.length) {
    for (const item of report.overInclusionCategoryCounts) {
      lines.push(`- ${item.category}: ${item.count}`);
    }
  } else {
    lines.push("- none");
  }

  if (report.topFailures.length) {
    lines.push("");
    lines.push("top failures:");
    for (const failure of report.topFailures) {
      lines.push(`- ${failure.caseId} (${failure.severity})`);
      lines.push(`  input: ${failure.input}`);
      lines.push(`  context: ${describeContext(failure.context)}`);
      lines.push(`  expected policies: ${failure.expectedPolicyIds.join(", ") || "none"}`);
      lines.push(`  actual policies: ${failure.selectedPolicyIds.join(", ") || "none"}`);
      lines.push(`  missing policies: ${failure.missingPolicies.join(", ") || "none"}`);
      lines.push(`  extra policies: ${failure.extraPolicies.join(", ") || "none"}`);
      lines.push(
        `  missing dependencies: ${
          failure.missingDependencies.length
            ? failure.missingDependencies.map((dependency) => `${dependency.policyId}->${dependency.requires}`).join(", ")
            : "none"
        }`
      );
      lines.push(`  expected obligations: ${failure.expectedObligations.join(", ") || "none"}`);
      lines.push(
        `  failed validators: ${
          failure.failedValidators.length
            ? failure.failedValidators.map((validator) => `${validator.id}: ${validator.message}`).join("; ")
            : "none"
        }`
      );
      lines.push(`  likely failure type: ${failure.failureTypes.join(", ") || "unknown"}`);
      if (failure.overInclusionCategory) {
        lines.push(`  over-inclusion category: ${failure.overInclusionCategory}`);
      }
    }
  }

  return lines.join("\n");
}

export function formatModelComparison(report: ModelComparisonReport): string {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const lines = [
    "policyc model comparison report",
    "",
    `run directory: ${report.runDir}`,
    `cases: ${report.cases}`,
    "",
    "Strategy          Avg tokens  Validator pass  Critical pass  Forbidden rate  Latent miss  Weighted failures"
  ];
  for (const strategy of report.strategies) {
    lines.push(
      `${strategy.strategy.padEnd(17)} ${strategy.averagePromptTokens
        .toFixed(0)
        .padStart(10)}  ${pct(strategy.validatorPassRate).padStart(14)}  ${pct(strategy.criticalValidatorPassRate).padStart(13)}  ${pct(
        strategy.forbiddenBehaviorRate
      ).padStart(14)}  ${pct(strategy.latentDutyMissRate).padStart(11)}  ${strategy.severityWeightedFailureScore.toFixed(1).padStart(17)}`
    );
  }
  return lines.join("\n");
}
