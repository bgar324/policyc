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
- Python: 82/82 tests passed.
- TypeScript and Python type checks, Ruff formatting/linting, graph validation, and dataset validation passed.
- Development regression set: four cases, canonical dataset SHA-256 `d5629abdcd798e007f41cd903c2311657106378be09dc6317f34fe7d0a598472`.
- Compiled regression prompts ranged from 168 to 282 tokens after removing an unrelated recurring-cancellation rule from generic rescheduling slices.
