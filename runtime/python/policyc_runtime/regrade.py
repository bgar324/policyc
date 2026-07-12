from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .case_evaluator import evaluate_case
from .experiment_models import EvaluatorRef
from .hashing import canonical_json, sha256
from .paired_manifest import load_paired_run
from .paired_report import build_paired_report
from .pricing import load_pricing
from .providers import ProviderResponse

EVALUATOR_ID = "independent-rules"
EVALUATOR_VERSION = "2.2.0"


def regrade_run(run_directory: Path) -> dict[str, Any]:
    root = run_directory.resolve()
    loaded = load_paired_run(root / "manifest.v2.json")
    manifest = loaded.manifest
    cases = {plan.caseId: plan.case for plan in manifest.casePlans}
    source_trials: list[dict[str, Any]] = []
    derived_trials: list[dict[str, Any]] = []
    trial_hashes: list[dict[str, str]] = []

    for path in sorted((root / "trials").glob("*.json")):
        raw = path.read_bytes()
        trial = json.loads(raw)
        source_trials.append(trial)
        trial_hashes.append({"trialId": trial["trialId"], "sha256": sha256(raw)})
        derived = dict(trial)
        if trial["status"] == "completed":
            derived["evaluation"] = evaluate_case(cases[trial["caseId"]], _response_from_trial(trial))
        derived_trials.append(derived)

    budget = json.loads((root / "budget.json").read_text())
    pricing = load_pricing(manifest.pricing.registryPath, manifest.pricing.registryVersion)
    price = pricing.lookup(manifest.model)
    derived_manifest = manifest.model_copy(
        update={"evaluator": EvaluatorRef(id="independent-rules", version=EVALUATOR_VERSION)}
    )
    report = build_paired_report(derived_manifest, derived_trials, budget, price)
    report["reportType"] = "derived-offline-regrade"
    report["sourceRunId"] = manifest.runId
    report["sourceEvaluator"] = manifest.evaluator.model_dump(mode="json")
    report["derivedEvaluator"] = derived_manifest.evaluator.model_dump(mode="json")

    destination = root / "derived" / f"evaluator-{EVALUATOR_VERSION}"
    evaluations = destination / "evaluations"
    evaluations.mkdir(parents=True, exist_ok=True)
    for trial in derived_trials:
        if trial["status"] == "completed":
            _write_json(evaluations / f"{trial['trialId']}.json", trial["evaluation"])
    _write_json(destination / "report.json", report)

    original_report = root / "report.json"
    addendum = {
        "schemaVersion": "1.0.0",
        "sourceRunId": manifest.runId,
        "sourceManifestSha256": sha256((root / "manifest.v2.json").read_bytes()),
        "sourceReportSha256": sha256(original_report.read_bytes()),
        "sourceTrialSetSha256": sha256(canonical_json(trial_hashes)),
        "sourceTrialCount": len(source_trials),
        "completedTrialsRegraded": sum(trial["status"] == "completed" for trial in source_trials),
        "sourceEvaluator": manifest.evaluator.model_dump(mode="json"),
        "derivedEvaluator": derived_manifest.evaluator.model_dump(mode="json"),
        "sourcePairedCounts": json.loads(original_report.read_text())["paired"]["counts"],
        "derivedPairedCounts": report["paired"]["counts"],
        "derivedReportSha256": sha256(f"{canonical_json(report)}\n"),
        "note": (
            "Offline regrade only. Original manifest, trials, evaluations, raw responses, and report "
            "remain unchanged. Incomplete trials remain failures and are not evaluated."
        ),
    }
    _write_json(destination / "addendum.json", addendum)
    return addendum


def _response_from_trial(trial: dict[str, Any]) -> ProviderResponse:
    return ProviderResponse(
        text=trial["responseText"],
        input_tokens=trial["inputTokens"],
        output_tokens=trial["outputTokens"],
        estimated_cost_usd=trial.get("costUsd"),
        tool_calls=trial.get("toolCalls", []),
        cached_input_tokens=trial.get("cachedInputTokens"),
        reasoning_tokens=trial.get("reasoningTokens"),
        total_tokens=trial.get("totalTokens"),
        response_id=trial.get("responseId"),
        actual_model=trial.get("actualModel"),
        outcome=trial.get("responseOutcome", "completed"),
        refusal=trial.get("refusal"),
        provider_request_id=trial.get("providerRequestId"),
        request_duration_ms=trial.get("latencyMs"),
    )


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{canonical_json(value)}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Regrade a completed PolicyC run without provider calls")
    parser.add_argument("run_directory", type=Path)
    args = parser.parse_args()
    print(json.dumps(regrade_run(args.run_directory), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
