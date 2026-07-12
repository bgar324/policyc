from __future__ import annotations

import asyncio
from collections import defaultdict

from .base import ProviderError, ProviderRequest, ProviderResponse


class FakeProvider:
    name = "fake"

    def __init__(self, *, delay: float = 0.01, outcomes: dict[str, list[str]] | None = None) -> None:
        self.delay = delay
        self.outcomes = outcomes or {}
        self.calls: dict[str, int] = defaultdict(int)
        self.active = 0
        self.max_active = 0
        self.cancelled = 0

    async def invoke(self, request: ProviderRequest) -> ProviderResponse:
        candidate = request.artifact.candidateId
        call = self.calls[candidate]
        self.calls[candidate] += 1
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            try:
                await asyncio.sleep(self.delay)
            except asyncio.CancelledError:
                self.cancelled += 1
                raise
            outcome_list = self.outcomes.get(candidate, [])
            outcome = outcome_list[call] if call < len(outcome_list) else "success"
            if outcome == "rate_limit":
                raise ProviderError("fake rate limit", retryable=True, retry_after=0.01)
            if outcome == "transient":
                raise ProviderError("fake transient failure", retryable=True)
            if outcome == "terminal":
                raise ProviderError("fake terminal failure", retryable=False)
            if outcome == "hang":
                await asyncio.Event().wait()
            text, tools = compliant_response(request)
            return ProviderResponse(
                text=text,
                input_tokens=request.artifact.tokenCount.tokens,
                output_tokens=max(1, len(text.split())),
                estimated_cost_usd=round(request.artifact.tokenCount.tokens * 0.0000001, 8),
                tool_calls=tools,
                metadata={"provider": "deterministic-fake", "outcome": outcome},
            )
        finally:
            self.active -= 1


def compliant_response(request: ProviderRequest) -> tuple[str, list[dict[str, str]]]:
    prompt = request.artifact.compiledPrompt.lower()
    user = request.artifact.request.lower()
    parts = ["I inspected the request and available context."]
    tools: list[dict[str, str]] = []
    if "call_tool:web" in prompt or any(word in user for word in ("latest", "current", "news", "weather")):
        tools.append({"name": "web"})
        parts.append("The current answer is supported by an authoritative source. [1]")
    if "ask_confirmation" in prompt or any(word in user for word in ("delete", "archive", "send", "cancel")):
        parts.append("Please confirm before I take that external or destructive action.")
    if "refuse" in prompt or "bypass" in user:
        parts.append("I cannot assist with bypassing safeguards.")
    if "cite_page_or_section" in prompt:
        parts.append("The relevant detail appears on page 2.")
    if "preserve_formulas" in prompt:
        parts.append("I preserved formulas and the table structure.")
    return " ".join(parts), tools
