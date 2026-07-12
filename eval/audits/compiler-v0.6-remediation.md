# Compiler 0.6 remediation

## Status

Compiler 0.6 is offline-ready for a small development smoke. It is not yet behaviorally validated and does not change the compiler 0.5 held-out result.

The frozen `held-out-v1` cases and their recorded responses remain unchanged. The nine confirmed regression cases were copied into `eval/behavioral/compiler-v0.6-regression-v1.jsonl` with new IDs and a `development` split.

## Evidence that motivated the patch

Blind adjudication of 129 complete compiler 0.5 pairs found 15 full-pass/compiled-fail trials. Eleven shared one emitter defect: the compiled prompt exposed the machine-oriented directive `report_unavailable_tool:web`. Four others involved missing or underspecified safeguards for production publishing, whole-file overwrite, ambiguous recurring-calendar cancellation, and legal-effect-preserving rewrites.

## Changes

- Removed machine-oriented unavailable-tool directives from emitted obligations. The prompt now states the limitation as natural-language execution guidance.
- Added a general confirmation policy for destructive or externally visible changes, including publishing, deployment, and overwrite operations.
- Added recurring-calendar scope guidance covering the exact series, one occurrence versus all future occurrences, effective date, time, and time zone.
- Added legal rewrite guidance that preserves actors, defined terms, scope, rights, duties, timing, and conditions.
- Expanded destructive and calendar intent detection while narrowing `draft` detection so a noun phrase such as “draft pricing page” does not activate writing policies.
- Removed broad destructive-intent matching from email/calendar-only and archive/delete-only policies; keyword and artifact/operation triggers still retain those domain rules when relevant.

## Offline verification

- Policy graph: 42 nodes, 30 dependency edges.
- TypeScript: 17/17 tests passed.
- Python: 69/69 tests passed.
- TypeScript and Python type checks, Ruff formatting/linting, graph validation, and dataset validation passed.
- Development regression set: 9 cases, dataset hash `dbc937586e58e8be415e43f634dcb83a73bdfd9c1ce5208cc71c1a83d8622b35`.

Focused prompt tests assert that unavailable-tool directives do not leak, publish and overwrite requests retain confirmation and reversible-alternative guidance, recurring cancellation retains series scope, and legal rewrites retain legal-effect guidance.

## Interpretation and next gate

These checks establish selector and emitter behavior, not model-level obligation preservation. The next justified spend is a small paired development smoke over the nine-case regression set. It must use a new output directory, explicit call/cost ceilings, and separate authorization. If that smoke passes manual or blinded review, freeze compiler 0.6 and evaluate it on a newly authored held-out set; do not rerun `held-out-v1` as held-out evidence.
