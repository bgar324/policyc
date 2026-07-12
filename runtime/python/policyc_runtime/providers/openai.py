from __future__ import annotations

import os
from typing import Any

import httpx

from .base import ProviderError, ProviderRequest, ProviderResponse


class OpenAIResponsesProvider:
    """Isolated real-provider adapter. It is never used by offline tests or without an explicit API key."""

    name = "openai"

    def __init__(self, api_key: str | None = None, base_url: str = "https://api.openai.com/v1") -> None:
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY is required for the openai provider")
        self.base_url = base_url.rstrip("/")

    async def invoke(self, request: ProviderRequest) -> ProviderResponse:
        payload: dict[str, Any] = {
            "model": request.model,
            "instructions": request.artifact.compiledPrompt,
            "input": request.artifact.request,
            **request.parameters,
        }
        if request.seed is not None:
            payload.setdefault("seed", request.seed)
        async with httpx.AsyncClient(timeout=None) as client:
            response = await client.post(
                f"{self.base_url}/responses",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=payload,
            )
        if response.status_code == 429 or response.status_code >= 500:
            retry_after = response.headers.get("retry-after")
            raise ProviderError(
                response.text[:500], retryable=True, retry_after=float(retry_after) if retry_after else None
            )
        if response.status_code >= 400:
            raise ProviderError(response.text[:500], retryable=False)
        body = response.json()
        usage = body.get("usage", {})
        text = body.get("output_text") or _extract_text(body)
        return ProviderResponse(
            text=text,
            input_tokens=int(usage.get("input_tokens", 0)),
            output_tokens=int(usage.get("output_tokens", 0)),
            tool_calls=[
                item for item in body.get("output", []) if item.get("type") in {"function_call", "web_search_call"}
            ],
            metadata={"response_id": body.get("id"), "model": body.get("model")},
        )


def _extract_text(body: dict[str, Any]) -> str:
    return "\n".join(
        content.get("text", "")
        for item in body.get("output", [])
        for content in item.get("content", [])
        if content.get("type") == "output_text"
    )
