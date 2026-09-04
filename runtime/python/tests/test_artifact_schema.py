from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import jsonschema
import pytest
from pydantic import ValidationError

from policyc_runtime.hashing import canonical_json, sha256
from policyc_runtime.manifest import load_artifact
from policyc_runtime.models import CompiledArtifact

PROTOCOL_SCHEMA = Path(__file__).resolve().parents[3] / "protocol" / "compiled-policy-artifact.schema.json"


def _artifact(schema_version: str, *, specializations: list[dict[str, Any]] | None) -> dict[str, Any]:
    prompt = "call_tool:gmail"
    core: dict[str, Any] = {
        "schemaVersion": schema_version,
        "compilerVersion": "0.8.0",
        "policyPackHash": sha256("policies"),
        "sourcePolicyId": "source",
        "sourcePolicyHash": sha256("source"),
        "request": "I confirm sending this one email.",
        "artifactContext": None,
        "selectedPolicyIds": ["p0"],
        "directlySelectedPolicyIds": ["p0"],
        "dependencyAddedPolicyIds": [],
        "criticalPolicyIds": ["p0"],
        "dependencyEdges": [],
        "selectionReasons": [{"policyId": "p0", "reasons": ["test"]}],
        "orderedRuntimeInstructions": [prompt],
        "compiledPrompt": prompt,
        "compiledPromptHash": sha256(prompt),
        "tokenCount": {"tokens": 3, "method": "estimated", "tokenizer": "test", "model": "fake-v1"},
        "compilationStrategy": "compiler_slice",
    }
    if specializations is not None:
        core["specializations"] = specializations
    return {**core, "candidateId": f"cand_{sha256(canonical_json(core))[:16]}", "createdAt": "2026-01-01T00:00:00Z"}


RECORD = {"policyId": "p0", "predicate": "explicit_confirmation", "satisfied": True, "evidence": ["request states it"]}


def test_legacy_artifact_without_specializations_loads_with_empty_trace(tmp_path: Path) -> None:
    path = tmp_path / "legacy.json"
    path.write_text(canonical_json(_artifact("1.0.0", specializations=None)))
    assert load_artifact(path).specializations == []


def test_current_artifact_requires_and_keeps_specializations(tmp_path: Path) -> None:
    path = tmp_path / "current.json"
    path.write_text(canonical_json(_artifact("1.1.0", specializations=[RECORD])))
    loaded = load_artifact(path)
    assert [item.model_dump() for item in loaded.specializations] == [RECORD]
    with pytest.raises(ValidationError, match="must record specializations"):
        CompiledArtifact.model_validate(_artifact("1.1.0", specializations=None))


def test_protocol_schema_conditionally_requires_traces_by_version() -> None:
    schema = json.loads(PROTOCOL_SCHEMA.read_text())
    assert schema["properties"]["schemaVersion"] == {"enum": ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]}
    trace_gate, fact_gate = schema["allOf"]
    assert trace_gate["if"]["properties"]["schemaVersion"] == {"enum": ["1.2.0", "1.3.0"]}
    assert trace_gate["then"] == {"required": ["requestState", "evaluations", "conflicts"]}
    assert trace_gate["else"]["then"] == {"required": ["specializations"]}
    assert fact_gate["if"] == {"properties": {"schemaVersion": {"const": "1.3.0"}}}
    required_facts = fact_gate["then"]["properties"]["requestState"]["required"]
    assert required_facts == [
        "currentInformation",
        "deferredWork",
        "slideTask",
        "externalDisclosure",
        "requestedSlideReorder",
    ]
    for key in ("specializations", "requestState", "evaluations", "conflicts"):
        assert key not in schema["required"]
    state_schema = schema["properties"]["requestState"]["oneOf"][1]
    for key in required_facts:
        assert key in state_schema["properties"]
        assert key not in state_schema["required"], "base shape keeps protocol 1.2 loadable"


STATE = {
    "operation": "send",
    "artifactType": "email",
    "currentInformation": False,
    "deferredWork": False,
    "slideTask": False,
    "externalDisclosure": "safe",
    "requestedSlideReorder": False,
    "authorization": "present",
    "limit": "none",
    "deliverable": "open",
    "purpose": "none",
    "permittedTask": False,
    "format": "none",
    "fields": {"recipient": True, "body": True, "attachment scope": True},
    "operationNamed": True,
    "operationNegated": False,
    "toolsAvailable": ["gmail"],
    "frontend": "deterministic",
    "evidence": ["all send fields stated"],
}
EVAL = {
    "policyId": "p0",
    "branchId": "already_authorized",
    "truth": "true",
    "evidence": ["authorization is present: true"],
}


def test_current_artifact_requires_request_state_and_evaluations(tmp_path: Path) -> None:
    core = _artifact("1.3.0", specializations=None)
    core.pop("candidateId")
    core.pop("createdAt")
    core["requestState"] = STATE
    core["evaluations"] = [EVAL]
    core["conflicts"] = []
    artifact = {**core, "candidateId": f"cand_{sha256(canonical_json(core))[:16]}", "createdAt": "2026-01-01T00:00:00Z"}
    path = tmp_path / "current.json"
    path.write_text(canonical_json(artifact))
    jsonschema.validate(artifact, json.loads(PROTOCOL_SCHEMA.read_text()))
    loaded = load_artifact(path)
    assert loaded.requestState is not None and loaded.requestState.authorization == "present"
    assert loaded.requestState.currentInformation is False
    assert loaded.requestState.externalDisclosure == "safe"
    assert loaded.evaluations[0].branchId == "already_authorized"
    historical = json.loads(canonical_json(artifact))
    historical["schemaVersion"] = "1.2.0"
    for key in ("currentInformation", "deferredWork", "slideTask", "externalDisclosure", "requestedSlideReorder"):
        historical["requestState"].pop(key)
    jsonschema.validate(historical, json.loads(PROTOCOL_SCHEMA.read_text()))
    historical_loaded = CompiledArtifact.model_validate(historical)
    assert historical_loaded.requestState is not None
    assert historical_loaded.requestState.currentInformation is None
    assert historical_loaded.requestState.deferredWork is None
    assert historical_loaded.requestState.slideTask is None
    assert historical_loaded.requestState.externalDisclosure == "unknown"
    assert historical_loaded.requestState.requestedSlideReorder is None
    incomplete_current = json.loads(canonical_json(artifact))
    incomplete_current["requestState"].pop("currentInformation")
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(incomplete_current, json.loads(PROTOCOL_SCHEMA.read_text()))
    with pytest.raises(ValidationError, match="all compiler 0.10 facts"):
        CompiledArtifact.model_validate(incomplete_current)
    with pytest.raises(ValidationError, match="requestState, evaluations, and conflicts"):
        CompiledArtifact.model_validate(_artifact("1.3.0", specializations=None))
    unknown_current_type = json.loads(canonical_json(artifact))
    unknown_current_type["requestState"]["artifactType"] = "database"
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(unknown_current_type, json.loads(PROTOCOL_SCHEMA.read_text()))
    with pytest.raises(ValidationError, match="artifactType"):
        CompiledArtifact.model_validate(unknown_current_type)
    unknown_historical_type = json.loads(canonical_json(unknown_current_type))
    unknown_historical_type["schemaVersion"] = "1.2.0"
    jsonschema.validate(unknown_historical_type, json.loads(PROTOCOL_SCHEMA.read_text()))
    assert CompiledArtifact.model_validate(unknown_historical_type).requestState is not None
