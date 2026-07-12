from __future__ import annotations

import math
import statistics
from collections import defaultdict
from typing import Any, cast

from .models import CompiledArtifact, EvaluationResult, RunManifest, TrialResult, TrialStatus


def build_report(
    manifest: RunManifest, artifacts: list[CompiledArtifact], results: list[TrialResult]
) -> dict[str, Any]:
    by_candidate: dict[str, list[TrialResult]] = defaultdict(list)
    for result in results:
        by_candidate[result.candidateId].append(result)
    artifact_by_id = {artifact.candidateId: artifact for artifact in artifacts}
    reference = next((artifact for artifact in artifacts if artifact.compilationStrategy == "compiler_slice"), None)
    required_critical = set((reference or artifact_by_id[manifest.fullPolicyCandidateId]).criticalPolicyIds)
    candidates: list[dict[str, Any]] = []
    for candidate_id in sorted(by_candidate):
        completed = [
            item for item in by_candidate[candidate_id] if item.status is TrialStatus.COMPLETED and item.evaluatorScores
        ]
        artifact = artifact_by_id[candidate_id]
        evaluations = [cast(EvaluationResult, item.evaluatorScores) for item in completed]
        selected = set(artifact.selectedPolicyIds)
        closed_edges = sum(
            1 for edge in artifact.dependencyEdges if edge.from_ in selected and edge.requires in selected
        )
        candidates.append(
            {
                "candidateId": candidate_id,
                "strategy": artifact.compilationStrategy,
                "promptTokens": artifact.tokenCount.model_dump(mode="json"),
                "samplesRequested": manifest.sampleCount,
                "samplesCompleted": len(completed),
                "samplesFailed": len(by_candidate[candidate_id]) - len(completed),
                "compliance": summarize([item.compliance for item in evaluations]),
                "answerQuality": summarize([item.answerQuality for item in evaluations]),
                "latencyMs": summarize_optional([item.latencyMs for item in completed]),
                "inputTokens": summarize_optional(
                    [float(item.inputTokens) if item.inputTokens is not None else None for item in completed]
                ),
                "outputTokens": summarize_optional(
                    [float(item.outputTokens) if item.outputTokens is not None else None for item in completed]
                ),
                "estimatedCostUsd": summarize_optional([item.estimatedCostUsd for item in completed]),
                "violationRate": sum(bool(item.policyViolations) for item in completed) / len(completed)
                if completed
                else None,
                "missingCriticalPolicies": sorted(required_critical - set(artifact.selectedPolicyIds)),
                "structural": {
                    "selectedPolicyCount": len(artifact.selectedPolicyIds),
                    "dependencyEdges": len(artifact.dependencyEdges),
                    "dependencyCompleteness": closed_edges / len(artifact.dependencyEdges)
                    if artifact.dependencyEdges
                    else 1.0,
                    "criticalPolicyCompleteness": not bool(required_critical - selected),
                    "graphValidatedByCompiler": True,
                },
            }
        )
    baseline = next(item for item in candidates if item["candidateId"] == manifest.fullPolicyCandidateId)
    margin = manifest.evaluator.nonInferiorityMargin
    for item in candidates:
        item["comparisonToFull"] = compare(item, baseline)
        enough = (
            item["samplesCompleted"] == manifest.sampleCount and baseline["samplesCompleted"] == manifest.sampleCount
        )
        item["experimentallyNonInferior"] = bool(
            enough
            and item["compliance"]["mean"] is not None
            and baseline["compliance"]["mean"] is not None
            and item["compliance"]["mean"] >= baseline["compliance"]["mean"] - margin
            and item["answerQuality"]["mean"] is not None
            and baseline["answerQuality"]["mean"] is not None
            and item["answerQuality"]["mean"] >= baseline["answerQuality"]["mean"] - margin
            and item["violationRate"] <= baseline["violationRate"] + margin
            and not item["missingCriticalPolicies"]
        )
    eligible = [
        item
        for item in candidates
        if item["experimentallyNonInferior"] and item["samplesCompleted"] == manifest.sampleCount
    ]
    chosen = min(eligible, key=lambda item: artifact_by_id[item["candidateId"]].tokenCount.tokens) if eligible else None
    ranking = sorted(
        eligible,
        key=lambda item: (
            -item["compliance"]["mean"],
            -item["answerQuality"]["mean"],
            artifact_by_id[item["candidateId"]].tokenCount.tokens,
            item["latencyMs"]["mean"] if item["latencyMs"]["mean"] is not None else math.inf,
            item["estimatedCostUsd"]["mean"] if item["estimatedCostUsd"]["mean"] is not None else math.inf,
        ),
    )
    return {
        "schemaVersion": "1.0.0",
        "runId": manifest.runId,
        "evidenceType": "experimental",
        "provider": manifest.provider,
        "model": manifest.model,
        "sampleCount": manifest.sampleCount,
        "nonInferiorityMargin": margin,
        "candidates": candidates,
        "smallestQualifyingCandidateId": chosen["candidateId"] if chosen else None,
        "candidateRanking": [item["candidateId"] for item in ranking],
        "caveats": [
            "Non-inferiority is experimental, not proof.",
            "Fake-provider runs test runtime mechanics, not model behavior.",
        ]
        if manifest.provider == "fake"
        else ["Model-based or rule-based evaluation is not ground truth."],
    }


def summarize(values: list[float]) -> dict[str, Any]:
    if not values:
        return {"count": 0, "mean": None, "median": None, "standardDeviation": None, "confidenceInterval95": None}
    mean = statistics.fmean(values)
    std = statistics.stdev(values) if len(values) > 1 else 0.0
    half = 1.96 * std / math.sqrt(len(values)) if len(values) > 1 else 0.0
    return {
        "count": len(values),
        "mean": mean,
        "median": statistics.median(values),
        "standardDeviation": std,
        "confidenceInterval95": [mean - half, mean + half],
    }


def summarize_optional(values: list[float | None]) -> dict[str, Any]:
    known = [value for value in values if value is not None]
    summary = summarize(known)
    summary["unknownCount"] = len(values) - len(known)
    if len(known) != len(values):
        summary.update({"mean": None, "median": None, "standardDeviation": None, "confidenceInterval95": None})
    return summary


def compare(candidate: dict[str, Any], baseline: dict[str, Any]) -> dict[str, float | None]:
    def delta(metric: str) -> float | None:
        left, right = candidate[metric]["mean"], baseline[metric]["mean"]
        return left - right if left is not None and right is not None else None

    return {
        "complianceDifference": delta("compliance"),
        "answerQualityDifference": delta("answerQuality"),
        "latencyDifferenceMs": delta("latencyMs"),
        "costDifferenceUsd": delta("estimatedCostUsd"),
    }
