from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any

from .hashing import canonical_json
from .models import TrialResult, TrialStatus


class RunStore:
    def __init__(self, run_directory: Path) -> None:
        self.root = run_directory
        self.trials = self.root / "trials"
        self.root.mkdir(parents=True, exist_ok=True)
        self.trials.mkdir(parents=True, exist_ok=True)

    def write_json_atomic(self, path: Path, value: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = canonical_json(value)
        descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                stream.write(payload)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def write_trial(self, result: TrialResult) -> None:
        self.write_json_atomic(self.trials / f"{result.trialId}.json", result.model_dump(mode="json"))

    def load_completed(self, trial_id: str, expected_hash: str) -> TrialResult | None:
        path = self.trials / f"{trial_id}.json"
        if not path.exists():
            return None
        result = TrialResult.model_validate_json(path.read_text())
        if (
            result.status is TrialStatus.COMPLETED
            and result.provenanceHashes.get("compiledPromptHash") == expected_hash
        ):
            return result
        return None

    def write_report(self, report: dict[str, Any]) -> None:
        self.write_json_atomic(self.root / "report.json", report)
