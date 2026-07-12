from __future__ import annotations

import json
from pathlib import Path

from .experiment_models import LoadedPairedRun, PairedRunManifest
from .hashing import canonical_json, sha256
from .manifest import load_artifact


def load_paired_run(path: Path) -> LoadedPairedRun:
    manifest_path = path.resolve()
    manifest = PairedRunManifest.model_validate_json(manifest_path.read_text())
    dataset_path = Path(manifest.dataset.path)
    if not dataset_path.is_absolute():
        dataset_path = (manifest_path.parent / dataset_path).resolve()
    rows = [json.loads(line) for line in dataset_path.read_text().splitlines() if line.strip()]
    dataset_hash = sha256("".join(f"{canonical_json(row)}\n" for row in rows))
    if dataset_hash != manifest.dataset.hash:
        raise ValueError(f"dataset hash mismatch: expected {manifest.dataset.hash}, got {dataset_hash}")
    if {row.get("datasetVersion") for row in rows} != {manifest.dataset.version}:
        raise ValueError("dataset version does not match manifest")
    if {row.get("split") for row in rows} != {manifest.dataset.split}:
        raise ValueError("dataset split does not match manifest")

    artifacts = {}
    for case_plan in manifest.casePlans:
        for candidate in case_plan.candidates:
            artifact_path = Path(candidate.artifactPath)
            if not artifact_path.is_absolute():
                artifact_path = (manifest_path.parent / artifact_path).resolve()
            artifact = load_artifact(artifact_path)
            if artifact.candidateId != candidate.candidateId:
                raise ValueError(f"candidate ID mismatch for {artifact_path}")
            if artifact.compilationStrategy != candidate.strategy:
                raise ValueError(f"strategy mismatch for {artifact_path}")
            if artifact.request != case_plan.case.request:
                raise ValueError(f"artifact request mismatch for case {case_plan.caseId}")
            artifacts[f"{case_plan.caseId}:{candidate.strategy}"] = artifact

    run_directory = Path(manifest.outputDirectory)
    if not run_directory.is_absolute():
        run_directory = (manifest_path.parent / run_directory).resolve()
    run_directory.mkdir(parents=True, exist_ok=True)
    return LoadedPairedRun(
        manifest=manifest,
        manifestPath=str(manifest_path),
        artifacts=artifacts,
        runDirectory=str(run_directory),
    )
