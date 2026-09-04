import type { Condition } from "../ir/conditions.js";
import type { RequestState } from "../ir/requestState.js";

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
  artifactOperations?: Array<{ artifactType: ArtifactType; operation: OperationTrigger }>;
  domains?: string[];
  risks?: string[];
  /** Positive request-state selectors. Unknown retains the node after scopes pass. */
  state?: {
    currentInformation?: true;
    deferredWork?: true;
    slideTask?: true;
  };
  /** Pure artifact gate; never selects a policy by itself. */
  artifactScope?: ArtifactType[];
  /** Pure operation gate; never selects a policy by itself. */
  operationScope?: OperationTrigger[];
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

/**
 * A conditional branch of a policy node. When `when` evaluates true over the
 * request state, this text and these obligations replace the node's defaults.
 * Branches are tried in order; the first true one wins; unknown falls through
 * to the node's conservative default.
 */
export type PolicyBranch = {
  id: string;
  when: Condition;
  runtimeInstruction: string;
  obligations: Obligation[];
  prohibitions: Prohibition[];
};

/**
 * `mandated`: this node's tool obligation comes from the source policy and is
 * not subject to a user-stated limit (current facts must come from live
 * research, never memory). Declared on the node, not inferred in code.
 */
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
  branches?: PolicyBranch[];
  mandated?: boolean;
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
  state: RequestState;
};

export type PolicySelectionReason = {
  policyId: string;
  reasons: string[];
  dependencyOf?: string[];
};

/** One evaluated branch, recorded in the artifact so a reader can see why a node emitted what it did. */
export type EvaluationRecord = {
  policyId: string;
  branchId: string;
  truth: "true" | "false" | "unknown";
  evidence: string[];
};

export type PolicySelection = {
  policies: Policy[];
  reasons: PolicySelectionReason[];
  detectedIntents: IntentTrigger[];
  dependencyEdges: Array<{ from: string; requires: string }>;
  /** Request state the compiled candidate was evaluated against; absent before evaluation. */
  requestState?: RequestState;
  /** Every branch evaluation, in node order. */
  evaluations?: EvaluationRecord[];
  /**
   * Present when this turn may not act: the user bounded it (`limited`,
   * `ambiguous`), or the resolved program asks for confirmation first (`ask`).
   * The emitter prints the instruction as the first active rule.
   */
  limit?: { verdict: "limited" | "ambiguous" | "ask"; instruction: string };
  /** Contradictions between resolved nodes, found at compile time. */
  conflicts?: string[];
};

export type PolicyPackFile = {
  policies: Policy[];
};
