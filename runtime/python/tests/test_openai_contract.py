from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from email.utils import format_datetime

import httpx
import pytest

from policyc_runtime.manifest import load_run
from policyc_runtime.providers import AmbiguousProviderError, ProviderError, ProviderRequest
from policyc_runtime.providers.openai import OpenAIResponsesProvider, parse_retry_after

from .conftest import write_run


def request(tmp_path, **parameters):  # type: ignore[no-untyped-def]
    path, _ = write_run(tmp_path, candidates=1, samples=1)
    artifact = load_run(path).artifacts[0]
    return ProviderRequest(
        artifact=artifact,
        model="gpt-5-mini-2025-08-07",
        parameters={"max_output_tokens": 256, "store": False, **parameters},
        seed=None,
        tools=[{"type": "web_search"}],
        case_id="case-1",
    )


def response_body(**overrides):  # type: ignore[no-untyped-def]
    base = {
        "id": "resp_test",
        "model": "gpt-5-mini-2025-08-07",
        "status": "completed",
        "created_at": 1,
        "completed_at": 2,
        "service_tier": "default",
        "output": [{"type": "message", "content": [{"type": "output_text", "text": "answer [1]"}]}],
        "usage": {
            "input_tokens": 100,
            "input_tokens_details": {"cached_tokens": 40},
            "output_tokens": 20,
            "output_tokens_details": {"reasoning_tokens": 5},
            "total_tokens": 120,
        },
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_request_contract_and_detailed_response(tmp_path) -> None:
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(json.loads(request.content))
        return httpx.Response(200, json=response_body(model="returned-snapshot"), headers={"x-request-id": "req_123"})

    provider = OpenAIResponsesProvider(api_key="secret-not-persisted", transport=httpx.MockTransport(handler))
    result = await provider.invoke(request(tmp_path))
    assert set(seen) == {"model", "instructions", "input", "max_output_tokens", "store", "tools"}
    assert "seed" not in seen and "secret-not-persisted" not in json.dumps(seen)
    assert result.cached_input_tokens == 40
    assert result.reasoning_tokens == 5
    assert result.total_tokens == 120
    assert result.actual_model == "returned-snapshot"
    assert result.provider_request_id == "req_123"


def test_unsupported_parameter_and_missing_key(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(ValueError, match="OPENAI_API_KEY"):
        OpenAIResponsesProvider()
    provider = OpenAIResponsesProvider(api_key="test")
    with pytest.raises(ValueError, match="unsupported"):
        provider.build_payload(request(tmp_path, seed=7))


@pytest.mark.parametrize(
    ("body", "outcome"),
    [
        (
            {**response_body(), "status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"}},
            "incomplete",
        ),
        (
            {**response_body(), "status": "incomplete", "incomplete_details": {"reason": "content_filter"}},
            "content_filtered",
        ),
        ({**response_body(), "usage": None}, "missing_usage"),
        ({**response_body(), "output": []}, "malformed_response"),
    ],
)
@pytest.mark.asyncio
async def test_non_success_outcomes(tmp_path, body, outcome) -> None:  # type: ignore[no-untyped-def]
    provider = OpenAIResponsesProvider(
        api_key="test", transport=httpx.MockTransport(lambda _: httpx.Response(200, json=body))
    )
    with pytest.raises(ProviderError) as caught:
        await provider.invoke(request(tmp_path))
    assert caught.value.outcome == outcome


@pytest.mark.asyncio
async def test_refusal_and_tool_normalization(tmp_path) -> None:
    body = response_body(
        output=[
            {"type": "web_search_call", "id": "web_1", "status": "completed"},
            {"type": "function_call", "id": "fn_1", "name": "lookup", "arguments": "{}"},
            {"type": "message", "content": [{"type": "refusal", "refusal": "I cannot help."}]},
        ]
    )
    provider = OpenAIResponsesProvider(
        api_key="test", transport=httpx.MockTransport(lambda _: httpx.Response(200, json=body))
    )
    result = await provider.invoke(request(tmp_path))
    assert result.outcome == "refused" and result.refusal == "I cannot help."
    assert [call["name"] for call in result.tool_calls] == ["web", "lookup"]


@pytest.mark.parametrize("status,retryable", [(429, True), (500, True), (400, False)])
@pytest.mark.asyncio
async def test_http_errors(tmp_path, status: int, retryable: bool) -> None:
    provider = OpenAIResponsesProvider(
        api_key="test",
        transport=httpx.MockTransport(
            lambda _: httpx.Response(status, json={"error": {"message": "nope"}}, headers={"retry-after": "2"})
        ),
    )
    with pytest.raises(ProviderError) as caught:
        await provider.invoke(request(tmp_path))
    assert caught.value.retryable is retryable
    assert caught.value.retry_after == 2


def test_retry_after_http_date() -> None:
    now = datetime.now(UTC).replace(microsecond=0)
    assert parse_retry_after(format_datetime(now + timedelta(seconds=5)), now) == 5


@pytest.mark.asyncio
async def test_malformed_json_and_transport_ambiguity(tmp_path) -> None:
    malformed = OpenAIResponsesProvider(
        api_key="test", transport=httpx.MockTransport(lambda _: httpx.Response(200, text="not-json"))
    )
    with pytest.raises(ProviderError, match="malformed JSON"):
        await malformed.invoke(request(tmp_path / "malformed"))

    def fail(_: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("uncertain")

    ambiguous = OpenAIResponsesProvider(api_key="test", transport=httpx.MockTransport(fail))
    with pytest.raises(AmbiguousProviderError):
        await ambiguous.invoke(request(tmp_path / "ambiguous"))

    def disconnect(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("disconnected")

    transport = OpenAIResponsesProvider(api_key="test", transport=httpx.MockTransport(disconnect))
    with pytest.raises(AmbiguousProviderError):
        await transport.invoke(request(tmp_path / "transport"))
