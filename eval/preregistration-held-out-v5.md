# Held-out v5 preregistration (revision 1)

## Revision history

Revision 1 is the first and, unless the official dry run's worst case exceeds the ceiling below, the only preregistration for held-out v5. One exploratory dry run, `run_b02ff398654a78c7` from the dataset-freeze commit `e063f31`, was made before this document to learn the worst case; it is preserved under `runs/compiler-v0.9-held-out-v5-explore/` and made no provider call. The ceiling below is set from it. The one official dry run is made from this document's commit, into the study's run directory, and is the run the paid execution resumes.

## Research question

For frozen compiler 0.9 with the extractor frontend, does a request-specific compiler slice preserve the critical obligations satisfied by the full synthetic policy prompt while materially reducing model input and billed cost, on independently authored cases neither the compiler nor the extractor prompt has seen?

## Frozen inputs

- Dataset: `eval/behavioral/held-out-v5.jsonl`
- Dataset version/split: `held-out-v5` / `held-out`
- Cases: 60
- Canonical dataset SHA-256: `a9ef58b0a4f728edbedb76d0aa206248afda319c13c2b5b5c83638fd6fc4f3b7`
- Dataset freeze commit: `e063f31`
- Construction record: `eval/audits/held-out-v5-construction.md`
- Compiler: 0.9.0, frozen at code commit `d96477b394c24c42cf827300b438952562578121` (`eval/audits/compiler-v0.9-freeze.md`, record commit `a8c99cd`); policy pack hash `26d53d4f90d29bb8da5ee0f2c33ef58978d3cf2ac2514af65ecf5cd29c060fa8`; protocol 1.2.0
- Frontend: `extractor:gpt-5-mini-2025-08-07:54d7f0ac870e`, reads file `runs/extract-hv5/reads.json`, SHA-256 `43a8c9842ac52d45fe5ab314dfef12c16626b6cfcb626b9a82fa5b2180bfdb82`, produced by extraction plan `ext_63d9fbf0c9ea70f9` at commit `e063f31` (60 of 60 requests read, 60 calls, $0.2678, output cap 4,096); the reads were not inspected before this preregistration and are not to be edited
- Strategies: `full_policy`, `compiler_slice`
- Provider/model: OpenAI / `gpt-5-mini-2025-08-07`
- Evaluator: `independent-rules` 2.6.0, followed by strategy-blind semantic grading

Compiler 0.9, the extractor prompt and field contract, the reads file, the dataset, evaluator behavior, grading rules, thresholds, and analysis rules must not change after the first candidate compilation against held-out v5. Discovered failures become development evidence for the next compiler iteration.

## Execution plan

- Samples per case and strategy: 3
- Logical trials and maximum provider executions: 360
- Concurrency: 4
- Output cap: 3,072 tokens per request (the highest cap a prior study needed; v4's 2,048 cost 21 truncations)
- Retries: 0
- Maximum input tokens: derived by the planner from per-call artifact, request, and tool-payload estimates plus 10% margin (no explicit override)
- Maximum total output tokens: 1,105,920
- Built-in web-search cases: eight
- `max_tool_calls`: 1 per response
- Maximum built-in web searches: 48
- Web-search context: low
- Configured scheduler cost ceiling: $3.50 (exploratory worst case $3.4518, of which $0.48 is the web-search reserve)

Before paid execution, generate exactly one zero-cost official dry run from the clean preregistration commit into `runs/compiler-v0.9-held-out-v5/`, preserve it, and record its run ID, exact commit, prompt-token totals, and logical worst-case cost in the execution audit. If that dry run's worst case exceeds the ceiling, do not execute and do not raise the ceiling in place; revise the protocol under a new preregistration. Paid execution is authorized by the user's instruction of 2026-09-03, "just topped up to $5. ready for you to do all six phases in one go", given with the plan's costs stated (Phase F, Phase G, the v5 reads, and this run at about $1.10 likely and $2.60 to $3.50 worst case); the typed `RUN <run-id>` is supplied by the coordinating agent under that instruction.

The provider credit balance at execution is about $4.30, above the worst case. If the provider nevertheless rejects calls before all 360 executions complete, those trials are recorded as failed, the run stops, and the preregistered coverage gate decides whether the study is conclusive; the dataset is spent either way.

The scheduler ceiling is not an external billing-account guarantee. In-flight requests and provider-reported search-content tokens can overshoot it. Actual usage and cost from provider responses, including failed attempts, must be retained and reported.

If more than 10% of planned pairs are incomplete for any reason, the study is operationally inconclusive.

## Primary behavioral outcome

The primary estimate is trial-level conditional critical preservation:

`compiled critical passes / trials in which the paired full-policy response critical-passes`.

All complete pairs will be placed in strategy-blind grading packets that omit strategy, prompt size, tokens, latency, and cost. The semantic grades are primary; automated evaluator 2.6 results are diagnostics. Function-tool cases grade the one-turn tool decision as critical because the synthetic function harness has no second model turn. Tool arguments and any emitted prose remain semantic diagnostics. Report incomplete and unpaired trials separately; never count them as passes.

Also report:

1. paired counts: both pass, full only, compiler only, both fail;
2. full-pass/compiler-fail trial and case counts;
3. absolute critical-pass rate by strategy;
4. refusal correctness, tool correctness, severe-violation rate, and relevant domain slices;
5. Wilson 95% intervals for proportions and exact two-sided McNemar analysis for discordant pairs;
6. case-clustered sensitivity results because three samples from one case are not independent;
7. a root-cause class for every full-pass/compiler-fail pair, using compiler 0.9's bins, each of which names a place in the compiler: frontend misread (the extractor's recorded state disagrees with the request), undeclared condition (a node had no branch for the situation), mask or precedence gap (the obligation algebra withheld or kept the wrong obligation), selector gap (a node was not selected), emitter text (the selected and resolved text did not carry the obligation), context-interface asymmetry, and stochastic; with the extractor's recorded state cited for every frontend-misread assignment.

Item 7 is the diagnostic that reads the compiler 0.9 change: v4 attributed 14 of 32 regressions to tool negation and limits, 7 to authorization, 7 to ask-side wording, and 4 to format. Whether those classes recur on v5, and whether the extractor's reads are where a failure originates, is reported as class counts, not as gates.

## Success gates fixed before execution

PolicyC may describe compiler 0.9 as passing this held-out test only if all of these conditions hold under primary blind semantic grading:

- conditional critical-preservation point estimate is at least 95%;
- its Wilson 95% lower bound is at least 90%;
- no more than three distinct cases contain a full-pass/compiler-fail result;
- mean actual input-token reduction is at least 90%;
- mean actual billed-cost reduction is at least 15%;
- complete paired coverage is at least 90%.

Latency and output-token changes are secondary outcomes, not success gates. Absolute strategy pass rates must always accompany conditional preservation so that both-fail pairs are not hidden. Passing these gates supports only a model-, compiler-, frontend-, prompt-, and dataset-specific result; it does not establish general prompt equivalence, and a single pass is not a replicated result. Every v3 and v4 failure class has a representation in compiler 0.9; a failed gate therefore names which representation did not generalize, and that is the finding.

## Efficiency analysis

Report per strategy and paired differences for actual input tokens, output tokens, latency, billed cost, uncached-equivalent cost, and built-in search cost. Input-token reduction is the direct compiler-compression measure. Billed cost can be affected by caching and output length, so neither cost nor latency may substitute for the behavioral gate. The extractor's compile-time cost ($0.2678 for 60 requests, one read per request reused by every candidate and sample) is reported beside the run's cost, never netted against the savings.

All raw provider attempts, response IDs, actual model IDs, usage, costs, compiled artifacts, manifests, blind packets, grades, and derived reports must remain hash-linked and resumable in the run directory and rebuildable SQLite catalog.
