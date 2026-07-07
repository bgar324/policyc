import type { ArtifactContext } from "../policy/types.js";
import type { ValidatorResult } from "../validators/rules.js";
import type { FailureType } from "../eval/types.js";

export type PromptStrategy = "full_prompt" | "compiled_prompt" | "naive_summary" | "minimal_prompt";

export type RunModelInput = {
  strategy: PromptStrategy;
  systemPrompt: string;
  input: string;
  context?: ArtifactContext | null;
};

export type ModelRunResult = {
  output: string;
  toolsCalled: string[];
  raw?: unknown;
};

export interface ModelRunner {
  runModel(input: RunModelInput): Promise<ModelRunResult>;
}

export type ModelTrace = {
  caseId: string;
  input: string;
  context?: ArtifactContext | null;
  strategy: PromptStrategy;
  selectedPolicies: string[];
  compiledPromptTokens: number;
  fullPromptTokens: number;
  systemPromptUsed: string;
  output: string;
  toolsCalled: string[];
  validatorResults: ValidatorResult[];
  failureCategories: FailureType[];
};

export type StrategyComparisonMetrics = {
  strategy: PromptStrategy;
  cases: number;
  averagePromptTokens: number;
  validatorPassRate: number;
  criticalValidatorPassRate: number;
  forbiddenBehaviorRate: number;
  latentDutyMissRate: number;
  severityWeightedFailureScore: number;
};

export type ModelComparisonReport = {
  runDir: string;
  cases: number;
  strategies: StrategyComparisonMetrics[];
};
