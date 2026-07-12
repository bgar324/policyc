from __future__ import annotations

import json
from pathlib import Path

import pytest

from policyc_runtime.blind_grading import build_blind_packets
from policyc_runtime.budget import BudgetExceeded, BudgetLedger
from policyc_runtime.case_evaluator import evaluate_case
from policyc_runtime.experiment_models import BehavioralCase, BudgetConfig, PairedRunManifest
from policyc_runtime.paired_report import _cached_savings, _sum_known, build_paired_report
from policyc_runtime.pricing import ModelPrice, calculate_cost
from policyc_runtime.providers import ProviderResponse


def price() -> ModelPrice:
    return ModelPrice(
        modelId="test",
        effectiveDate="2026-01-01",
        inputPerMillion=1,
        cachedInputPerMillion=0.1,
        outputPerMillion=2,
        reasoningTokens="included_in_output",
        source="test",
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "config",
    [
        BudgetConfig(maxLogicalTrials=1, maxCalls=1, maxInputTokens=5, maxOutputTokens=100, maxCostUsd=1),
        BudgetConfig(maxLogicalTrials=1, maxCalls=2, maxInputTokens=100, maxOutputTokens=5, maxCostUsd=1),
        BudgetConfig(maxLogicalTrials=1, maxCalls=2, maxInputTokens=100, maxOutputTokens=100, maxCostUsd=0.000001),
    ],
)
async def test_hard_budget_ceiling_before_call(config: BudgetConfig) -> None:
    with pytest.raises(BudgetExceeded):
        await BudgetLedger(config, price()).reserve(10, 10, "trial")


@pytest.mark.asyncio
async def test_two_call_ceiling_proves_no_third_call() -> None:
    config = BudgetConfig(maxLogicalTrials=2, maxCalls=2, maxInputTokens=100, maxOutputTokens=512, maxCostUsd=1)
    ledger = BudgetLedger(config, price())
    for index in range(2):
        reservation = await ledger.reserve(10, 256, f"trial-{index}")
        await ledger.complete(reservation, 10, 0, 2, f"trial-{index}")
    with pytest.raises(BudgetExceeded):
        await ledger.reserve(10, 256, "third")
    assert ledger.calls == 2


@pytest.mark.asyncio
async def test_missing_usage_makes_accounting_unknown() -> None:
    config = BudgetConfig(maxLogicalTrials=1, maxCalls=1, maxInputTokens=100, maxOutputTokens=100, maxCostUsd=1)
    ledger = BudgetLedger(config, price())
    reservation = await ledger.reserve(10, 10, "failed-trial")
    await ledger.fail_definitive(reservation, "failed-trial")
    snapshot = ledger.snapshot()
    assert snapshot["calls"] == 1
    assert snapshot["accountingComplete"] is False
    assert snapshot["unknownUsageAttempts"] == 1
    assert snapshot["actualInputTokens"] is None
    assert snapshot["actualOutputTokens"] is None
    assert snapshot["actualCostUsd"] is None


def test_cached_cost_is_not_zero() -> None:
    assert calculate_cost(price(), 100, 40, 20) == pytest.approx(0.000104)


def test_empty_failed_metrics_are_unknown_not_zero() -> None:
    assert _sum_known([], "costUsd") is None
    assert _sum_known([], "inputTokens") is None
    assert _cached_savings([], price()) is None


def test_independent_obligation_and_tool_evaluation() -> None:
    case = BehavioralCase.model_validate(
        {
            "schemaVersion": "1.0.0",
            "datasetVersion": "test",
            "split": "development",
            "caseId": "case",
            "request": "latest news",
            "artifactContext": None,
            "applicableObligations": [
                {"id": "cite", "description": "cite", "severity": "critical", "validator": "citations_present"},
                {
                    "id": "web",
                    "description": "browse",
                    "severity": "high",
                    "validator": "required_tool",
                    "value": "web",
                },
            ],
            "criticalObligationIds": ["cite"],
            "prohibitions": [],
            "expectedRefusal": "forbidden",
            "toolExpectation": {"required": ["web"], "forbidden": []},
            "tools": [{"type": "web_search", "name": "web"}],
            "rubric": {"description": "good", "minQualityScore": 0.5},
            "tags": ["current"],
        }
    )
    omitted = evaluate_case(case, ProviderResponse(text="uncited answer", input_tokens=1, output_tokens=1))
    assert omitted["passed"] is False and set(omitted["severeFailures"]) == {"cite", "web"}
    correct = evaluate_case(
        case,
        ProviderResponse(text="answer [1]", input_tokens=1, output_tokens=1, tool_calls=[{"name": "web"}]),
    )
    assert correct["passed"] is True


def test_20_case_120_trial_pairing_and_blind_packets() -> None:
    root = Path(__file__).parents[3]
    cases = [
        json.loads(line)
        for line in (root / "eval/behavioral/held-out-pilot-v1.jsonl").read_text().splitlines()
        if line.strip()
    ]
    case_plans = [
        {
            "caseId": case["caseId"],
            "case": case,
            "candidates": [
                {
                    "strategy": strategy,
                    "candidateId": f"{case['caseId']}-{strategy}",
                    "artifactPath": f"{strategy}.json",
                }
                for strategy in ("full_policy", "compiler_slice")
            ],
        }
        for case in cases
    ]
    manifest = PairedRunManifest.model_validate(
        {
            "schemaVersion": "2.0.0",
            "runId": "pilot",
            "experimentName": "pilot",
            "dataset": {
                "path": "held-out.jsonl",
                "hash": "a" * 64,
                "version": "held-out-pilot-v1",
                "split": "held-out",
            },
            "compilerHash": "b" * 64,
            "casePlans": case_plans,
            "strategies": ["full_policy", "compiler_slice"],
            "provider": "fake",
            "model": "test",
            "modelParameters": {"max_output_tokens": 256, "store": False},
            "sampleCount": 3,
            "maxConcurrency": 2,
            "timeoutSeconds": 10,
            "retryPolicy": {
                "maxAttempts": 1,
                "initialBackoffSeconds": 0,
                "maxBackoffSeconds": 0,
                "jitterFraction": 0,
            },
            "rateLimit": {"maxConcurrentRequests": 2},
            "evaluator": {"id": "independent-rules", "version": "2.0.0"},
            "grader": {"type": "manual", "version": "1.0.0", "blind": True},
            "budget": {
                "maxLogicalTrials": 120,
                "maxCalls": 120,
                "maxInputTokens": 10000,
                "maxOutputTokens": 30720,
                "maxCostUsd": 1,
            },
            "pricing": {"registryPath": "prices.json", "registryVersion": "test"},
            "outputDirectory": ".",
            "rawResponseRetention": "full",
            "createdAt": "2026-01-01T00:00:00Z",
        }
    )
    trials = []
    for case in cases:
        for sample in range(3):
            for strategy in ("full_policy", "compiler_slice"):
                trials.append(
                    {
                        "trialId": f"{case['caseId']}-{sample}-{strategy}",
                        "caseId": case["caseId"],
                        "sampleIndex": sample,
                        "strategy": strategy,
                        "status": "completed",
                        "responseText": "safe answer",
                        "inputTokens": 10,
                        "cachedInputTokens": 0,
                        "outputTokens": 2,
                        "latencyMs": 1,
                        "costUsd": 0.001,
                        "evaluation": {
                            "passed": True,
                            "criticalPassed": True,
                            "severeFailures": [],
                            "qualityScore": 1,
                            "obligationResults": {identifier: True for identifier in case["criticalObligationIds"]},
                        },
                    }
                )
    budget = {"actualCostUsd": 0.12, "ambiguousCostExposureUsd": 0}
    report = build_paired_report(manifest, trials, budget, price())
    assert len(trials) == 120 and len(report["paired"]["perCase"]) == 20
    assert report["paired"]["counts"]["bothPass"] == 60
    packets, private_map = build_blind_packets(manifest, trials)
    assert len(packets) == 60 and len(private_map["answers"]) == 120
    assert "strategy" not in json.dumps(packets) and "inputTokens" not in json.dumps(packets)
