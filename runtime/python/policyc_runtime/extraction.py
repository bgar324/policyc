"""Request-state extraction: the paid half of the extractor frontend.

TypeScript plans what is read (`policyc extract` writes `extraction-plan.json`
with the instructions, the response schema, and one input block per request);
this module makes the calls. It follows the same rules as a paired run: the
worst case is priced before anything is sent and must fit the ceiling, a paid
run needs the typed `RUN <planId>` confirmation, every raw response is kept,
a re-run of the same plan makes no new calls for requests already read, and
the reads file only ever contains responses that matched the schema. Nothing
here knows what the facts mean; the compiler validates the file again at its
own boundary when a run loads it.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import jsonschema
from pydantic import Field

from .hashing import canonical_json
from .models import StrictModel
from .pricing import ModelPrice, calculate_cost, load_pricing
from .providers import OpenAIResponsesProvider
from .providers.base import ProviderError, ProviderResponse, RawProviderResponse


class ExtractionItem(StrictModel):
    key: str = Field(min_length=1)
    input: str = Field(min_length=1)
    requiredFields: list[str]
    estimatedInputTokens: int = Field(ge=1)


class ExtractionBudget(StrictModel):
    maxCalls: int = Field(ge=1)
    maxCostUsd: float = Field(gt=0)


class ExtractionSource(StrictModel):
    kind: Literal["cases", "fixtures"]
    path: str
    hash: str
    count: int = Field(ge=1)


class ExtractionPlan(StrictModel):
    schemaVersion: Literal["1.0.0"]
    kind: Literal["request-state-extraction"]
    planId: str
    label: str | None = None
    createdAt: str
    sourceControl: dict[str, Any]
    frontendId: str = Field(min_length=1)
    promptPath: str
    promptSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    source: ExtractionSource
    provider: Literal["fake", "openai"]
    model: str = Field(min_length=1)
    modelParameters: dict[str, Any]
    responseSchema: dict[str, Any]
    instructions: str = Field(min_length=1)
    items: list[ExtractionItem] = Field(min_length=1)
    maxConcurrency: int = Field(ge=1)
    budget: ExtractionBudget
    pricing: dict[str, str]
    outputDirectory: str
    rawResponseRetention: Literal["full"]


def load_plan(path: Path) -> ExtractionPlan:
    return ExtractionPlan.model_validate(json.loads(path.read_text()))


def spend_plan(plan: ExtractionPlan, price: ModelPrice) -> dict[str, Any]:
    max_output = int(plan.modelParameters["max_output_tokens"])
    input_tokens = sum(item.estimatedInputTokens for item in plan.items)
    worst_case = sum(calculate_cost(price, item.estimatedInputTokens, 0, max_output) for item in plan.items)
    return {
        "planId": plan.planId,
        "frontendId": plan.frontendId,
        "calls": len(plan.items),
        "maximumProviderCalls": plan.budget.maxCalls,
        "estimatedInputTokens": input_tokens,
        "outputTokenCapPerCall": max_output,
        "worstCaseCostUsd": round(worst_case, 8),
        "maxCostUsd": plan.budget.maxCostUsd,
    }


def build_payload(plan: ExtractionPlan, item: ExtractionItem) -> dict[str, Any]:
    return {
        "model": plan.model,
        "instructions": plan.instructions,
        "input": item.input,
        **plan.modelParameters,
        "store": False,
        "text": {
            "format": {
                "type": "json_schema",
                "name": "request_state_read",
                "strict": True,
                "schema": plan.responseSchema,
            }
        },
    }


class FakeExtractor:
    """Offline stand-in: answers every request with the conservative read, in the response shape."""

    name = "fake"

    async def post(self, payload: dict[str, Any]) -> RawProviderResponse:
        await asyncio.sleep(0.01)
        names = _required_field_names(payload["input"])
        read = {
            "authorization": "absent",
            "limit": "none",
            "purpose": "none",
            "permittedTask": False,
            "format": "none",
            "operationNamed": False,
            "operationNegated": False,
            "fields": [{"name": name, "stated": False} for name in names],
            "evidence": ["fake extractor: conservative read"],
        }
        body = {
            "id": "resp_fake",
            "status": "completed",
            "model": payload["model"],
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": json.dumps(read)}],
                }
            ],
            "usage": {"input_tokens": 100, "output_tokens": 60, "input_tokens_details": {"cached_tokens": 0}},
        }
        return RawProviderResponse(
            status_code=200, headers={}, body=body, received_at=datetime.now(UTC), duration_ms=1.0
        )


def _required_field_names(input_block: str) -> list[str]:
    for line in input_block.splitlines():
        if line.startswith("- required fields for this operation: "):
            value = line.split(": ", 1)[1]
            return [] if value == "none" else [name.strip() for name in value.split(",")]
    return []


class ExtractionRuntime:
    def __init__(self, plan: ExtractionPlan, plan_path: Path, provider: Any, price: ModelPrice) -> None:
        self.plan = plan
        self.root = plan_path.parent
        self.provider = provider
        self.price = price
        self.raw_dir = self.root / "raw"
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.max_output = int(plan.modelParameters["max_output_tokens"])
        self.lock = asyncio.Lock()
        # Parses stored and fresh responses alike; never sends.
        self.parser = OpenAIResponsesProvider(api_key="parse-only")
        self.calls = 0
        self.actual_cost = 0.0
        self.in_flight_worst_case = 0.0
        self.results: dict[str, dict[str, Any]] = {}

    async def run(self) -> dict[str, Any]:
        started = datetime.now(UTC).isoformat()
        semaphore = asyncio.Semaphore(self.plan.maxConcurrency)

        async def one(item: ExtractionItem) -> None:
            async with semaphore:
                self.results[item.key] = await self._extract(item)

        await asyncio.gather(*(one(item) for item in self.plan.items))
        finished = datetime.now(UTC).isoformat()
        reads = {key: result["read"] for key, result in self.results.items() if result["status"] == "completed"}
        reads_file = {"frontendId": self.plan.frontendId, "reads": reads}
        (self.root / "reads.json").write_text(canonical_json(reads_file) + "\n")
        report = {
            "planId": self.plan.planId,
            "frontendId": self.plan.frontendId,
            "startedAt": started,
            "finishedAt": finished,
            "items": {key: {k: v for k, v in result.items() if k != "read"} for key, result in self.results.items()},
            "outcomes": _count(result["status"] for result in self.results.values()),
        }
        (self.root / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
        budget = {
            "calls": self.calls,
            "maximumProviderCalls": self.plan.budget.maxCalls,
            "actualCostUsd": round(self.actual_cost, 8),
            "maxCostUsd": self.plan.budget.maxCostUsd,
            "actualInputTokens": sum(r.get("inputTokens", 0) for r in self.results.values()),
            "actualCachedInputTokens": sum(r.get("cachedInputTokens", 0) for r in self.results.values()),
            "actualOutputTokens": sum(r.get("outputTokens", 0) for r in self.results.values()),
            "readsWritten": len(reads),
        }
        (self.root / "budget.json").write_text(json.dumps(budget, indent=2, sort_keys=True) + "\n")
        return {"outcomes": report["outcomes"], "budget": budget, "readsPath": str(self.root / "reads.json")}

    async def _extract(self, item: ExtractionItem) -> dict[str, Any]:
        raw_path = self.raw_dir / f"{_safe(item.key)}.json"
        if raw_path.exists():
            stored = json.loads(raw_path.read_text())
            raw = RawProviderResponse(
                status_code=stored["statusCode"],
                headers=stored["headers"],
                body=stored["body"],
                received_at=datetime.fromisoformat(stored["receivedAt"]),
                duration_ms=stored["durationMs"],
            )
            result = self._settle(item, raw, resumed=True)
            async with self.lock:
                self.calls += 1
                self.actual_cost += result.get("costUsd", 0.0)
            return result
        worst_case = calculate_cost(self.price, item.estimatedInputTokens, 0, self.max_output)
        async with self.lock:
            committed = self.actual_cost + self.in_flight_worst_case + worst_case
            if self.calls >= self.plan.budget.maxCalls or committed > self.plan.budget.maxCostUsd:
                return {
                    "status": "budget_exceeded",
                    "error": "the remaining ceiling cannot cover this call's worst case",
                }
            self.calls += 1
            self.in_flight_worst_case += worst_case
        try:
            raw = await self.provider.post(build_payload(self.plan, item))
        except ProviderError as error:
            async with self.lock:
                self.in_flight_worst_case -= worst_case
            return {"status": "failed", "error": {"type": error.outcome, "message": str(error)}}
        raw_path.write_text(
            json.dumps(
                {
                    "key": item.key,
                    "statusCode": raw.status_code,
                    "headers": raw.headers,
                    "body": raw.body,
                    "receivedAt": raw.received_at.isoformat(),
                    "durationMs": raw.duration_ms,
                },
                indent=2,
                sort_keys=True,
            )
            + "\n"
        )
        result = self._settle(item, raw, resumed=False)
        async with self.lock:
            self.in_flight_worst_case -= worst_case
            self.actual_cost += result.get("costUsd", 0.0)
        return result

    def _settle(self, item: ExtractionItem, raw: RawProviderResponse, *, resumed: bool) -> dict[str, Any]:
        base: dict[str, Any] = {"resumed": resumed}
        try:
            response = self._parse(raw)
        except ProviderError as error:
            partial = error.partial_response
            usage = self._usage(partial) if partial is not None else {}
            return {**base, **usage, "status": "failed", "error": {"type": error.outcome, "message": str(error)}}
        usage = self._usage(response)
        try:
            parsed = json.loads(response.text)
            jsonschema.validate(parsed, self.plan.responseSchema)
        except (json.JSONDecodeError, jsonschema.ValidationError) as error:
            return {**base, **usage, "status": "invalid", "error": {"type": "schema", "message": str(error)[:300]}}
        given = set(item.requiredFields)
        fields = {entry["name"]: entry["stated"] for entry in parsed["fields"] if entry["name"] in given}
        read = {key: value for key, value in parsed.items() if key != "fields"}
        read["fields"] = fields
        return {**base, **usage, "status": "completed", "read": read}

    def _parse(self, raw: RawProviderResponse) -> ProviderResponse:
        response = self.parser.parse(raw, self.plan.model)
        if response.refusal:
            raise ProviderError("extractor refused", retryable=False, outcome="refused", partial_response=response)
        return response

    def _usage(self, response: ProviderResponse) -> dict[str, Any]:
        return {
            "costUsd": round(
                calculate_cost(
                    self.price, response.input_tokens, response.cached_input_tokens or 0, response.output_tokens
                ),
                8,
            ),
            "inputTokens": response.input_tokens,
            "cachedInputTokens": response.cached_input_tokens or 0,
            "outputTokens": response.output_tokens,
            "reasoningTokens": response.reasoning_tokens,
            "responseId": response.response_id,
            "actualModel": response.actual_model,
            "requestDurationMs": response.request_duration_ms,
        }


def _count(values: Any) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return dict(sorted(counts.items()))


def _safe(key: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in key)


async def run_extraction(path: Path, *, dry_run: bool, yes: bool) -> None:
    plan = load_plan(path)
    registry = load_pricing(plan.pricing["registryPath"], plan.pricing["registryVersion"])
    price = registry.lookup(plan.model)
    spend = spend_plan(plan, price)
    print(json.dumps({"spendPlan": spend}, indent=2, sort_keys=True))
    if spend["worstCaseCostUsd"] > plan.budget.maxCostUsd:
        raise ValueError("planned worst-case extraction cost exceeds the hard budget")
    if plan.provider == "openai":
        for item in plan.items:
            build_payload(plan, item)
    if dry_run:
        print(f"Paid command: policyc-runtime extract {path} --yes")
        return
    if plan.provider == "openai" and not yes:
        expected = f"RUN {plan.planId}"
        authorization = await asyncio.to_thread(input, f"Type {expected} to authorize paid API calls: ")
        if authorization.strip() != expected:
            raise SystemExit("paid extraction not authorized")
    provider: Any = FakeExtractor() if plan.provider == "fake" else OpenAIResponsesProvider()
    runtime = ExtractionRuntime(plan, path, provider, price)
    report = await runtime.run()
    print(json.dumps(report, indent=2, sort_keys=True))
