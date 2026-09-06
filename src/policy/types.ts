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
  /**
   * Declares a context dimension complete. Present fields are hints that may
   * describe one part of a request; only an exhaustive declaration is exclusion
   * evidence for the source arm. `artifacts: true` means the request touches no
   * artifact beyond `artifactType` and `features` (none at all when
   * `artifactType` is absent). `tools: true` means `toolsAvailable` is complete.
   */
  exhaustive?: { artifacts?: true; tools?: true };
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

/** Source spans are UTF-8 byte offsets, with an exclusive end. Not entailment evidence. */
export type SourceSelection = {
  contractVersion: "source-sections-v1";
  selectionBasis: "current-selector-prediction";
  sourceMapHash: string;
  seedPolicyIds: string[];
  sections: Array<{
    heading: string;
    startByte: number;
    endByte: number;
    sha256: string;
    policyIds: string[];
    retained: boolean;
    context: boolean;
    reasons: string[];
  }>;
};

/** Span-level provenance for the clause arm. Every span is a whole source line; the newline belongs to the span. */
export type SourceClauseSelection = {
  contractVersion: "source-clauses-v1";
  clauseMapHash: string;
  /** What the case context declared exhaustive; false means nothing could be pruned on that dimension. */
  exhaustive: { artifacts: boolean; tools: boolean };
  seedPolicyIds: string[];
  retainedSections: string[];
  clauses: Array<{
    id: string;
    section: string;
    line: number;
    startByte: number;
    endByte: number;
    sha256: string;
    retained: boolean;
    dependsOn: string[];
    /** Retention cites a signal or dependency; pruning cites the exhaustive fact. */
    reasons: string[];
  }>;
  /** One canonical copy per distinct boilerplate text, with every label-only copy it subsumes. */
  boilerplate: Array<{
    section: string;
    line: number;
    startByte: number;
    endByte: number;
    sha256: string;
    retained: boolean;
    subsumes: Array<{ section: string; line: number; startByte: number; endByte: number; sha256: string }>;
  }>;
};

/** Verbatim evidence bound to retained clauses and proposed actions. No field is a verdict. */
export type SourceEvidenceBinding = {
  contractVersion: "source-evidence-v1";
  evidenceContractHash: string;
  request: { sha256: string; sentences: number };
  /** Proposed actions in request order; `a0` is the declared operation when the request does not name it. */
  actions: Array<{ id: string; operation: OperationTrigger; sentence: number; phrase: string }>;
  bindings: Array<{
    clause: string;
    /** The proposed action this evidence is bound to. */
    action: string;
    roles: Array<{ id: string; requirement: string }>;
    /** Whole sentences of the request, each tagged with the roles it touches. */
    quotes: Array<{ sentence: number; start: number; end: number; text: string; roles: string[] }>;
  }>;
};

/** One reader resolution: contract 1 quotes the condition it found; contract 2 answers a listed condition by id with a verdict and the deciding words. */
export type PolicyResolution =
  | { condition: string; finding: string; directive: string }
  | { condition: string; holds: "yes" | "no" | "undecidable" | "not-applicable"; quote: string; directive: string };

/** A model reader's resolution of the policy's own conditions for one request; rendered as directives after the clause slice. */
export type PolicyReadingRecord = {
  readerId: string;
  readingContractSha256: string;
  resolutions: PolicyResolution[];
};

/** The indexed conditions listed for one request: provenance for the condition_list_slice arm and for contract-2 readings. */
export type PolicyConditionsRecord = {
  conditionIndexHash: string;
  conditions: Array<{ clause: string; id: string; sentence: string; condition: string }>;
};

export type PolicySelection = {
  policies: Policy[];
  reasons: PolicySelectionReason[];
  detectedIntents: IntentTrigger[];
  dependencyEdges: Array<{ from: string; requires: string }>;
  /** Only the opt-in source experiment records original section provenance. */
  sourceSelection?: SourceSelection;
  /** Clause-level provenance for the source_clause_slice arm. */
  sourceClauseSelection?: SourceClauseSelection;
  /** Evidence bound for the source_evidence_* arms; the frame is chosen at emission. */
  sourceEvidence?: SourceEvidenceBinding;
  /** The persisted reading for the model_reader_slice arm. */
  policyReading?: PolicyReadingRecord;
  /** The indexed conditions listed for this request: the condition_list_slice arm and contract-2 readings. */
  policyConditions?: PolicyConditionsRecord;
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
