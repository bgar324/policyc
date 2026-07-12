import { z } from "zod";

const policyKind = z.enum(["universal", "content_gated", "structural"]);
const severity = z.enum(["style", "format", "tool", "privacy", "safety"]);
const intent = z.enum([
  "current_info", "weather", "rewrite", "draft", "polish", "image_generation", "image_interpretation",
  "chart_interpretation", "pdf_summary", "spreadsheet_edit", "destructive_action", "send_email",
  "draft_email", "calendar_mutation", "background_work", "hidden_reasoning", "citation_request",
  "identification", "sensitive_attribute", "policy_bypass"
]);
const artifactType = z.enum(["pdf", "spreadsheet", "image", "document", "email", "calendar_event", "generated_image", "unknown"]);
const operation = z.enum(["summarize", "extract", "edit", "rewrite", "analyze", "describe", "create", "update", "delete", "archive", "send", "draft", "lookup"]);
const obligationType = z.enum(["call_tool", "include_citations", "use_output_format", "ask_confirmation", "refuse", "read_file_or_skill", "complete_current_turn", "inspect_artifact", "state_uncertainty", "preserve_formulas", "preserve_data_structure", "cite_page_or_section"]);
const prohibitionType = z.enum(["forbidden_tool_call", "claim_background_work", "reveal_hidden_reasoning", "invent_citations", "mention_internal_policy", "destructive_action_without_confirmation", "fake_precision", "identify_unknown_person", "infer_sensitive_attributes", "answer_current_info_from_memory", "raw_tool_json"]);

const triggerSchema = z.object({
  keywords: z.array(z.string().min(1)).optional(),
  intents: z.array(intent).optional(),
  artifactTypes: z.array(artifactType).optional(),
  artifactFeatures: z.array(z.string().min(1)).optional(),
  tools: z.array(z.string().min(1)).optional(),
  operations: z.array(operation).optional(),
  domains: z.array(z.string().min(1)).optional(),
  risks: z.array(z.string().min(1)).optional()
}).strict();

const obligationSchema = z.object({ type: obligationType, value: z.string().optional(), detail: z.string().optional() }).strict();
const prohibitionSchema = z.object({ type: prohibitionType, value: z.string().optional(), detail: z.string().optional() }).strict();

export const policySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  title: z.string().min(1),
  description: z.string().min(1),
  kind: policyKind,
  priority: z.number().int().min(0).max(10_000),
  severity,
  alwaysActive: z.boolean(),
  triggers: triggerSchema.default({}),
  requires: z.array(z.string().min(1)).default([]),
  obligations: z.array(obligationSchema).default([]),
  prohibitions: z.array(prohibitionSchema).default([]),
  runtimeInstruction: z.string(),
  validators: z.array(z.string().min(1)).default([])
}).strict();

export const policyPackSchema = z.object({ policies: z.array(policySchema) }).strict();

