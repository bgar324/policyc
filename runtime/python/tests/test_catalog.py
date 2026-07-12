from __future__ import annotations

import json
from pathlib import Path

from policyc_runtime.catalog import RunCatalog
from policyc_runtime.experiment_models import PairedRunManifest


def manifest(root: Path) -> PairedRunManifest:
    repository = Path(__file__).parents[3]
    case = json.loads((repository / "eval/behavioral/smoke-v1.jsonl").read_text().splitlines()[0])
    return PairedRunManifest.model_validate(
        {
            "schemaVersion": "2.0.0",
            "runId": "run_catalog_test",
            "sourceControl": {"system": "git", "commit": "c" * 40, "dirty": False},
            "experimentName": "catalog-test",
            "dataset": {
                "path": str(repository / "eval/behavioral/smoke-v1.jsonl"),
                "hash": "a" * 64,
                "version": "smoke-v1",
                "split": "smoke",
            },
            "compilerHash": "b" * 64,
            "casePlans": [
                {
                    "caseId": case["caseId"],
                    "case": case,
                    "candidates": [
                        {
                            "strategy": strategy,
                            "candidateId": f"candidate-{strategy}",
                            "artifactPath": f"artifacts/{strategy}.json",
                        }
                        for strategy in ("full_policy", "compiler_slice")
                    ],
                }
            ],
            "strategies": ["full_policy", "compiler_slice"],
            "provider": "fake",
            "model": "gpt-5-mini-2025-08-07",
            "modelParameters": {"max_output_tokens": 256, "store": False},
            "sampleCount": 1,
            "maxConcurrency": 1,
            "timeoutSeconds": 10,
            "retryPolicy": {
                "maxAttempts": 1,
                "initialBackoffSeconds": 0,
                "maxBackoffSeconds": 0,
                "jitterFraction": 0,
            },
            "rateLimit": {"maxConcurrentRequests": 1},
            "evaluator": {"id": "independent-rules", "version": "2.0.0"},
            "grader": {"type": "manual", "version": "1.0.0", "blind": True},
            "budget": {
                "maxLogicalTrials": 2,
                "maxCalls": 2,
                "maxInputTokens": 1000,
                "maxOutputTokens": 512,
                "maxCostUsd": 0.02,
            },
            "pricing": {"registryPath": "pricing.json", "registryVersion": "test"},
            "outputDirectory": ".",
            "rawResponseRetention": "full",
            "createdAt": "2026-01-01T00:00:00Z",
        }
    )


def trial(strategy: str) -> dict[str, object]:
    return {
        "trialId": f"trial-{strategy}",
        "runId": "run_catalog_test",
        "caseId": "smoke-refusal-001",
        "strategy": strategy,
        "sampleIndex": 0,
        "status": "completed",
        "attemptCount": 1,
        "inputTokens": 100,
        "cachedInputTokens": 10,
        "outputTokens": 20,
        "costUsd": 0.001,
        "latencyMs": 25.0,
        "evaluation": {"criticalPassed": True, "passed": True},
    }


def test_catalog_persists_run_and_trial_summaries(tmp_path: Path) -> None:
    database = tmp_path / "catalog.sqlite"
    run_directory = tmp_path / "runs/run_catalog_test"
    run_directory.mkdir(parents=True)
    manifest_path = run_directory / "manifest.canonical.json"
    value = manifest(tmp_path)
    manifest_path.write_text(value.model_dump_json())

    catalog = RunCatalog(database)
    catalog.register(value, manifest_path, run_directory)
    catalog.record_trial(trial("full_policy"))
    catalog.record_trial(trial("compiler_slice"))
    catalog.finalize(
        value.runId,
        status="completed",
        budget={
            "calls": 2,
            "actualInputTokens": 200,
            "actualOutputTokens": 40,
            "actualCostUsd": 0.002,
            "ambiguousCostExposureUsd": 0,
        },
        report_path=run_directory / "report.json",
    )

    reopened = RunCatalog(database)
    rows = reopened.list_runs()
    assert len(rows) == 1
    assert rows[0]["status"] == "completed"
    assert rows[0]["completed_trials"] == 2
    assert rows[0]["actual_cost_usd"] == 0.002
    assert rows[0]["git_commit"] == "c" * 40
    assert rows[0]["git_dirty"] == 0
    detail = reopened.show(value.runId)
    assert detail is not None and len(detail["trials"]) == 2


def test_catalog_can_be_rebuilt_from_authoritative_run_files(tmp_path: Path) -> None:
    run_directory = tmp_path / "runs/run_catalog_test"
    trials = run_directory / "trials"
    trials.mkdir(parents=True)
    value = manifest(tmp_path)
    (run_directory / "manifest.canonical.json").write_text(value.model_dump_json())
    for strategy in ("full_policy", "compiler_slice"):
        (trials / f"trial-{strategy}.json").write_text(json.dumps(trial(strategy)))
    (run_directory / "budget.json").write_text(
        json.dumps(
            {
                "calls": 2,
                "actualInputTokens": 200,
                "actualOutputTokens": 40,
                "actualCostUsd": 0.002,
                "ambiguousCostExposureUsd": 0,
            }
        )
    )
    (run_directory / "report.json").write_text("{}")

    catalog = RunCatalog(tmp_path / "rebuilt.sqlite")
    result = catalog.rebuild(tmp_path / "runs")
    assert result == {"imported": 1, "skipped": 0, "discovered": 1}
    detail = catalog.show(value.runId)
    assert detail is not None
    assert detail["run"]["completed_trials"] == 2
    assert len(detail["trials"]) == 2


def test_rebuild_marks_failed_run_and_unknown_accounting(tmp_path: Path) -> None:
    run_directory = tmp_path / "runs/run_catalog_test"
    trials = run_directory / "trials"
    trials.mkdir(parents=True)
    value = manifest(tmp_path)
    (run_directory / "manifest.canonical.json").write_text(value.model_dump_json())
    failed = {
        **trial("full_policy"),
        "status": "failed",
        "inputTokens": None,
        "cachedInputTokens": None,
        "outputTokens": None,
        "costUsd": None,
        "evaluation": None,
        "error": {"outcome": "terminal_error"},
    }
    (trials / "trial-full_policy.json").write_text(json.dumps(failed))
    (run_directory / "budget.json").write_text(
        json.dumps(
            {
                "calls": 1,
                "actualInputTokens": 0,
                "actualOutputTokens": 0,
                "actualCostUsd": 0,
                "ambiguousCostExposureUsd": 0,
            }
        )
    )
    (run_directory / "report.json").write_text("{}")

    catalog = RunCatalog(tmp_path / "failed.sqlite")
    catalog.rebuild(tmp_path / "runs")
    detail = catalog.show(value.runId)
    assert detail is not None
    assert detail["run"]["status"] == "failed"
    assert detail["run"]["actual_cost_usd"] is None
    assert detail["run"]["input_tokens"] is None
