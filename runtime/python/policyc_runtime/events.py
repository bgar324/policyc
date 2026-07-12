from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .models import EVENT_TYPES, RunEvent


class EventBus:
    def __init__(self, run_id: str, event_path: Path) -> None:
        self.run_id = run_id
        self.event_path = event_path
        self.event_path.parent.mkdir(parents=True, exist_ok=True)
        self._sequence = self._last_sequence()
        self._lock = asyncio.Lock()
        self._subscribers: set[asyncio.Queue[RunEvent | None]] = set()

    async def publish(
        self,
        event_type: EVENT_TYPES,
        *,
        trial_id: str | None = None,
        candidate_id: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> RunEvent:
        async with self._lock:
            self._sequence += 1
            event = RunEvent(
                runId=self.run_id,
                eventId=f"evt_{self._sequence:08d}",
                eventType=event_type,
                timestamp=datetime.now(UTC),
                sequence=self._sequence,
                trialId=trial_id,
                candidateId=candidate_id,
                payload=payload or {},
            )
            with self.event_path.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(event.model_dump(mode="json"), sort_keys=True, separators=(",", ":")) + "\n")
            for subscriber in tuple(self._subscribers):
                subscriber.put_nowait(event)
            return event

    async def subscribe(self, after_sequence: int = 0) -> AsyncIterator[RunEvent]:
        queue: asyncio.Queue[RunEvent | None] = asyncio.Queue()
        async with self._lock:
            history = (
                [RunEvent.model_validate_json(line) for line in self.event_path.read_text().splitlines() if line]
                if self.event_path.exists()
                else []
            )
            self._subscribers.add(queue)
        try:
            for event in history:
                if event.sequence > after_sequence:
                    yield event
            while True:
                queued = await queue.get()
                if queued is None:
                    break
                yield queued
        finally:
            self._subscribers.discard(queue)

    async def close(self) -> None:
        for subscriber in tuple(self._subscribers):
            subscriber.put_nowait(None)

    def _last_sequence(self) -> int:
        if not self.event_path.exists():
            return 0
        lines = [line for line in self.event_path.read_text().splitlines() if line]
        return int(json.loads(lines[-1])["sequence"]) if lines else 0


def serialize_sse(event: RunEvent) -> str:
    data = json.dumps(event.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return f"id: {event.eventId}\nevent: {event.eventType}\ndata: {data}\n\n"
