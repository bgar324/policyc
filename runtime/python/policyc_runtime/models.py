from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TokenCount(StrictModel):
    tokens: int = Field(ge=0)
    method: Literal["exact", "estimated"]
    tokenizer: str
    model: str | None = None


class DependencyEdge(StrictModel):
    from_: str = Field(alias="from")
    requires: str


class SelectionReason(StrictModel):
    policyId: str
    reasons: list[str]
    dependencyOf: list[str] | None = None


class SpecializationRecord(StrictModel):
    """Protocol 1.1.0 trace, kept so held-out-v4 artifacts still load."""

    policyId: str
    predicate: Literal["explicit_confirmation", "explicit_limit"]
    satisfied: bool
    evidence: list[str]


ARTIFACT_TYPES_1_3 = frozenset(
    {"pdf", "spreadsheet", "image", "document", "email", "calendar_event", "generated_image", "unknown"}
)


class RequestState(StrictModel):
    operation: str | None = None
    artifactType: str | None = None
    # Protocols 1.0-1.2 predate these facts. Conservative defaults keep their
    # historical artifacts readable; protocol 1.3 will require them on the wire.
    currentInformation: bool | None = None
    deferredWork: bool | None = None
    slideTask: bool | None = None
    externalDisclosure: Literal["safe", "confidential_external", "unknown"] = "unknown"
    requestedSlideReorder: bool | None = None
    authorization: Literal["present", "reported", "conditional", "absent"]
    limit: Literal["limited", "ambiguous", "none"]
    deliverable: Literal["text", "open", "unresolved"]
    purpose: Literal["sensitive_attribute_read", "identification", "none"]
    permittedTask: bool
    format: Literal["requested", "none"]
    fields: dict[str, bool]
    operationNamed: bool
    operationNegated: bool
    toolsAvailable: list[str] | None = None
    frontend: str = Field(min_length=1)
    evidence: list[str]


class EvaluationRecord(StrictModel):
    policyId: str
    branchId: str
    truth: Literal["true", "false", "unknown"]
    evidence: list[str]


# Protocol 1.4.0, offline source-slicing experiment only. The section arms carry
# a sourceSelection; the clause arm carries a sourceClauseSelection. Every other
# strategy stays on protocol 1.3.0 and records neither.
SOURCE_SELECTION_STRATEGIES = frozenset(
    {"source_preserving_slice", "source_matched_semantic", "source_matched_authored"}
)
SOURCE_CLAUSE_STRATEGIES = frozenset(
    {
        "source_clause_slice",
        "source_evidence_bare",
        "source_evidence_apply",
        "model_reader_slice",
        "condition_list_slice",
    }
)
SOURCE_EVIDENCE_STRATEGIES = frozenset({"source_evidence_bare", "source_evidence_apply"})
READER_STRATEGY = "model_reader_slice"
CONDITION_LIST_STRATEGY = "condition_list_slice"
HASH_PATTERN = r"^[a-f0-9]{64}$"


class SourceSection(StrictModel):
    """One original source span, projected from the current selector's prediction."""

    heading: str = Field(min_length=1)
    startByte: int = Field(ge=0)
    endByte: int = Field(gt=0)
    sha256: str = Field(pattern=HASH_PATTERN)
    policyIds: list[str]
    retained: bool
    context: bool
    reasons: list[str]

    @model_validator(mode="after")
    def _check_span_and_flags(self) -> SourceSection:
        if self.endByte <= self.startByte:
            raise ValueError(f"source section spans are half-open and non-empty: {self.heading}")
        if self.context and not self.retained:
            raise ValueError(f"source context sections must be retained: {self.heading}")
        if not self.retained and not self.reasons:
            # An omission is a selector prediction, not proof; it must say why.
            raise ValueError(f"omitted source sections must record reasons: {self.heading}")
        return self


class SourceSelection(StrictModel):
    """Provenance for the source-section arms; not a claim of semantic equivalence."""

    contractVersion: Literal["source-sections-v1"]
    selectionBasis: Literal["current-selector-prediction"]
    sourceMapHash: str = Field(pattern=HASH_PATTERN)
    seedPolicyIds: list[str]
    sections: list[SourceSection] = Field(min_length=1)

    @model_validator(mode="after")
    def _check_order_and_retention(self) -> SourceSelection:
        previous: SourceSection | None = None
        for section in self.sections:
            if previous is not None and section.startByte < previous.endByte:
                raise ValueError(
                    "source sections must keep original order without overlap: "
                    f"{previous.heading} then {section.heading}"
                )
            previous = section
        if not any(section.retained for section in self.sections):
            raise ValueError("source selection must retain at least one section")
        return self


class SourceSpan(StrictModel):
    """One whole source line: a half-open UTF-8 byte span whose text hashes to `sha256`."""

    section: str = Field(min_length=1)
    line: int = Field(ge=1)
    startByte: int = Field(ge=0)
    endByte: int = Field(gt=0)
    sha256: str = Field(pattern=HASH_PATTERN)

    @model_validator(mode="after")
    def _check_span(self) -> SourceSpan:
        if self.endByte <= self.startByte:
            raise ValueError(f"source spans are half-open and non-empty: line {self.line}")
        return self


class SourceClause(SourceSpan):
    id: str = Field(min_length=1)
    retained: bool
    dependsOn: list[str]
    reasons: list[str] = Field(min_length=1)


class SourceBoilerplate(SourceSpan):
    retained: bool
    subsumes: list[SourceSpan]


class SourceClauseSelection(StrictModel):
    """Span-level provenance for the clause arm. Retention cites a signal; pruning cites an exhaustive fact."""

    contractVersion: Literal["source-clauses-v1"]
    clauseMapHash: str = Field(pattern=HASH_PATTERN)
    exhaustive: dict[Literal["artifacts", "tools"], bool]
    seedPolicyIds: list[str]
    retainedSections: list[str]
    clauses: list[SourceClause] = Field(min_length=1)
    boilerplate: list[SourceBoilerplate]

    @model_validator(mode="after")
    def _check_provenance(self) -> SourceClauseSelection:
        ids = {clause.id for clause in self.clauses}
        if len(ids) != len(self.clauses):
            raise ValueError("clause ids must be unique")
        previous: SourceClause | None = None
        for clause in self.clauses:
            if previous is not None and clause.startByte < previous.endByte:
                raise ValueError(f"clauses must keep source order without overlap: {previous.id} then {clause.id}")
            for dependency in clause.dependsOn:
                if dependency not in ids:
                    raise ValueError(f"clause {clause.id} depends on unknown clause {dependency}")
            if not clause.retained and not any(
                reason.startswith("pruned by trusted structural fact") for reason in clause.reasons
            ):
                raise ValueError(f"pruned clause {clause.id} must cite a trusted structural fact")
            previous = clause
        if not any(clause.retained for clause in self.clauses):
            raise ValueError("clause selection must retain at least one clause")
        return self


class EvidenceQuote(StrictModel):
    sentence: int = Field(ge=0)
    start: int = Field(ge=0)
    end: int = Field(gt=0)
    text: str = Field(min_length=1)
    roles: list[str] = Field(min_length=1)


class EvidenceRole(StrictModel):
    id: str = Field(min_length=1)
    requirement: str = Field(min_length=1)


class EvidenceBinding(StrictModel):
    clause: str = Field(min_length=1)
    action: str = Field(min_length=1)
    roles: list[EvidenceRole] = Field(min_length=1)
    quotes: list[EvidenceQuote]


class ProposedAction(StrictModel):
    id: str = Field(min_length=1)
    operation: str = Field(min_length=1)
    sentence: int = Field(ge=-1)
    phrase: str


class SourceEvidenceBinding(StrictModel):
    """Verbatim request sentences bound to clauses and proposed actions. No field is a verdict."""

    contractVersion: Literal["source-evidence-v1"]
    evidenceContractHash: str = Field(pattern=HASH_PATTERN)
    request: dict[Literal["sha256", "sentences"], Any]
    actions: list[ProposedAction]
    bindings: list[EvidenceBinding]

    @model_validator(mode="after")
    def _check_binding(self) -> SourceEvidenceBinding:
        action_ids = {action.id for action in self.actions}
        for binding in self.bindings:
            if binding.action not in action_ids:
                raise ValueError(f"binding for {binding.clause} names unknown action {binding.action}")
            role_ids = {role.id for role in binding.roles}
            for quote in binding.quotes:
                if not set(quote.roles) <= role_ids:
                    raise ValueError(f"quote in {binding.clause} tags a role the clause did not declare")
        return self


class PolicyResolutionV1(StrictModel):
    """Contract 1: the reader found and quoted the condition itself."""

    condition: str = Field(min_length=1)
    finding: str = Field(min_length=1)
    directive: str = Field(min_length=1)


class PolicyResolutionV2(StrictModel):
    """Contract 2: the reader answered a listed condition by id; an empty directive renders nothing."""

    condition: str = Field(min_length=1)
    holds: Literal["yes", "no", "undecidable", "not-applicable"]
    quote: str
    directive: str


class PolicyReadingRecord(StrictModel):
    """A model reader's resolutions for one request; only the directives are rendered."""

    readerId: str = Field(min_length=1)
    readingContractSha256: str = Field(pattern=HASH_PATTERN)
    resolutions: list[PolicyResolutionV1 | PolicyResolutionV2]


class PolicyCondition(StrictModel):
    clause: str = Field(min_length=1)
    id: str = Field(min_length=1)
    sentence: str = Field(min_length=1)
    condition: str = Field(min_length=1)


class PolicyConditionsRecord(StrictModel):
    """The indexed conditions listed for one request: rendered by condition_list_slice, answered by a v2 reader."""

    conditionIndexHash: str = Field(pattern=HASH_PATTERN)
    conditions: list[PolicyCondition]

    @model_validator(mode="after")
    def _check_conditions(self) -> PolicyConditionsRecord:
        ids = [condition.id for condition in self.conditions]
        if len(set(ids)) != len(ids):
            raise ValueError("listed condition ids must be unique")
        for condition in self.conditions:
            if condition.condition not in condition.sentence:
                raise ValueError(f"condition span of {condition.id} is not within its sentence")
        return self


class CompiledArtifact(StrictModel):
    schemaVersion: Literal["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]
    compilerVersion: str
    candidateId: str
    policyPackHash: str
    sourcePolicyId: str
    sourcePolicyHash: str
    request: str
    artifactContext: dict[str, Any] | None
    selectedPolicyIds: list[str]
    directlySelectedPolicyIds: list[str]
    dependencyAddedPolicyIds: list[str]
    criticalPolicyIds: list[str]
    dependencyEdges: list[DependencyEdge]
    selectionReasons: list[SelectionReason]
    specializations: list[SpecializationRecord] = Field(default_factory=list)
    requestState: RequestState | None = None
    evaluations: list[EvaluationRecord] = Field(default_factory=list)
    conflicts: list[str] = Field(default_factory=list)
    sourceSelection: SourceSelection | None = None
    sourceClauseSelection: SourceClauseSelection | None = None
    sourceEvidence: SourceEvidenceBinding | None = None
    policyReading: PolicyReadingRecord | None = None
    policyConditions: PolicyConditionsRecord | None = None
    orderedRuntimeInstructions: list[str]
    compiledPrompt: str
    compiledPromptHash: str
    tokenCount: TokenCount
    compilationStrategy: str
    createdAt: datetime

    @model_validator(mode="before")
    @classmethod
    def _require_trace_for_version(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        version = data.get("schemaVersion")
        if version == "1.1.0" and "specializations" not in data:
            raise ValueError("schemaVersion 1.1.0 artifacts must record specializations")
        if version in ("1.2.0", "1.3.0", "1.4.0") and any(
            key not in data for key in ("requestState", "evaluations", "conflicts")
        ):
            raise ValueError(f"schemaVersion {version} artifacts must record requestState, evaluations, and conflicts")
        if version in ("1.3.0", "1.4.0"):
            state = data.get("requestState")
            required_facts = (
                "currentInformation",
                "deferredWork",
                "slideTask",
                "externalDisclosure",
                "requestedSlideReorder",
            )
            if not isinstance(state, dict) or any(key not in state for key in required_facts):
                raise ValueError(f"schemaVersion {version} requestState must record all compiler 0.10 facts")
            artifact_type = state.get("artifactType")
            if artifact_type is not None and artifact_type not in ARTIFACT_TYPES_1_3:
                raise ValueError(f"schemaVersion {version} requestState artifactType is invalid: {artifact_type}")
        strategy = data.get("compilationStrategy")
        section_arm = strategy in SOURCE_SELECTION_STRATEGIES
        clause_arm = strategy in SOURCE_CLAUSE_STRATEGIES
        if version == "1.4.0":
            if not (section_arm or clause_arm):
                raise ValueError(
                    "schemaVersion 1.4.0 is reserved for the source-slice strategies "
                    f"{sorted(SOURCE_SELECTION_STRATEGIES | SOURCE_CLAUSE_STRATEGIES)}, not {strategy!r}"
                )
            if section_arm and data.get("sourceSelection") is None:
                raise ValueError("schemaVersion 1.4.0 artifacts must record sourceSelection")
            if clause_arm and data.get("sourceClauseSelection") is None:
                raise ValueError(f"schemaVersion 1.4.0 {strategy} artifacts must record sourceClauseSelection")
            if section_arm and ("sourceClauseSelection" in data or "sourceEvidence" in data):
                raise ValueError(f"{strategy!r} artifacts record sourceSelection only")
            if clause_arm and "sourceSelection" in data:
                raise ValueError(f"{strategy} artifacts record sourceClauseSelection, not sourceSelection")
            evidence_arm = strategy in SOURCE_EVIDENCE_STRATEGIES
            if evidence_arm and data.get("sourceEvidence") is None:
                raise ValueError(f"schemaVersion 1.4.0 {strategy} artifacts must record sourceEvidence")
            if not evidence_arm and "sourceEvidence" in data:
                raise ValueError(f"{strategy!r} artifacts do not record sourceEvidence")
            if strategy == READER_STRATEGY and data.get("policyReading") is None:
                raise ValueError(f"schemaVersion 1.4.0 {strategy} artifacts must record policyReading")
            if strategy != READER_STRATEGY and "policyReading" in data:
                raise ValueError(f"{strategy!r} artifacts do not record policyReading")
            if strategy == CONDITION_LIST_STRATEGY and data.get("policyConditions") is None:
                raise ValueError(f"schemaVersion 1.4.0 {strategy} artifacts must record policyConditions")
            if strategy not in (CONDITION_LIST_STRATEGY, READER_STRATEGY) and "policyConditions" in data:
                raise ValueError(f"{strategy!r} artifacts do not record policyConditions")
        else:
            if section_arm or clause_arm:
                raise ValueError(f"{strategy!r} artifacts must declare schemaVersion 1.4.0, not {version!r}")
            if any(
                key in data
                for key in (
                    "sourceSelection",
                    "sourceClauseSelection",
                    "sourceEvidence",
                    "policyReading",
                    "policyConditions",
                )
            ):
                raise ValueError(f"source provenance is recorded only by schemaVersion 1.4.0, not {version!r}")
        return data


class RetryPolicy(StrictModel):
    maxAttempts: int = Field(default=3, ge=1, le=20)
    initialBackoffSeconds: float = Field(default=0.1, ge=0)
    maxBackoffSeconds: float = Field(default=5.0, ge=0)
    jitterFraction: float = Field(default=0.1, ge=0, le=1)


class RateLimit(StrictModel):
    requestsPerWindow: int | None = Field(default=None, ge=1)
    windowSeconds: float = Field(default=1.0, gt=0)
    maxConcurrentRequests: int | None = Field(default=None, ge=1)
    estimatedTokensPerWindow: int | None = Field(default=None, ge=1)


class EvaluatorConfig(StrictModel):
    id: str = "rule-based"
    version: str = "1.0.0"
    nonInferiorityMargin: float = Field(default=0.05, ge=0, le=1)


class RunManifest(StrictModel):
    schemaVersion: Literal["1.0.0"]
    runId: str
    experimentName: str
    candidates: list[str] = Field(min_length=1)
    fullPolicyCandidateId: str
    provider: str
    model: str
    modelParameters: dict[str, Any]
    sampleCount: int = Field(ge=1)
    maxConcurrency: int = Field(ge=1)
    timeoutSeconds: float = Field(gt=0)
    retryPolicy: RetryPolicy
    rateLimit: RateLimit
    evaluator: EvaluatorConfig
    seed: int | None = None
    outputDirectory: str
    rawResponseRetention: Literal["none", "text", "full"]

    @model_validator(mode="after")
    def unique_candidates(self) -> RunManifest:
        if len(set(self.candidates)) != len(self.candidates):
            raise ValueError("candidate paths must be unique")
        return self


class TrialStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    RETRYING = "retrying"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class RunStatus(StrEnum):
    CREATED = "created"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ErrorInfo(StrictModel):
    type: str
    message: str
    retryable: bool


class EvaluationResult(StrictModel):
    evaluatorId: str
    evaluatorVersion: str
    compliance: float = Field(ge=0, le=1)
    answerQuality: float = Field(ge=0, le=1)
    obligationResults: dict[str, bool]
    violations: list[str]
    evidence: dict[str, str]


class TrialResult(StrictModel):
    schemaVersion: Literal["1.0.0"] = "1.0.0"
    runId: str
    trialId: str
    candidateId: str
    strategy: str
    sampleIndex: int
    status: TrialStatus
    attemptCount: int
    queuedAt: datetime
    startedAt: datetime | None = None
    completedAt: datetime | None = None
    latencyMs: float | None = None
    provider: str
    model: str
    inputTokens: int | None = None
    outputTokens: int | None = None
    estimatedCostUsd: float | None = None
    responseText: str | None = None
    toolCalls: list[dict[str, Any]] = Field(default_factory=list)
    evaluatorScores: EvaluationResult | None = None
    policyViolations: list[str] = Field(default_factory=list)
    error: ErrorInfo | None = None
    provenanceHashes: dict[str, str]


EVENT_TYPES = Literal[
    "run.created",
    "run.started",
    "trial.queued",
    "trial.started",
    "trial.retrying",
    "trial.completed",
    "trial.failed",
    "trial.cancelled",
    "evaluation.started",
    "evaluation.completed",
    "run.completed",
    "run.failed",
    "run.cancelled",
]


class RunEvent(StrictModel):
    schemaVersion: Literal["1.0.0"] = "1.0.0"
    runId: str
    eventId: str
    eventType: EVENT_TYPES
    timestamp: datetime
    sequence: int = Field(ge=1)
    trialId: str | None = None
    candidateId: str | None = None
    payload: dict[str, Any]


class LoadedRun(StrictModel):
    manifest: RunManifest
    manifestPath: Path
    artifacts: list[CompiledArtifact]
    runDirectory: Path
