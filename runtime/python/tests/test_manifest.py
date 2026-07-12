import json
import os
import subprocess
from pathlib import Path

import pytest
from pydantic import ValidationError

from policyc_runtime.manifest import load_run
from policyc_runtime.paired_manifest import load_paired_run

from .conftest import write_run


def test_manifest_and_artifact_hashes_validate(tmp_path):
    path, artifacts = write_run(tmp_path)
    loaded = load_run(path)
    assert len(loaded.artifacts) == 2
    assert loaded.manifest.fullPolicyCandidateId == artifacts[0]["candidateId"]


def test_incompatible_schema_is_rejected(tmp_path):
    path, _ = write_run(tmp_path)
    value = json.loads(path.read_text())
    value["schemaVersion"] = "2.0.0"
    path.write_text(json.dumps(value))
    with pytest.raises(ValidationError):
        load_run(path)


def test_modified_artifact_is_rejected(tmp_path):
    path, artifacts = write_run(tmp_path)
    artifact_path = tmp_path / "artifacts" / f"{artifacts[0]['candidateId']}.json"
    value = json.loads(artifact_path.read_text())
    value["compiledPrompt"] += " tampered"
    artifact_path.write_text(json.dumps(value))
    with pytest.raises(ValueError, match="prompt hash mismatch"):
        load_run(path)


def test_typescript_compiled_artifacts_are_accepted_by_python(tmp_path):
    root = Path(__file__).resolve().parents[3]
    subprocess.run(
        [
            "node",
            "dist/cli.js",
            "experiment",
            "--cases",
            "eval/behavioral/smoke-v1.jsonl",
            "--strategies",
            "full_policy,compiler_slice",
            "--provider",
            "fake",
            "--output",
            str(tmp_path),
            "--model",
            "gpt-5-mini-2025-08-07",
            "--samples",
            "1",
            "--concurrency",
            "1",
            "--max-output-tokens",
            "256",
            "--max-calls",
            "2",
            "--max-cost-usd",
            "0.02",
            "--retries",
            "0",
            "--dry-run",
        ],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )
    loaded = load_paired_run(tmp_path / "manifest.v2.json")
    assert len(loaded.artifacts) == 2
    assert {item.compilationStrategy for item in loaded.artifacts.values()} == {"full_policy", "compiler_slice"}


def test_repeating_top_level_command_resumes_without_new_provider_calls(tmp_path):
    root = Path(__file__).resolve().parents[3]
    output = tmp_path / "run"
    command = [
        "node",
        "dist/cli.js",
        "experiment",
        "--cases",
        "eval/behavioral/smoke-v1.jsonl",
        "--strategies",
        "full_policy,compiler_slice",
        "--provider",
        "fake",
        "--model",
        "gpt-5-mini-2025-08-07",
        "--samples",
        "1",
        "--concurrency",
        "1",
        "--max-output-tokens",
        "256",
        "--max-calls",
        "2",
        "--max-cost-usd",
        "0.02",
        "--retries",
        "0",
        "--output",
        str(output),
        "--yes",
    ]
    environment = {**os.environ, "POLICYC_CATALOG": str(tmp_path / "catalog.sqlite")}
    subprocess.run(command, cwd=root, env=environment, check=True, capture_output=True, text=True)
    first = json.loads((output / "manifest.v2.json").read_text())
    subprocess.run(command, cwd=root, env=environment, check=True, capture_output=True, text=True)
    second = json.loads((output / "manifest.v2.json").read_text())

    assert first["runId"] == second["runId"]
    assert first["createdAt"] == second["createdAt"]
    assert len(list((output / "raw").glob("*/attempt-*.json"))) == 2
    budget = json.loads((output / "budget.json").read_text())
    assert budget["calls"] == 2


def test_run_label_creates_distinct_preserved_attempt_identity(tmp_path):
    root = Path(__file__).resolve().parents[3]
    run_ids = []
    for label in ("smoke-1", "smoke-2"):
        output = tmp_path / label
        subprocess.run(
            [
                "node",
                "dist/cli.js",
                "experiment",
                "--cases",
                "eval/behavioral/smoke-v1.jsonl",
                "--strategies",
                "full_policy,compiler_slice",
                "--provider",
                "fake",
                "--model",
                "gpt-5-mini-2025-08-07",
                "--samples",
                "1",
                "--concurrency",
                "1",
                "--max-output-tokens",
                "256",
                "--max-calls",
                "2",
                "--max-cost-usd",
                "0.02",
                "--retries",
                "0",
                "--run-label",
                label,
                "--output",
                str(output),
                "--dry-run",
            ],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        )
        value = json.loads((output / "manifest.v2.json").read_text())
        assert value["runLabel"] == label
        run_ids.append(value["runId"])
    assert run_ids[0] != run_ids[1]
