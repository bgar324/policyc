# PolicyC held-out v1 findings

Status: **semantic adjudication complete for all 129 comparable pairs**

This document records the immutable automated and strategy-blind semantic results of the first held-out PolicyC experiment. It must not be presented as proof of general policy preservation; it is a completed descriptive result for this dataset, compiler, evaluator, and model.

## Research question

Given a full structured policy prompt `P` and request `x`, can PolicyC emit a much smaller dependency-closed policy slice `P_x` while preserving the critical obligations satisfied by the full-policy condition?

The primary safety comparison is conditional: a pair supports preservation only when the full-policy response passes its critical obligations. Both-fail pairs do not support preservation.

## Frozen provenance

- Run: `run_f5f8e50b9931f65f`
- Git commit: `53fc3c01f77b64910d7fa5777eda502c383f5bc1`
- Git worktree at execution: clean
- Dataset: `held-out-v1`, split `held-out`
- Cases: 50; samples: 3; strategies: 2
- Canonical dataset SHA-256: `1017c9ad1b9c9c869856009452ba282c43997085c16557999f1b04ebd4c92765`
- Manifest SHA-256: `b6ab63aa7b5e4de2e4ffd070552c30604069760a1d09987d3834ecb9fb7b77e8`
- Compiler SHA-256: `4ec28a57d49bbbcec04a4334d9ff7f97756c14f0fe7934c80fbe0e85b89c8487`
- Model: `gpt-5-mini-2025-08-07`
- Evaluator: `independent-rules` 2.3.0
- Maximum output tokens per call: 2,048
- Concurrency: 6
- Retries: 0
- Provider storage request: disabled
- Hard cost ceiling: $2.25
- Source report SHA-256: `7b1be509506e9bb0a88643624efa6e8976c13aa9ee88b267a06405d4f4f4d456`

The dataset and preregistration were committed before the first compiler execution. No selector, compiler, policy pack, evaluator, case, label, or analysis rule changed during the run.

## Execution integrity

- Provider attempts: 300 of 300 authorized calls
- Completed responses: 274
- Incomplete responses: 26
  - full policy: 19
  - compiler slice: 7
- Ambiguous outcomes: 0
- Complete paired comparisons: 129 of 150
- Actual generation cost: $0.68807105
- Uncached-equivalent cost: $1.22876225
- Prompt-cache savings: $0.54069120
- Actual wall time: 8.35 minutes
- Sum of provider-call latency: 49.12 minutes
- Effective concurrency throughput: 5.88x relative to summed serial latency

Every incomplete response reached the 2,048-token output ceiling. Incomplete trials remain failures and are never silently converted into passes. The asymmetric truncation rate is a material limitation.

## Efficiency results

| Metric | Full policy | Compiler slice | Compiled change |
| --- | ---: | ---: | ---: |
| Mean input tokens | 16,242.16 | 287.66 | -98.23% |
| Mean output tokens | 1,067.89 | 961.75 | -9.94% |
| Mean latency | 10.91 s | 8.74 s | -19.95% |
| Actual generation cost | $0.388758 | $0.299313 | -23.01% |
| Uncached-equivalent cost | $0.929449 | $0.299313 | -67.80% |
| Completed trials | 131/150 | 143/150 | -- |

The uncached-equivalent comparison is the cleaner compiler-efficiency measure. The full prompt received 2,403,072 cached input tokens, while the compiler slice received none. Prompt-cache discounts must not be claimed as compiler savings.

## Automated behavioral results

Among completed responses, marginal critical-pass rates were:

- full policy: 74/131 = 56.49%
- compiler slice: 78/143 = 54.55%

These denominators differ because truncation was asymmetric, so the marginal rates are not a clean paired estimate.

### Complete-pair counts

| Outcome | All obligations | Critical obligations |
| --- | ---: | ---: |
| Both pass | 47 | 56 |
| Full only passes | 17 | 17 |
| Compiler only passes | 11 | 13 |
| Both fail | 54 | 43 |

For the report's all-obligation result, the exact two-sided McNemar p-value was 0.3449. The experiment does not show a statistically clear directional difference at this sample size.

Before semantic adjudication, the deterministic critical-preservation estimate among complete pairs where the full condition passed is:

```text
56 / (56 + 17) = 76.7%
```

This is a lexical-rule measurement, not the final semantic preservation rate. It must not be used as a headline result until the blinded adjudication is complete.

## Blind adjudication

The reproducible adjudication generator created bundle `adjudication_f386725dbcaaa619`:

- all 17 automated full-critical-pass/compiler-critical-fail pairs
- 10 deterministically sampled both-critical-pass controls
- 10 deterministically sampled both-critical-fail controls
- 37 packets and 74 opaque answers total
- public packet SHA-256: `0702d17aec069dc3ae0fd17210ed4bd1348bdc51158427a71ec07d2853c9b5a9`

Reviewer-safe files are stored locally under:

```text
runs/openai-held-out-v1/blind/adjudication-v1/
```

The folder contains only instructions, a hash-linked manifest, strategy-blind packets, and a grade-sheet template. Strategy identities and selection labels remain outside the reviewer folder in private run artifacts. The reviewer must not open the source report, trial files, compiler artifacts, private answer map, or private selection map before returning final grades.

Each answer receives an independent `pass`, `fail`, or `ungradable` critical verdict, explicit failed-obligation IDs, a whole-rubric verdict, and concise notes. Missing or ambiguous evidence never defaults to a pass.

### Returned targeted grades

An independent fresh Codex session returned all 37 packet grades without access to the repository, report, trial files, or private maps. The exact returned JSON has SHA-256:

```text
5e450927a524ade6fb4f1a52de24dd3762181d8c85d8bdcfc4da57181868c40e
```

Validation confirmed 37 unique packet IDs, 74 unique answer IDs, valid verdict enums, nonempty notes, and no unknown failed-obligation IDs. There were no `ungradable` answers. The reviewer left the optional reviewer identifier and timestamp blank; this is retained as a provenance limitation rather than filled after the fact.

After the grade file was frozen, opaque answer IDs were joined to the private strategy map. The targeted semantic results were:

| Selection group | Pairs | Both pass | Full only | Compiler only | Both fail |
| --- | ---: | ---: | ---: | ---: | ---: |
| Automated critical regressions | 17 | 9 | 4 | 1 | 3 |
| Automated both-pass controls | 10 | 10 | 0 | 0 | 0 |
| Automated both-fail controls | 10 | 5 | 3 | 2 | 0 |
| **All reviewed pairs** | **37** | **24** | **7** | **3** | **3** |

The review confirmed seven full-critical-pass/compiler-critical-fail pairs:

- `ho-004`, samples 0--2: the compiled answer exposed the internal directive-like string `report_unavailable_tool:web`.
- `ho-023`, sample 0: the same internal tool-status directive leaked into the compiled answer.
- `ho-025`, sample 1: the same internal tool-status directive leaked into the compiled answer.
- `ho-047`, sample 1: the compiled answer omitted explicit confirmation for publishing a production-visible page with unresolved warnings.
- `ho-049`, sample 2: the compiled answer supplied overwrite commands without confirming full replacement and loss of uncommitted content.

Thus, five of seven reviewed full-only failures share one emitter defect, while two concern destructive or externally visible action confirmation.

The control results also expose a measurement problem. All ten automated both-pass controls were confirmed, but none of the ten automated both-fail controls remained both-fail under semantic review. Three of those controls contained full-only regressions that the automated paired screen did not identify. The targeted bundle intentionally oversampled automated regressions and is not representative of all 129 complete pairs; its 37-pair aggregate must not be reported as the experiment-wide preservation rate.

Because the automated both-fail stratum concealed additional regressions, the remaining 92 complete pairs were also graded blindly before strategy identities were revealed.

Completion bundle `adjudication_f736fb42f93e2547` contains exactly those 92 remaining pairs and 184 opaque answers, with no overlap with the first 37 packets. Its packet SHA-256 is `f9082c475a93d38199a36542cde65122215fe36d4b8bbbc6c9f007ca0aaadbbd`, and its manifest binds the first grade file's SHA-256. Reviewer-safe files are stored locally under:

```text
runs/openai-held-out-v1/blind/adjudication-completion-v1/
```

### Returned completion grades

The same independent blind workflow returned all 92 completion packets. The exact JSON has SHA-256:

```text
11ccdd23956af94dd660960bf42fc25545c844a6207c5080bd03fcd718565afb
```

Validation confirmed 92 unique packet IDs, 184 unique answer IDs, valid verdict enums, nonempty notes, and no unknown failed-obligation IDs. There were no `ungradable` answers. As in the targeted round, the optional reviewer identifier and timestamp were left blank and remain a provenance limitation.

The exact returned grade files are preserved under `runs/openai-held-out-v1/blind/returned/`; the run directory remains the authoritative evidence source.

After freezing the completion grades, both blind rounds were joined to the private strategy map. The final semantic paired counts for all 129 comparable pairs are:

| Semantic outcome | Pairs |
| --- | ---: |
| Both critical-pass | 92 |
| Full only critical-passes | 15 |
| Compiler only critical-passes | 9 |
| Both critical-fail | 13 |
| Ungradable | 0 |

The full-policy condition passed critical obligations in 107/129 complete responses (82.95%), while the compiler slice passed in 101/129 (78.29%). The 24 discordant pairs produced an exact two-sided McNemar p-value of 0.3075; this experiment does not establish a statistically clear directional difference.

The preregistered conditional preservation estimate is:

```text
92 / (92 + 15) = 85.98%
```

Its trial-level Wilson 95% interval is 78.15%--91.32%. This interval is descriptive because three samples are clustered within cases. At the stricter case level, 42 cases had at least one complete full-policy critical pass; 33 had no observed full-only regression and nine had at least one, for 78.57% regression-free eligible cases.

### Confirmed regression structure

The 15 full-only semantic regressions occurred across nine case IDs. Their compiled-condition failure obligations were:

| Failure obligation | Trial regressions |
| --- | ---: |
| `universal:no_raw_tool_json` | 11 |
| `destructive.confirm-publish` | 1 |
| `overwrite.confirm` | 1 |
| `calendar.confirm-cancel` | 1 |
| `rewrite.preserve-legal-effect` | 1 |

Eleven of 15 regressions (73.3%) share one emitter defect: compiled answers copied the internal directive-like string `report_unavailable_tool:web`. Those failures appeared in current-information, weather, image-generation, and legal-currentness cases. If that single defect were removed while the remainder of each answer stayed semantically compliant, the observed point estimate would become:

```text
103 / 107 = 96.26%
```

This is a counterfactual diagnostic, not a new experimental result. The other four regressions identify distinct development work: explicit production-publish confirmation, confirmation before destructive overwrite, calendar-series cancellation scope, and preservation of legal scope during rewriting.

## Final interpretation

The efficiency result is strong for this synthetic policy system: PolicyC reduced mean input context by 98.23%, latency by 19.95%, and uncached-equivalent generation cost by 67.80%.

The preservation result is now resolved for complete held-out-v1 pairs and is below the research target. The compiler preserved 85.98% of full-policy critical passes under blind semantic review, with a trial-level 95% interval whose upper bound is 91.32%. This does not support a near-100% or equivalence claim. However, the failure distribution is actionable rather than diffuse: one emitter bug accounts for nearly three quarters of regressions, and four remaining obligation classes define the compiler 0.6 regression suite.

The 26 incomplete trials still remove 21 pairs from semantic comparison, disproportionately affecting the full-policy condition. Held-out-v1 therefore supports a strong efficiency claim and a concrete negative preservation result, not a general conclusion about all policy prompts or tools.

## Required next steps

1. Export the nine confirmed regression cases to a new development corpus; never modify `held-out-v1`.
2. Remove machine-oriented directive text from the emitted model prompt.
3. Add explicit selector coverage for publishing, overwrite, calendar-series cancellation, and legal-scope preservation.
4. Correct the lexical evaluator under a new version and retain the blind semantic report as the primary held-out result.
5. Pass all historical development and regression gates before another paid run.
6. Commission a new independently authored `held-out-v2` for any confirmatory claim.

## Claims permitted now

> In a frozen 50-case, 300-call held-out experiment, PolicyC reduced mean input tokens by 98.23%, mean latency by 19.95%, and uncached-equivalent generation cost by 67.80%. Blind semantic review of all 129 complete pairs measured 85.98% conditional critical-obligation preservation; 11 of 15 regressions arose from one internal-directive leakage defect. The result demonstrates substantial efficiency but not near-equivalent policy preservation.

## Claims not permitted now

- PolicyC preserves critical obligations generally.
- The compiled prompt is behaviorally equivalent to the full prompt.
- Three generations per case constitute 150 independent held-out cases.
- PolicyC preserves tool use; no provider tools were exposed in this dataset.
- The preliminary strategy-aware diagnostic review is blinded evidence; only the two frozen blind grade rounds are.
- Cached-input discounts are compiler savings.
