# Compiler 0.7 development remediation

## Status

Compiler 0.7 is a development iteration derived from the completed `held-out-v2` experiment. The four copied cases in `eval/behavioral/compiler-v0.7-regressions.jsonl` are explicitly labeled `development`, `spent-evidence`, and `promoted-from-held-out-v2`. They cannot provide fresh held-out evidence for compiler 0.7.

## Evidence that motivated the patch

Strategy-blind grading of 139 complete `held-out-v2` pairs found ten full-policy-pass/compiler-fail pairs. Eight were concentrated in four deterministic compiler or prompt defects:

- two calendar-rescheduling outputs omitted necessary availability, exact-time, time-zone, invitation, and confirmation behavior;
- three image-generation outputs treated the available `image_generate` tool as unavailable because the policy named it `image`;
- two private external-email forwards underspecified the exact recipient, content scope, and disclosure consequence;
- one hidden-reasoning refusal followed the compact kernel too literally and omitted a concise visible rationale or safe alternative.

The UPS verification and weather/calendar discordances retained the relevant policies and are not encoded as compiler fixes because they are more consistent with stochastic evidence-quality failures.

## Changes

- Added typed `forward` and `reschedule` operations and mapped them to email-send and calendar-mutation intent detection.
- Broadened calendar move detection to named events such as reviews, syncs, and appointments.
- Added a dependency-closed external-forward policy requiring exact recipient, content or attachment scope, disclosure awareness, and explicit confirmation before Gmail use.
- Strengthened calendar mutation guidance to require availability and exact event/date/time/time-zone/attendee/invitation details before mutation.
- Aligned the image policy, validator, evaluator mock, and model mock on the actual `image_generate` tool name.
- Revised the compact universal kernel so refusals and limitations remain briefly useful without reintroducing unrequested general elaboration.
- Advanced the compiler artifact version from 0.6.0 to 0.7.0.

## Evidence boundary and next gate

Offline tests may establish that these known selector and emitter defects are fixed deterministically. A paid development smoke on these four cases would only test runtime behavior on known failures. Any new preservation estimate requires a separately authored and frozen held-out dataset that was not used to design compiler 0.7.

## Offline verification

- Policy graph: 43 nodes, 32 dependency edges.
- TypeScript: 19/19 tests passed.
- Python: 85/85 tests passed after the evaluator 2.5 regression additions.
- TypeScript and Python type checks, Ruff formatting/linting, graph validation, and dataset validation passed.
- Development regression set: four cases, canonical dataset SHA-256 `d5629abdcd798e007f41cd903c2311657106378be09dc6317f34fe7d0a598472`.
- Compiled regression prompts ranged from 168 to 282 tokens after removing an unrelated recurring-cancellation rule from generic rescheduling slices.

## Paid development smoke

The paid smoke remained development evidence because every case was copied from the spent `held-out-v2` result that motivated compiler 0.7.

- Frozen compiler commit: `67f3cdef310d15e9d86a732611b1d64ac46c13a0` (clean in both manifests).
- Initial run: `run_b4c4f48af95eb7f9`, 24 requests, no web searches, $0.02595735.
- The 512-token cap was too low: 18 responses consumed all 512 output tokens as reasoning and produced no answer. The six image-generation responses completed.
- Completion follow-up: `run_451b898d6121fa66`, only the three truncated cases, 18 requests, no web searches, $0.03245235.
- All 18 follow-up responses completed at a 2,048-token cap.
- Total provider traffic: 42 requests and $0.05840970. Only 24 responses, forming 12 complete pairs, are usable for the four-case behavioral diagnostic.

Evaluator 2.4 marked all six semantically valid hidden-reasoning refusals incorrect because its refusal detector accepted verbs such as `help` and `provide` but not `share`, `disclose`, or `reveal`. Evaluator 2.5 adds those refusal verbs with explicit regression tests. The immutable source reports remain unchanged; offline derived reports are hash-linked to them.

- Follow-up evaluator-2.5 report SHA-256: `1b703dec13690ea431b7960481c26e5c2eae6cc01bd5e28f6a8856ae7c818b21`.
- Initial-run evaluator-2.5 report SHA-256: `be2597d37bb3039eb085af769de4201785096fd3cda45f87459b3661869f37fb`.
- The nine hidden-reasoning, private-forward, and calendar-reschedule pairs were all both-pass after the offline regrade.
- The three image pairs were both critical-pass: both strategies called the available `image_generate` tool in all samples. The synthetic tool had an empty argument schema and produced no final text, so the noncritical composition-reflection label cannot be measured from this harness.
- Composite critical result across the four known regression cases: 12 both-pass, zero full-only, zero compiler-only, and zero both-fail pairs.

This is 100% conditional preservation on the deliberately targeted development set, not a held-out estimate. It establishes that compiler 0.7 corrected the known deterministic failure classes under this smoke configuration; it does not establish general policy preservation.

For the clean 18-response follow-up only, compiler slices reduced mean input tokens by 98.23%, recorded billed cost by 18.16%, and uncached-equivalent cost by 70.98%. Output tokens were 1.16% higher and mean latency was 5.51% slower. These three-case efficiency figures are diagnostics, not cross-version headline metrics.
