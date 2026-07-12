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


class CompiledArtifact(StrictModel):
    schemaVersion: Literal["1.0.0"]
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
    orderedRuntimeInstructions: list[str]
    compiledPrompt: str
    compiledPromptHash: str
    tokenCount: TokenCount
    compilationStrategy: str
    createdAt: datetime


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
