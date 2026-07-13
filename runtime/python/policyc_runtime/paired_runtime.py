from __future__ import annotations

import asyncio
import json
import random
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Any

from .blind_grading import build_blind_packets
from .budget import BudgetExceeded, BudgetLedger
from .case_evaluator import evaluate_case
from .catalog import RunCatalog
from .experiment_models import BehavioralCase, LoadedPairedRun
from .hashing import stable_id
from .paired_report import build_paired_report
from .persistence import RunStore
from .pricing import load_pricing
from .providers import (
    AmbiguousProviderError,
    AsyncProvider,
    OpenAIResponsesProvider,
    ProviderError,
    ProviderRequest,
    ProviderResponse,
    RawProviderResponse,
)
from .rate_limit import RateLimiter


@dataclass(frozen=True, slots=True)
class PairedTrialSpec:
    trial_id: str
    case_id: str
    strategy: str
    sample_index: int
    dispatch_order_index: int
    case: BehavioralCase


class PairedExperimentRuntime:
    def __init__(self, loaded: LoadedPairedRun, provider: AsyncProvider) -> None:
        self.loaded = loaded
        self.provider = provider
        self.root = Path(loaded.runDirectory)
        self.store = RunStore(self.root)
        manifest = loaded.manifest
        registry = load_pricing(manifest.pricing.registryPath, manifest.pricing.registryVersion)
        self.price = registry.lookup(manifest.model)
        self.web_search_per_call = registry.web_search_per_call
        self.ledger = BudgetLedger(manifest.budget, self.price, self.web_search_per_call)
        self.rate_limiter = RateLimiter(manifest.rateLimit, manifest.maxConcurrency)
        self.catalog = RunCatalog()
        self.results: list[dict[str, Any]] = []

    async def run(self) -> dict[str, Any]:
        manifest = self.loaded.manifest
        self.store.write_json_atomic(self.root / "manifest.canonical.json", manifest.model_dump(mode="json"))
        self.catalog.register(manifest, Path(self.loaded.manifestPath), self.root)
        try:
            queue: asyncio.Queue[PairedTrialSpec | None] = asyncio.Queue()
            workers = [asyncio.create_task(self._worker(queue)) for _ in range(manifest.maxConcurrency)]
            for spec in self._specs():
                existing = await self._resume(spec)
                if existing is not None:
                    self.results.append(existing)
                    self.catalog.record_trial(existing)
                else:
                    await queue.put(spec)
            for _ in workers:
                await queue.put(None)
            await queue.join()
            await asyncio.gather(*workers)
            ordered = sorted(self.results, key=lambda item: item["trialId"])
            budget = self.ledger.snapshot()
            self.store.write_json_atomic(self.root / "budget.json", budget)
            report = build_paired_report(manifest, ordered, budget, self.price, self.web_search_per_call)
            report_path = self.root / "report.json"
            self.store.write_json_atomic(report_path, report)
            packets, answer_map = build_blind_packets(manifest, ordered)
            self.store.write_json_atomic(self.root / "blind" / "grading-packets.json", packets)
            self.store.write_json_atomic(self.root / "blind" / "answer-map.private.json", answer_map)
            failures = [
                {
                    "sourceDatasetVersion": manifest.dataset.version,
                    "caseId": item["caseId"],
                    "strategy": item["strategy"],
                    "sampleIndex": item["sampleIndex"],
                    "status": item["status"],
                    "evaluation": item.get("evaluation"),
                }
                for item in ordered
                if item["status"] != "completed" or not item["evaluation"]["passed"]
            ]
            self.store.write_json_atomic(self.root / "failures-development.json", failures)
            self.catalog.finalize(
                manifest.runId, status=_catalog_status(ordered), budget=budget, report_path=report_path
            )
            return report
        except BaseException as error:
            self.catalog.finalize(
                manifest.runId,
                status="failed",
                budget=self.ledger.snapshot(),
                stop_reason=f"{type(error).__name__}: {error}",
            )
            raise

    async def _worker(self, queue: asyncio.Queue[PairedTrialSpec | None]) -> None:
        while True:
            spec = await queue.get()
            try:
                if spec is None:
                    return
                result = await self._execute(spec)
                self.results.append(result)
                self.catalog.record_trial(result)
            finally:
                queue.task_done()

    async def _resume(self, spec: PairedTrialSpec) -> dict[str, Any] | None:
        trial_path = self.root / "trials" / f"{spec.trial_id}.json"
        failed_value: dict[str, Any] | None = None
        if trial_path.exists():
            value = json.loads(trial_path.read_text())
            if value.get("provenanceHashes") != self._provenance(spec):
                raise ValueError(f"resume provenance mismatch for {spec.trial_id}")
            attempts = int(value.get("attemptCount", 0))
            if value.get("status") == "completed" and value.get("responseOutcome") != "incomplete":
                await self.ledger.restore_completed(
                    value["inputTokens"],
                    value["outputTokens"],
                    value["costUsd"],
                    attempts,
                    value.get("builtInToolCalls", 0),
                    value.get("toolCostUsd", 0.0),
                )
                return value
            if value.get("status") == "ambiguous" and not self.loaded.manifest.retryPolicy.retryAmbiguous:
                await self.ledger.restore_ambiguous(value["ambiguousCostExposureUsd"], attempts)
                return value
            if value.get("status") == "failed":
                # A raw response can outlive finalization (for example, if
                # accounting or the process fails after persistence). Recover
                # it below before treating the provider attempt as failed.
                failed_value = value
        provider_path = self.root / "provider" / f"{spec.trial_id}.json"
        if provider_path.exists():
            record = json.loads(provider_path.read_text())
            response = _response_from_dict(record["response"])
            await self.ledger.restore_completed(
                response.input_tokens,
                response.output_tokens,
                record["costUsd"],
                record["attemptCount"],
                record.get("builtInToolCalls", 0),
                record.get("toolCostUsd", 0.0),
            )
            if response.status != "completed" or response.outcome == "incomplete":
                details = response.metadata.get("incomplete_details") or {}
                error = ProviderError(
                    f"OpenAI response status {response.status}: {details}",
                    retryable=False,
                    outcome=response.outcome,
                    partial_response=response,
                )
                result = self._partial_failure_result(
                    spec,
                    response,
                    record["attemptCount"],
                    error,
                    record["costUsd"],
                    record["latencyMs"],
                )
                self.store.write_json_atomic(trial_path, result)
                return result
            return self._finish_evaluation(
                spec, response, record["attemptCount"], record["costUsd"], record["latencyMs"]
            )
        raw_directory = self.root / "raw" / spec.trial_id
        raw_paths = sorted(raw_directory.glob("attempt-*.json")) if raw_directory.exists() else []
        if raw_paths:
            attempt = int(raw_paths[-1].stem.split("-")[-1])
            raw_value = json.loads(raw_paths[-1].read_text())
            if isinstance(self.provider, OpenAIResponsesProvider):
                raw = RawProviderResponse(
                    status_code=raw_value["statusCode"],
                    headers=raw_value["headers"],
                    body=raw_value["body"],
                    received_at=datetime.fromisoformat(raw_value["receivedAt"]),
                    duration_ms=raw_value["durationMs"],
                )
                try:
                    response = self.provider.parse(raw, self.loaded.manifest.model)
                except ProviderError as error:
                    if error.partial_response is None:
                        await self.ledger.restore_definitive_failure(attempt)
                        result = self._failed_result(spec, "failed", attempt, error)
                        self.store.write_json_atomic(self.root / "trials" / f"{spec.trial_id}.json", result)
                        return result
                    response = error.partial_response
                    cached = response.cached_input_tokens if response.cached_input_tokens is not None else 0
                    from .pricing import calculate_cost

                    built_in_tool_calls = _web_search_calls(response)
                    tool_cost = built_in_tool_calls * self.web_search_per_call
                    cost = calculate_cost(self.price, response.input_tokens, cached, response.output_tokens) + tool_cost
                    await self.ledger.restore_completed(
                        response.input_tokens,
                        response.output_tokens,
                        cost,
                        attempt,
                        built_in_tool_calls,
                        tool_cost,
                    )
                    record = {
                        "trialId": spec.trial_id,
                        "attemptCount": attempt,
                        "latencyMs": raw_value["durationMs"],
                        "costUsd": cost,
                        "builtInToolCalls": built_in_tool_calls,
                        "toolCostUsd": tool_cost,
                        "response": asdict(response),
                    }
                    self.store.write_json_atomic(provider_path, record)
                    result = self._partial_failure_result(spec, response, attempt, error, cost, raw_value["durationMs"])
                    self.store.write_json_atomic(self.root / "trials" / f"{spec.trial_id}.json", result)
                    return result
            else:
                response = _response_from_dict(raw_value["body"]["response"])
            cached = response.cached_input_tokens if response.cached_input_tokens is not None else 0
            from .pricing import calculate_cost

            built_in_tool_calls = _web_search_calls(response)
            tool_cost = built_in_tool_calls * self.web_search_per_call
            cost = calculate_cost(self.price, response.input_tokens, cached, response.output_tokens) + tool_cost
            await self.ledger.restore_completed(
                response.input_tokens,
                response.output_tokens,
                cost,
                attempt,
                built_in_tool_calls,
                tool_cost,
            )
            record = {
                "trialId": spec.trial_id,
                "attemptCount": attempt,
                "latencyMs": raw_value["durationMs"],
                "costUsd": cost,
                "builtInToolCalls": built_in_tool_calls,
                "toolCostUsd": tool_cost,
                "response": asdict(response),
            }
            self.store.write_json_atomic(provider_path, record)
            return self._finish_evaluation(spec, response, attempt, cost, raw_value["durationMs"])
        if failed_value is not None:
            attempts = int(failed_value.get("attemptCount", 0))
            if attempts:
                await self.ledger.restore_definitive_failure(attempts)
            return failed_value
        return None

    async def _execute(self, spec: PairedTrialSpec) -> dict[str, Any]:
        manifest = self.loaded.manifest
        artifact = self.loaded.artifacts[f"{spec.case_id}:{spec.strategy}"]
        output_cap = int(manifest.modelParameters["max_output_tokens"])
        previous_path = self.root / "trials" / f"{spec.trial_id}.json"
        previous = json.loads(previous_path.read_text()) if previous_path.exists() else {}
        start_attempt = int(previous.get("attemptCount", 0)) + 1
        for attempt in range(start_attempt, manifest.retryPolicy.maxAttempts + 1):
            try:
                estimated_input = artifact.tokenCount.tokens + manifest.inputTokenOverheadPerCall
                max_built_in_tool_calls = (
                    int(manifest.modelParameters.get("max_tool_calls", 0))
                    if any(item.type == "web_search" for item in spec.case.tools)
                    else 0
                )
                reservation = await self.ledger.reserve(
                    estimated_input, output_cap, spec.trial_id, max_built_in_tool_calls
                )
            except BudgetExceeded as error:
                result = self._failed_result(spec, "failed", attempt - 1, error)
                result["stopReason"] = "hard_budget_reached_before_attempt"
                self.store.write_json_atomic(self.root / "trials" / f"{spec.trial_id}.json", result)
                return result
            request = ProviderRequest(
                artifact=artifact,
                model=manifest.model,
                parameters=manifest.modelParameters,
                seed=None,
                tools=[item.provider_dict() for item in spec.case.tools],
                case_id=spec.case_id,
            )
            started = perf_counter()
            try:
                async with self.rate_limiter.limit(estimated_input):
                    response = await asyncio.wait_for(
                        self._call_and_persist_raw(request, spec, attempt), timeout=manifest.timeoutSeconds
                    )
                latency = (perf_counter() - started) * 1000
                cached = response.cached_input_tokens if response.cached_input_tokens is not None else 0
                cost = await self.ledger.complete(
                    reservation,
                    response.input_tokens,
                    cached,
                    response.output_tokens,
                    spec.trial_id,
                    _web_search_calls(response),
                )
                response.estimated_cost_usd = cost
                record = {
                    "trialId": spec.trial_id,
                    "attemptCount": attempt,
                    "latencyMs": latency,
                    "costUsd": cost,
                    "builtInToolCalls": _web_search_calls(response),
                    "toolCostUsd": _web_search_calls(response) * self.web_search_per_call,
                    "response": asdict(response),
                }
                self.store.write_json_atomic(self.root / "provider" / f"{spec.trial_id}.json", record)
                return self._finish_evaluation(spec, response, attempt, cost, latency)
            except (AmbiguousProviderError, TimeoutError) as error:
                await self.ledger.ambiguous(reservation, spec.trial_id)
                result = self._failed_result(spec, "ambiguous", attempt, error)
                result["ambiguousCostExposureUsd"] = reservation.cost_usd
                self.store.write_json_atomic(self.root / "trials" / f"{spec.trial_id}.json", result)
                if not manifest.retryPolicy.retryAmbiguous or attempt >= manifest.retryPolicy.maxAttempts:
                    return result
            except ProviderError as error:
                if error.partial_response is not None:
                    response = error.partial_response
                    cached = response.cached_input_tokens if response.cached_input_tokens is not None else 0
                    cost = await self.ledger.complete(
                        reservation,
                        response.input_tokens,
                        cached,
                        response.output_tokens,
                        spec.trial_id,
                        _web_search_calls(response),
                    )
                    response.estimated_cost_usd = cost
                    latency = response.request_duration_ms or (perf_counter() - started) * 1000
                    record = {
                        "trialId": spec.trial_id,
                        "attemptCount": attempt,
                        "latencyMs": latency,
                        "costUsd": cost,
                        "builtInToolCalls": _web_search_calls(response),
                        "toolCostUsd": _web_search_calls(response) * self.web_search_per_call,
                        "response": asdict(response),
                    }
                    self.store.write_json_atomic(self.root / "provider" / f"{spec.trial_id}.json", record)
                    result = self._partial_failure_result(spec, response, attempt, error, cost, latency)
                    self.store.write_json_atomic(self.root / "trials" / f"{spec.trial_id}.json", result)
                    return result
                await self.ledger.fail_definitive(reservation, spec.trial_id)
                if not error.retryable or attempt >= manifest.retryPolicy.maxAttempts:
                    result = self._failed_result(spec, "failed", attempt, error)
                    self.store.write_json_atomic(self.root / "trials" / f"{spec.trial_id}.json", result)
                    return result
                await asyncio.sleep(
                    _backoff(
                        manifest.retryPolicy.initialBackoffSeconds,
                        manifest.retryPolicy.maxBackoffSeconds,
                        manifest.retryPolicy.jitterFraction,
                        spec.trial_id,
                        attempt,
                        error.retry_after,
                    )
                )
            except BudgetExceeded as error:
                result = self._failed_result(spec, "failed", attempt, error)
                result["stopReason"] = "hard_budget_reached_after_usage"
                self.store.write_json_atomic(self.root / "trials" / f"{spec.trial_id}.json", result)
                return result
        raise RuntimeError(f"attempt loop exhausted for {spec.trial_id}")

    async def _call_and_persist_raw(
        self, request: ProviderRequest, spec: PairedTrialSpec, attempt: int
    ) -> ProviderResponse:
        if isinstance(self.provider, OpenAIResponsesProvider):
            raw = await self.provider.send(request)
            self.store.write_json_atomic(self.root / "raw" / spec.trial_id / f"attempt-{attempt}.json", _raw_dict(raw))
            return self.provider.parse(raw, request.model)
        response = await self.provider.invoke(request)
        raw = RawProviderResponse(
            status_code=200,
            headers={},
            body={"fake": True, "response": asdict(response)},
            received_at=datetime.now(UTC),
            duration_ms=response.request_duration_ms or 0.0,
        )
        self.store.write_json_atomic(self.root / "raw" / spec.trial_id / f"attempt-{attempt}.json", _raw_dict(raw))
        return response

    def _finish_evaluation(
        self, spec: PairedTrialSpec, response: ProviderResponse, attempt: int, cost: float, latency: float | None
    ) -> dict[str, Any]:
        evaluation = evaluate_case(spec.case, response)
        artifact = self.loaded.artifacts[f"{spec.case_id}:{spec.strategy}"]
        self.store.write_json_atomic(self.root / "evaluations" / f"{spec.trial_id}.json", evaluation)
        result = {
            "schemaVersion": "2.0.0",
            "runId": self.loaded.manifest.runId,
            "trialId": spec.trial_id,
            "caseId": spec.case_id,
            "strategy": spec.strategy,
            "sampleIndex": spec.sample_index,
            "dispatchOrderIndex": spec.dispatch_order_index,
            "status": "completed",
            "attemptCount": attempt,
            "provider": self.loaded.manifest.provider,
            "requestedModel": self.loaded.manifest.model,
            "actualModel": response.actual_model,
            "responseId": response.response_id,
            "providerRequestId": response.provider_request_id,
            "responseOutcome": response.outcome,
            "responseText": response.text,
            "refusal": response.refusal,
            "toolCalls": response.tool_calls,
            "inputTokens": response.input_tokens,
            "cachedInputTokens": response.cached_input_tokens,
            "outputTokens": response.output_tokens,
            "reasoningTokens": response.reasoning_tokens,
            "totalTokens": response.total_tokens,
            "latencyMs": latency,
            "costUsd": cost,
            "builtInToolCalls": _web_search_calls(response),
            "toolCostUsd": _web_search_calls(response) * self.web_search_per_call,
            "evaluation": evaluation,
            "structuralRetention": {
                "selectedPolicyIds": artifact.selectedPolicyIds,
                "criticalPolicyIds": artifact.criticalPolicyIds,
                "allArtifactCriticalPoliciesRetained": set(artifact.criticalPolicyIds)
                <= set(artifact.selectedPolicyIds),
            },
            "provenanceHashes": self._provenance(spec),
        }
        self.store.write_json_atomic(self.root / "trials" / f"{spec.trial_id}.json", result)
        return result

    def _failed_result(self, spec: PairedTrialSpec, status: str, attempt: int, error: Exception) -> dict[str, Any]:
        error_info: dict[str, Any] = {"type": type(error).__name__, "message": str(error)}
        if isinstance(error, ProviderError):
            error_info.update(
                {"outcome": error.outcome, "retryable": error.retryable, "retryAfterSeconds": error.retry_after}
            )
        return {
            "schemaVersion": "2.0.0",
            "runId": self.loaded.manifest.runId,
            "trialId": spec.trial_id,
            "caseId": spec.case_id,
            "strategy": spec.strategy,
            "sampleIndex": spec.sample_index,
            "dispatchOrderIndex": spec.dispatch_order_index,
            "status": status,
            "attemptCount": attempt,
            "error": error_info,
            "provenanceHashes": self._provenance(spec),
        }

    def _partial_failure_result(
        self,
        spec: PairedTrialSpec,
        response: ProviderResponse,
        attempt: int,
        error: ProviderError,
        cost: float,
        latency: float | None,
    ) -> dict[str, Any]:
        result = self._failed_result(spec, "failed", attempt, error)
        result.update(
            {
                "requestedModel": self.loaded.manifest.model,
                "actualModel": response.actual_model,
                "responseId": response.response_id,
                "providerRequestId": response.provider_request_id,
                "responseOutcome": response.outcome,
                "responseText": response.text,
                "refusal": response.refusal,
                "toolCalls": response.tool_calls,
                "inputTokens": response.input_tokens,
                "cachedInputTokens": response.cached_input_tokens,
                "outputTokens": response.output_tokens,
                "reasoningTokens": response.reasoning_tokens,
                "totalTokens": response.total_tokens,
                "latencyMs": latency,
                "costUsd": cost,
                "builtInToolCalls": _web_search_calls(response),
                "toolCostUsd": _web_search_calls(response) * self.web_search_per_call,
            }
        )
        return result

    def _provenance(self, spec: PairedTrialSpec) -> dict[str, str]:
        artifact = self.loaded.artifacts[f"{spec.case_id}:{spec.strategy}"]
        return {
            "compiledPromptHash": artifact.compiledPromptHash,
            "datasetHash": self.loaded.manifest.dataset.hash,
            "compilerHash": self.loaded.manifest.compilerHash,
        }

    def _specs(self) -> list[PairedTrialSpec]:
        manifest = self.loaded.manifest
        specs = []
        for case_index, plan in enumerate(manifest.casePlans):
            for sample in range(manifest.sampleCount):
                ordered_strategies = _ordered_strategies(manifest.strategies, case_index, sample)
                for order_index, strategy in enumerate(ordered_strategies):
                    artifact = self.loaded.artifacts[f"{plan.caseId}:{strategy}"]
                    trial_id = stable_id(
                        "trial",
                        {
                            "run": manifest.runId,
                            "case": plan.caseId,
                            "strategy": strategy,
                            "prompt": artifact.compiledPromptHash,
                            "model": manifest.model,
                            "parameters": manifest.modelParameters,
                            "evaluator": manifest.evaluator.model_dump(mode="json"),
                            "sample": sample,
                        },
                    )
                    specs.append(PairedTrialSpec(trial_id, plan.caseId, strategy, sample, order_index, plan.case))
        return specs


def spend_plan(loaded: LoadedPairedRun) -> dict[str, Any]:
    manifest = loaded.manifest
    registry = load_pricing(manifest.pricing.registryPath, manifest.pricing.registryVersion)
    price = registry.lookup(manifest.model)
    logical_trials = len(loaded.artifacts) * manifest.sampleCount
    logical_input = (
        sum(artifact.tokenCount.tokens for artifact in loaded.artifacts.values()) * manifest.sampleCount
        + logical_trials * manifest.inputTokenOverheadPerCall
    )
    input_by_strategy = {
        strategy: sum(
            artifact.tokenCount.tokens for key, artifact in loaded.artifacts.items() if key.endswith(f":{strategy}")
        )
        * manifest.sampleCount
        + len([key for key in loaded.artifacts if key.endswith(f":{strategy}")])
        * manifest.sampleCount
        * manifest.inputTokenOverheadPerCall
        for strategy in manifest.strategies
    }
    logical_output_cap = (
        len(loaded.artifacts) * manifest.sampleCount * int(manifest.modelParameters["max_output_tokens"])
    )
    from .pricing import calculate_cost

    maximum_built_in_tool_calls = (
        sum(any(tool.type == "web_search" for tool in plan.case.tools) for plan in manifest.casePlans)
        * len(manifest.strategies)
        * manifest.sampleCount
        * int(manifest.modelParameters.get("max_tool_calls", 0))
    )
    built_in_tool_cost_cap = maximum_built_in_tool_calls * registry.web_search_per_call
    logical_cost_cap = calculate_cost(price, logical_input, 0, logical_output_cap) + built_in_tool_cost_cap
    retry_factor = manifest.retryPolicy.maxAttempts
    return {
        "runId": manifest.runId,
        "provider": manifest.provider,
        "model": manifest.model,
        "logicalTrials": logical_trials,
        "maximumProviderCalls": logical_trials * retry_factor,
        "logicalInputTokens": logical_input,
        "inputTokensByStrategy": input_by_strategy,
        "inputTokenOverheadPerCall": manifest.inputTokenOverheadPerCall,
        "logicalOutputTokenCap": logical_output_cap,
        "estimatedMinimumCostUsd": calculate_cost(price, logical_input, 0, 0),
        "estimatedExpectedCostUsd": calculate_cost(price, logical_input, 0, logical_output_cap // 2)
        + built_in_tool_cost_cap,
        "expectedOutputCapUtilization": 0.5,
        "logicalCostCapUsd": logical_cost_cap,
        "maximumBuiltInToolCalls": maximum_built_in_tool_calls,
        "builtInToolCostCapUsd": built_in_tool_cost_cap,
        "retryWorstCaseCostUsd": logical_cost_cap * retry_factor,
        "configuredWorstCaseCostUsd": manifest.budget.maxCostUsd,
        "pricing": price.model_dump(mode="json"),
        "pricingRegistryVersion": manifest.pricing.registryVersion,
        "cachedInputAssumptionIncluded": False,
        "hardBudget": manifest.budget.model_dump(mode="json"),
        "requiresConfirmation": manifest.provider == "openai",
    }


def _web_search_calls(response: ProviderResponse) -> int:
    if response.built_in_tool_calls is not None:
        return response.built_in_tool_calls
    return sum(item.get("type") == "web_search" for item in response.tool_calls)


def _raw_dict(raw: RawProviderResponse) -> dict[str, Any]:
    return {
        "statusCode": raw.status_code,
        "headers": raw.headers,
        "body": raw.body,
        "receivedAt": raw.received_at.isoformat(),
        "durationMs": raw.duration_ms,
    }


def _response_from_dict(value: dict[str, Any]) -> ProviderResponse:
    return ProviderResponse(**value)


def _backoff(
    initial: float, maximum: float, jitter: float, trial_id: str, attempt: int, retry_after: float | None
) -> float:
    base = min(maximum, initial * (2 ** (attempt - 1)))
    result = max(0.0, base * (1 + random.Random(f"{trial_id}:{attempt}").uniform(-jitter, jitter)))
    return max(result, retry_after or 0.0)


def _catalog_status(results: list[dict[str, Any]]) -> str:
    statuses = {item["status"] for item in results}
    if statuses == {"completed"}:
        return "completed"
    if "completed" in statuses:
        return "completed_with_failures"
    if "ambiguous" in statuses:
        return "ambiguous"
    return "failed"


def _ordered_strategies(strategies: list[str], case_index: int, sample_index: int) -> list[str]:
    ordered = list(strategies)
    return ordered if (case_index + sample_index) % 2 == 0 else list(reversed(ordered))
