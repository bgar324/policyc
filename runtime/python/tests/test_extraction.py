"""The extraction runtime is the paid half of the extractor frontend. These tests
pin what a paid run relies on without a provider: the worst case is priced and
fails closed against the ceiling, a response that does not match the schema
never reaches the reads file, a re-run reads stored responses instead of
posting again, and the budget ledger is cumulative across resumes."""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from policyc_runtime.extraction import (
    ExtractionRuntime,
    FakeExtractor,
    build_payload,
    load_plan,
    spend_plan,
)
from policyc_runtime.pricing import load_pricing
from policyc_runtime.providers.base import RawProviderResponse

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "authorization",
        "limit",
        "purpose",
        "permittedTask",
        "format",
        "operationNamed",
        "operationNegated",
        "fields",
        "evidence",
    ],
    "properties": {
        "authorization": {"enum": ["present", "reported", "conditional", "absent"]},
        "limit": {"enum": ["limited", "ambiguous", "none"]},
        "purpose": {"enum": ["sensitive_attribute_read", "identification", "none"]},
        "permittedTask": {"type": "boolean"},
        "format": {"enum": ["requested", "none"]},
        "operationNamed": {"type": "boolean"},
        "operationNegated": {"type": "boolean"},
        "fields": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "stated"],
                "properties": {"name": {"type": "string"}, "stated": {"type": "boolean"}},
            },
        },
        "evidence": {"type": "array", "items": {"type": "string"}},
    },
}


INPUT = "\n".join(
    [
        "Request:",
        "send it",
        "",
        "Declared context:",
        "- required fields for this operation: ",
        "  - recipient: an address",
        "  - body: what it says",
    ]
)


def _plan(tmp_path: Path, *, max_cost: float, items: int = 2, max_output: int = 256) -> Path:
    plan = {
        "schemaVersion": "1.0.0",
        "kind": "request-state-extraction",
        "planId": "ext_test",
        "createdAt": "2026-01-01T00:00:00.000Z",
        "sourceControl": {"system": "git", "commit": "0" * 40, "dirty": False},
        "frontendId": "extractor:test",
        "promptPath": "prompts/request-state-extractor.md",
        "promptSha256": "a" * 64,
        "readContractSha256": "c" * 64,
        "source": {"kind": "cases", "path": "x.jsonl", "hash": "b" * 64, "count": items},
        "provider": "openai",
        "model": "gpt-5-mini-2025-08-07",
        "modelParameters": {"max_output_tokens": max_output, "store": False},
        "responseSchema": SCHEMA,
        "instructions": "read the request",
        "items": [
            {
                "key": f"case-{index}",
                "input": INPUT,
                "requiredFields": ["recipient", "body"],
                "estimatedInputTokens": 1000,
            }
            for index in range(items)
        ],
        "maxConcurrency": 2,
        "budget": {"maxCalls": items, "maxCostUsd": max_cost},
        "pricing": {"registryPath": str(ROOT / "pricing" / "openai-v2.json"), "registryVersion": "openai-2026-07-12"},
        "outputDirectory": ".",
        "rawResponseRetention": "full",
    }
    path = tmp_path / "extraction-plan.json"
    path.write_text(json.dumps(plan))
    return path


def _response(text: str, *, refusal: str | None = None) -> RawProviderResponse:
    content: list[dict[str, str]] = [{"type": "output_text", "text": text}]
    if refusal:
        content = [{"type": "refusal", "refusal": refusal}]
    body = {
        "id": "resp_1",
        "status": "completed",
        "model": "gpt-5-mini-2025-08-07",
        "output": [{"type": "message", "content": content}],
        "usage": {"input_tokens": 900, "output_tokens": 80, "input_tokens_details": {"cached_tokens": 0}},
    }
    return RawProviderResponse(status_code=200, headers={}, body=body, received_at=datetime.now(UTC), duration_ms=5.0)


class ScriptedProvider:
    def __init__(self, texts: list[str], *, refusal: str | None = None) -> None:
        self.texts = texts
        self.refusal = refusal
        self.posts: list[dict[str, Any]] = []

    async def post(self, payload: dict[str, Any]) -> RawProviderResponse:
        self.posts.append(payload)
        return _response(self.texts[len(self.posts) - 1], refusal=self.refusal)


VALID = json.dumps(
    {
        "authorization": "present",
        "limit": "none",
        "purpose": "none",
        "permittedTask": False,
        "format": "none",
        "operationNamed": True,
        "operationNegated": False,
        "fields": [
            {"name": "recipient", "stated": True},
            {"name": "body", "stated": False},
            {"name": "tone", "stated": True},
        ],
        "evidence": ['authorization present: "send it"'],
    }
)


def _price() -> Any:
    return load_pricing(str(ROOT / "pricing" / "openai-v2.json"), "openai-2026-07-12").lookup("gpt-5-mini-2025-08-07")


def test_worst_case_is_priced_from_the_plan_and_the_payload_is_strict(tmp_path: Path) -> None:
    plan = load_plan(_plan(tmp_path, max_cost=1.0))
    spend = spend_plan(plan, _price())
    assert spend["calls"] == 2
    price = _price()
    expected = 2 * (1000 * price.inputPerMillion + 256 * price.outputPerMillion) / 1_000_000
    assert spend["worstCaseCostUsd"] == pytest.approx(expected)
    payload = build_payload(plan, plan.items[0])
    assert payload["text"]["format"] == {
        "type": "json_schema",
        "name": "request_state_read",
        "strict": True,
        "schema": SCHEMA,
    }
    assert payload["store"] is False and payload["max_output_tokens"] == 256


def test_reads_keep_only_schema_valid_responses_and_only_the_given_fields(tmp_path: Path) -> None:
    path = _plan(tmp_path, max_cost=1.0)
    plan = load_plan(path)
    provider = ScriptedProvider([VALID, json.dumps({"authorization": "maybe"})])
    report = asyncio.run(ExtractionRuntime(plan, path, provider, _price()).run())
    assert report["outcomes"] == {"completed": 1, "invalid": 1}
    reads = json.loads((tmp_path / "reads.json").read_text())
    assert reads["frontendId"] == "extractor:test"
    assert set(reads["reads"]) == {"case-0"}
    read = reads["reads"]["case-0"]
    assert read["fields"] == {"recipient": True, "body": False}, "a field the plan did not ask for is dropped"
    assert read["authorization"] == "present" and read["evidence"]
    assert len(list((tmp_path / "raw").iterdir())) == 2, "every raw response is kept, valid or not"
    budget = json.loads((tmp_path / "budget.json").read_text())
    assert budget["calls"] == 2 and budget["actualCostUsd"] > 0


def test_rerun_reads_stored_responses_and_posts_nothing(tmp_path: Path) -> None:
    path = _plan(tmp_path, max_cost=1.0)
    plan = load_plan(path)
    first = ScriptedProvider([VALID, VALID])
    asyncio.run(ExtractionRuntime(plan, path, first, _price()).run())
    before = json.loads((tmp_path / "budget.json").read_text())
    second = ScriptedProvider([])
    report = asyncio.run(ExtractionRuntime(plan, path, second, _price()).run())
    assert second.posts == []
    assert report["outcomes"] == {"completed": 2}
    after = json.loads((tmp_path / "budget.json").read_text())
    assert after["calls"] == before["calls"] == 2
    assert after["actualCostUsd"] == before["actualCostUsd"]
    assert all(item["resumed"] for item in json.loads((tmp_path / "report.json").read_text())["items"].values())


def test_ceiling_stops_calls_before_they_are_made(tmp_path: Path) -> None:
    price = _price()
    one_call = (1000 * price.inputPerMillion + 256 * price.outputPerMillion) / 1_000_000
    path = _plan(tmp_path, max_cost=one_call * 1.5)
    plan = load_plan(path)
    plan = plan.model_copy(update={"maxConcurrency": 1})
    provider = ScriptedProvider([VALID, VALID])
    report = asyncio.run(ExtractionRuntime(plan, path, provider, price).run())
    assert len(provider.posts) == 1
    assert report["outcomes"] == {"budget_exceeded": 1, "completed": 1}


def test_refusal_is_a_failure_not_a_read(tmp_path: Path) -> None:
    path = _plan(tmp_path, max_cost=1.0, items=1)
    plan = load_plan(path)
    provider = ScriptedProvider(["ignored"], refusal="I cannot help with that")
    report = asyncio.run(ExtractionRuntime(plan, path, provider, _price()).run())
    assert report["outcomes"] == {"failed": 1}
    assert json.loads((tmp_path / "reads.json").read_text())["reads"] == {}


def test_fake_extractor_answers_in_the_response_shape(tmp_path: Path) -> None:
    path = _plan(tmp_path, max_cost=1.0, items=1)
    plan = load_plan(path)
    report = asyncio.run(ExtractionRuntime(plan, path, FakeExtractor(), _price()).run())
    assert report["outcomes"] == {"completed": 1}
    read = json.loads((tmp_path / "reads.json").read_text())["reads"]["case-0"]
    assert read["authorization"] == "absent" and read["fields"] == {"recipient": False, "body": False}


class RejectingThenValidProvider:
    def __init__(self) -> None:
        self.posts = 0

    async def post(self, payload: dict[str, Any]) -> RawProviderResponse:
        self.posts += 1
        if self.posts == 1:
            body = {"error": {"code": "insufficient_quota", "message": "no credit"}}
            return RawProviderResponse(
                status_code=429, headers={}, body=body, received_at=datetime.now(UTC), duration_ms=1.0
            )
        return _response(VALID)


def test_http_errors_are_kept_but_retried_on_the_next_run(tmp_path: Path) -> None:
    path = _plan(tmp_path, max_cost=1.0, items=1)
    plan = load_plan(path)
    provider = RejectingThenValidProvider()
    first = asyncio.run(ExtractionRuntime(plan, path, provider, _price()).run())
    assert first["outcomes"] == {"failed": 1}
    assert len(list((tmp_path / "errors").iterdir())) == 1
    assert not (tmp_path / "raw").exists() or not list((tmp_path / "raw").iterdir())
    second = asyncio.run(ExtractionRuntime(plan, path, provider, _price()).run())
    assert provider.posts == 2
    assert second["outcomes"] == {"completed": 1}
