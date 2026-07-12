from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import Field

from .models import StrictModel


class ModelPrice(StrictModel):
    modelId: str
    effectiveDate: str
    inputPerMillion: float = Field(ge=0)
    cachedInputPerMillion: float = Field(ge=0)
    outputPerMillion: float = Field(ge=0)
    reasoningTokens: Literal["included_in_output"]
    source: str


class PricingRegistry(StrictModel):
    schemaVersion: Literal["1.0.0"]
    version: str
    currency: Literal["USD"]
    models: list[ModelPrice]

    def lookup(self, model: str) -> ModelPrice:
        match = next((item for item in self.models if item.modelId == model), None)
        if match is None:
            raise ValueError(f"unknown model pricing: {model}")
        return match


def load_pricing(path: str, expected_version: str) -> PricingRegistry:
    registry = PricingRegistry.model_validate(json.loads(Path(path).read_text()))
    if registry.version != expected_version:
        raise ValueError(f"pricing registry version mismatch: expected {expected_version}, got {registry.version}")
    return registry


def calculate_cost(price: ModelPrice, input_tokens: int, cached_input_tokens: int, output_tokens: int) -> float:
    if min(input_tokens, cached_input_tokens, output_tokens) < 0 or cached_input_tokens > input_tokens:
        raise ValueError("invalid token usage for cost calculation")
    regular = input_tokens - cached_input_tokens
    return (
        regular * price.inputPerMillion
        + cached_input_tokens * price.cachedInputPerMillion
        + output_tokens * price.outputPerMillion
    ) / 1_000_000
