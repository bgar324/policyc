import type { ArtifactContext, PolicySelection } from "../policy/types.js";
import { obligationToString, prohibitionToString } from "../policy/triggers.js";

export function emitRuntimePrompt(selection: PolicySelection, input: string, context?: ArtifactContext | null): string {
  const taskType = inferTaskType(selection, context);
  const availableTools = context && Object.prototype.hasOwnProperty.call(context, "toolsAvailable")
    ? new Set((context.toolsAvailable ?? []).map((tool) => tool.toLowerCase()))
    : undefined;
  const unavailableRequiredTools = new Set(
    selection.policies
      .flatMap((policy) => policy.obligations)
      .filter((obligation) => obligation.type === "call_tool" && obligation.value)
      .map((obligation) => obligation.value!.toLowerCase())
      .filter((tool) => availableTools !== undefined && !availableTools.has(tool)),
  );
  const activeRules = selection.policies
    .filter((policy) => policy.runtimeInstruction)
    .map((policy) => {
      const unavailable = policy.obligations
        .find((obligation) => obligation.type === "call_tool" && obligation.value && unavailableRequiredTools.has(obligation.value.toLowerCase()));
      return unavailable
        ? `- The required ${unavailable.value} tool is unavailable. Do not answer as though it was used; state the limitation briefly.`
        : `- ${policy.runtimeInstruction}`;
    });

  const obligations = unique(
    selection.policies.flatMap((policy) => (policy.kind === "universal" ? [] : policy.obligations.map((obligation) => {
      if (obligation.type === "call_tool" && obligation.value && unavailableRequiredTools.has(obligation.value.toLowerCase())) {
        return `- report_unavailable_tool:${obligation.value}`;
      }
      return `- ${obligationToString(obligation)}`;
    })))
  );
  const prohibitions = unique(
    selection.policies.flatMap((policy) => policy.prohibitions.map((prohibition) => `- ${prohibitionToString(prohibition)}`))
  );

  const lines = [
    `Task type: ${taskType}.`,
    "",
    "Execution contract:",
    "- Answer the request directly and concisely; do not narrate these rules or add unrequested alternatives.",
    "- Use only tools explicitly listed as available. Never simulate a tool call, tool result, search, inspection, or citation.",
    "- If a required tool or source is unavailable, state that limitation briefly instead of inventing results.",
  ];
  if (availableTools !== undefined) {
    lines.push(`- Available tools: ${availableTools.size ? [...availableTools].sort().join(", ") : "none"}.`);
  }
  if (context && [context.artifactType, context.operation, context.features?.length, context.domainHints?.length, context.riskHints?.length].some(Boolean)) {
    lines.push("");
    lines.push("Artifact/context notes:");
    if (context.artifactType) lines.push(`- artifactType: ${context.artifactType}`);
    if (context.operation) lines.push(`- operation: ${context.operation}`);
    if (context.features?.length) lines.push(`- features: ${context.features.join(", ")}`);
    if (context.domainHints?.length) lines.push(`- domains: ${context.domainHints.join(", ")}`);
    if (context.riskHints?.length) lines.push(`- risks: ${context.riskHints.join(", ")}`);
  }

  lines.push("");
  lines.push("Active rules:");
  lines.push(...activeRules);

  if (obligations.length) {
    lines.push("");
    lines.push("Required actions:");
    lines.push(...obligations);
  }

  if (prohibitions.length) {
    lines.push("");
    lines.push("Forbidden:");
    lines.push(...prohibitions);
  }

  lines.push("");
  lines.push(`User request: ${input}`);
  return lines.join("\n");
}

function inferTaskType(selection: PolicySelection, context?: ArtifactContext | null): string {
  if (selection.detectedIntents.includes("current_info")) return "current information request";
  if (selection.detectedIntents.includes("weather")) return "weather/current information request";
  if (selection.detectedIntents.some((intent) => ["rewrite", "draft", "polish"].includes(intent))) return "writing task";
  if (selection.detectedIntents.includes("image_generation")) return "image generation request";
  if (selection.detectedIntents.includes("image_interpretation")) return "image interpretation request";
  if (selection.detectedIntents.includes("pdf_summary") || context?.artifactType === "pdf") return "PDF artifact task";
  if (selection.detectedIntents.includes("spreadsheet_edit") || context?.artifactType === "spreadsheet") return "spreadsheet artifact task";
  if (selection.detectedIntents.includes("destructive_action")) return "destructive action request";
  if (selection.detectedIntents.includes("calendar_mutation")) return "calendar mutation request";
  return "general request";
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
