from __future__ import annotations

import asyncio
import json
from time import perf_counter

import pytest

from policyc_runtime.events import EventBus, serialize_sse
from policyc_runtime.manifest import load_run
from policyc_runtime.models import RunStatus, TrialStatus
from policyc_runtime.persistence import RunStore
from policyc_runtime.providers.fake import FakeProvider
from policyc_runtime.scheduler import ExperimentRuntime
from policyc_runtime.state import transition, transition_run

from .conftest import write_run


@pytest.mark.asyncio
async def test_trials_run_concurrently_without_exceeding_bound(tmp_path):
    path, _ = write_run(tmp_path, candidates=3, samples=3, concurrency=2)
    provider = FakeProvider(delay=0.03)
    report = await ExperimentRuntime(load_run(path), provider).run()
    assert provider.max_active == 2
    assert sum(item["samplesCompleted"] for item in report["candidates"]) == 9


@pytest.mark.asyncio
async def test_transient_failure_retries_and_terminal_failure_does_not(tmp_path):
    path, artifacts = write_run(tmp_path, candidates=2, samples=1, attempts=3)
    provider = FakeProvider(
        outcomes={artifacts[0]["candidateId"]: ["transient", "success"], artifacts[1]["candidateId"]: ["terminal"]}
    )
    runtime = ExperimentRuntime(load_run(path), provider)
    report = await runtime.run()
    assert provider.calls[artifacts[0]["candidateId"]] == 2
    assert provider.calls[artifacts[1]["candidateId"]] == 1
    assert sum(item["samplesFailed"] for item in report["candidates"]) == 1


@pytest.mark.asyncio
async def test_timeout_becomes_failed_result(tmp_path):
    path, artifacts = write_run(tmp_path, candidates=1, samples=1, timeout=0.01, attempts=1)
    runtime = ExperimentRuntime(load_run(path), FakeProvider(outcomes={artifacts[0]["candidateId"]: ["hang"]}))
    report = await runtime.run()
    assert report["candidates"][0]["samplesFailed"] == 1
    trial = next((tmp_path / "trials").glob("*.json"))
    assert json.loads(trial.read_text())["error"]["type"] == "TimeoutError"


@pytest.mark.asyncio
async def test_completed_trials_are_reused_on_restart(tmp_path):
    path, _ = write_run(tmp_path, candidates=2, samples=2)
    first = FakeProvider()
    await ExperimentRuntime(load_run(path), first).run()
    assert sum(first.calls.values()) == 4
    second = FakeProvider()
    report = await ExperimentRuntime(load_run(path), second).run()
    assert sum(second.calls.values()) == 0
    assert sum(item["samplesCompleted"] for item in report["candidates"]) == 4


@pytest.mark.asyncio
async def test_cancellation_propagates_to_active_provider(tmp_path):
    path, _ = write_run(tmp_path, candidates=2, samples=3, concurrency=2, timeout=5)
    provider = FakeProvider(delay=5)
    runtime = ExperimentRuntime(load_run(path), provider)
    task = asyncio.create_task(runtime.run())
    while provider.active < 2:  # noqa: ASYNC110 - polling exposes active fake-provider calls in this cancellation test
        await asyncio.sleep(0.001)
    await runtime.cancel()
    result = await asyncio.wait_for(task, 1)
    assert result["status"] == "cancelled"
    assert provider.cancelled == 2


@pytest.mark.asyncio
async def test_rate_limit_delays_requests(tmp_path):
    path, _ = write_run(tmp_path, candidates=1, samples=3, concurrency=3, requests_per_window=1)
    started = perf_counter()
    await ExperimentRuntime(load_run(path), FakeProvider(delay=0)).run()
    assert perf_counter() - started >= 0.018


def test_state_machine_rejects_invalid_transition():
    assert transition(TrialStatus.QUEUED, TrialStatus.RUNNING) is TrialStatus.RUNNING
    with pytest.raises(ValueError, match="invalid trial state transition"):
        transition(TrialStatus.COMPLETED, TrialStatus.RUNNING)
    assert transition_run(RunStatus.CREATED, RunStatus.RUNNING) is RunStatus.RUNNING
    with pytest.raises(ValueError, match="invalid run state transition"):
        transition_run(RunStatus.COMPLETED, RunStatus.RUNNING)


@pytest.mark.asyncio
async def test_events_are_monotonic_and_sse_compatible(tmp_path):
    bus = EventBus("run_x", tmp_path / "events.jsonl")
    first = await bus.publish("run.created")
    second = await bus.publish("run.started")
    assert [first.sequence, second.sequence] == [1, 2]
    assert serialize_sse(second).startswith("id: evt_00000002\nevent: run.started\ndata:")
    replay = bus.subscribe(after_sequence=1)
    assert (await anext(replay)).eventId == second.eventId
    await replay.aclose()


def test_atomic_persistence_leaves_only_complete_json(tmp_path):
    store = RunStore(tmp_path)
    store.write_json_atomic(tmp_path / "value.json", {"complete": True})
    assert json.loads((tmp_path / "value.json").read_text()) == {"complete": True}
    assert not list(tmp_path.glob("*.tmp"))


@pytest.mark.asyncio
async def test_report_aggregation_is_deterministic(tmp_path):
    path, _ = write_run(tmp_path, candidates=2, samples=3)
    first = await ExperimentRuntime(load_run(path), FakeProvider()).run()
    second = await ExperimentRuntime(load_run(path), FakeProvider()).run()
    first.pop("caveats")
    second.pop("caveats")
    assert first == second
    assert first["smallestQualifyingCandidateId"] is not None
