import { encode } from "gpt-tokenizer";

export type TokenCount = {
  tokens: number;
  method: "exact" | "estimated";
  tokenizer: string;
  model?: string;
};

const O200K_MODELS = /^(gpt-4o|gpt-4\.1|gpt-5|o[134])(?:-|$)/i;

export function countTokens(text: string, model?: string): TokenCount {
  if (!model || O200K_MODELS.test(model)) {
    return { tokens: encode(text).length, method: "exact", tokenizer: "o200k_base", model };
  }
  return { tokens: countApproxTokens(text), method: "estimated", tokenizer: "words_divided_by_0.75", model };
}

export function countApproxTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words / 0.75);
}

export function tokenReduction(fullPromptTokens: number, compiledPromptTokens: number): number {
  if (fullPromptTokens <= 0) return 0;
  return Math.max(0, (fullPromptTokens - compiledPromptTokens) / fullPromptTokens);
}
