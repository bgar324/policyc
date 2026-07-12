from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

import uvicorn

from .events import serialize_sse
from .manifest import load_run
from .providers import FakeProvider, OpenAIResponsesProvider
from .scheduler import ExperimentRuntime


def main() -> None:
    parser = argparse.ArgumentParser(prog="policyc-runtime")
    subcommands = parser.add_subparsers(dest="command", required=True)
    run = subcommands.add_parser("run")
    run.add_argument("manifest", type=Path)
    serve = subcommands.add_parser("serve")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    if args.command == "serve":
        uvicorn.run("policyc_runtime.service:app", host=args.host, port=args.port)
    else:
        asyncio.run(run_manifest(args.manifest))


async def run_manifest(path: Path) -> None:
    loaded = load_run(path)
    provider = FakeProvider() if loaded.manifest.provider == "fake" else OpenAIResponsesProvider()
    runtime = ExperimentRuntime(loaded, provider)

    async def stream() -> None:
        async for event in runtime.events.subscribe():
            print(serialize_sse(event), end="")

    subscriber = asyncio.create_task(stream())
    await asyncio.sleep(0)
    report = await runtime.run()
    await subscriber
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
