from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .events import serialize_sse
from .manifest import load_run
from .providers import FakeProvider, OpenAIResponsesProvider
from .scheduler import ExperimentRuntime


class CreateRunRequest(BaseModel):
    manifestPath: str


class RunManager:
    def __init__(self) -> None:
        self.runtimes: dict[str, ExperimentRuntime] = {}
        self.tasks: dict[str, asyncio.Task[dict[str, Any]]] = {}

    def create(self, manifest_path: str) -> str:
        loaded = load_run(manifest_path)
        if loaded.manifest.runId in self.runtimes:
            raise ValueError("run already exists")
        provider = FakeProvider() if loaded.manifest.provider == "fake" else OpenAIResponsesProvider()
        runtime = ExperimentRuntime(loaded, provider)
        self.runtimes[loaded.manifest.runId] = runtime
        self.tasks[loaded.manifest.runId] = asyncio.create_task(runtime.run())
        return loaded.manifest.runId


manager = RunManager()
app = FastAPI(title="PolicyC Runtime", version="0.3.0")


@app.post("/runs", status_code=202)
async def create_run(request: CreateRunRequest) -> dict[str, str]:
    try:
        run_id = manager.create(request.manifestPath)
    except (ValueError, OSError) as error:
        raise HTTPException(400, str(error)) from error
    return {"runId": run_id}


@app.get("/runs/{run_id}")
async def get_run(run_id: str) -> dict[str, Any]:
    runtime = _runtime(run_id)
    return {"runId": run_id, "status": runtime.status, "completedTrials": len(runtime.results)}


@app.get("/runs/{run_id}/events")
async def stream_events(run_id: str) -> StreamingResponse:
    runtime = _runtime(run_id)

    async def generate():
        async for event in runtime.events.subscribe():
            yield serialize_sse(event)
            if event.eventType in {"run.completed", "run.failed", "run.cancelled"}:
                break

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/runs/{run_id}/cancel", status_code=202)
async def cancel_run(run_id: str) -> dict[str, str]:
    runtime = _runtime(run_id)
    await runtime.cancel()
    return {"runId": run_id, "status": "cancelling"}


@app.get("/runs/{run_id}/report")
async def get_report(run_id: str) -> dict[str, Any]:
    runtime = _runtime(run_id)
    path = runtime.loaded.runDirectory / "report.json"
    if not path.exists():
        raise HTTPException(409, "report is not available")
    return json.loads(path.read_text())


def _runtime(run_id: str) -> ExperimentRuntime:
    runtime = manager.runtimes.get(run_id)
    if runtime is None:
        raise HTTPException(404, "run not found")
    return runtime
