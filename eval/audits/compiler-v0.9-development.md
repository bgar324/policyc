# Compiler 0.9 development

## Status

Compiler 0.9 is a development iteration derived from the completed `held-out-v4` experiment and the `held-out-v3` regressions compiler 0.8 did not address. It is unfrozen. No paid call has been made against it. Any preservation claim requires a newly authored, frozen held-out-v5 set.

## Development set and the held-back gate

`eval/behavioral/compiler-v0.9-regressions.jsonl` (20 cases, hash `69e48aabb4e20270…`) and `eval/behavioral/compiler-v0.9-regressions-heldback.jsonl` (7 cases, hash `cc00b49e0d25921c…`) copy every held-out-v4 full-only case (17) and the ten held-out-v3 full-only cases compiler 0.8 left untouched, each tagged `class-<name>` by root cause. The split is explicit and stratified so every targeted class has cases on both sides: held back are `cv09-034v4`, `cv09-039v4`, `cv09-023v3` (limit), `cv09-002v4` (limit-selector), `cv09-048v4`, `cv09-052v4` (authorization), and `cv09-018v4` (ask-quality).

`test/compiler.test.ts` runs a generic contract over both files: no forbidden tool appears as a required action, every required tool appears without a re-ask, and every ask-side case still asks and names what to pin down. All four 0.9 tests failed on compiler 0.8 (commit `3cad225`).

Honesty about the gate: while making the held-back gate pass, the specialization traces of `cv09-048v4` and `cv09-052v4` were read to diagnose why they failed (a relative-clause false positive in the limit read; a contrastive negation; two field recognizers). Those two cases are therefore no longer unseen by the predicate's author. `cv09-034v4`, `cv09-039v4`, `cv09-023v3`, `cv09-002v4`, and `cv09-018v4` passed without their traces being inspected. The paid development smoke and, above all, held-out-v5 remain the only tests of generalization that this process did not touch.

## What changed from compiler 0.8

Changes touch selection triggers (new destructive-intent patterns and node keywords), node text, the emitter's precedence rules, and the specialization stage. The policy graph is unchanged (43 nodes, 32 edges); `pnpm eval` selector metrics are unchanged (157 cases, precision 90.2%, recall 99.8%, critical recall 100%).

**Selector (destructive intents).** `detectIntents` now recognizes releasing to production ("ship … to prod"), saving over an original, mass mailbox removal without the words delete or archive ("clear out … mailbox", "get rid of … emails"), and edit-and-save ("dedupe … and save it"). `destructive_email_calendar_confirm` and `archive_delete_distinction` gained matching keywords. On v4 these shapes never selected a confirmation node at all, so compiler 0.8's predicate was never evaluated on them.

**Emitter (ask-side text).** The default instruction on `external_state_change_confirmation`, `destructive_email_calendar_confirm`, and `archive_delete_distinction` now carries the source prompt's own asking checklist: exact target, scope, who will see it, reversibility, the archive-versus-delete distinction with its consequence, and a rule not to invent content the user has not supplied. Two emission-precedence rules: `inspect_artifact` is not listed as required beside `ask_confirmation` (ask outranks act), nor when the request's purpose is a sensitive-attribute or identification read (declining outranks inspecting for that purpose). `sensitive_attributes_no_inference` says so in prose.

**`explicit_limit` predicate (`src/compiler/limits.ts`).** Request-level. Verdicts `limited`, `ambiguous`, `none`. Signals: a negated action verb naming an available tool's action; a text-only deliverable ("just tell me", "that's all I need", "in words"); an advice question at a clause boundary; a text artifact as the requested deliverable (a prompt, a paragraph); inputs already supplied in the request. Scope constraints inside an action request are not limits: "archive it, do not delete it", "if you mention her, just say she is unavailable", a summary of an attached file, "don't send it, put it in drafts". When `limited` or `ambiguous`, every selected node's `call_tool` and `inspect_artifact` obligations are withheld and a prose limit is emitted; `ambiguous` also tells the model to ask before acting. The fail-safe direction is toward not acting. Two precedence rules: a satisfied confirmation (which proved the exact action and every field) outranks an `ambiguous` limit but not a `limited` one; a policy that both requires a tool and forbids the alternative (`current_info_requires_web` with `answer_current_info_from_memory`) is mandated by the source prompt and outranks any limit.

**Authorization read (`src/compiler/authorization.ts`).** Replaces compiler 0.8's "I confirm" verb scan. Reads the request for the structure of an authorization act: a settled-state clause in the user's voice ("I've been through the list", "I confirm") or attributed to others and adopted by the user ("everyone's confirmed", "priya already signed off"); a no-re-ask clause ("no need to loop back", "I don't need another readback", "don't ask me anything"); a go clause ("go ahead", "send it, don't draft it"). States `present`, `reported`, `conditional`, `absent`; only `present` proceeds. A go clause alone is a request to act, not authorization. Conditionals are recognized only when they condition authorization itself, not content. The field-completeness checks are unchanged in principle and widened in recognizer: times as "2 to 3pm", zones as "central time", targets as definite noun phrases ("the pricing sync", "the 38 messages under the 2022 audit label"), a stated body with no attachment mention as resolved attachment scope, location and conferencing as one field. Every required field must still be present.

Artifacts record both predicates in the `specializations` trace under protocol 1.1.0; the compiled-artifact schema and Python model accept `explicit_limit`.

## Reader boundary and blind paraphrase measurement

The authorization read now sits behind an injectable, schema-validated boundary (`AuthorizationReader` in `src/compiler/authorization.ts`, `guardedReader` wrapping any reader so a thrown error or invalid shape becomes `absent`). `specializeSelection` and `compileSelection` accept a reader; the default is the guarded deterministic baseline. A compile-time model-assisted extractor, once authorized, plugs in at this seam; the field-completeness checks run over whatever the reader returns, so an over-eager reader still cannot execute without every field (tested).

The current reader is a phrase-pattern baseline, not the planned extractor. To measure its recall without tuning on the measurement, 23 paraphrase fixtures (`eval/behavioral/compiler-v0.9-paraphrases.jsonl`) were written and labeled before either reader was run on them: 6 present-authorization, 7 non-present (reported, conditional, absent), 5 limited, 5 not limited. Result, unchanged since first run:

| Fixture group | Matched | Unsafe reads |
| --- | ---: | ---: |
| Authorization, expect `present` | 0 / 6 | 0 |
| Authorization, expect reported/conditional/absent | 5 / 7 | 0 (two `reported` cases read `absent`, the safe side) |
| Limit, expect `limited` | 1 / 5 | 0 |
| Limit, expect `none` | 5 / 5 | 0 |

The baseline reader fails closed on every fixture and recognizes almost none of the fresh phrasings. That is the same shape as compiler 0.8's held-out-v4 result, measured offline this time, before any paid call, on a fixture set that will not be used to tune. Held-out v5 would very likely reproduce it for the authorization class. The regexes were not adjusted in response; the fixtures stay as a fixed offline recall benchmark for whichever reader replaces the baseline.

Consequence for the roadmap: compiler 0.9's selector, checklist, limit-precedence, and emission-precedence changes stand on their own and are expected to move the ask-side, limit, and readout classes. The authorization class needs a reader that generalizes, and this measurement says a deterministic phrase reader is not it. The next step on that class is a compile-time extractor behind the existing boundary, developed against these 23 fixtures plus the held-back slice, which is a separate authorization decision because it introduces a model call into compilation.

## Offline verification

- `pnpm test:all` green: 32 TypeScript tests (including the four 0.9 regression tests over both slices, the blind paraphrase measurement, and the reader-boundary test), graph valid, ruff, mypy, 94 pytest.
- Fake-provider contract run over the 20 visible cases: 40/40 completed, all artifacts `0.9.0 / 1.1.0`.
- Sweep over all 60 held-out-v4 cases: `explicit_confirmation` satisfied on exactly the four act-side cases (`hv4-041`, `044`, `048`, `052`) and on no ask-side case; `explicit_limit` fires on eight cases, none of which requires a tool; no forbidden tool is emitted as a required action anywhere; every ask-side case asks. Three earlier over-limits (`hv4-001`, `027`, `055`) were found by this sweep and fixed before the version bump. Held-out v4 is spent, so this sweep is development evidence about safety, not a preservation estimate.

## Evidence boundary and next gate

Offline tests establish that the known defects are fixed deterministically on the cases they were derived from. Compiler 0.8 passed exactly this kind of check and generalized to nothing; the difference this time is a held-back slice, a structural rather than lexical read of authorization, and a whole-set sweep, none of which is a substitute for fresh evidence. Next: Phase F smoke (one sample, ceiling fixed after the dry run), Phase G regression run, freeze, author held-out-v5 with the same isolated-author protocol, preregister with an output cap no lower than 3,072, run once.
