from __future__ import annotations

import math
from collections import defaultdict
from typing import Any

from .experiment_models import PairedRunManifest
from .pricing import ModelPrice


def build_paired_report(
    manifest: PairedRunManifest,
    trials: list[dict[str, Any]],
    budget: dict[str, Any],
    price: ModelPrice,
) -> dict[str, Any]:
    completed = [item for item in trials if item["status"] == "completed"]
    by_strategy: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in trials:
        by_strategy[item["strategy"]].append(item)
    strategies = {}
    for strategy in manifest.strategies:
        all_rows = by_strategy[strategy]
        rows = [row for row in all_rows if row["status"] == "completed"]
        passed = sum(bool(row["evaluation"]["passed"]) for row in rows)
        critical = sum(bool(row["evaluation"]["criticalPassed"]) for row in rows)
        severe = sum(bool(row["evaluation"]["severeFailures"]) for row in rows)
        violations = sum(not bool(row["evaluation"]["passed"]) for row in rows)
        strategies[strategy] = {
            "caseCount": len({row["caseId"] for row in all_rows}),
            "trialCount": len(all_rows),
            "completed": len(rows),
            "failed": sum(row["status"] == "failed" for row in all_rows),
            "ambiguous": sum(row["status"] == "ambiguous" for row in all_rows),
            "missing": len(manifest.casePlans) * manifest.sampleCount - len(all_rows),
            "passRate": _proportion(passed, len(rows)),
            "criticalPassRate": _proportion(critical, len(rows)),
            "criticalFailureRate": _proportion(len(rows) - critical, len(rows)),
            "severeFailureRate": _proportion(severe, len(rows)),
            "violationRate": _proportion(violations, len(rows)),
            "meanAnswerQuality": _mean_nested(rows, "evaluation", "qualityScore"),
            "inputTokens": _sum_known(all_rows, "inputTokens"),
            "cachedInputTokens": _sum_known(all_rows, "cachedInputTokens"),
            "outputTokens": _sum_known(all_rows, "outputTokens"),
            "costUsd": _sum_known(all_rows, "costUsd"),
            "meanLatencyMs": _mean_known(all_rows, "latencyMs"),
        }
    indexed = {(row["caseId"], row["sampleIndex"], row["strategy"]): row for row in completed}
    pairs: list[dict[str, Any]] = []
    counts = {"bothPass": 0, "bothFail": 0, "fullOnlyPass": 0, "compiledOnlyPass": 0}
    for case_plan in manifest.casePlans:
        for sample in range(manifest.sampleCount):
            full = indexed.get((case_plan.caseId, sample, "full_policy"))
            compiled = indexed.get((case_plan.caseId, sample, "compiler_slice"))
            if not full or not compiled:
                continue
            full_pass = bool(full["evaluation"]["passed"])
            compiled_pass = bool(compiled["evaluation"]["passed"])
            key = (
                "bothPass"
                if full_pass and compiled_pass
                else "bothFail"
                if not full_pass and not compiled_pass
                else "fullOnlyPass"
                if full_pass
                else "compiledOnlyPass"
            )
            counts[key] += 1
            full_obligations = full["evaluation"]["obligationResults"]
            compiled_obligations = compiled["evaluation"]["obligationResults"]
            pairs.append(
                {
                    "caseId": case_plan.caseId,
                    "sampleIndex": sample,
                    "fullPassed": full_pass,
                    "compiledPassed": compiled_pass,
                    "criticalRegression": full["evaluation"]["criticalPassed"]
                    and not compiled["evaluation"]["criticalPassed"],
                    "obligationRegressions": sorted(
                        key
                        for key, value in full_obligations.items()
                        if value and not compiled_obligations.get(key, False)
                    ),
                }
            )
    discordant = counts["fullOnlyPass"] + counts["compiledOnlyPass"]
    per_case = {}
    for case_plan in manifest.casePlans:
        case_pairs = [pair for pair in pairs if pair["caseId"] == case_plan.caseId]
        per_case[case_plan.caseId] = {
            "pairedSamples": len(case_pairs),
            "fullPasses": sum(pair["fullPassed"] for pair in case_pairs),
            "compiledPasses": sum(pair["compiledPassed"] for pair in case_pairs),
            "criticalRegressions": sum(pair["criticalRegression"] for pair in case_pairs),
            "obligationRegressions": sorted({item for pair in case_pairs for item in pair["obligationRegressions"]}),
        }
    return {
        "schemaVersion": "2.0.0",
        "runId": manifest.runId,
        "evidenceType": "small-sample paired experiment; descriptive, not proof",
        "dataset": manifest.dataset.model_dump(mode="json"),
        "model": manifest.model,
        "modelParameters": manifest.modelParameters,
        "strategies": strategies,
        "paired": {
            "counts": counts,
            "discordantPairs": discordant,
            "exactTwoSidedMcNemarP": _binomial_two_sided(counts["fullOnlyPass"], discordant),
            "pairs": pairs,
            "perCase": per_case,
        },
        "outcomes": {
            status: sum(item["status"] == status for item in trials) for status in ("completed", "failed", "ambiguous")
        },
        "providerErrorOutcomes": {
            outcome: sum(item.get("error", {}).get("outcome") == outcome for item in trials)
            for outcome in sorted(
                {item.get("error", {}).get("outcome") for item in trials if item.get("error", {}).get("outcome")}
            )
        },
        "budget": budget,
        "costAccounting": {
            "totalGenerationCostUsd": budget["actualCostUsd"],
            "graderCostUsd": None,
            "ambiguousAttemptExposureUsd": budget["ambiguousCostExposureUsd"],
            "cachedTokenSavingsUsd": _cached_savings(trials, price),
        },
        "limitations": [
            "Confidence intervals and paired tests are descriptive at small sample sizes.",
            "Rule validators measure declared obligations and do not establish semantic equivalence.",
            "Unknown usage, latency, or cost values remain null rather than being treated as zero.",
        ],
    }


def _proportion(successes: int, total: int) -> dict[str, Any]:
    if total == 0:
        return {"value": None, "wilson95": None, "successes": 0, "total": 0}
    value = successes / total
    z = 1.959963984540054
    denominator = 1 + z * z / total
    center = (value + z * z / (2 * total)) / denominator
    radius = z * math.sqrt(value * (1 - value) / total + z * z / (4 * total * total)) / denominator
    return {
        "value": value,
        "wilson95": [max(0.0, center - radius), min(1.0, center + radius)],
        "successes": successes,
        "total": total,
    }


def _sum_known(rows: list[dict[str, Any]], key: str) -> float | int | None:
    if not rows:
        return None
    values = [row[key] for row in rows if row.get(key) is not None]
    return sum(values) if len(values) == len(rows) else None


def _mean_known(rows: list[dict[str, Any]], key: str) -> float | None:
    values = [float(row[key]) for row in rows if row.get(key) is not None]
    return sum(values) / len(values) if len(values) == len(rows) and values else None


def _mean_nested(rows: list[dict[str, Any]], parent: str, key: str) -> float | None:
    values = [float(row[parent][key]) for row in rows if row.get(parent, {}).get(key) is not None]
    return sum(values) / len(values) if len(values) == len(rows) and values else None


def _cached_savings(rows: list[dict[str, Any]], price: ModelPrice) -> float | None:
    if not rows:
        return None
    if any(row.get("cachedInputTokens") is None for row in rows):
        return None
    cached = sum(row["cachedInputTokens"] for row in rows)
    return cached * (price.inputPerMillion - price.cachedInputPerMillion) / 1_000_000


def _binomial_two_sided(k: int, n: int) -> float | None:
    if n == 0:
        return None
    tail = sum(math.comb(n, i) for i in range(0, min(k, n - k) + 1)) / (2**n)
    return min(1.0, 2 * tail)
