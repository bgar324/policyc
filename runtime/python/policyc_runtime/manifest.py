from __future__ import annotations

import json
from pathlib import Path

from .hashing import canonical_json, sha256
from .models import CompiledArtifact, LoadedRun, RunManifest


def load_run(path: str | Path) -> LoadedRun:
    manifest_path = Path(path).resolve()
    manifest = RunManifest.model_validate_json(manifest_path.read_text())
    base = manifest_path.parent
    artifacts = [load_artifact((base / item).resolve()) for item in manifest.candidates]
    ids = {artifact.candidateId for artifact in artifacts}
    if len(ids) != len(artifacts):
        raise ValueError("candidate artifacts must have unique candidate IDs")
    if manifest.fullPolicyCandidateId not in ids:
        raise ValueError("fullPolicyCandidateId is not present in candidates")
    run_directory = (base / manifest.outputDirectory).resolve()
    return LoadedRun(manifest=manifest, manifestPath=manifest_path, artifacts=artifacts, runDirectory=run_directory)


def load_artifact(path: Path) -> CompiledArtifact:
    raw = json.loads(path.read_text())
    artifact = CompiledArtifact.model_validate(raw)
    if sha256(artifact.compiledPrompt) != artifact.compiledPromptHash:
        raise ValueError(f"compiled prompt hash mismatch: {path}")
    core = dict(raw)
    core.pop("candidateId")
    core.pop("createdAt")
    expected_id = f"cand_{sha256(canonical_json(core))[:16]}"
    if artifact.candidateId != expected_id:
        raise ValueError(f"candidate ID hash mismatch: {path}")
    return artifact
