from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from time import perf_counter
from typing import Any

import httpx

from .base import AmbiguousProviderError, ProviderError, ProviderRequest, ProviderResponse, RawProviderResponse

ALLOWED_PARAMETERS = {
    "max_output_tokens",
    "temperature",
    "top_p",
    "reasoning",
    "text",
    "tools",
    "tool_choice",
    "store",
    "service_tier",
    "metadata",
    "include",
    "parallel_tool_calls",
    "truncation",
}


class OpenAIResponsesProvider:
    name = "openai"

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str = "https://api.openai.com/v1",
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY is required for the openai provider")
        self.base_url = base_url.rstrip("/")
        self.transport = transport

    def build_payload(self, request: ProviderRequest) -> dict[str, Any]:
        if not request.model.strip():
            raise ValueError("OpenAI model must be fixed and non-empty")
        unknown = set(request.parameters) - ALLOWED_PARAMETERS
        if unknown:
            raise ValueError(f"unsupported OpenAI Responses parameters: {', '.join(sorted(unknown))}")
        maximum = request.parameters.get("max_output_tokens")
        if not isinstance(maximum, int) or isinstance(maximum, bool) or maximum <= 0:
            raise ValueError("OpenAI requests require a positive integer max_output_tokens")
        payload: dict[str, Any] = {
            "model": request.model,
            "instructions": request.artifact.compiledPrompt,
            "input": request.artifact.request,
            **request.parameters,
            "store": bool(request.parameters.get("store", False)),
        }
        if request.tools:
            payload["tools"] = request.tools
        return payload

    async def send(self, request: ProviderRequest) -> RawProviderResponse:
        payload = self.build_payload(request)
        started = perf_counter()
        try:
            async with httpx.AsyncClient(timeout=None, transport=self.transport) as client:
                response = await client.post(
                    f"{self.base_url}/responses",
                    headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                    json=payload,
                )
        except (httpx.TimeoutException, httpx.TransportError) as error:
            raise AmbiguousProviderError(
                f"OpenAI transport outcome is ambiguous: {type(error).__name__}: {error}"
            ) from error
        duration = (perf_counter() - started) * 1000
        try:
            body: Any = response.json()
        except json.JSONDecodeError:
            body = response.text
        return RawProviderResponse(
            status_code=response.status_code,
            headers={key.lower(): value for key, value in response.headers.items()},
            body=body,
            received_at=datetime.now(UTC),
            duration_ms=duration,
        )

    def parse(self, raw: RawProviderResponse, requested_model: str) -> ProviderResponse:
        if raw.status_code >= 400:
            message = _error_message(raw.body)
            retryable = raw.status_code == 429 or raw.status_code >= 500
            raise ProviderError(
                message,
                retryable=retryable,
                retry_after=parse_retry_after(raw.headers.get("retry-after")),
                outcome="retryable_error" if retryable else "terminal_error",
            )
        if not isinstance(raw.body, dict):
            raise ProviderError("OpenAI returned malformed JSON", retryable=False, outcome="malformed_response")
        body = raw.body
        status = body.get("status")
        if status != "completed":
            details = body.get("incomplete_details") or body.get("error") or {}
            reason = details.get("reason") if isinstance(details, dict) else None
            outcome = "content_filtered" if reason == "content_filter" else "incomplete"
            raise ProviderError(f"OpenAI response status {status}: {details}", retryable=False, outcome=outcome)
        usage = body.get("usage")
        if (
            not isinstance(usage, dict)
            or not isinstance(usage.get("input_tokens"), int)
            or not isinstance(usage.get("output_tokens"), int)
        ):
            raise ProviderError(
                "OpenAI response is missing required usage metadata", retryable=False, outcome="missing_usage"
            )
        input_details = usage.get("input_tokens_details") or {}
        output_details = usage.get("output_tokens_details") or {}
        texts: list[str] = []
        refusals: list[str] = []
        tools: list[dict[str, Any]] = []
        for item in body.get("output", []):
            if not isinstance(item, dict):
                continue
            item_type = item.get("type")
            if item_type == "web_search_call":
                tools.append({"name": "web", "type": "web_search", "id": item.get("id"), "status": item.get("status")})
            elif item_type == "function_call":
                tools.append(
                    {
                        "name": item.get("name"),
                        "type": "function",
                        "id": item.get("id"),
                        "arguments": item.get("arguments"),
                        "status": item.get("status"),
                    }
                )
            for content in item.get("content", []):
                if not isinstance(content, dict):
                    continue
                if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                    texts.append(content["text"])
                if content.get("type") == "refusal" and isinstance(content.get("refusal"), str):
                    refusals.append(content["refusal"])
        top_level_text = body.get("output_text")
        text: str = top_level_text if isinstance(top_level_text, str) else "\n".join(texts)
        refusal = "\n".join(refusals) or None
        if not text and refusal:
            text = refusal
        if not text and not tools:
            raise ProviderError(
                "OpenAI completed response contains no text or refusal", retryable=False, outcome="malformed_response"
            )
        return ProviderResponse(
            text=text,
            input_tokens=usage["input_tokens"],
            output_tokens=usage["output_tokens"],
            cached_input_tokens=_optional_int(input_details.get("cached_tokens")),
            reasoning_tokens=_optional_int(output_details.get("reasoning_tokens")),
            total_tokens=_optional_int(usage.get("total_tokens")),
            tool_calls=tools,
            metadata={"requested_model": requested_model},
            response_id=_optional_str(body.get("id")),
            actual_model=_optional_str(body.get("model")),
            status="completed",
            outcome="refused" if refusal else "completed",
            refusal=refusal,
            service_tier=_optional_str(body.get("service_tier")),
            provider_request_id=raw.headers.get("x-request-id"),
            created_at=_optional_int(body.get("created_at")),
            completed_at=_optional_int(body.get("completed_at")),
            request_duration_ms=raw.duration_ms,
        )

    async def invoke(self, request: ProviderRequest) -> ProviderResponse:
        raw = await self.send(request)
        return self.parse(raw, request.model)


def parse_retry_after(value: str | None, now: datetime | None = None) -> float | None:
    if not value:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        try:
            target = parsedate_to_datetime(value)
        except (TypeError, ValueError):
            return None
        current = now or datetime.now(UTC)
        return max(0.0, (target - current).total_seconds())


def _error_message(body: Any) -> str:
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            return error["message"][:1000]
    return str(body)[:1000]


def _optional_int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _optional_str(value: Any) -> str | None:
    return value if isinstance(value, str) else None
