# Held-out v3 preregistration

## Research question

For frozen compiler 0.7, does a request-specific compiler slice preserve the critical obligations satisfied by the full synthetic policy prompt while materially reducing model input and billed cost?

## Frozen inputs

- Dataset: `eval/behavioral/held-out-v3.jsonl`
- Dataset version/split: `held-out-v3` / `held-out`
- Cases: 60
- Canonical dataset SHA-256: `8d6bf6999fcb7232e92633412f1eaf93be53a910dbfc1993f4fef7b6d49a7de3`
- Dataset freeze commit: `564781c95825f1ec3057ececcca220bacd5b3965`
- Construction record: `eval/audits/held-out-v3-construction.md`
- Compiler: 0.7.0, frozen at `67f3cdef310d15e9d86a732611b1d64ac46c13a0`
- Strategies: `full_policy`, `compiler_slice`
- Provider/model: OpenAI / `gpt-5-mini-2025-08-07`
- Evaluator: `independent-rules` 2.6.0, followed by strategy-blind semantic grading

Compiler 0.7, the dataset, evaluator behavior, grading rules, thresholds, and analysis rules must not change after the first candidate compilation against held-out v3. Discovered failures become development evidence for compiler 0.8.

## Execution plan

- Samples per case and strategy: 3
- Logical trials and maximum provider executions: 360
- Concurrency: 6
- Output cap: 3,072 tokens per request
- Retries: 0
- Maximum input tokens: 5,000,000
- Maximum total output tokens: 1,105,920
- Built-in web-search cases: five
- `max_tool_calls`: 1 per response
- Maximum built-in web searches: 30
- Web-search context: low
- Configured scheduler cost ceiling: $3.50

Before paid execution, generate exactly one zero-cost dry run from the clean preregistration commit and record its run ID, exact commit, prompt-token totals, expected cost, and logical worst-case cost. If the dry run violates these fixed call, token, search, or cost limits, do not execute; revise the protocol under a new preregistration rather than silently changing this one. Paid execution requires a new explicit user authorization naming the synthetic content, 360-request cap, 30-search cap, and $3.50 scheduler ceiling.

The scheduler ceiling is not an external billing-account guarantee. In-flight requests and provider-reported search-content tokens can overshoot it. Actual usage and cost from provider responses, including failed attempts, must be retained and reported.

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
6. case-clustered sensitivity results because three samples from one case are not independent.

If more than 10% of planned pairs are incomplete, the behavioral study is operationally inconclusive and no preservation claim is allowed.

## Success gates fixed before execution

PolicyC may describe compiler 0.7 as passing this held-out test only if all of these conditions hold under primary blind semantic grading:

- conditional critical-preservation point estimate is at least 95%;
- its Wilson 95% lower bound is at least 90%;
- no more than three distinct cases contain a full-pass/compiler-fail result;
- mean actual input-token reduction is at least 90%;
- mean actual billed-cost reduction is at least 15%;
- complete paired coverage is at least 90%.

Latency and output-token changes are secondary outcomes, not success gates. Absolute strategy pass rates must always accompany conditional preservation so that both-fail pairs are not hidden. Passing these gates supports only a model-, compiler-, prompt-, and dataset-specific result; it does not establish general prompt equivalence.

## Efficiency analysis

Report per strategy and paired differences for actual input tokens, output tokens, latency, billed cost, uncached-equivalent cost, and built-in search cost. Input-token reduction is the direct compiler-compression measure. Billed cost can be affected by caching and output length, so neither cost nor latency may substitute for the behavioral gate.

All raw provider attempts, response IDs, actual model IDs, usage, costs, compiled artifacts, manifests, blind packets, grades, and derived reports must remain hash-linked and resumable in the run directory and rebuildable SQLite catalog.
