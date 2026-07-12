from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from .experiment_models import BudgetConfig
from .pricing import ModelPrice, calculate_cost


class BudgetExceeded(RuntimeError):
    pass


@dataclass(slots=True)
class Reservation:
    input_tokens: int
    output_tokens: int
    cost_usd: float


class BudgetLedger:
    def __init__(self, config: BudgetConfig, price: ModelPrice) -> None:
        self.config = config
        self.price = price
        self.calls = 0
        self.actual_input_tokens = 0
        self.actual_output_tokens = 0
        self.actual_cost_usd = 0.0
        self.accounting_complete = True
        self.unknown_usage_attempts = 0
        self.ambiguous_cost_exposure_usd = 0.0
        self._reserved_input = 0
        self._reserved_output = 0
        self._reserved_cost = 0.0
        self.decisions: list[dict[str, Any]] = []
        self._lock = asyncio.Lock()

    async def reserve(self, estimated_input: int, output_cap: int, trial_id: str) -> Reservation:
        worst_cost = calculate_cost(self.price, estimated_input, 0, output_cap)
        async with self._lock:
            checks = {
                "calls": self.calls + 1 <= self.config.maxCalls,
                "input_tokens": self.actual_input_tokens + self._reserved_input + estimated_input
                <= self.config.maxInputTokens,
                "output_tokens": self.actual_output_tokens + self._reserved_output + output_cap
                <= self.config.maxOutputTokens,
                "cost_usd": self.actual_cost_usd + self.ambiguous_cost_exposure_usd + self._reserved_cost + worst_cost
                <= self.config.maxCostUsd + 1e-12,
            }
            decision = {
                "trialId": trial_id,
                "stage": "before_attempt",
                "allowed": all(checks.values()),
                "checks": checks,
                "estimatedInputTokens": estimated_input,
                "outputCap": output_cap,
                "reservedCostUsd": worst_cost,
            }
            self.decisions.append(decision)
            if not all(checks.values()):
                raise BudgetExceeded(f"hard budget reached before trial {trial_id}: {checks}")
            self.calls += 1
            self._reserved_input += estimated_input
            self._reserved_output += output_cap
            self._reserved_cost += worst_cost
            return Reservation(estimated_input, output_cap, worst_cost)

    async def complete(
        self, reservation: Reservation, input_tokens: int, cached_tokens: int, output_tokens: int, trial_id: str
    ) -> float:
        cost = calculate_cost(self.price, input_tokens, cached_tokens, output_tokens)
        async with self._lock:
            self._release(reservation)
            self.actual_input_tokens += input_tokens
            self.actual_output_tokens += output_tokens
            self.actual_cost_usd += cost
            within = (
                self.actual_input_tokens <= self.config.maxInputTokens
                and self.actual_output_tokens <= self.config.maxOutputTokens
                and self.actual_cost_usd + self.ambiguous_cost_exposure_usd <= self.config.maxCostUsd + 1e-12
            )
            self.decisions.append(
                {
                    "trialId": trial_id,
                    "stage": "after_usage",
                    "allowed": within,
                    "actualInputTokens": input_tokens,
                    "cachedInputTokens": cached_tokens,
                    "actualOutputTokens": output_tokens,
                    "actualCostUsd": cost,
                }
            )
            if not within:
                raise BudgetExceeded(f"provider usage exceeded hard budget during {trial_id}")
        return cost

    async def fail_definitive(self, reservation: Reservation, trial_id: str) -> None:
        async with self._lock:
            self._release(reservation)
            self.accounting_complete = False
            self.unknown_usage_attempts += 1
            self.decisions.append({"trialId": trial_id, "stage": "definitive_failure", "allowed": True})

    async def ambiguous(self, reservation: Reservation, trial_id: str) -> None:
        async with self._lock:
            self._release(reservation)
            self.ambiguous_cost_exposure_usd += reservation.cost_usd
            self.decisions.append(
                {"trialId": trial_id, "stage": "ambiguous", "allowed": False, "exposureCostUsd": reservation.cost_usd}
            )

    async def restore_completed(self, input_tokens: int, output_tokens: int, cost_usd: float, attempts: int) -> None:
        async with self._lock:
            self.calls += attempts
            self.actual_input_tokens += input_tokens
            self.actual_output_tokens += output_tokens
            self.actual_cost_usd += cost_usd

    async def restore_ambiguous(self, exposure_usd: float, attempts: int) -> None:
        async with self._lock:
            self.calls += attempts
            self.ambiguous_cost_exposure_usd += exposure_usd

    async def restore_definitive_failure(self, attempts: int) -> None:
        async with self._lock:
            self.calls += attempts
            self.accounting_complete = False
            self.unknown_usage_attempts += attempts

    def snapshot(self) -> dict[str, Any]:
        return {
            "calls": self.calls,
            "actualInputTokens": self.actual_input_tokens if self.accounting_complete else None,
            "actualOutputTokens": self.actual_output_tokens if self.accounting_complete else None,
            "actualCostUsd": self.actual_cost_usd if self.accounting_complete else None,
            "knownInputTokens": self.actual_input_tokens,
            "knownOutputTokens": self.actual_output_tokens,
            "knownCostUsd": self.actual_cost_usd,
            "accountingComplete": self.accounting_complete,
            "unknownUsageAttempts": self.unknown_usage_attempts,
            "ambiguousCostExposureUsd": self.ambiguous_cost_exposure_usd,
            "limits": self.config.model_dump(mode="json"),
            "decisions": self.decisions,
        }

    def _release(self, reservation: Reservation) -> None:
        self._reserved_input -= reservation.input_tokens
        self._reserved_output -= reservation.output_tokens
        self._reserved_cost -= reservation.cost_usd
