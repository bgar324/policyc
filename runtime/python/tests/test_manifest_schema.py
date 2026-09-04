"""The paired-run manifest schema under protocol/ is the cross-language contract,
but nothing had validated a real manifest against it, so it drifted (it lacked
estimatedInputTokens and the frontend record while the planner wrote both).
This test plans manifests through the real CLI, under the deterministic frontend
and a persisted one, and validates each against the schema; it also validates the
last frozen held-out manifest so historical evidence stays loadable."""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

import jsonschema
import pytest
from pydantic import ValidationError

from policyc_runtime.experiment_models import FrontendRecord, PairedRunManifest
from policyc_runtime.paired_manifest import load_paired_run

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = json.loads((ROOT / "protocol" / "paired-run-manifest.schema.json").read_text())


def _plan(output: Path, extra: list[str]) -> dict:
    subprocess.run(
        [
            "node",
            "dist/cli.js",
            "experiment",
            "--cases",
            "eval/behavioral/compiler-v0.9-regressions.jsonl",
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
            "40",
            "--max-cost-usd",
            "0.60",
            "--retries",
            "0",
            "--run-label",
            "schema-test",
            "--output",
            str(output),
            "--dry-run",
            *extra,
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        env={"PATH": __import__("os").environ["PATH"]},
    )
    return json.loads((output / "manifest.v2.json").read_text())


def test_baseline_manifest_validates_against_protocol_schema(tmp_path: Path) -> None:
    manifest = _plan(tmp_path / "baseline", [])
    jsonschema.validate(manifest, SCHEMA)
    assert manifest["frontend"] == {"frontendId": "deterministic"}
    loaded = load_paired_run(tmp_path / "baseline" / "manifest.v2.json")
    assert loaded.manifest.frontend.frontendId == "deterministic"


READ = {
    "currentInformation": None,
    "deferredWork": None,
    "slideTask": None,
    "externalDisclosure": "unknown",
    "requestedSlideReorder": None,
    "authorization": "absent",
    "limit": "none",
    "purpose": "none",
    "permittedTask": False,
    "format": "none",
    "operationNamed": True,
    "operationNegated": False,
    "fields": {"recipient": True, "body": True, "attachment scope": True},
    "evidence": ["fixture"],
}


def test_persisted_frontend_manifest_records_file_hash_and_validates(tmp_path: Path) -> None:
    contract = json.loads(
        subprocess.run(
            [
                "node",
                "--input-type=module",
                "--eval",
                (
                    "import { extractorContract, extractorFrontendId } from "
                    "'./dist/extractor/contract.js'; "
                    "const contract = extractorContract(); "
                    "console.log(JSON.stringify({ "
                    "readContractSha256: contract.readContractSha256, "
                    "frontendId: extractorFrontendId('fixture', contract.readContractSha256) "
                    "}));"
                ),
            ],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    )
    reads = tmp_path / "reads.json"
    reads.write_text(json.dumps({**contract, "reads": {"cv09-041v4": READ}}))
    manifest = _plan(tmp_path / "fixture", ["--request-state-reads", str(reads)])
    jsonschema.validate(manifest, SCHEMA)
    record = manifest["frontend"]
    assert record["frontendId"] == contract["frontendId"]
    assert record["readContractSha256"] == contract["readContractSha256"]
    assert record["readsSha256"] == hashlib.sha256(reads.read_bytes()).hexdigest()
    assert Path(record["readsPath"]) == reads.resolve()
    baseline = _plan(tmp_path / "baseline2", [])
    assert manifest["compilerHash"] != baseline["compilerHash"], "frontend identity must change the compiler hash"


def test_historical_manifest_still_validates() -> None:
    path = ROOT / "runs" / "compiler-v0.8-held-out-v4" / "manifest.v2.json"
    if not path.exists():
        pytest.skip("held-out-v4 run directory is not present on this machine")
    manifest = json.loads(path.read_text())
    # Pre-0.9 manifests omit the field; the Pydantic default supplies it and the
    # schema requires it, so validate what the runtime would load, not the raw file.
    loaded = PairedRunManifest.model_validate(manifest)
    jsonschema.validate(loaded.model_dump(mode="json", by_alias=True, exclude_none=True), SCHEMA)
    assert loaded.frontend.frontendId == "deterministic"


def test_persisted_frontend_without_hash_is_rejected() -> None:
    with pytest.raises(ValidationError, match="readsSha256"):
        FrontendRecord(frontendId="some-extractor")
    assert FrontendRecord(frontendId="deterministic").readsSha256 is None
