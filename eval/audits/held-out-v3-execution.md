# Held-out v3 execution audit

## Frozen experiment

- Run ID: `run_c019d419734c6c5e`
- Dataset freeze commit: `564781c95825f1ec3057ececcca220bacd5b3965`
- Preregistration/source commit: `d81862808f66b5fb80b5c3bcb2f06764a8a23f03`
- Compiler 0.7 freeze commit: `67f3cdef310d15e9d86a732611b1d64ac46c13a0`
- Dataset logical hash: `8d6bf6999fcb7232e92633412f1eaf93be53a910dbfc1993f4fef7b6d49a7de3`
- Provider/model: OpenAI / `gpt-5-mini-2025-08-07`
- Design: 60 cases, two strategies, three samples, 360 model executions
- Runtime: concurrency six, no retries, 3,072-token completion cap, at most one tool call per trial
- Primary evaluation: exhaustive strategy-blind semantic grading; evaluator 2.6 is diagnostic

The dataset, compiler, policy artifacts, requests, model parameters, and
critical obligations were frozen before paid execution. A provider-adapter
schema repair was made before comparative results were inspected and is
separately documented in `held-out-v3-provider-schema-incident.md`.

## Final execution accounting

- Completed model executions: 360/360
- Additional pre-model HTTP schema rejections: 36
- Client Responses API attempts: 396 total (360 executions plus 36 rejected before execution)
- Built-in web searches reported by the provider: 20
- Input tokens: 3,230,515
- Output tokens: 265,686
- Recorded cost: $0.93327915
- Search-tool cost included above: $0.20
- Scheduler ceiling: $3.50
- Failed or ambiguous active trials: zero
- Accounting completeness: complete; no unknown usage attempts
- Cataloged execution interval: 943.72 seconds (15.73 minutes), or 22.89 completed executions per minute with concurrency six

The timing figure describes this concurrent run; it is not a measured speedup
against a sequential control. The 36 HTTP 400 responses were rejected before
model execution, reported no token usage, and are retained under
`quarantine-invalid-function-schema` rather than overwritten by resumed
successes.

## Runtime incident

The original function-tool adapter emitted `strict: true` for schemas with
optional properties. OpenAI rejected those requests because strict function
schemas require every property to be listed as required. Commit
`ea863d2746f45c778f6e22b5b0feb336871a391c` changes only provider
serialization: strict-compatible schemas remain strict, while intentionally
optional schemas are non-strict. It does not change compiler 0.7 or any model
input artifact. The repaired runtime passed 20 TypeScript tests, 89 Python
tests, both type checkers, Ruff, and policy-graph validation before resume.

## Artifact integrity

- Report SHA-256: `d3edf008aec1ae88eebde9e3634c2827a80ec394ccacd5846030e9ec31b91aed`
- Exhaustive blind-packet file SHA-256: `ea7bbef9403b7b0f261f9152ec8a8869fe30ddf4078e1a00601565a98b50f3cb`
- Locked merged-grade SHA-256: `576808092658dba67edb8fd25681ac342cc086fc6083a0a4ac20e606c71c58c8`
- Private answer-map SHA-256: `cb68185df789ba9de9087e3610177556535a5d9e300db6409f085eed699ff220`
- Unblinded semantic-results SHA-256: `86bc56cf23ae1ee7e293aed23407f098d695e86fba220b91abb6811c8e625318`
- Blind coverage: 180/180 paired packets and 360/360 answers
- API-key leak scan: zero matches outside the ignored `.env`
- SQLite catalog status: `completed`, 360 completed trials, zero failed or ambiguous trials

Three isolated Codex reviewer agents each received one 20-case packet batch.
Their packets omitted strategy, prompt size, tokens, latency, cost, and the
private answer map. The merged anonymous grades were hash-locked and pushed in
commit `f91bbf5` before strategy identities were opened. The three grade sheets
contain 304 anonymous critical passes and 56 failures with exact answer-ID
coverage and no ungradable critical verdicts.

## Efficiency results

Relative to the full-policy condition, compiler 0.7 produced:

- 93.75% lower mean actual input tokens (1,055.66 versus 16,891.65);
- 12.14% lower total billed cost ($0.43647250 versus $0.49680665);
- 19.75% lower generation cost after excluding web-search fees;
- 59.46% lower uncached-equivalent cost ($0.44396050 versus $1.09504025);
- 16.96% more mean output tokens (795.71 versus 680.32);
- 14.63% higher mean latency (9,302.05 ms versus 8,114.98 ms);
- 11 built-in searches versus nine for the full condition.

Actual input includes any retrieved search context, not just the compiled
policy artifact. Search fees reduced the billed-cost improvement below its
preregistered 15% gate even though generation-only cost cleared that threshold.

## Primary strategy-blind semantic result

| Outcome | Pairs |
| --- | ---: |
| Both critical-pass | 130 |
| Full only critical-pass | 33 |
| Compiler only critical-pass | 11 |
| Both critical-fail | 6 |

- Full-policy critical pass rate: 163/180 = 90.56% (Wilson 95%: 85.40%--94.02%)
- Compiler-slice critical pass rate: 141/180 = 78.33% (Wilson 95%: 71.76%--83.73%)
- Conditional preservation: 130/163 = 79.75%
- Conditional-preservation Wilson 95% interval: 72.93%--85.21%
- Discordant pairs: 44
- Exact two-sided McNemar p-value: 0.00126003
- Cases with at least one full-pass/compiler-fail result: 16/60
- Regression-free eligible cases: 42/58 = 72.41%
- Macro mean of within-case conditional preservation: 78.74%
- Leave-one-case-out conditional-preservation range: 79.38%--81.25%

The 16 full-only case IDs are `hv3-001`, `hv3-003`, `hv3-006`,
`hv3-007`, `hv3-009`, `hv3-010`, `hv3-014`, `hv3-018`, `hv3-022`,
`hv3-023`, `hv3-029`, `hv3-047`, `hv3-051`, `hv3-053`, `hv3-056`, and
`hv3-058`. At the case-aggregate level the full condition had more passing
samples in 15 cases, the compiler in six, and 39 tied; the exact sign-test
p-value across 21 non-tied cases is 0.07835. Repeated samples remain clustered,
so packet-level intervals and tests are descriptive rather than evidence from
180 independent cases.

Two full-only judgments in `hv3-009` expose a context-interface asymmetry:
the compact emitter turned the case's `work calendar` domain hint into
model-visible prose, while the full condition and blind packet did not expose
that hint equivalently. The locked primary grades correctly remain unchanged.
As a sensitivity check only, treating those two compiled answers as passes
would produce 132/163 = 80.98% conditional preservation (Wilson 95%:
74.27%--86.27%) and 15 distinct full-only cases, still failing every behavioral
gate.

## Regression localization

The 33 full-only failures are concentrated rather than diffuse. Primary root
cause attribution assigns 21 pairs to emitter wording or semantic loss, seven
to selector omission or misselection, two to the context-interface mismatch
described above, and three to isolated model/tool stochasticity:

- 15 redundant-confirmation failures across six already-confirmed Gmail or
  Calendar actions. Their compiled prompts still emitted
  `Required actions: ask_confirmation`, causing the model to request a second
  confirmation instead of executing.
- Six tool-routing failures: two missed a required image edit, three called an
  explicitly forbidden image-generation tool for prompt-only writing, and one
  called a forbidden spreadsheet tool for arithmetic supplied entirely in text.
- Three rewrite-format failures. The request required only the rewrite, while
  the compiled prompt required a `Draft/Notes` wrapper.
- Three present-tense background-work claims. The compact universal rule lost
  the full prompt's explicit treatment of “I'm working on it” fiction.
- One email-send case activated current-information/web rules because “now” was
  misclassified as a freshness request, then claimed email was unavailable and
  promised a later attempt.
- Two unsupported `work calendar` claims caused by asymmetric context exposure.
- Three isolated response-level failures: one missing controlling citation,
  one invented legal detail, and one invented date.

The redundant-confirmation, background-work, output-format, and tool-selection
groups account for 28/33 regressions and expose compiler or evaluation-pipeline
defects, not merely random model drift. The remaining three are more consistent
with sample-level model variance.

## Automated evaluator diagnostic

Evaluator 2.6 marked 69 both-pass, 28 full-only, 11 compiler-only, and 72
both-fail pairs, with compiler and full critical pass rates of 67.78% and
83.33%. These lexical and tool-rule results are diagnostics only. The
exhaustive strategy-blind semantic grades above are the preregistered primary
outcome.

## Preregistered decision

| Gate | Threshold | Result | Decision |
| --- | ---: | ---: | --- |
| Conditional preservation | at least 95% | 79.75% | fail |
| Wilson 95% lower bound | at least 90% | 72.93% | fail |
| Distinct full-only cases | at most 3 | 16 | fail |
| Mean actual input reduction | at least 90% | 93.75% | pass |
| Total billed-cost reduction | at least 15% | 12.14% | fail |
| Complete paired coverage | at least 90% | 100% | pass |

Compiler 0.7 therefore fails the frozen held-out-v3 test. The run is
operationally conclusive, but it does not support near-equivalence: compiler
0.7 delivered large context and uncached-cost reductions while replacing 33
full-policy critical successes with failures. The next compiler version should
make required actions conditional on already-satisfied confirmation state,
honor explicit tool-use negation and prompt-only image requests, and let
user-requested output format override generic wrappers. Held-out v3 must now be
treated as development evidence; any compiler 0.8 claim requires a new frozen,
independently authored held-out set.
