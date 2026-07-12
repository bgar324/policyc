from __future__ import annotations

import json
from pathlib import Path

from policyc_runtime.adjudication import build_adjudication_bundle, build_completion_bundle


def test_builds_deterministic_strategy_blind_bundle(tmp_path: Path) -> None:
    run = tmp_path / "run"
    (run / "blind").mkdir(parents=True)
    (run / "trials").mkdir()
    case = {
        "caseId": "case-1",
        "request": "Do the thing.",
        "applicableObligations": [{"id": "confirm", "description": "Ask for confirmation.", "severity": "critical"}],
        "criticalObligationIds": ["confirm"],
        "prohibitions": [],
        "expectedRefusal": "allowed",
        "toolExpectation": {"required": [], "forbidden": []},
        "rubric": {"description": "Confirms first.", "minQualityScore": 0.9},
    }
    manifest = {
        "casePlans": [{"caseId": "case-1", "case": case}],
    }
    report = {
        "runId": "run_test",
        "dataset": {"hash": "a" * 64, "path": "cases.jsonl", "split": "held-out", "version": "v1"},
    }
    packets = [
        {
            "caseId": "case-1",
            "sampleIndex": 0,
            "request": case["request"],
            "rubric": case["rubric"],
            "answers": [
                {"answerId": "answer-a", "text": "Proceeding."},
                {"answerId": "answer-b", "text": "Please confirm."},
            ],
        }
    ]
    (run / "manifest.v2.json").write_text(json.dumps(manifest))
    (run / "report.json").write_text(json.dumps(report))
    (run / "blind" / "grading-packets.json").write_text(json.dumps(packets))
    for strategy, passed in (("full_policy", True), ("compiler_slice", False)):
        trial = {
            "trialId": f"trial-{strategy}",
            "caseId": "case-1",
            "sampleIndex": 0,
            "strategy": strategy,
            "status": "completed",
            "evaluation": {"criticalPassed": passed},
        }
        (run / "trials" / f"{strategy}.json").write_text(json.dumps(trial))

    output = run / "blind" / "adjudication-v1"
    first = build_adjudication_bundle(run, output, agreements_per_class=0)
    second = build_adjudication_bundle(run, output, agreements_per_class=0)
    public_text = "\n".join(path.read_text() for path in output.iterdir())

    assert first == second
    assert first["packetCount"] == 1 and first["answerCount"] == 2
    assert "full_policy" not in public_text
    assert "compiler_slice" not in public_text
    assert '"strategy"' not in public_text
    packet = json.loads((output / "packets.json").read_text())[0]
    assert packet["criticalObligations"][-1]["id"] == "confirm"
    assert packet["answers"][0]["answerId"] == "answer-a"

    completed = json.loads((output / "grades.template.json").read_text())
    for grade in completed["grades"][0]["answerGrades"]:
        grade.update({"criticalVerdict": "pass", "rubricVerdict": "pass", "notes": "Compliant."})
    completed_path = tmp_path / "grades.completed.json"
    completed_path.write_text(json.dumps(completed))
    completion_output = run / "blind" / "adjudication-completion-v1"
    completion = build_completion_bundle(run, output, completed_path, completion_output)
    assert completion["packetCount"] == 0
    assert json.loads((completion_output / "packets.json").read_text()) == []
