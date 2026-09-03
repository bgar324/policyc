"""The planner writes `estimatedInputTokens` per candidate (artifact prompt +
request + provider tool payload + fixed overhead). The runtime must reserve from
that value, and its spend plan must sum it, so the pre-attempt guard and the
dry-run ceilings agree with what the provider bills. Older manifests without the
field fall back to artifact tokens plus the fixed overhead."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from policyc_runtime.paired_manifest import load_paired_run
from policyc_runtime.paired_runtime import estimated_input_tokens, spend_plan

ROOT = Path(__file__).resolve().parents[3]


def _plan(output: Path) -> None:
    subprocess.run(
        [
            "node",
            "dist/cli.js",
            "experiment",
            "--cases",
            "eval/behavioral/compiler-v0.8-regressions.jsonl",
            "--strategies",
            "full_policy,compiler_slice",
            "--provider",
            "openai",
            "--model",
            "gpt-5-mini-2025-08-07",
            "--samples",
            "1",
            "--concurrency",
            "1",
            "--max-output-tokens",
            "256",
            "--max-calls",
            "12",
            "--max-cost-usd",
            "0.10",
            "--retries",
            "0",
            "--run-label",
            "reservation-test",
            "--output",
            str(output),
            "--dry-run",
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )


def test_runtime_reserves_from_planner_estimate_and_falls_back_without_it(tmp_path: Path) -> None:
    output = tmp_path / "run"
    _plan(output)
    loaded = load_paired_run(output / "manifest.v2.json")
    manifest = loaded.manifest

    # Provider-reported input per compiler_slice call in run_b9daf24a2c394e8d.
    observed = {"cv08-007": 429, "cv08-010": 471, "cv08-047": 498, "cv08-051": 458, "cv08-053": 489, "cv08-058": 447}
    for plan in manifest.casePlans:
        for candidate in plan.candidates:
            artifact = loaded.artifacts[f"{plan.caseId}:{candidate.strategy}"]
            reserved = estimated_input_tokens(manifest, artifact, plan.caseId, candidate.strategy)
            assert candidate.estimatedInputTokens is not None
            assert reserved == candidate.estimatedInputTokens
            assert reserved > artifact.tokenCount.tokens + manifest.inputTokenOverheadPerCall
            if candidate.strategy == "compiler_slice":
                assert reserved >= observed[plan.caseId], f"{plan.caseId}: reservation {reserved} below observed"

    plan_summary = spend_plan(loaded)
    per_call_total = sum(
        candidate.estimatedInputTokens or 0 for plan in manifest.casePlans for candidate in plan.candidates
    )
    assert plan_summary["logicalInputTokens"] == per_call_total * manifest.sampleCount
    assert plan_summary["logicalInputTokens"] <= manifest.budget.maxInputTokens

    # Legacy manifest shape: strip the field and confirm the fallback formula.
    raw = json.loads((output / "manifest.v2.json").read_text())
    for plan in raw["casePlans"]:
        for candidate in plan["candidates"]:
            candidate.pop("estimatedInputTokens")
    legacy_path = output / "manifest.legacy.json"
    legacy_path.write_text(json.dumps(raw))
    legacy = load_paired_run(legacy_path)
    for plan in legacy.manifest.casePlans:
        for candidate in plan.candidates:
            artifact = legacy.artifacts[f"{plan.caseId}:{candidate.strategy}"]
            assert (
                estimated_input_tokens(legacy.manifest, artifact, plan.caseId, candidate.strategy)
                == artifact.tokenCount.tokens + legacy.manifest.inputTokenOverheadPerCall
            )
