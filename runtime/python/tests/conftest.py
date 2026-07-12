from __future__ import annotations

from pathlib import Path
from typing import Any

from policyc_runtime.hashing import canonical_json, sha256


def write_run(
    root: Path,
    *,
    candidates: int = 2,
    samples: int = 2,
    concurrency: int = 2,
    timeout: float = 0.2,
    attempts: int = 3,
    requests_per_window: int = 100,
) -> tuple[Path, list[dict[str, Any]]]:
    artifact_dir = root / "artifacts"
    artifact_dir.mkdir(parents=True)
    artifacts = []
    for index in range(candidates):
        prompt = "call_tool:web include_citations" if index else "full policy citation web"
        core: dict[str, Any] = {
            "schemaVersion": "1.0.0",
            "compilerVersion": "test",
            "policyPackHash": sha256("policies"),
            "sourcePolicyId": "test-source",
            "sourcePolicyHash": sha256("source"),
            "request": "latest news",
            "artifactContext": None,
            "selectedPolicyIds": sorted({"p0", f"p{index}"}),
            "directlySelectedPolicyIds": sorted({"p0", f"p{index}"}),
            "dependencyAddedPolicyIds": [],
            "criticalPolicyIds": ["p0"],
            "dependencyEdges": [],
            "selectionReasons": [{"policyId": f"p{index}", "reasons": ["test"]}],
            "orderedRuntimeInstructions": [prompt],
            "compiledPrompt": prompt,
            "compiledPromptHash": sha256(prompt),
            "tokenCount": {"tokens": 10 + index, "method": "estimated", "tokenizer": "test", "model": "fake-v1"},
            "compilationStrategy": "full_policy" if index == 0 else "compiler_slice",
        }
        artifact = {
            **core,
            "candidateId": f"cand_{sha256(canonical_json(core))[:16]}",
            "createdAt": "2026-01-01T00:00:00Z",
        }
        (artifact_dir / f"{artifact['candidateId']}.json").write_text(canonical_json(artifact) + "\n")
        artifacts.append(artifact)
    manifest = {
        "schemaVersion": "1.0.0",
        "runId": "run_test",
        "experimentName": "test",
        "candidates": [f"artifacts/{item['candidateId']}.json" for item in artifacts],
        "fullPolicyCandidateId": artifacts[0]["candidateId"],
        "provider": "fake",
        "model": "fake-v1",
        "modelParameters": {"temperature": 0},
        "sampleCount": samples,
        "maxConcurrency": concurrency,
        "timeoutSeconds": timeout,
        "retryPolicy": {
            "maxAttempts": attempts,
            "initialBackoffSeconds": 0.001,
            "maxBackoffSeconds": 0.005,
            "jitterFraction": 0,
        },
        "rateLimit": {
            "requestsPerWindow": requests_per_window,
            "windowSeconds": 0.01,
            "maxConcurrentRequests": concurrency,
        },
        "evaluator": {"id": "rule-based", "version": "1.0.0", "nonInferiorityMargin": 0.05},
        "seed": 1,
        "outputDirectory": ".",
        "rawResponseRetention": "text",
    }
    path = root / "manifest.json"
    path.write_text(canonical_json(manifest) + "\n")
    return path, artifacts
