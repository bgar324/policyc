from __future__ import annotations

import json
import os
import sqlite3
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .experiment_models import PairedRunManifest
from .hashing import canonical_json, sha256

SCHEMA_VERSION = 1


def default_catalog_path() -> Path:
    configured = os.environ.get("POLICYC_CATALOG")
    if configured:
        return Path(configured).expanduser().resolve()
    current = Path.cwd().resolve()
    for candidate in (current, *current.parents):
        if (candidate / "package.json").exists() and (candidate / "runtime/python").exists():
            return candidate / ".policyc/catalog.sqlite"
    return current / ".policyc/catalog.sqlite"


class RunCatalog:
    def __init__(self, path: Path | None = None) -> None:
        self.path = (path or default_catalog_path()).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def register(
        self,
        manifest: PairedRunManifest,
        manifest_path: Path,
        run_directory: Path,
        *,
        status: str = "running",
    ) -> None:
        now = _now()
        git_commit, git_dirty = _git_state()
        manifest_value = manifest.model_dump(mode="json")
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO runs (
                    run_id, schema_version, experiment_name, status, provider, model,
                    dataset_version, dataset_hash, dataset_split, compiler_hash,
                    git_commit, git_dirty, manifest_hash, manifest_path, run_directory,
                    created_at, started_at, updated_at, logical_trials, max_calls, max_cost_usd
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                    status=excluded.status, git_commit=excluded.git_commit,
                    git_dirty=excluded.git_dirty, manifest_hash=excluded.manifest_hash,
                    manifest_path=excluded.manifest_path, run_directory=excluded.run_directory,
                    updated_at=excluded.updated_at
                """,
                (
                    manifest.runId,
                    manifest.schemaVersion,
                    manifest.experimentName,
                    status,
                    manifest.provider,
                    manifest.model,
                    manifest.dataset.version,
                    manifest.dataset.hash,
                    manifest.dataset.split,
                    manifest.compilerHash,
                    git_commit,
                    git_dirty,
                    sha256(canonical_json(manifest_value)),
                    str(manifest_path.resolve()),
                    str(run_directory.resolve()),
                    manifest.createdAt.isoformat(),
                    now,
                    now,
                    manifest.budget.maxLogicalTrials,
                    manifest.budget.maxCalls,
                    manifest.budget.maxCostUsd,
                ),
            )

    def record_trial(self, result: dict[str, Any]) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO trials (
                    trial_id, run_id, case_id, strategy, sample_index, status,
                    attempt_count, input_tokens, cached_input_tokens, output_tokens,
                    cost_usd, latency_ms, critical_passed, passed, error_outcome, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(trial_id) DO UPDATE SET
                    status=excluded.status, attempt_count=excluded.attempt_count,
                    input_tokens=excluded.input_tokens,
                    cached_input_tokens=excluded.cached_input_tokens,
                    output_tokens=excluded.output_tokens, cost_usd=excluded.cost_usd,
                    latency_ms=excluded.latency_ms, critical_passed=excluded.critical_passed,
                    passed=excluded.passed, error_outcome=excluded.error_outcome,
                    updated_at=excluded.updated_at
                """,
                (
                    result["trialId"],
                    result["runId"],
                    result["caseId"],
                    result["strategy"],
                    result["sampleIndex"],
                    result["status"],
                    result.get("attemptCount", 0),
                    result.get("inputTokens"),
                    result.get("cachedInputTokens"),
                    result.get("outputTokens"),
                    result.get("costUsd"),
                    result.get("latencyMs"),
                    _optional_bool(result.get("evaluation", {}).get("criticalPassed")),
                    _optional_bool(result.get("evaluation", {}).get("passed")),
                    result.get("error", {}).get("outcome"),
                    _now(),
                ),
            )
            self._refresh_counts(connection, result["runId"])

    def finalize(
        self,
        run_id: str,
        *,
        status: str,
        budget: dict[str, Any] | None = None,
        report_path: Path | None = None,
        stop_reason: str | None = None,
    ) -> None:
        budget = budget or {}
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE runs SET status=?, completed_at=?, updated_at=?, calls=?,
                    input_tokens=?, output_tokens=?, actual_cost_usd=?,
                    ambiguous_cost_exposure_usd=?, report_path=?, stop_reason=?
                WHERE run_id=?
                """,
                (
                    status,
                    _now(),
                    _now(),
                    budget.get("calls"),
                    budget.get("actualInputTokens"),
                    budget.get("actualOutputTokens"),
                    budget.get("actualCostUsd"),
                    budget.get("ambiguousCostExposureUsd"),
                    str(report_path.resolve()) if report_path else None,
                    stop_reason,
                    run_id,
                ),
            )
            self._refresh_counts(connection, run_id)

    def list_runs(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM runs ORDER BY COALESCE(started_at, created_at) DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(row) for row in rows]

    def show(self, run_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            run = connection.execute("SELECT * FROM runs WHERE run_id=?", (run_id,)).fetchone()
            if run is None:
                return None
            trials = connection.execute(
                "SELECT * FROM trials WHERE run_id=? ORDER BY case_id, sample_index, strategy", (run_id,)
            ).fetchall()
        return {"run": dict(run), "trials": [dict(row) for row in trials]}

    def rebuild(self, root: Path) -> dict[str, int]:
        manifests = sorted(root.resolve().rglob("manifest.canonical.json")) if root.exists() else []
        imported = 0
        skipped = 0
        for manifest_path in manifests:
            try:
                manifest = PairedRunManifest.model_validate_json(manifest_path.read_text())
                run_directory = manifest_path.parent
                self.register(manifest, manifest_path, run_directory, status="running")
                for trial_path in sorted((run_directory / "trials").glob("*.json")):
                    self.record_trial(json.loads(trial_path.read_text()))
                budget_path = run_directory / "budget.json"
                report_path = run_directory / "report.json"
                budget = json.loads(budget_path.read_text()) if budget_path.exists() else None
                status = "completed" if report_path.exists() else "incomplete"
                self.finalize(
                    manifest.runId,
                    status=status,
                    budget=budget,
                    report_path=report_path if report_path.exists() else None,
                )
                imported += 1
            except (OSError, ValueError, json.JSONDecodeError):
                skipped += 1
        return {"imported": imported, "skipped": skipped, "discovered": len(manifests)}

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS runs (
                    run_id TEXT PRIMARY KEY,
                    schema_version TEXT NOT NULL,
                    experiment_name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    dataset_version TEXT NOT NULL,
                    dataset_hash TEXT NOT NULL,
                    dataset_split TEXT NOT NULL,
                    compiler_hash TEXT NOT NULL,
                    git_commit TEXT,
                    git_dirty INTEGER,
                    manifest_hash TEXT NOT NULL,
                    manifest_path TEXT NOT NULL,
                    run_directory TEXT NOT NULL,
                    report_path TEXT,
                    created_at TEXT NOT NULL,
                    started_at TEXT,
                    completed_at TEXT,
                    updated_at TEXT NOT NULL,
                    logical_trials INTEGER NOT NULL,
                    completed_trials INTEGER NOT NULL DEFAULT 0,
                    failed_trials INTEGER NOT NULL DEFAULT 0,
                    ambiguous_trials INTEGER NOT NULL DEFAULT 0,
                    calls INTEGER,
                    max_calls INTEGER NOT NULL,
                    input_tokens INTEGER,
                    output_tokens INTEGER,
                    actual_cost_usd REAL,
                    ambiguous_cost_exposure_usd REAL,
                    max_cost_usd REAL NOT NULL,
                    stop_reason TEXT
                );
                CREATE TABLE IF NOT EXISTS trials (
                    trial_id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
                    case_id TEXT NOT NULL,
                    strategy TEXT NOT NULL,
                    sample_index INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    attempt_count INTEGER NOT NULL,
                    input_tokens INTEGER,
                    cached_input_tokens INTEGER,
                    output_tokens INTEGER,
                    cost_usd REAL,
                    latency_ms REAL,
                    critical_passed INTEGER,
                    passed INTEGER,
                    error_outcome TEXT,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS trials_run_id ON trials(run_id);
                CREATE INDEX IF NOT EXISTS trials_case ON trials(run_id, case_id);
                """
            )
            connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA busy_timeout = 30000")
        return connection

    @staticmethod
    def _refresh_counts(connection: sqlite3.Connection, run_id: str) -> None:
        connection.execute(
            """
            UPDATE runs SET
                completed_trials=(SELECT COUNT(*) FROM trials WHERE run_id=? AND status='completed'),
                failed_trials=(SELECT COUNT(*) FROM trials WHERE run_id=? AND status='failed'),
                ambiguous_trials=(SELECT COUNT(*) FROM trials WHERE run_id=? AND status='ambiguous'),
                updated_at=?
            WHERE run_id=?
            """,
            (run_id, run_id, run_id, _now(), run_id),
        )


def _git_state() -> tuple[str | None, bool | None]:
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"], check=True, capture_output=True, text=True, timeout=5
        ).stdout.strip()
        dirty = bool(
            subprocess.run(
                ["git", "status", "--porcelain"], check=True, capture_output=True, text=True, timeout=5
            ).stdout.strip()
        )
        return commit, dirty
    except (OSError, subprocess.SubprocessError):
        return None, None


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _optional_bool(value: Any) -> int | None:
    return int(value) if isinstance(value, bool) else None
