from __future__ import annotations

from typing import Any

from .experiment_models import PairedRunManifest
from .hashing import sha256


def build_blind_packets(
    manifest: PairedRunManifest, trials: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    completed = [item for item in trials if item["status"] == "completed"]
    indexed = {(item["caseId"], item["sampleIndex"], item["strategy"]): item for item in completed}
    packets = []
    answer_map: dict[str, Any] = {}
    for plan in manifest.casePlans:
        for sample in range(manifest.sampleCount):
            answers = []
            for strategy in manifest.strategies:
                trial = indexed.get((plan.caseId, sample, strategy))
                if not trial:
                    continue
                answer_id = f"answer_{sha256(str(trial['trialId']) + ':blind')[:16]}"
                answers.append(
                    {
                        "answerId": answer_id,
                        "text": trial["responseText"],
                        "observedTools": _public_tool_evidence(trial.get("toolCalls", [])),
                    }
                )
                answer_map[answer_id] = {"trialId": trial["trialId"], "strategy": strategy}
            answers.sort(key=lambda item: sha256(f"{plan.caseId}:{sample}:{item['answerId']}"))
            packets.append(
                {
                    "caseId": plan.caseId,
                    "sampleIndex": sample,
                    "request": plan.case.request,
                    "rubric": plan.case.rubric.model_dump(mode="json"),
                    "answers": answers,
                }
            )
    return packets, {"runId": manifest.runId, "answers": answer_map}


def _public_tool_evidence(tool_calls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    evidence: list[dict[str, Any]] = []
    seen: set[tuple[Any, Any, Any]] = set()
    for call in tool_calls:
        item = {key: call.get(key) for key in ("name", "type", "status") if call.get(key) is not None}
        identity = (item.get("name"), item.get("type"), item.get("status"))
        if identity in seen:
            continue
        seen.add(identity)
        evidence.append(item)
    return evidence
