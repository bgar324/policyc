# Compiler 0.8 development regression experiment

## Status

This is the Phase G regression run from the compiler 1.0 handoff: three samples per strategy on the six copied `held-out-v3` redundant-confirmation cases in `eval/behavioral/compiler-v0.8-regressions.jsonl` (dataset hash `e50214e49d5a37dee334d3dfe777b07f33386b704ce1f0198e6b8798b12843dc`). The cases are `development`, `spent-evidence`, and `promoted-from-held-out-v3`. Compiler 0.8 was built from exactly these failures, so this run can confirm that the known defect is fixed at runtime and cannot estimate preservation. Any preservation claim requires a newly authored, frozen held-out-v4 set.

## Run identity

- Run: `run_d28db856d3128b8a`, label `compiler-v0.8-regression`, directory `runs/compiler-v0.8-regression/`
- Source commit: `5ee1cf01b31a6186cd2379a2c0359088722c8b44`, clean tree
- Compiler 0.8.0, protocol 1.1.0, evaluator 2.6.0, model `gpt-5-mini-2025-08-07`
- Plan: 6 cases x `full_policy`,`compiler_slice` x 3 samples = 36 executions, concurrency 2, 2,048 output tokens per call, no retries, no built-in tools
- Ceilings: 36 calls, 335,165 input tokens (299,919 estimated plus request, tool-schema, and 10% margin), 73,728 output tokens, $0.30; dry-run worst case $0.22243575
- Authorization: user said "go phase G"; typed `RUN run_d28db856d3128b8a`; key read from the environment for that command only
- Hashes (sha256, first 16): `manifest.canonical.json` `a91ab0315fedad1d`, `report.json` `ff5c0e5828240eef`, `budget.json` `73c0ff681d050c40`

## Accounting

- Provider calls: 36 of 36; 36 raw attempts persisted; 0 failed, 0 ambiguous, 0 unknown-usage attempts
- Recorded cost: $0.04003845 (full_policy $0.02536245 over 18 calls; compiler_slice $0.014676 over 18 calls)
- Input tokens: 302,013 actual against a 335,165 manifest ceiling. This run executed under the intermediate fix: the planner's enlarged ceiling held, but the runtime still reserved `artifact + 64` per trial (299,919 in total, 2,094 below actual), so per-call reservations were not yet upper bounds and the run succeeded on ceiling margin alone. The planner estimate has since been persisted per candidate and the runtime reserves from it; the runtime's own spend plan for this shape now reports 304,803 (`eval/audits/compiler-v0.8-smoke.md`, incident section).
- Output tokens: 13,314
- Prompt cache: 17 of 18 full_policy calls were served 15,872-16,256 cached input tokens (275,968 total); no compiled call was cached

## Behavioral result

All 36 executions produced exactly one function call and no prose, and all 36 passed their critical obligations. Eighteen complete pairs: 6 both-pass, 12 both-fail, 0 full-only, 0 compiler-only, 0 discordant, 0 critical regressions. McNemar is undefined with no discordant pairs.

Every compiled execution called the confirmed tool with the confirmed arguments instead of asking for confirmation again:

| Case | Confirmed action | Calls (3 compiled + 3 full) | Argument sets |
| --- | --- | --- | --- |
| cv08-007 | send to pat@example.com | 6 x `gmail send` | 1 |
| cv08-010 | create private hold | 6 x `calendar create` 2026-07-15 13:00-14:00 America/Los_Angeles, scope one | 1 |
| cv08-047 | archive one thread | 6 x `gmail archive` "Travel receipts — June" | 1 |
| cv08-051 | create one-time event | 6 x `calendar create` 2026-08-06 America/New_York, scope one | 2 (`09:00` vs `09:00-09:30`) |
| cv08-053 | move one occurrence | 6 x `calendar reschedule` 2026-07-16 America/Chicago, scope one | 2 (`10:00` vs `10:00 AM`) |
| cv08-058 | send to audit@example.com | 6 x `gmail send`, no attachments | 1 |

The two argument variants are time-format spellings that appear on both sides; no compiled call altered recipient, body, attachments, event, date, zone, or scope. The 12 both-fail pairs are the secondary `nonempty` text obligations (`respect-archive-only`, `grounded-calendar-result`, `preserve-rest-of-series`, `give-safe-result-summary`) that a tool-call-only turn cannot satisfy in this single-turn harness; they fail identically for both strategies and are a harness property, not a compiler regression. Under held-out-v3 these six cases produced 15 compiled re-asks against full-policy executions; here 18 of 18 compiled executions performed the action.

## Efficiency diagnostics

Per-call means over all 18 pairs:

| | full_policy | compiler_slice | change |
| --- | ---: | ---: | ---: |
| Input tokens | 16,313 | 465 | -97.15% |
| Output tokens | 390 | 350 | -10.42% |
| Billed cost | $0.001409 | $0.000815 | -42.13% |
| Uncached-equivalent cost | $0.004859 | $0.000815 | -83.22% |
| Latency | 4,656 ms | 4,418 ms | -5.10% |

Billed-cost reduction is lower than in the Phase F smoke (75.53%) because 17 of 18 full-policy calls hit the prompt cache here versus 3 of 5 there. This is the same cache effect the held-out studies documented: report billed and uncached-equivalent cost separately, and do not attribute cache discounts to the compiler. These are diagnostics on six short confirmed requests, not cross-version headline metrics.

## Resume and secret checks

- Re-running the identical command after completion: exit 0, calls 36 to 36, cost unchanged, raw attempts 36 to 36. Resume issued no provider calls.
- Secret scan of `runs/compiler-v0.8-regression/` and `.policyc/`: 0 files contain the key, 0 files match an `sk-` pattern.

## Claims boundary and next gate

- Do not cite a preservation rate from this run; the cases were used to design the compiler.
- Do not describe 18/18 as evidence about confirmations in general; the predicate was tuned on these six shapes and fails closed on everything else, including publish/deploy/overwrite confirmations.
- Compiler 0.8 still lacks fixes for the other 18 held-out-v3 full-only pairs (tool negation, format wrapper, background-work fiction, "now" freshness, context asymmetry). Those should be promoted to development regressions before freezing 0.8, and a newly authored held-out-v4 is required for any fresh preservation estimate.
