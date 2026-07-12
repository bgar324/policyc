from __future__ import annotations

import asyncio
import platform
import random
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from time import perf_counter
from typing import Any

from .evaluator import RuleBasedEvaluator
from .events import EventBus
from .hashing import canonical_json, sha256, stable_id
from .models import CompiledArtifact, ErrorInfo, LoadedRun, RunStatus, TrialResult, TrialStatus
from .persistence import RunStore
from .providers import AsyncProvider, ProviderError, ProviderRequest
from .rate_limit import RateLimiter
from .report import build_report
from .state import transition, transition_run


@dataclass(frozen=True, slots=True)
class TrialSpec:
    trial_id: str
    artifact: CompiledArtifact
    sample_index: int


class ExperimentRuntime:
    def __init__(self, loaded: LoadedRun, provider: AsyncProvider) -> None:
        self.loaded = loaded
        self.provider = provider
        self.store = RunStore(loaded.runDirectory)
        self.events = EventBus(loaded.manifest.runId, loaded.runDirectory / "events.jsonl")
        self.evaluator = RuleBasedEvaluator()
        self.rate_limiter = RateLimiter(loaded.manifest.rateLimit, loaded.manifest.maxConcurrency)
        self._cancel = asyncio.Event()
        self._workers: list[asyncio.Task[None]] = []
        self._queue: asyncio.Queue[TrialSpec | None] | None = None
        self._active_calls: set[asyncio.Task[Any]] = set()
        self.status = RunStatus.CREATED
        self.results: list[TrialResult] = []

    async def run(self) -> dict[str, Any]:
        manifest = self.loaded.manifest
        self._write_reproducibility_metadata()
        await self.events.publish("run.created", payload={"experimentName": manifest.experimentName})
        self.status = transition_run(self.status, RunStatus.RUNNING)
        await self.events.publish("run.started", payload={"trials": len(self.loaded.artifacts) * manifest.sampleCount})
        queue: asyncio.Queue[TrialSpec | None] = asyncio.Queue(maxsize=max(1, manifest.maxConcurrency * 2))
        self._queue = queue
        self._workers = [
            asyncio.create_task(self._worker(queue), name=f"policyc-worker-{index}")
            for index in range(manifest.maxConcurrency)
        ]
        try:
            for spec in self._trial_specs():
                if self._cancel.is_set():
                    break
                completed = self.store.load_completed(spec.trial_id, spec.artifact.compiledPromptHash)
                if completed:
                    self.results.append(completed)
                    await self.events.publish(
                        "trial.completed",
                        trial_id=spec.trial_id,
                        candidate_id=spec.artifact.candidateId,
                        payload={"resumed": True},
                    )
                    continue
                await self.events.publish(
                    "trial.queued",
                    trial_id=spec.trial_id,
                    candidate_id=spec.artifact.candidateId,
                    payload={"sampleIndex": spec.sample_index},
                )
                await queue.put(spec)
            for _ in self._workers:
                await queue.put(None)
            await queue.join()
            await asyncio.gather(*self._workers)
            if self._cancel.is_set():
                self.status = transition_run(self.status, RunStatus.CANCELLED)
                await self.events.publish("run.cancelled", payload={"completed": len(self.results)})
            else:
                report = build_report(
                    manifest, self.loaded.artifacts, sorted(self.results, key=lambda item: item.trialId)
                )
                self.store.write_report(report)
                self.status = transition_run(self.status, RunStatus.COMPLETED)
                await self.events.publish(
                    "run.completed", payload={"completed": len(self.results), "report": "report.json"}
                )
                return report
        except asyncio.CancelledError:
            await self.cancel()
            raise
        except Exception as error:
            self.status = transition_run(self.status, RunStatus.FAILED)
            await self.events.publish("run.failed", payload={"type": type(error).__name__, "message": str(error)})
            raise
        finally:
            await self.events.close()
        return {"runId": manifest.runId, "status": self.status}

    async def cancel(self) -> None:
        self._cancel.set()
        for call in tuple(self._active_calls):
            call.cancel()

    async def _worker(self, queue: asyncio.Queue[TrialSpec | None]) -> None:
        while True:
            spec = await queue.get()
            try:
                if spec is None:
                    return
                if self._cancel.is_set():
                    result = self._new_result(spec, TrialStatus.CANCELLED)
                    self.store.write_trial(result)
                    self.results.append(result)
                    await self.events.publish(
                        "trial.cancelled", trial_id=spec.trial_id, candidate_id=spec.artifact.candidateId
                    )
                else:
                    self.results.append(await self._execute(spec))
            finally:
                queue.task_done()

    async def _execute(self, spec: TrialSpec) -> TrialResult:
        manifest = self.loaded.manifest
        result = self._new_result(spec, TrialStatus.QUEUED)
        for attempt in range(1, manifest.retryPolicy.maxAttempts + 1):
            result.status = transition(result.status, TrialStatus.RUNNING)
            result.attemptCount = attempt
            result.startedAt = datetime.now(UTC)
            self.store.write_trial(result)
            await self.events.publish(
                "trial.started",
                trial_id=spec.trial_id,
                candidate_id=spec.artifact.candidateId,
                payload={"attempt": attempt},
            )
            started = perf_counter()
            try:
                request = ProviderRequest(
                    artifact=spec.artifact,
                    model=manifest.model,
                    parameters=manifest.modelParameters,
                    seed=_sample_seed(manifest.seed, spec.sample_index),
                )
                async with self.rate_limiter.limit(spec.artifact.tokenCount.tokens):
                    call = asyncio.create_task(self.provider.invoke(request))
                    self._active_calls.add(call)
                    try:
                        response = await asyncio.wait_for(call, timeout=manifest.timeoutSeconds)
                    finally:
                        self._active_calls.discard(call)
                result.latencyMs = (perf_counter() - started) * 1000
                await self.events.publish(
                    "evaluation.started", trial_id=spec.trial_id, candidate_id=spec.artifact.candidateId
                )
                evaluation = await self.evaluator.evaluate(spec.artifact, response)
                await self.events.publish(
                    "evaluation.completed",
                    trial_id=spec.trial_id,
                    candidate_id=spec.artifact.candidateId,
                    payload={"compliance": evaluation.compliance},
                )
                result.status = transition(result.status, TrialStatus.COMPLETED)
                result.completedAt = datetime.now(UTC)
                result.inputTokens = response.input_tokens
                result.outputTokens = response.output_tokens
                result.estimatedCostUsd = response.estimated_cost_usd
                result.responseText = response.text if manifest.rawResponseRetention != "none" else None
                result.toolCalls = response.tool_calls
                result.evaluatorScores = evaluation
                result.policyViolations = evaluation.violations
                self.store.write_trial(result)
                await self.events.publish(
                    "trial.completed",
                    trial_id=spec.trial_id,
                    candidate_id=spec.artifact.candidateId,
                    payload={"attempt": attempt, "latencyMs": result.latencyMs},
                )
                return result
            except asyncio.CancelledError:
                result.status = transition(result.status, TrialStatus.CANCELLED)
                result.completedAt = datetime.now(UTC)
                self.store.write_trial(result)
                await self.events.publish(
                    "trial.cancelled", trial_id=spec.trial_id, candidate_id=spec.artifact.candidateId
                )
                if self._cancel.is_set():
                    return result
                raise
            except (TimeoutError, ProviderError) as error:
                retryable = isinstance(error, TimeoutError) or error.retryable
                result.latencyMs = (perf_counter() - started) * 1000
                if retryable and attempt < manifest.retryPolicy.maxAttempts:
                    result.status = transition(result.status, TrialStatus.RETRYING)
                    result.error = ErrorInfo(
                        type=type(error).__name__, message=str(error) or "request timed out", retryable=True
                    )
                    self.store.write_trial(result)
                    delay = _backoff(
                        manifest.retryPolicy.initialBackoffSeconds,
                        manifest.retryPolicy.maxBackoffSeconds,
                        manifest.retryPolicy.jitterFraction,
                        spec.trial_id,
                        attempt,
                    )
                    if isinstance(error, ProviderError) and error.retry_after is not None:
                        delay = max(delay, error.retry_after)
                    await self.events.publish(
                        "trial.retrying",
                        trial_id=spec.trial_id,
                        candidate_id=spec.artifact.candidateId,
                        payload={"attempt": attempt, "delaySeconds": delay},
                    )
                    await asyncio.sleep(delay)
                    continue
                result.status = transition(result.status, TrialStatus.FAILED)
                result.completedAt = datetime.now(UTC)
                result.error = ErrorInfo(
                    type=type(error).__name__, message=str(error) or "request timed out", retryable=retryable
                )
                self.store.write_trial(result)
                await self.events.publish(
                    "trial.failed",
                    trial_id=spec.trial_id,
                    candidate_id=spec.artifact.candidateId,
                    payload={"attempt": attempt, "retryable": retryable},
                )
                return result
        raise AssertionError("retry loop exited unexpectedly")

    def _trial_specs(self) -> list[TrialSpec]:
        manifest = self.loaded.manifest
        config_hash = sha256(
            canonical_json(
                {
                    "provider": manifest.provider,
                    "model": manifest.model,
                    "parameters": manifest.modelParameters,
                    "seed": manifest.seed,
                }
            )
        )
        specs = []
        for artifact in sorted(self.loaded.artifacts, key=lambda item: item.candidateId):
            for sample in range(manifest.sampleCount):
                trial_id = stable_id(
                    "trial",
                    {
                        "run": manifest.runId,
                        "config": config_hash,
                        "candidate": artifact.compiledPromptHash,
                        "sample": sample,
                    },
                )
                specs.append(TrialSpec(trial_id, artifact, sample))
        return specs

    def _new_result(self, spec: TrialSpec, status: TrialStatus) -> TrialResult:
        manifest = self.loaded.manifest
        return TrialResult(
            runId=manifest.runId,
            trialId=spec.trial_id,
            candidateId=spec.artifact.candidateId,
            strategy=spec.artifact.compilationStrategy,
            sampleIndex=spec.sample_index,
            status=status,
            attemptCount=0,
            queuedAt=datetime.now(UTC),
            provider=manifest.provider,
            model=manifest.model,
            provenanceHashes={
                "compiledPromptHash": spec.artifact.compiledPromptHash,
                "policyPackHash": spec.artifact.policyPackHash,
                "sourcePolicyHash": spec.artifact.sourcePolicyHash,
            },
        )

    def _write_reproducibility_metadata(self) -> None:
        manifest = self.loaded.manifest
        self.store.write_json_atomic(
            self.loaded.runDirectory / "manifest.canonical.json", manifest.model_dump(mode="json")
        )
        self.store.write_json_atomic(
            self.loaded.runDirectory / "environment.json",
            {
                "python": sys.version,
                "platform": platform.platform(),
                "provider": manifest.provider,
                "model": manifest.model,
                "reproduce": ["pnpm build", f"policyc-runtime run {self.loaded.manifestPath}"],
                "rawResponseRetention": manifest.rawResponseRetention,
            },
        )


def _sample_seed(seed: int | None, sample: int) -> int | None:
    return seed + sample if seed is not None else None


def _backoff(initial: float, maximum: float, jitter_fraction: float, trial_id: str, attempt: int) -> float:
    base = min(maximum, initial * (2 ** (attempt - 1)))
    jitter = random.Random(f"{trial_id}:{attempt}").uniform(-jitter_fraction, jitter_fraction)
    return max(0, base * (1 + jitter))
