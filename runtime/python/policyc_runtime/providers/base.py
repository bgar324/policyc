from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

from ..models import CompiledArtifact


@dataclass(slots=True)
class ProviderRequest:
    artifact: CompiledArtifact
    model: str
    parameters: dict[str, Any]
    seed: int | None
    tools: list[dict[str, Any]] = field(default_factory=list)
    case_id: str | None = None


@dataclass(slots=True)
class ProviderResponse:
    text: str
    input_tokens: int
    output_tokens: int
    estimated_cost_usd: float | None = None
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    built_in_tool_calls: int | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    cached_input_tokens: int | None = None
    reasoning_tokens: int | None = None
    total_tokens: int | None = None
    response_id: str | None = None
    actual_model: str | None = None
    status: str = "completed"
    outcome: str = "completed"
    refusal: str | None = None
    service_tier: str | None = None
    provider_request_id: str | None = None
    created_at: int | None = None
    completed_at: int | None = None
    request_duration_ms: float | None = None


@dataclass(slots=True)
class RawProviderResponse:
    status_code: int
    headers: dict[str, str]
    body: Any
    received_at: datetime
    duration_ms: float


class ProviderError(Exception):
    def __init__(
        self,
        message: str,
        *,
        retryable: bool,
        retry_after: float | None = None,
        outcome: str = "terminal_error",
        partial_response: ProviderResponse | None = None,
    ) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.retry_after = retry_after
        self.outcome = outcome
        self.partial_response = partial_response


class AmbiguousProviderError(ProviderError):
    def __init__(self, message: str) -> None:
        super().__init__(message, retryable=False, outcome="ambiguous")


class AsyncProvider(Protocol):
    name: str

    async def invoke(self, request: ProviderRequest) -> ProviderResponse: ...
