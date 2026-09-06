from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import jsonschema
import pytest
from pydantic import ValidationError

from policyc_runtime.hashing import canonical_json, sha256
from policyc_runtime.manifest import load_artifact
from policyc_runtime.models import (
    SOURCE_SELECTION_STRATEGIES,
    CompiledArtifact,
    PolicyConditionsRecord,
    PolicyReadingRecord,
    SourceSelection,
)

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


def test_protocol_schema_conditionally_requires_traces_by_version() -> None:
    validator = jsonschema.Draft202012Validator(json.loads(PROTOCOL_SCHEMA.read_text()))
    facts = ("currentInformation", "deferredWork", "slideTask", "externalDisclosure", "requestedSlideReorder")
    for version in ("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"):
        artifact = (
            _experimental()
            if version == "1.4.0"
            else _artifact(version, specializations=[RECORD] if version == "1.1.0" else None)
        )
        required_trace = ["specializations"] if version == "1.1.0" else []
        if version in ("1.2.0", "1.3.0"):
            state = dict(STATE)
            if version == "1.2.0":
                for fact in facts:
                    state.pop(fact)
            artifact.update(requestState=state, evaluations=[EVAL], conflicts=[])
        if version in ("1.2.0", "1.3.0", "1.4.0"):
            required_trace = ["requestState", "evaluations", "conflicts"]
        validator.validate(artifact)
        CompiledArtifact.model_validate(artifact)
        for field in required_trace:
            incomplete = {key: value for key, value in artifact.items() if key != field}
            with pytest.raises(jsonschema.ValidationError):
                validator.validate(incomplete)
            with pytest.raises(ValidationError):
                CompiledArtifact.model_validate(incomplete)
        if version in ("1.3.0", "1.4.0"):
            for fact in facts:
                incomplete = {
                    **artifact,
                    "requestState": {key: value for key, value in artifact["requestState"].items() if key != fact},
                }
                with pytest.raises(jsonschema.ValidationError):
                    validator.validate(incomplete)
                with pytest.raises(ValidationError):
                    CompiledArtifact.model_validate(incomplete)


SECTIONS: list[dict[str, Any]] = [
    {
        "heading": "Operating context",
        "startByte": 0,
        "endByte": 512,
        "sha256": sha256("kernel section bytes"),
        "policyIds": ["p0"],
        "retained": True,
        "context": True,
        "reasons": ["source-only operating context, no authored node"],
    },
    {
        "heading": "Slide formatting",
        "startByte": 512,
        "endByte": 900,
        "sha256": sha256("slide section bytes"),
        "policyIds": [],
        "retained": False,
        "context": False,
        "reasons": ["existing-selector semantic prediction: no slide task detected"],
    },
]
SOURCE_SELECTION: dict[str, Any] = {
    "contractVersion": "source-sections-v1",
    "selectionBasis": "current-selector-prediction",
    "sourceMapHash": sha256("source map"),
    "seedPolicyIds": ["p0"],
    "sections": SECTIONS,
}


def _copy(value: Any) -> Any:
    return json.loads(canonical_json(value))


def _section(**overrides: Any) -> dict[str, Any]:
    return {**_copy(SECTIONS[0]), **overrides}


def _selection(sections: list[dict[str, Any]] | None = None, **overrides: Any) -> dict[str, Any]:
    selection = _copy(SOURCE_SELECTION)
    if sections is not None:
        selection["sections"] = _copy(sections)
    selection.update(overrides)
    return selection


def _experimental(strategy: str = "source_preserving_slice", **overrides: Any) -> dict[str, Any]:
    core = _artifact("1.4.0", specializations=None)
    core.pop("candidateId")
    core.pop("createdAt")
    core["compilerVersion"] = "0.10.0-source-slice.1"
    core["compilationStrategy"] = strategy
    core["requestState"] = _copy(STATE)
    core["evaluations"] = [_copy(EVAL)]
    core["conflicts"] = []
    core["sourceSelection"] = _selection()
    core.update(overrides)
    return {**core, "candidateId": f"cand_{sha256(canonical_json(core))[:16]}", "createdAt": "2026-01-01T00:00:00Z"}


def test_experimental_artifact_carries_source_sections_bound_to_its_identity(tmp_path: Path) -> None:
    artifact = _experimental()
    jsonschema.validate(artifact, json.loads(PROTOCOL_SCHEMA.read_text()))
    path = tmp_path / "source-slice.json"
    path.write_text(canonical_json(artifact))
    load_artifact(path)
    tampered = _copy(artifact)
    tampered["sourceSelection"]["sections"][0]["sha256"] = sha256("edited kernel section bytes")
    tampered_path = tmp_path / "tampered.json"
    tampered_path.write_text(canonical_json(tampered))
    with pytest.raises(ValueError, match="candidate ID hash mismatch"):
        load_artifact(tampered_path)


def test_source_selection_requires_matching_protocol_and_strategy(tmp_path: Path) -> None:
    schema = json.loads(PROTOCOL_SCHEMA.read_text())
    for strategy in sorted(SOURCE_SELECTION_STRATEGIES):
        experimental = _experimental(strategy)
        jsonschema.validate(experimental, schema)
        assert CompiledArtifact.model_validate(experimental).compilationStrategy == strategy
        on_legacy_protocol = _experimental(strategy, schemaVersion="1.3.0")
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(on_legacy_protocol, schema)
        with pytest.raises(ValidationError, match="must declare schemaVersion 1.4.0"):
            CompiledArtifact.model_validate(on_legacy_protocol)
    legacy_strategy_on_1_4 = _experimental("compiler_slice")
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(legacy_strategy_on_1_4, schema)
    with pytest.raises(ValidationError, match="reserved for the source-slice strategies"):
        CompiledArtifact.model_validate(legacy_strategy_on_1_4)
    without_selection = _experimental()
    without_selection.pop("sourceSelection")
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(without_selection, schema)
    with pytest.raises(ValidationError, match="must record sourceSelection"):
        CompiledArtifact.model_validate(without_selection)
    selection_on_legacy_emission = _experimental("compiler_slice", schemaVersion="1.3.0")
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(selection_on_legacy_emission, schema)
    with pytest.raises(ValidationError, match="recorded only by schemaVersion 1.4.0"):
        CompiledArtifact.model_validate(selection_on_legacy_emission)
    missing_facts = _experimental()
    missing_facts["requestState"].pop("currentInformation")
    with pytest.raises(ValidationError, match="all compiler 0.10 facts"):
        CompiledArtifact.model_validate(missing_facts)
    legacy_path = tmp_path / "legacy.json"
    legacy_path.write_text(canonical_json(_artifact("1.0.0", specializations=None)))
    assert load_artifact(legacy_path).sourceSelection is None


def test_malformed_source_spans_and_retention_flags_are_rejected() -> None:
    omitted = _section(
        heading="Slide formatting", startByte=512, endByte=900, retained=False, context=False, reasons=[]
    )
    with pytest.raises(ValidationError, match="half-open and non-empty"):
        SourceSelection.model_validate(_selection([_section(startByte=512, endByte=512)]))
    with pytest.raises(ValidationError, match="context sections must be retained"):
        SourceSelection.model_validate(_selection([_section(retained=False, reasons=["prediction"])]))
    with pytest.raises(ValidationError, match="must record reasons"):
        SourceSelection.model_validate(_selection([SECTIONS[0], omitted]))
    with pytest.raises(ValidationError, match="original order without overlap"):
        SourceSelection.model_validate(_selection([SECTIONS[1], SECTIONS[0]]))
    with pytest.raises(ValidationError, match="retain at least one section"):
        SourceSelection.model_validate(_selection([SECTIONS[1]]))
    with pytest.raises(ValidationError):
        SourceSelection.model_validate(_selection([]))
    schema = json.loads(PROTOCOL_SCHEMA.read_text())
    for broken in (
        _selection([_section(retained=False, reasons=["prediction"])]),
        _selection([SECTIONS[0], omitted]),
        _selection([_section(startByte=-1)]),
        _selection([]),
    ):
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(_experimental(sourceSelection=broken), schema)


def test_source_selection_provenance_fields_are_required() -> None:
    schema = json.loads(PROTOCOL_SCHEMA.read_text())
    for field in ("contractVersion", "selectionBasis", "sourceMapHash", "seedPolicyIds", "sections"):
        incomplete = _selection()
        incomplete.pop(field)
        with pytest.raises(ValidationError):
            SourceSelection.model_validate(incomplete)
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(_experimental(sourceSelection=incomplete), schema)
    for broken in (
        _selection(contractVersion="source-sections-v2"),
        _selection(selectionBasis="semantic-equivalence-proof"),
        _selection(sourceMapHash="not-a-hash"),
        _selection(sourceMapNote="undeclared field"),
        _selection([_section(sha256="deadbeef")]),
    ):
        with pytest.raises(ValidationError):
            SourceSelection.model_validate(broken)
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(_experimental(sourceSelection=broken), schema)


CONDITIONS_RECORD = {
    "conditionIndexHash": "d" * 64,
    "conditions": [
        {
            "clause": "destructive.confirm",
            "id": "destructive.confirm/confirmation",
            "sentence": (
                "Ask for confirmation before destructive actions. "
                "Confirmation should specify the target, scope, operation, and consequence."
            ),
            "condition": "Confirmation should specify the target, scope, operation, and consequence",
        }
    ],
}


def test_listed_conditions_are_gated_by_strategy_and_protocol() -> None:
    clause_arm = {
        **_artifact("1.4.0", specializations=None),
        "requestState": STATE,
        "evaluations": [EVAL],
        "conflicts": [],
        "sourceClauseSelection": {},
    }
    # The "before" validator gates provenance by strategy before any field is parsed.
    with pytest.raises(ValidationError, match="must record policyConditions"):
        CompiledArtifact.model_validate({**clause_arm, "compilationStrategy": "condition_list_slice"})
    with pytest.raises(ValidationError, match="do not record policyConditions"):
        CompiledArtifact.model_validate(
            {**clause_arm, "compilationStrategy": "source_clause_slice", "policyConditions": CONDITIONS_RECORD}
        )
    with pytest.raises(ValidationError, match="recorded only by schemaVersion 1.4.0"):
        CompiledArtifact.model_validate(
            {
                **_artifact("1.3.0", specializations=[RECORD]),
                "requestState": STATE,
                "evaluations": [EVAL],
                "conflicts": [],
                "policyConditions": CONDITIONS_RECORD,
            }
        )


def test_reading_records_accept_either_contract_and_conditions_check_their_spans() -> None:
    reading = {"readerId": "reader:m:low:" + "c" * 12, "readingContractSha256": "c" * 64}
    v1 = {"condition": "quoted sentence", "finding": "quoted request", "directive": "Ask first."}
    v2 = {
        "condition": "destructive.confirm/confirmation",
        "holds": "yes",
        "quote": "that part is settled",
        "directive": "",
    }
    assert len(PolicyReadingRecord.model_validate({**reading, "resolutions": [v1, v2]}).resolutions) == 2
    with pytest.raises(ValidationError):
        PolicyReadingRecord.model_validate({**reading, "resolutions": [{**v2, "holds": "maybe"}]})
    with pytest.raises(ValidationError):
        PolicyReadingRecord.model_validate(
            {**reading, "resolutions": [{"condition": "x", "quote": "", "directive": ""}]}
        )
    assert (
        PolicyConditionsRecord.model_validate(CONDITIONS_RECORD).conditions[0].id == "destructive.confirm/confirmation"
    )
    with pytest.raises(ValidationError, match="not within its sentence"):
        PolicyConditionsRecord.model_validate(
            {**CONDITIONS_RECORD, "conditions": [{**CONDITIONS_RECORD["conditions"][0], "condition": "elsewhere"}]}
        )
    with pytest.raises(ValidationError, match="must be unique"):
        PolicyConditionsRecord.model_validate({**CONDITIONS_RECORD, "conditions": CONDITIONS_RECORD["conditions"] * 2})
