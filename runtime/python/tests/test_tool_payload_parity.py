"""The TypeScript planner mirrors `ToolDefinition.provider_dict()` to estimate
billed tool-payload tokens. This test writes the Python payloads for a fixed set
of tools to a shared fixture that `test/experiment.test.ts` compares against, so
either side drifting fails a test."""

from __future__ import annotations

import json
from pathlib import Path

from policyc_runtime.experiment_models import ToolDefinition
from policyc_runtime.hashing import canonical_json

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = ROOT / "protocol" / "fixtures" / "tool-payload-parity.json"


def _payloads() -> dict[str, list[dict[str, object]]]:
    out: dict[str, list[dict[str, object]]] = {}
    for line in (ROOT / "eval/behavioral/compiler-v0.8-regressions.jsonl").read_text().splitlines():
        if not line.strip():
            continue
        case = json.loads(line)
        out[case["caseId"]] = [ToolDefinition.model_validate(t).provider_dict() for t in case["tools"]]
    out["web"] = [ToolDefinition(type="web_search", name="web").provider_dict()]
    out["empty-parameters"] = [
        ToolDefinition(
            type="function",
            name="ping",
            description="Ping.",
            parameters={"type": "object", "properties": {}, "additionalProperties": True},
        ).provider_dict()
    ]
    out["strict-eligible"] = [
        ToolDefinition(
            type="function",
            name="echo",
            description="Echo.",
            parameters={
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
                "additionalProperties": False,
            },
        ).provider_dict()
    ]
    return out


def test_provider_payload_fixture_matches_python() -> None:
    expected = canonical_json(_payloads())
    assert FIXTURE.read_text().strip() == expected.strip(), (
        "provider_dict() changed; regenerate protocol/fixtures/tool-payload-parity.json "
        "with canonical_json(_payloads()) and update providerToolPayload in src/experiment/plan.ts"
    )
