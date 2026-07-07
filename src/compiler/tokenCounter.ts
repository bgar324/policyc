export function countApproxTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words / 0.75);
}

export function tokenReduction(fullPromptTokens: number, compiledPromptTokens: number): number {
  if (fullPromptTokens <= 0) return 0;
  return Math.max(0, (fullPromptTokens - compiledPromptTokens) / fullPromptTokens);
}
