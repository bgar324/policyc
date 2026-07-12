import type { ArtifactContext, PolicySeverity } from "../policy/types.js";
import type { Trace } from "../traces/types.js";

export type EvalSeverity = "low" | "medium" | "high" | "critical";
export type FailureType =
  | "missing_policy"
  | "missing_dependency"
  | "artifact_trigger_miss"
  | "validator_failure"
  | "over_inclusion"
  | "bad_eval_label"
  | "unknown";

export type OverInclusionCategory =
  | "acceptable_conservative_over_inclusion"
  | "overly_broad_keyword_trigger"
  | "overly_broad_intent_trigger"
  | "dependency_closure_too_broad"
  | "universal_core_too_large"
  | "eval_label_too_narrow";

export type ExpectedDependency = {
  policyId: string;
  requires: string;
};

export type FailedValidator = {
  id: string;
  message: string;
  critical: boolean;
};

export type EvalCase = {
  id: string;
  promptPack: string;
  input: string;
  context?: ArtifactContext | null;
  expectedActivePolicies: string[];
  expectedDependencies?: ExpectedDependency[];
  expectedObligations: string[];
  forbiddenBehaviors: string[];
  severity: EvalSeverity;
  mockTrace?: Partial<Trace>;
};

export type EvalCaseResult = {
  caseId: string;
  input: string;
  context?: ArtifactContext | null;
  severity: EvalSeverity;
  selectedPolicyIds: string[];
  expectedPolicyIds: string[];
  expectedObligations: string[];
  missingPolicies: string[];
  extraPolicies: string[];
  missingDependencies: ExpectedDependency[];
  policyPrecision: number;
  policyRecall: number;
  dependencyClosureComplete: boolean;
  compiledTokens: number;
  fullPromptTokens: number;
  minimalPromptTokens: number;
  naiveSummaryTokens?: number;
  validatorPasses: number;
  validatorFailures: number;
  failedValidators: FailedValidator[];
  criticalValidatorFailures: number;
  criticalValidatorPasses: number;
  forbiddenBehaviorFailures: number;
  failureTypes: FailureType[];
  overInclusionCategory?: OverInclusionCategory;
};

export type PromptStrategyTokenAverages = {
  fullPrompt: number;
  compiledPrompt: number;
  minimalPrompt: number;
  naiveSummary?: number;
};

export type FailureTypeCount = {
  type: FailureType;
  count: number;
};

export type OverInclusionCategoryCount = {
  category: OverInclusionCategory;
  count: number;
};

export type ValidatorSanityResult = {
  name: string;
  validatorId: string;
  passed: boolean;
  message: string;
};

export type MetricsReport = {
  cases: number;
  policyPrecision: number;
  policyRecall: number;
  criticalPolicyRecall: number;
  dependencyClosureCompleteness: number;
  averageFullPromptTokens: number;
  averageCompiledPromptTokens: number;
  averageMinimalPromptTokens: number;
  averageNaiveSummaryTokens?: number;
  promptStrategyAverages: PromptStrategyTokenAverages;
  averageTokenReductionPercentage: number;
  tokenCountingMethod: "exact:o200k_base";
  obligationPassRate: number;
  criticalObligationPassRate: number;
  forbiddenBehaviorRate: number;
  severityWeightedFailureScore: number;
  failureTypeCounts: FailureTypeCount[];
  overInclusionCategoryCounts: OverInclusionCategoryCount[];
  validatorSanityResults: ValidatorSanityResult[];
  topFailures: EvalCaseResult[];
};

export const severityWeight: Record<EvalSeverity, number> = {
  low: 1,
  medium: 2,
  high: 4,
  critical: 8
};

export const policySeverityWeight: Record<PolicySeverity, number> = {
  style: 1,
  format: 2,
  tool: 4,
  privacy: 6,
  safety: 8
};
