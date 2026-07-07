import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { emitRuntimePrompt } from "../compiler/emitter.js";
import { loadPolicies } from "../policy/loader.js";
import type { Policy } from "../policy/types.js";
import { obligationToString } from "../policy/triggers.js";
import { selectPolicies } from "../policy/selector.js";
import type { Trace } from "../traces/types.js";
import { runValidators } from "../validators/index.js";
import { runValidatorSanityTests } from "../validators/sanity.js";
import { countBaselineTokens } from "./baselines.js";
import { computeMetrics } from "./metrics.js";
import type { EvalCase, EvalCaseResult, ExpectedDependency, FailureType, MetricsReport, OverInclusionCategory } from "./types.js";

export function loadEvalCases(evalDir = "evals"): EvalCase[] {
  const files = readdirSync(evalDir)
    .filter((file) => file.endsWith(".jsonl"))
    .sort();
  return files.flatMap((file) =>
    readFileSync(join(evalDir, file), "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as EvalCase)
  );
}

export function runEval(): MetricsReport {
  const policies = loadPolicies();
  const cases = loadEvalCases();
  const fullPrompt = readFileSync("prompts/synthetic-enterprise-agent.md", "utf8");
  const results = cases.map((testCase) => runEvalCase(testCase, policies, fullPrompt));
  return computeMetrics(results, runValidatorSanityTests());
}

function runEvalCase(testCase: EvalCase, policies: Policy[], fullPrompt: string): EvalCaseResult {
  const selection = selectPolicies(policies, { input: testCase.input, context: testCase.context });
  const compiledPrompt = emitRuntimePrompt(selection, testCase.input, testCase.context);
  const tokenCounts = countBaselineTokens(fullPrompt, compiledPrompt);
  const selectedPolicyIds = selection.policies.map((policy) => policy.id);
  const selectedPolicyIdsForPrecision = selection.policies
    .filter((policy) => policy.kind === "content_gated" || testCase.expectedActivePolicies.includes(policy.id))
    .map((policy) => policy.id);
  const expectedPolicySet = new Set(testCase.expectedActivePolicies);
  const selectedPolicySet = new Set(selectedPolicyIds);
  const missingPolicies = testCase.expectedActivePolicies.filter((id) => !selectedPolicySet.has(id));
  const extraPolicies = selectedPolicyIdsForPrecision.filter((id) => !expectedPolicySet.has(id));
  const intersection = testCase.expectedActivePolicies.filter((id) => selectedPolicySet.has(id)).length;
  const precision = selectedPolicyIdsForPrecision.length ? intersection / selectedPolicyIdsForPrecision.length : 1;
  const recall = testCase.expectedActivePolicies.length ? intersection / testCase.expectedActivePolicies.length : 1;
  const dependencyClosureComplete = selection.policies.every((policy) => policy.requires.every((requiredId) => selectedPolicySet.has(requiredId)));
  const missingDependencies = findMissingExpectedDependencies(testCase.expectedDependencies ?? [], selectedPolicySet);
  const trace = createMockTrace(testCase, selection.policies, selectedPolicyIds, compiledPrompt);
  const validatorResults = runValidators(trace, selection.policies);
  const validatorFailures = validatorResults.filter((result) => !result.passed);
  const failedValidators = validatorFailures.map((result) => ({
    id: result.id,
    message: result.message,
    critical: result.critical
  }));
  const forbiddenBehaviorFailures = validatorFailures.filter((result) =>
    testCase.forbiddenBehaviors.some((behavior) => result.id.includes(behavior) || result.message.includes(behavior))
  ).length;
  const failureTypes = classifyFailures(testCase, missingPolicies, extraPolicies, missingDependencies, dependencyClosureComplete, validatorFailures.length);
  const overInclusionCategory = extraPolicies.length ? categorizeOverInclusion(testCase, extraPolicies) : undefined;

  return {
    caseId: testCase.id,
    input: testCase.input,
    context: testCase.context,
    severity: testCase.severity,
    selectedPolicyIds,
    expectedPolicyIds: testCase.expectedActivePolicies,
    expectedObligations: testCase.expectedObligations,
    missingPolicies,
    extraPolicies,
    missingDependencies,
    policyPrecision: precision,
    policyRecall: recall,
    dependencyClosureComplete,
    compiledTokens: tokenCounts.compiledPromptTokens,
    fullPromptTokens: tokenCounts.fullPromptTokens,
    minimalPromptTokens: tokenCounts.minimalPromptTokens,
    naiveSummaryTokens: tokenCounts.naiveSummaryTokens,
    validatorPasses: validatorResults.length - validatorFailures.length,
    validatorFailures: validatorFailures.length,
    failedValidators,
    criticalValidatorFailures: validatorFailures.filter((result) => result.critical).length,
    forbiddenBehaviorFailures,
    failureTypes,
    overInclusionCategory
  };
}

function categorizeOverInclusion(testCase: EvalCase, extraPolicies: string[]): OverInclusionCategory {
  if (extraPolicies.some((policyId) => policyId.includes("definition") || policyId.includes("output_format"))) {
    return "dependency_closure_too_broad";
  }
  if (extraPolicies.some((policyId) => ["current_info_requires_web", "citations_required", "authoritative_sources_preferred"].includes(policyId))) {
    return /citation|source|checked the source|fake a citation/i.test(testCase.input)
      ? "overly_broad_keyword_trigger"
      : "acceptable_conservative_over_inclusion";
  }
  if (extraPolicies.some((policyId) => policyId.includes("writing") || policyId.includes("preserve_user_meaning") || policyId.includes("draft"))) {
    return "overly_broad_intent_trigger";
  }
  if (testCase.context?.artifactType && extraPolicies.some((policyId) => /(chart|table|pdf|image|spreadsheet|formula)/i.test(policyId))) {
    return "acceptable_conservative_over_inclusion";
  }
  if (extraPolicies.some((policyId) => policyId.startsWith("no_") || policyId.includes("privacy") || policyId.includes("sensitive"))) {
    return "acceptable_conservative_over_inclusion";
  }
  return "eval_label_too_narrow";
}

function findMissingExpectedDependencies(expectedDependencies: ExpectedDependency[], selectedPolicySet: Set<string>): ExpectedDependency[] {
  return expectedDependencies.filter((dependency) => !selectedPolicySet.has(dependency.policyId) || !selectedPolicySet.has(dependency.requires));
}

function classifyFailures(
  testCase: EvalCase,
  missingPolicies: string[],
  extraPolicies: string[],
  missingDependencies: ExpectedDependency[],
  dependencyClosureComplete: boolean,
  validatorFailureCount: number
): FailureType[] {
  const failures = new Set<FailureType>();
  if (missingPolicies.length) failures.add("missing_policy");
  if (missingDependencies.length || !dependencyClosureComplete) failures.add("missing_dependency");
  if (validatorFailureCount > 0) failures.add("validator_failure");
  if (extraPolicies.length) failures.add("over_inclusion");
  if (testCase.expectedActivePolicies.length === 0 && testCase.expectedObligations.length > 0) failures.add("bad_eval_label");

  const hasArtifactContext = Boolean(
    testCase.context?.artifactType ||
      testCase.context?.features?.length ||
      testCase.context?.operation ||
      testCase.context?.domainHints?.length ||
      testCase.context?.riskHints?.length
  );
  const artifactPolicyMiss = missingPolicies.some((policyId) =>
    /(pdf|spreadsheet|artifact|chart|table|image|formula|numeric|page|section)/i.test(policyId)
  );
  if (hasArtifactContext && artifactPolicyMiss) failures.add("artifact_trigger_miss");

  if (
    failures.size === 0 &&
    (missingPolicies.length || extraPolicies.length || missingDependencies.length || validatorFailureCount > 0 || !dependencyClosureComplete)
  ) {
    failures.add("unknown");
  }
  return Array.from(failures);
}

function createMockTrace(testCase: EvalCase, policies: Policy[], selectedPolicyIds: string[], compiledPrompt: string): Trace {
  const obligations = new Set(policies.flatMap((policy) => policy.obligations.map(obligationToString)));
  const toolsCalled: string[] = [];
  if (obligations.has("call_tool:web")) toolsCalled.push("web");
  if (obligations.has("call_tool:image")) toolsCalled.push("image");

  const outputParts = ["I inspected the relevant request and context."];
  if (obligations.has("include_citations")) outputParts.push("The answer cites an authoritative source. [1]");
  if (obligations.has("ask_confirmation")) outputParts.push("Please confirm before I take that destructive action.");
  if (obligations.has("use_output_format:writing")) outputParts.push("Draft: A polished version preserving the original meaning.");
  if (obligations.has("refuse")) outputParts.push("I cannot assist with bypassing those safeguards.");
  if (obligations.has("cite_page_or_section")) outputParts.push("Specific claims are tied to page 2.");
  if (obligations.has("preserve_formulas")) outputParts.push("I preserved formulas and the data structure.");
  if (obligations.has("state_uncertainty")) outputParts.push("I will state uncertainty for approximate values.");

  return {
    input: testCase.input,
    context: testCase.context,
    selectedPolicyIds,
    compiledPrompt,
    toolsCalled,
    output: outputParts.join(" "),
    ...testCase.mockTrace
  };
}
