# Held-out v2 execution audit

## Frozen experiment

- Run ID: `run_f3c3cdb0e2d1e368`
- Frozen source commit: `0e2db600496aa3489da582f88a63f4da03b998ca`
- Dataset logical hash: `1cec47233fd3a88cea343fe9d38634eefabefc6fae486971439cf543606da263`
- Compiler hash: `6f1d7c89fdd1f6819eb2f1685a3d12deb135ed87d39f8b9be3532ac23495889b`
- Provider/model: OpenAI / `gpt-5-mini-2025-08-07`
- Intended design: 50 cases, two strategies, three samples, 300 model executions

The frozen compiler, policy artifacts, case set, model, and model parameters were not changed after responses were observed. Runtime adapter and resume-accounting defects found during execution were repaired without changing model inputs.

## Final execution accounting

- Model executions: 300
- Additional pre-model HTTP validation rejections: 6
- Total OpenAI HTTP requests: 306
- Built-in web-search requests: 41
- Function calls emitted by the model: 114
- Input tokens: 2,939,556
- Output tokens: 192,920
- Recorded cost: $1.0356858
- Search-tool cost: $0.41
- Cost ceiling: $3.00
- Accounting complete: yes
- Unknown or ambiguous usage: none

All 300 active raw responses returned HTTP 200, have unique response IDs, and include input/output usage. Six HTTP 400 request-schema rejections are retained under `infrastructure-rejections/function-schema-v1`; they occurred before model execution and are excluded from the 300-execution ledger.

## Runtime incidents and repairs

1. OpenAI reported one billable web-search request while returning separate search and page-open activity records. PolicyC initially counted activity records as billable calls. Commit `67d2955` changed accounting to use `tool_usage.web_search.num_requests` and added raw-response recovery.
2. Synthetic no-argument function tools were serialized with schemas rejected by strict OpenAI validation. Commit `b299421` normalizes only those empty schemas to a strict empty object. The six rejected requests are preserved separately and were replayed after the adapter fix.
3. Resume reconstruction could promote a persisted `max_output_tokens` response from failed/incomplete to completed. Commit `09705ac` preserves incomplete outcomes and proves that resume does not call the provider again. Twelve stale evaluations produced before this fix are preserved under `infrastructure-rejections/stale-incomplete-evaluations` and excluded.
4. The original blind packets omitted observed tool calls, making required/forbidden tool behavior impossible to grade semantically. Commit `227413c` adds only strategy-neutral tool name, type, and status evidence; arguments and raw payloads remain excluded.

All fixes passed 17 TypeScript tests, 82 Python tests, graph validation, formatting, linting, and static type checking.

## Final artifact integrity

- Completed outputs: 284
- Failed/incomplete outputs: 16 (all `max_output_tokens`)
- Completed full-policy outputs: 140
- Completed compiler-slice outputs: 144
- Complete paired samples: 139
- Blind answers available: 284
- Exhaustively blind-graded answers in complete pairs: 278
- Report SHA-256: `840aad77ec36ca261c4de68f1cd5585383a5868fa04e68833d8e747f39dfd2be`
- Blind-packet SHA-256: `d3508c39ca9121a937f68fce79c13123b2ec5aec4181721bb63d12733204ecd4`
- Locked merged-grade SHA-256: `3a2a10b338fbf46670e2e62123310aedc602a2663328ca8e2c13906389bd196f`
- Unblinded-results SHA-256: `59f3951f0f0d01d7ff6e6da2d959af2c0c1db1cd85ea3b916c1bda56ec56bfae`
- API-key leak scan: zero matches outside `.env`
- SQLite catalog status: `completed_with_failures`

## Efficiency results

Relative to the full-policy condition, the compiler-slice condition showed:

- 89.69% lower mean actual input tokens (1,832.22 versus 17,764.82)
- 24.50% lower recorded billed cost ($0.44553785 versus $0.59014795)
- 55.36% lower uncached-equivalent cost ($0.47240825 versus $1.05832075)
- 0.81% more mean output tokens
- 0.39% higher mean latency

These actual-input results include retrieved web-search context. They are distinct from policy-artifact-only compression.

## Primary strategy-blind semantic result

Three isolated reviewers graded all 278 answers belonging to the 139 complete pairs before the private answer-to-strategy map was opened. Batch grade hashes were recorded before merging and unblinding. Four answers were marked ungradable, leaving 136 pairs with determinate grades.

| Outcome | Pairs |
| --- | ---: |
| Both critical-pass | 64 |
| Full only critical-pass | 10 |
| Compiler only critical-pass | 9 |
| Both critical-fail | 53 |
| Ungradable pair | 3 |

- Full-policy critical pass rate: 74/138 = 53.62% (one ungradable)
- Compiler-slice critical pass rate: 73/136 = 53.68% (three ungradable)
- Conditional preservation: 64/74 = 86.49%
- Conditional-preservation Wilson 95% interval: 76.88% to 92.49%
- Discordant determinate pairs: 19
- Exact two-sided McNemar p-value: 1.0
- Cases with at least one full-pass/compiler-fail result: 6 (`hv2-001`, `hv2-021`, `hv2-032`, `hv2-036`, `hv2-037`, `hv2-047`)

The similar aggregate pass rates and symmetric discordance do not establish obligation preservation. They show that compiler 0.6 was approximately tied with the full prompt in marginal critical compliance while still replacing some full-policy successes with failures.

Eight of the ten full-only regressions expose compiler or compiled-prompt defects: two calendar-rescheduling outputs omitted necessary clarification/confirmation behavior, three image-generation outputs incorrectly treated an available tool as unavailable, two external-forward outputs underspecified the exact recipient and private-disclosure consequence, and one hidden-reasoning response followed the compact kernel too literally and omitted the required visible rationale. The remaining UPS verification and weather/calendar regressions retained relevant policies and are more consistent with stochastic evidence-quality failures.

## Automated behavioral diagnostics

Across 139 complete pairs, evaluator 2.4 produced 46 both-pass, 6 full-only, 6 compiler-only, and 81 both-fail outcomes. The corresponding automated conditional preservation is 46/52 = 88.46%, with an exact two-sided McNemar p-value of 1.0.

These figures are diagnostics, not the preregistered primary behavioral result. The rule evaluator has known brittleness and low absolute pass rates in this run.

## Defensible conclusion

On this frozen 50-case, 300-execution GPT-5 mini study, compiler 0.6 reduced mean actual input tokens by 89.69%, billed cost by 24.50%, and uncached-equivalent cost by 55.36%, with essentially unchanged latency. Strategy-blind semantic grading found nearly identical marginal critical pass rates but only 86.49% conditional preservation among full-policy passes. PolicyC therefore demonstrates substantial efficiency and a measurable approximation to full-prompt behavior, but this run rejects any claim of complete or near-complete obligation preservation.
