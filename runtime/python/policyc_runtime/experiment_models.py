from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import Field, model_validator

from .models import CompiledArtifact, RateLimit, StrictModel


class Requirement(StrictModel):
    id: str
    description: str
    severity: Literal["low", "medium", "high", "critical"]
    validator: str
    value: str | None = None


class ToolDefinition(StrictModel):
    type: Literal["web_search", "function"]
    name: str
    description: str | None = None
    parameters: dict[str, Any] | None = None

    def provider_dict(self) -> dict[str, Any]:
        if self.type == "web_search":
            return {"type": "web_search"}
        return {
            "type": "function",
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters,
            "strict": True,
        }


class ToolExpectation(StrictModel):
    required: list[str]
    forbidden: list[str]


class Rubric(StrictModel):
    description: str
    minQualityScore: float


class BehavioralCase(StrictModel):
    schemaVersion: Literal["1.0.0"]
    datasetVersion: str
    split: Literal["development", "pilot", "held-out", "adversarial", "smoke"]
    caseId: str
    request: str
    artifactContext: dict[str, Any] | None
    sourceArtifact: dict[str, Any] | None = None
    applicableObligations: list[Requirement]
    criticalObligationIds: list[str]
    prohibitions: list[Requirement]
    expectedRefusal: Literal["required", "forbidden", "allowed"]
    toolExpectation: ToolExpectation
    tools: list[ToolDefinition]
    rubric: Rubric
    tags: list[str]
    template: bool = False


class CandidateRef(StrictModel):
    strategy: str
    candidateId: str
    artifactPath: str


class CasePlan(StrictModel):
    caseId: str
    case: BehavioralCase
    candidates: list[CandidateRef]

    @model_validator(mode="after")
    def consistent(self) -> CasePlan:
        if self.caseId != self.case.caseId:
            raise ValueError("case plan ID does not match case")
        strategies = [item.strategy for item in self.candidates]
        if len(strategies) != len(set(strategies)):
            raise ValueError(f"duplicate strategy in case {self.caseId}")
        if "full_policy" not in strategies or "compiler_slice" not in strategies:
            raise ValueError(f"case {self.caseId} requires full_policy and compiler_slice")
        return self


class DatasetRef(StrictModel):
    path: str
    hash: str
    version: str
    split: str


class RetryPolicyV2(StrictModel):
    maxAttempts: int = Field(ge=1, le=20)
    initialBackoffSeconds: float = Field(ge=0)
    maxBackoffSeconds: float = Field(ge=0)
    jitterFraction: float = Field(ge=0, le=1)
    retryAmbiguous: bool = False


class EvaluatorRef(StrictModel):
    id: Literal["independent-rules"]
    version: str


class GraderRef(StrictModel):
    type: Literal["manual", "none"]
    version: str
    blind: bool


class BudgetConfig(StrictModel):
    maxLogicalTrials: int = Field(ge=1)
    maxCalls: int = Field(ge=1)
    maxInputTokens: int = Field(ge=1)
    maxOutputTokens: int = Field(ge=1)
    maxCostUsd: float = Field(gt=0)


class PricingRef(StrictModel):
    registryPath: str
    registryVersion: str


class SourceControlRef(StrictModel):
    system: Literal["git"]
    commit: str
    dirty: bool


class PairedRunManifest(StrictModel):
    schemaVersion: Literal["2.0.0"]
    runId: str
    runLabel: str | None = None
    sourceControl: SourceControlRef | None = None
    experimentName: str
    dataset: DatasetRef
    compilerHash: str
    casePlans: list[CasePlan] = Field(min_length=1)
    strategies: list[str] = Field(min_length=2)
    provider: Literal["fake", "openai"]
    model: str
    modelParameters: dict[str, Any]
    sampleCount: int = Field(ge=1)
    inputTokenOverheadPerCall: int = Field(default=0, ge=0)
    maxConcurrency: int = Field(ge=1)
    timeoutSeconds: float = Field(gt=0)
    retryPolicy: RetryPolicyV2
    rateLimit: RateLimit
    evaluator: EvaluatorRef
    grader: GraderRef
    budget: BudgetConfig
    pricing: PricingRef
    outputDirectory: str
    rawResponseRetention: Literal["none", "text", "full"]
    createdAt: datetime

    @model_validator(mode="after")
    def validate_paid_safety(self) -> PairedRunManifest:
        maximum = self.modelParameters.get("max_output_tokens")
        if not isinstance(maximum, int) or isinstance(maximum, bool) or maximum <= 0:
            raise ValueError("paired experiments require positive max_output_tokens")
        if "seed" in self.modelParameters:
            raise ValueError("seed is not supported by the documented Responses API contract")
        if self.rawResponseRetention != "full":
            raise ValueError("paired experiments require full raw-response retention for safe resume")
        logical = len(self.casePlans) * len(self.strategies) * self.sampleCount
        if self.budget.maxLogicalTrials != logical:
            raise ValueError(f"maxLogicalTrials must equal {logical}")
        if self.budget.maxCalls < logical:
            raise ValueError("maxCalls is below logical trial count")
        if len({item.caseId for item in self.casePlans}) != len(self.casePlans):
            raise ValueError("case IDs must be unique")
        for plan in self.casePlans:
            if set(item.strategy for item in plan.candidates) != set(self.strategies):
                raise ValueError(f"case {plan.caseId} does not contain exactly the configured strategies")
            available = {item.name for item in plan.case.tools}
            expected = set(plan.case.toolExpectation.required + plan.case.toolExpectation.forbidden)
            if not expected <= available:
                raise ValueError(f"case {plan.caseId} references unavailable tools")
        return self


class LoadedPairedRun(StrictModel):
    manifest: PairedRunManifest
    manifestPath: str
    artifacts: dict[str, CompiledArtifact]
    runDirectory: str
