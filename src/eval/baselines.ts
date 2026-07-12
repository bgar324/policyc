import { countTokens } from "../compiler/tokenCounter.js";
import type { ArtifactContext } from "../policy/types.js";

export type PromptStrategy = "full_prompt" | "compiled_prompt" | "minimal_prompt" | "naive_summary";

export type BaselineTokenCounts = {
  fullPromptTokens: number;
  compiledPromptTokens: number;
  minimalPromptTokens: number;
  naiveSummaryTokens?: number;
  tokenCountingMethod: string;
};

const MINIMAL_PROMPT = "You are a helpful assistant.";

export function countBaselineTokens(fullPrompt: string, compiledPrompt: string): BaselineTokenCounts {
  return {
    fullPromptTokens: countTokens(fullPrompt).tokens,
    compiledPromptTokens: countTokens(compiledPrompt).tokens,
    minimalPromptTokens: countTokens(MINIMAL_PROMPT).tokens,
    naiveSummaryTokens: undefined,
    tokenCountingMethod: "exact:o200k_base"
  };
}

export function describeContext(context?: ArtifactContext | null): string {
  if (!context) return "none";
  const parts = [
    context.artifactType ? `artifactType=${context.artifactType}` : undefined,
    context.operation ? `operation=${context.operation}` : undefined,
    context.features?.length ? `features=${context.features.join(",")}` : undefined,
    context.domainHints?.length ? `domains=${context.domainHints.join(",")}` : undefined,
    context.riskHints?.length ? `risks=${context.riskHints.join(",")}` : undefined,
    context.toolsRequested?.length ? `tools=${context.toolsRequested.join(",")}` : undefined
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : "empty";
}
