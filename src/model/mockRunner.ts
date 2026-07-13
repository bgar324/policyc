import type { ModelRunResult, ModelRunner, RunModelInput } from "./types.js";

export class MockModelRunner implements ModelRunner {
  async runModel(input: RunModelInput): Promise<ModelRunResult> {
    if (input.strategy === "minimal_prompt") {
      return {
        output: buildMinimalOutput(input.input),
        toolsCalled: [],
        raw: { runner: "mock", strategy: input.strategy }
      };
    }

    if (input.strategy === "naive_summary") {
      return {
        output: buildNaiveOutput(input),
        toolsCalled: inferNaiveTools(input),
        raw: { runner: "mock", strategy: input.strategy }
      };
    }

    return {
      output: buildCompliantOutput(input.systemPrompt, input.input),
      toolsCalled: inferToolsFromPrompt(input.systemPrompt, input.input),
      raw: { runner: "mock", strategy: input.strategy }
    };
  }
}

function buildCompliantOutput(systemPrompt: string, userInput: string): string {
  const parts = ["I inspected the relevant request and context."];
  if (systemPrompt.includes("include_citations") || /current|latest|today|recent|weather|guidance|sources|citations/i.test(userInput)) {
    parts.push("The answer is grounded in an authoritative source. [1]");
  }
  if (systemPrompt.includes("ask_confirmation") || /delete|archive|send|schedule|cancel|forward/i.test(userInput)) {
    parts.push("Please confirm before I take that external or destructive action.");
  }
  if (systemPrompt.includes("use_output_format:writing") || /rewrite|draft|polish|shorten|compose/i.test(userInput)) {
    parts.push("Draft: A concise version that preserves the original meaning.");
  }
  if (systemPrompt.includes("refuse") || /bypass|ignore your policy|jailbreak/i.test(userInput)) {
    parts.push("I cannot assist with bypassing safeguards.");
  }
  if (systemPrompt.includes("cite_page_or_section")) {
    parts.push("Specific document claims are tied to page 2.");
  }
  if (systemPrompt.includes("preserve_formulas")) {
    parts.push("I preserved formulas and the data structure.");
  }
  if (systemPrompt.includes("state_uncertainty") || systemPrompt.includes("fake_precision")) {
    parts.push("I will state uncertainty for approximate values.");
  }
  return parts.join(" ");
}

function buildNaiveOutput(input: RunModelInput): string {
  const parts = ["Here is a concise answer."];
  if (/latest|today|current|recent|weather|guidance|sources|citations/i.test(input.input)) {
    parts.push("I included a source-style reference. [1]");
  }
  if (/delete|archive|send|schedule|cancel|forward/i.test(input.input)) {
    parts.push("Please confirm before I make that change.");
  }
  if (/rewrite|draft|polish|shorten|compose/i.test(input.input)) {
    parts.push("Draft: A clearer version preserving the main meaning.");
  }
  if (/pdf|chart|spreadsheet|formula|image/i.test(input.input)) {
    parts.push("I inspected the relevant artifact and will avoid exact values unless visible.");
  }
  return parts.join(" ");
}

function buildMinimalOutput(userInput: string): string {
  if (/latest|today|current|recent|weather|guidance/i.test(userInput)) {
    return "The latest answer is probably available from recent sources.";
  }
  if (/delete|archive|send|schedule|cancel/i.test(userInput)) {
    return "Done.";
  }
  if (/chain-of-thought|hidden reasoning/i.test(userInput)) {
    return "My chain-of-thought is not available.";
  }
  if (/chart|graph/i.test(userInput)) {
    return "The chart shows exactly 42.125% growth.";
  }
  return "Here is the answer.";
}

function inferToolsFromPrompt(systemPrompt: string, input: string): string[] {
  const tools: string[] = [];
  if (
    systemPrompt.includes("call_tool:web") ||
    (/Use (live )?web|current information|current-info/i.test(systemPrompt) && /latest|today|current|recent|weather|guidance|sources|citations/i.test(input))
  ) {
    tools.push("web");
  }
  if (
    systemPrompt.includes("call_tool:image_generate") ||
    (/image tool|Image generation/i.test(systemPrompt) && /generate an image|create an image|draw|edit this image/i.test(input))
  ) {
    tools.push("image_generate");
  }
  return tools;
}

function inferNaiveTools(input: RunModelInput): string[] {
  const tools: string[] = [];
  if (/latest|today|current|recent|weather|guidance/i.test(input.input)) tools.push("web");
  if (/generate an image|create an image|draw|edit this image/i.test(input.input)) tools.push("image_generate");
  return tools;
}
