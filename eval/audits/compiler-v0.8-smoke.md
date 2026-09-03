# Compiler 0.8 development smoke

## Status

Compiler 0.8 is a development iteration derived from the completed `held-out-v3` experiment. The six copied cases in `eval/behavioral/compiler-v0.8-regressions.jsonl` (dataset hash `e50214e49d5a37dee334d3dfe777b07f33386b704ce1f0198e6b8798b12843dc`) are labeled `development`, `spent-evidence`, and `promoted-from-held-out-v3`. They cannot provide fresh held-out evidence for compiler 0.8. This run is the Phase F adapter, persistence, and resume smoke from the compiler 1.0 handoff, not the Phase G regression experiment.

## Run identity

- Run: `run_b9daf24a2c394e8d`, label `compiler-v0.8-smoke`, directory `runs/compiler-v0.8-smoke/`
- Source commit: `68bb314412cdb8d735a4d9b4144cdfe8b7a9a30f`, clean tree
- Compiler 0.8.0, protocol 1.1.0, evaluator 2.6.0, model `gpt-5-mini-2025-08-07`
- Plan: 6 cases x `full_policy`,`compiler_slice` x 1 sample = 12 executions, concurrency 2, 2,048 output tokens per call, no retries, no built-in tools
- Ceilings: 12 calls, 99,973 input tokens, 24,576 output tokens, $0.15; dry-run worst case $0.07414525
- Authorization: typed `RUN run_b9daf24a2c394e8d` after an explicit user go-ahead; the key was read from the environment for that command only
- Hashes (sha256, first 16): `manifest.canonical.json` `19d9021de7eb381c`, `report.json` `77f7bccdcd2c5fc1`, `budget.json` `762769275e1e387a`

## Accounting

- Provider calls: 11 of 12 planned; 11 raw attempts persisted, 0 ambiguous, 0 unknown-usage attempts
- Recorded cost: $0.01725575 (compiler_slice $0.004488 over 6 calls; full_policy $0.01276775 over 5 calls)
- Input tokens: 84,359 actual (compiler_slice mean 465; full_policy mean 16,313, three of five calls served 15,872-16,256 cached tokens)
- Output tokens: 3,483
- One trial, `cv08-058 full_policy`, failed before any provider call with `BudgetExceeded` on the input-token check; see the incident below

## Behavioral result

All 11 completed executions produced exactly one function call and no prose, and every one passed its critical obligations. The six `compiler_slice` executions called the tool with the confirmed arguments instead of asking for confirmation again:

| Case | Confirmed action | compiler_slice call | full_policy call |
| --- | --- | --- | --- |
| cv08-007 | send to pat@example.com | `gmail send`, exact recipient and body, no attachments | same |
| cv08-010 | create private hold | `calendar create`, 2026-07-15 13:00-14:00 America/Los_Angeles, scope one | same |
| cv08-047 | archive one thread | `gmail archive`, thread "Travel receipts — June" | same |
| cv08-051 | create one-time event | `calendar create`, 2026-08-06 09:00-09:30 America/New_York, scope one | same |
| cv08-053 | move one occurrence | `calendar reschedule`, 2026-07-16 10:00 America/Chicago, scope one | same |
| cv08-058 | send to audit@example.com | `gmail send`, exact recipient and body, no attachments | not executed (budget incident) |

Paired outcomes over the five complete pairs: 2 both-pass, 3 both-fail, 0 discordant. The both-fail pairs are secondary `nonempty` text obligations (`respect-archive-only`, `grounded-calendar-result`, `preserve-rest-of-series`) that a tool-call-only turn cannot satisfy in this single-turn harness; they affect both strategies identically and are not compiler regressions. Under held-out-v3 these same six cases produced 15 compiled re-ask failures against full-policy executions.

This is development evidence on spent cases with one sample each. It shows the 0.8 emitter changes model behavior in the intended direction on the exact inputs it was built from; it estimates nothing about preservation.

## Incident: derived input ceiling starved the last trial

`policyc experiment` derived `maxInputTokens` as the exact sum of per-call reservations (artifact token count plus 64 tokens per call, 99,973 in total), with no headroom because `--retries 0` makes the attempt multiplier 1. Provider-reported input exceeded each reservation by 37-76 tokens (101-140 above the artifact count): the request is sent as a separate `input` message and the synthetic function schema is billed too, and neither was in the estimate. Per call the excess decomposes exactly into `countTokens(request) + countTokens(JSON tools)` minus 6-15 tokens. Across 11 calls the excess was 641 tokens; the remaining allowance, 15,614, was below the 16,255 reservation for the final `full_policy` trial, so the budget guard rejected it before any call. Held-out v2 and v3 did not meet this because they set `--max-input-tokens` explicitly (4,000,000 and 5,000,000); earlier derived-ceiling runs happened to dispatch a small compiled trial last.

Response, in three steps. First `deriveInputLimit` gained a 10% margin, which was insufficient alone for compact-only plans. Then `estimateCallInputTokens` in `src/experiment/plan.ts` counted request and tool tokens, but only the manifest ceiling grew: the Python runtime still reserved `artifact + 64` per trial, and the dataset tool row differs from the billed provider payload. The final form: `providerToolPayload` mirrors `ToolDefinition.provider_dict()` (pinned by `protocol/fixtures/tool-payload-parity.json`, checked from both test suites), the planner writes `estimatedInputTokens` on every manifest candidate, and the runtime reserves from that field and sums it in its spend plan, falling back to `artifact + 64` for manifests that predate it. On this run's data the per-call estimate exceeds every provider-reported input by 6-15 tokens, so it is an upper bound on these shapes; `deriveInputLimit` keeps a 10% margin for tokenizer drift and an explicit `--max-input-tokens` still overrides. Dollar exposure remains bounded by `--max-cost-usd`. The failed trial is preserved as failed; re-running it requires a new output directory because the manifest identity includes the budget.

## Resume and secret checks

- Re-running the identical command after completion: exit 0 in 0.6 s, calls 11 to 11, cost unchanged, raw attempts 11 to 11, outcomes unchanged. Resume issued no provider calls.
- Secret scan of `runs/compiler-v0.8-smoke/` and `.policyc/`: 0 files contain the key, 0 files match an `sk-` pattern, no persisted authorization headers.

## Claims boundary

- Do not cite a preservation rate from this run.
- Do not describe these six cases as fresh evidence for compiler 0.8.
- The 97% input reduction on these cases reflects short confirmed requests against a 16K-token full prompt and is not a cross-version headline metric.
