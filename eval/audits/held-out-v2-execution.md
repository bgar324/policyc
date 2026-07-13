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

All three fixes passed 17 TypeScript tests, 82 Python tests, graph validation, formatting, linting, and static type checking.

## Final artifact integrity

- Completed outputs: 284
- Failed/incomplete outputs: 16 (all `max_output_tokens`)
- Completed full-policy outputs: 140
- Completed compiler-slice outputs: 144
- Complete paired samples: 139
- Blind answers available: 284
- Report SHA-256: `840aad77ec36ca261c4de68f1cd5585383a5868fa04e68833d8e747f39dfd2be`
- Blind-packet SHA-256: `c9386e0aed9a91efe99e34c40c78a25bbbf4ce4854e328e61022ffbf613bbf79`
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

## Provisional automated behavioral diagnostics

Across 139 complete pairs, evaluator 2.4 produced 46 both-pass, 6 full-only, 6 compiler-only, and 81 both-fail outcomes. The corresponding automated conditional preservation is 46/52 = 88.46%, with an exact two-sided McNemar p-value of 1.0.

These figures are diagnostics, not the preregistered primary behavioral result. The rule evaluator has known brittleness and low absolute pass rates in this run. Strategy-blind semantic grading of the complete pairs must be completed and hashed before unblinding or making preservation claims.

