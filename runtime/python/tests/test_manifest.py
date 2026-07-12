import json
import subprocess
from pathlib import Path

import pytest
from pydantic import ValidationError

from policyc_runtime.manifest import load_run

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
            "compile-candidates",
            "--input",
            "latest news",
            "--output",
            str(tmp_path),
            "--model",
            "fake-v1",
        ],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )
    loaded = load_run(tmp_path / "manifest.json")
    assert len(loaded.artifacts) == 5
    assert {item.compilationStrategy for item in loaded.artifacts} == {
        "full_policy",
        "compiler_slice",
        "kernel_only",
        "direct_matches",
        "conservative_expanded",
    }
