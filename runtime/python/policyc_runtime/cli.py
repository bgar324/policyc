from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

import uvicorn

from .adjudication import build_adjudication_bundle, build_completion_bundle
from .catalog import RunCatalog, default_catalog_path
from .events import serialize_sse
from .manifest import load_run
from .paired_manifest import load_paired_run
from .paired_runtime import PairedExperimentRuntime, spend_plan
from .providers import FakeProvider, OpenAIResponsesProvider, ProviderRequest
from .scheduler import ExperimentRuntime


def main() -> None:
    parser = argparse.ArgumentParser(prog="policyc-runtime")
    subcommands = parser.add_subparsers(dest="command", required=True)
    run = subcommands.add_parser("run")
    run.add_argument("manifest", type=Path)
    serve = subcommands.add_parser("serve")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)
    experiment = subcommands.add_parser("experiment")
    experiment.add_argument("manifest", type=Path)
    experiment.add_argument("--dry-run", action="store_true")
    experiment.add_argument("--yes", action="store_true")
    runs = subcommands.add_parser("runs")
    runs.add_argument("action", choices=["list", "show", "rebuild"])
    runs.add_argument("run_id", nargs="?")
    runs.add_argument("--catalog", type=Path, default=default_catalog_path())
    runs.add_argument("--root", type=Path, default=Path("runs"))
    runs.add_argument("--limit", type=int, default=50)
    runs.add_argument("--json", action="store_true")
    adjudication = subcommands.add_parser("adjudication-bundle")
    adjudication.add_argument("run_directory", type=Path)
    adjudication.add_argument("--output", type=Path)
    adjudication.add_argument("--agreements-per-class", type=int, default=10)
    completion = subcommands.add_parser("adjudication-completion-bundle")
    completion.add_argument("run_directory", type=Path)
    completion.add_argument("--prior-bundle", type=Path, required=True)
    completion.add_argument("--completed-grades", type=Path, required=True)
    completion.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.command == "serve":
        uvicorn.run("policyc_runtime.service:app", host=args.host, port=args.port)
    elif args.command == "experiment":
        asyncio.run(run_paired_manifest(args.manifest, dry_run=args.dry_run, yes=args.yes))
    elif args.command == "runs":
        run_catalog_command(args.action, args.run_id, args.catalog, args.root, args.limit, args.json)
    elif args.command == "adjudication-bundle":
        output = args.output or args.run_directory / "blind" / "adjudication-v1"
        result = build_adjudication_bundle(
            args.run_directory,
            output,
            agreements_per_class=args.agreements_per_class,
        )
        print(json.dumps(result, indent=2, sort_keys=True))
    elif args.command == "adjudication-completion-bundle":
        output = args.output or args.run_directory / "blind" / "adjudication-completion-v1"
        result = build_completion_bundle(
            args.run_directory,
            args.prior_bundle,
            args.completed_grades,
            output,
        )
        print(json.dumps(result, indent=2, sort_keys=True))
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


async def run_paired_manifest(path: Path, *, dry_run: bool, yes: bool) -> None:
    loaded = load_paired_run(path)
    plan = spend_plan(loaded)
    print(json.dumps({"spendPlan": plan}, indent=2, sort_keys=True))
    manifest = loaded.manifest
    if plan["logicalTrials"] > manifest.budget.maxLogicalTrials:
        raise ValueError("logical trial count exceeds the hard budget")
    if plan["logicalInputTokens"] > manifest.budget.maxInputTokens:
        raise ValueError("planned input tokens exceed the hard budget")
    if plan["logicalOutputTokenCap"] > manifest.budget.maxOutputTokens:
        raise ValueError("planned output cap exceeds the hard budget")
    if plan["logicalCostCapUsd"] > manifest.budget.maxCostUsd:
        raise ValueError("planned one-attempt cost exceeds the hard budget")
    if manifest.provider == "openai":
        validator = OpenAIResponsesProvider(api_key="offline-dry-run-placeholder")
        for case_plan in manifest.casePlans:
            tools = [item.provider_dict() for item in case_plan.case.tools]
            for candidate in case_plan.candidates:
                artifact = loaded.artifacts[f"{case_plan.caseId}:{candidate.strategy}"]
                validator.build_payload(
                    ProviderRequest(
                        artifact=artifact,
                        model=manifest.model,
                        parameters=manifest.modelParameters,
                        seed=None,
                        tools=tools,
                        case_id=case_plan.caseId,
                    )
                )
    if dry_run:
        print(f"Paid command: policyc-runtime experiment {path} --yes")
        return
    if manifest.provider == "openai" and not yes:
        expected = f"RUN {manifest.runId}"
        authorization = await asyncio.to_thread(input, f"Type {expected} to authorize paid API calls: ")
        if authorization.strip() != expected:
            raise SystemExit("paid run not authorized")
    provider = FakeProvider() if manifest.provider == "fake" else OpenAIResponsesProvider()
    report = await PairedExperimentRuntime(loaded, provider).run()
    print(json.dumps(report, indent=2, sort_keys=True))


def run_catalog_command(
    action: str, run_id: str | None, catalog_path: Path, root: Path, limit: int, as_json: bool
) -> None:
    catalog = RunCatalog(catalog_path)
    if action == "rebuild":
        print(json.dumps({"catalog": str(catalog.path), **catalog.rebuild(root)}, indent=2, sort_keys=True))
        return
    if action == "show":
        if not run_id:
            raise SystemExit("runs show requires <run-id>")
        result = catalog.show(run_id)
        if result is None:
            raise SystemExit(f"unknown run: {run_id}")
        print(json.dumps(result, indent=2, sort_keys=True))
        return
    rows = catalog.list_runs(limit)
    if as_json:
        print(json.dumps(rows, indent=2, sort_keys=True))
        return
    if not rows:
        print(f"No runs recorded in {catalog.path}")
        return
    headers = ("RUN ID", "STATUS", "DATASET", "MODEL", "TRIALS", "CALLS", "COST")
    print("  ".join(headers))
    for row in rows:
        trials = f"{row['completed_trials']}/{row['logical_trials']}"
        cost = "unknown" if row["actual_cost_usd"] is None else f"${row['actual_cost_usd']:.6f}"
        calls = "unknown" if row["calls"] is None else str(row["calls"])
        print(f"{row['run_id']}  {row['status']}  {row['dataset_version']}  {row['model']}  {trials}  {calls}  {cost}")


if __name__ == "__main__":
    main()
