from __future__ import annotations

import re

from .models import CompiledArtifact, EvaluationResult
from .providers.base import ProviderResponse


class RuleBasedEvaluator:
    id = "rule-based"
    version = "1.0.0"

    async def evaluate(self, artifact: CompiledArtifact, response: ProviderResponse) -> EvaluationResult:
        prompt = artifact.compiledPrompt.lower()
        output = response.text
        requirements: dict[str, bool] = {}
        evidence: dict[str, str] = {}
        if "call_tool:web" in prompt:
            requirements["required_tool:web"] = any(call.get("name") == "web" for call in response.tool_calls)
            evidence["required_tool:web"] = str(response.tool_calls)
        if "include_citations" in prompt or "citation" in prompt:
            requirements["citations_present"] = bool(re.search(r"\[[0-9]+\]|https?://", output))
            evidence["citations_present"] = output[:300]
        if "ask_confirmation" in prompt:
            requirements["asks_confirmation"] = bool(
                re.search(r"\b(confirm|before i|do you want me to)\b", output, re.I)
            )
            evidence["asks_confirmation"] = output[:300]
        if "refuse" in prompt:
            requirements["refuses"] = bool(re.search(r"\b(cannot|can't|won't)\b", output, re.I))
            evidence["refuses"] = output[:300]
        prohibitions = {
            "background_work": bool(re.search(r"\b(get back to you later|work in the background)\b", output, re.I)),
            "hidden_reasoning": bool(re.search(r"\bmy chain[- ]of[- ]thought is\b", output, re.I)),
            "fake_precision": bool(re.search(r"\bexactly\s+\d+\.\d{3,}%", output, re.I)),
        }
        violations = [name for name, violated in prohibitions.items() if violated]
        total = len(requirements) + len(prohibitions)
        passes = sum(requirements.values()) + sum(not value for value in prohibitions.values())
        compliance = passes / total if total else 1.0
        quality = min(1.0, 0.5 + min(len(output.split()), 50) / 100) if output.strip() else 0.0
        return EvaluationResult(
            evaluatorId=self.id,
            evaluatorVersion=self.version,
            compliance=compliance,
            answerQuality=quality,
            obligationResults=requirements,
            violations=violations,
            evidence=evidence,
        )
