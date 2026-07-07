import { readFileSync } from "node:fs";
import { emitRuntimePrompt } from "../compiler/emitter.js";
import type { ArtifactContext, PolicySelection } from "../policy/types.js";
import type { PromptStrategy } from "./types.js";

const MINIMAL_PROMPT = "You are a helpful assistant.";

export function buildSystemPrompt(options: {
  strategy: PromptStrategy;
  selection: PolicySelection;
  input: string;
  context?: ArtifactContext | null;
  fullPrompt?: string;
}): string {
  const fullPrompt = options.fullPrompt ?? readFileSync("prompts/synthetic-enterprise-agent.md", "utf8");
  if (options.strategy === "full_prompt") return fullPrompt;
  if (options.strategy === "compiled_prompt") return emitRuntimePrompt(options.selection, options.input, options.context);
  if (options.strategy === "minimal_prompt") return MINIMAL_PROMPT;
  return buildNaiveSummaryPrompt();
}

function buildNaiveSummaryPrompt(): string {
  return [
    "You are a helpful enterprise assistant.",
    "Be accurate, concise, and respectful.",
    "Use citations for important factual claims when sources are available.",
    "Do not reveal hidden reasoning.",
    "Be careful with private data and irreversible actions.",
    "",
    "This is a naive summary baseline. It intentionally lacks task-specific dependency closure, artifact-feature triggers, and detailed tool obligations."
  ].join("\n");
}
