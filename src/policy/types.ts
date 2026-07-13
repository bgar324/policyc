export type PolicyKind = "universal" | "content_gated" | "structural";

export type PolicySeverity = "style" | "format" | "tool" | "privacy" | "safety";

export type IntentTrigger =
  | "current_info"
  | "weather"
  | "rewrite"
  | "draft"
  | "polish"
  | "image_generation"
  | "image_interpretation"
  | "chart_interpretation"
  | "pdf_summary"
  | "spreadsheet_edit"
  | "destructive_action"
  | "send_email"
  | "draft_email"
  | "calendar_mutation"
  | "background_work"
  | "hidden_reasoning"
  | "citation_request"
  | "identification"
  | "sensitive_attribute"
  | "policy_bypass";

export type ArtifactType =
  | "pdf"
  | "spreadsheet"
  | "image"
  | "document"
  | "email"
  | "calendar_event"
  | "generated_image"
  | "unknown";

export type OperationTrigger =
  | "summarize"
  | "extract"
  | "edit"
  | "rewrite"
  | "analyze"
  | "describe"
  | "create"
  | "update"
  | "delete"
  | "archive"
  | "send"
  | "forward"
  | "draft"
  | "reschedule"
  | "lookup";

export type ObligationType =
  | "call_tool"
  | "include_citations"
  | "use_output_format"
  | "ask_confirmation"
  | "refuse"
  | "read_file_or_skill"
  | "complete_current_turn"
  | "inspect_artifact"
  | "state_uncertainty"
  | "preserve_formulas"
  | "preserve_data_structure"
  | "cite_page_or_section";

export type ProhibitionType =
  | "forbidden_tool_call"
  | "claim_background_work"
  | "reveal_hidden_reasoning"
  | "invent_citations"
  | "mention_internal_policy"
  | "destructive_action_without_confirmation"
  | "fake_precision"
  | "identify_unknown_person"
  | "infer_sensitive_attributes"
  | "answer_current_info_from_memory"
  | "raw_tool_json";

export type TriggerSet = {
  keywords?: string[];
  intents?: IntentTrigger[];
  artifactTypes?: ArtifactType[];
  artifactFeatures?: string[];
  tools?: string[];
  operations?: OperationTrigger[];
  domains?: string[];
  risks?: string[];
};

export type Obligation = {
  type: ObligationType;
  value?: string;
  detail?: string;
};

export type Prohibition = {
  type: ProhibitionType;
  value?: string;
  detail?: string;
};

export type Policy = {
  id: string;
  title: string;
  description: string;
  kind: PolicyKind;
  priority: number;
  severity: PolicySeverity;
  alwaysActive: boolean;
  triggers: TriggerSet;
  requires: string[];
  obligations: Obligation[];
  prohibitions: Prohibition[];
  runtimeInstruction: string;
  validators: string[];
  pack?: string;
};

export type ArtifactContext = {
  artifactType?: ArtifactType;
  features?: string[];
  operation?: OperationTrigger;
  domainHints?: string[];
  riskHints?: string[];
  toolsAvailable?: string[];
  toolsRequested?: string[];
};

export type SelectionInput = {
  input: string;
  context?: ArtifactContext | null;
};

export type PolicySelectionReason = {
  policyId: string;
  reasons: string[];
  dependencyOf?: string[];
};

export type PolicySelection = {
  policies: Policy[];
  reasons: PolicySelectionReason[];
  detectedIntents: IntentTrigger[];
  dependencyEdges: Array<{ from: string; requires: string }>;
};

export type PolicyPackFile = {
  policies: Policy[];
};
