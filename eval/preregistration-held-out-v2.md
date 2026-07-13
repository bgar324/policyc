# Held-out v2 preregistration

## Research question

For frozen compiler 0.6, does the request-specific compiler slice preserve the critical obligations satisfied by the full synthetic policy prompt while materially reducing policy-context tokens and generation cost?

## Frozen inputs

- Dataset: `eval/behavioral/held-out-v2.jsonl`
- Dataset version/split: `held-out-v2` / `held-out`
- Cases: 50
- Dataset SHA-256: `1cec47233fd3a88cea343fe9d38634eefabefc6fae486971439cf543606da263`
- Dataset construction record: `eval/audits/held-out-v2-construction.md`
- Compiler version: 0.6.0
- Strategies: `full_policy`, `compiler_slice`
- Provider/model: OpenAI / `gpt-5-mini-2025-08-07`
- Evaluator: `independent-rules` 2.4.0, followed by strategy-blind semantic grading

The dataset was independently authored and independently audited without access to PolicyC selectors, structured policy nodes, prior datasets, or model outputs. Compiler 0.6 must not be changed after seeing these cases or their responses.

## Execution plan

- Samples per case/strategy: 3
- Logical trials and maximum provider calls: 300
- Concurrency: 6
- Output cap: 2,048 tokens per call
- Retries: 0
- Maximum total output tokens: 614,400
- Maximum total input tokens: 4,000,000
- Built-in web-search cases: 11
- `max_tool_calls`: 1 per response
- Maximum built-in web-search calls: 66
- Web-search context: low
- Search-call fee cap: $0.66 at $0.01 per call
- Estimated expected generation cost: $1.89546675
- Prompt/output/search-call logical cap: $2.50986675
- Configured scheduler cost ceiling: $3.00

OpenAI documents that `search_context_size: low` does not guarantee an exact search-content token count. Actual retrieved-content tokens are included from provider usage, and the runtime stops future dispatch when actual cumulative cost crosses its scheduler ceiling. The configured ceiling is not an external billing-account guarantee and could be exceeded by the already in-flight request that first crosses it. This limitation must appear in final reporting.

## Primary outcomes

1. Critical-obligation conditional preservation: compiled critical passes divided by full-policy critical passes, evaluated pairwise.
2. Full-pass/compiled-fail count and case count.
3. Paired outcome counts: both pass, full only, compiled only, both fail.
4. Critical pass rate by strategy.
5. Severe violation, refusal correctness, and tool correctness by strategy.
6. Mean input/output tokens, latency, actual billed cost, uncached-equivalent cost, and built-in tool cost by strategy.

Report Wilson intervals for proportions and exact two-sided McNemar analysis for discordant pairs. Trial-level intervals are descriptive because repeated samples are clustered within 50 cases. Also report case-level regression counts.

## Grading and interpretation

All complete pairs will be graded in strategy-blind packets that omit strategy identity and token/cost metadata. Automated evaluator results are diagnostics; strategy-blind semantic grades are the primary behavioral evidence. Preserve completed grades and their hashes before unblinding.

Do not claim general equivalence or near-100% preservation solely from this study. A defensible positive statement must name the model, frozen dataset, case/trial counts, observed preservation estimate, uncertainty, and efficiency reduction. Any compiler change after inspecting results creates a new development version and cannot be rerun on `held-out-v2` as fresh held-out evidence.
