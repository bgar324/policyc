# Held-out v4 preregistration (revision 2)

## Revision history

Revision 1 (`a615e62`) preregistered dataset hash `2c19952831d74beddffc2dddc7efd9504f811369c6f5848c5a9b18b9e3a6cfbf` with a $1.50 scheduler ceiling. Its single permitted dry run, `run_9332cb6c03fc44a5` from commit `a615e62`, compiled 120 candidate artifacts and reported 3,029,931 logical input tokens, a 737,280 output cap, a $0.30 web-search reserve, and a $2.53204275 worst case; the runtime refused it against the ceiling before any provider call. The run directory was then deleted instead of preserved, which revision 1 did not permit; the figures above are the record of it. Separately, a post-freeze review found `hv4-042` carried a pre-resolved `artifactContext.operation`, corrected in `eval/authoring/held-out-v4/revisions.jq` and re-frozen (`eval/audits/held-out-v4-construction.md`, "Post-freeze correction"). This revision supersedes revision 1 in full and authorizes exactly one replacement dry run, which must be preserved under `runs/`. The scheduler cost ceiling is left unset here: it is the user's decision, to be fixed in this document by a further revision before the replacement dry run, after the user has weighed the observed $2.53 worst case against the credit balance.

## Research question

For frozen compiler 0.8, does a request-specific compiler slice preserve the critical obligations satisfied by the full synthetic policy prompt while materially reducing model input and billed cost?

## Frozen inputs

- Dataset: `eval/behavioral/held-out-v4.jsonl`
- Dataset version/split: `held-out-v4` / `held-out`
- Cases: 60
- Canonical dataset SHA-256: `197dee9fe2719f20848d81e5a4144218e217690b1a1c5c1f3aa2922d66efdfb1`
- Dataset freeze commit: the commit that introduces this revision
- Construction record: `eval/audits/held-out-v4-construction.md`
- Compiler: 0.8.0, frozen at `2e5fc441eeffacf576f389b17f352287987c73dc` (`eval/audits/compiler-v0.8-freeze.md`)
- Strategies: `full_policy`, `compiler_slice`
- Provider/model: OpenAI / `gpt-5-mini-2025-08-07`
- Evaluator: `independent-rules` 2.6.0, followed by strategy-blind semantic grading

Compiler 0.8, the dataset, evaluator behavior, grading rules, thresholds, and analysis rules must not change after the first candidate compilation against held-out v4. Discovered failures become development evidence for the next compiler iteration.

## Execution plan

- Samples per case and strategy: 3
- Logical trials and maximum provider executions: 360
- Concurrency: 4
- Output cap: 2,048 tokens per request
- Retries: 0
- Maximum input tokens: derived by the planner from per-call artifact, request, and tool-payload estimates plus 10% margin (no explicit override)
- Maximum total output tokens: 737,280
- Built-in web-search cases: five
- `max_tool_calls`: 1 per response
- Maximum built-in web searches: 30
- Web-search context: low
- Configured scheduler cost ceiling: UNSET, to be fixed by the user in the next revision (observed worst case for this shape: $2.53204275)

Before paid execution, generate exactly one zero-cost dry run from the clean preregistration commit, preserve its directory under `runs/`, and record its run ID, exact commit, prompt-token totals, and logical worst-case cost. If the dry run's worst case exceeds the ceiling, do not execute and do not raise the ceiling in place; revise the protocol under a new preregistration. Paid execution requires a new explicit user authorization naming the synthetic content, the 360-request cap, the 30-search cap, and the fixed scheduler ceiling.

The scheduler ceiling is not an external billing-account guarantee. In-flight requests and provider-reported search-content tokens can overshoot it. Actual usage and cost from provider responses, including failed attempts, must be retained and reported.

The output cap is 2,048 rather than v3's 3,072 because every completed v3 response and every compiler-0.8 development response fit within 2,048 tokens; the cap is preregistered here so it cannot be tuned after inspection. If more than 10% of planned pairs are incomplete for any reason, the study is operationally inconclusive.

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
7. a root-cause class for every full-pass/compiler-fail pair, using the held-out-v3 taxonomy (emitter loss, selector error, context-interface asymmetry, stochastic), and within emitter loss whether the case is a confirmation-state case.

Item 7 is the diagnostic that reads the compiler 0.8 change: v3 attributed 15 of 33 regressions to redundant confirmation. Whether that class recurs on v4 is reported as a class count, not as a gate.

## Success gates fixed before execution

PolicyC may describe compiler 0.8 as passing this held-out test only if all of these conditions hold under primary blind semantic grading:

- conditional critical-preservation point estimate is at least 95%;
- its Wilson 95% lower bound is at least 90%;
- no more than three distinct cases contain a full-pass/compiler-fail result;
- mean actual input-token reduction is at least 90%;
- mean actual billed-cost reduction is at least 15%;
- complete paired coverage is at least 90%.

Latency and output-token changes are secondary outcomes, not success gates. Absolute strategy pass rates must always accompany conditional preservation so that both-fail pairs are not hidden. Passing these gates supports only a model-, compiler-, prompt-, and dataset-specific result; it does not establish general prompt equivalence. Compiler 0.8 changed one of the five v3 failure classes, and the other four are expected to recur; a failed gate with a zero confirmation-class count is the anticipated outcome and is still a failed gate.

## Efficiency analysis

Report per strategy and paired differences for actual input tokens, output tokens, latency, billed cost, uncached-equivalent cost, and built-in search cost. Input-token reduction is the direct compiler-compression measure. Billed cost can be affected by caching and output length, so neither cost nor latency may substitute for the behavioral gate.

All raw provider attempts, response IDs, actual model IDs, usage, costs, compiled artifacts, manifests, blind packets, grades, and derived reports must remain hash-linked and resumable in the run directory and rebuildable SQLite catalog.
