from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from ..models import CompiledArtifact


@dataclass(slots=True)
class ProviderRequest:
    artifact: CompiledArtifact
    model: str
    parameters: dict[str, Any]
    seed: int | None


@dataclass(slots=True)
class ProviderResponse:
    text: str
    input_tokens: int
    output_tokens: int
    estimated_cost_usd: float | None = None
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


class ProviderError(Exception):
    def __init__(self, message: str, *, retryable: bool, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.retry_after = retry_after


class AsyncProvider(Protocol):
    name: str

    async def invoke(self, request: ProviderRequest) -> ProviderResponse: ...
