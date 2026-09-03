# Compiler 0.8 freeze record

## Frozen identity

- Compiler: 0.8.0 at source commit `2e5fc441eeffacf576f389b17f352287987c73dc`, clean tree
- Policy graph: 43 nodes, 32 dependency edges, `policyPackHash` `7441f02323d1364b36354f18875929f898ae96dbabd68cb598d511ce9112ea03`
- Compiled-artifact protocol: 1.1.0 (`protocol/compiled-policy-artifact.schema.json`, sha256 `3312450910f5ac4898841c4fa5c9f7880aa97244130533f282f529288685670e`)
- Behavioral evaluator: `independent-rules` 2.6.0
- Provider adapter: OpenAI Responses adapter as of `2e5fc44` (last adapter-file change `67d2955`; empty-schema normalization `b299421`; optional-argument strict handling `ea863d2`)
- Synthetic source prompt: sha256 `961150058da20550d6004e52bdbd9a35954028d182883b3a4fcf19ff71ec803a`
- Pricing registry: `pricing/openai-v2.json`, version `openai-2026-07-12`
- Model snapshot for any paid evaluation: `gpt-5-mini-2025-08-07`

No compiler, policy-pack, schema, evaluator, or adapter change may land between this commit and the completion of the held-out-v4 experiment. Any such change makes v4 a development iteration for the changed code.

## What changed from compiler 0.7

One addition: a specialization stage between dependency closure and emission (`src/compiler/specialize.ts`). Selection is unchanged; `pnpm eval` selector metrics are identical to 0.7 (157 cases, precision 90.2%, recall 99.8%, critical recall 100%).

Seven policy nodes that carry an `ask_confirmation` obligation now declare a `specialization` with predicate `explicit_confirmation` and an authored `satisfied` branch: `external_state_change_confirmation`, `destructive_email_calendar_confirm`, `send_email_requires_explicit_request`, `external_email_forward_confirmation`, `archive_delete_distinction`, `calendar_event_mutation_policies`, `recurring_calendar_cancellation_scope`. When the predicate holds, the satisfied branch replaces the node's instruction and obligations; otherwise the node emits exactly as in 0.7.

The predicate holds only when one sentence of the request contains the user's own first-person present-tense confirmation (verb bound directly to `I`/`we`, allowing adverbs or a coordinator), names the same operation the artifact context declares, is not negated before or after the action, is not inside quotation or a reporting frame, is not conditional or future, and supplies every field the source policy requires for the artifact type and operation (email send: recipient, body, attachment scope; email forward: recipient, content scope, attachment scope; email archive/delete: exact thread; calendar create: title, date, time, time zone, attendee scope, location, conferencing, recurrence scope; calendar reschedule/update/delete: event, date, time, time zone; recurring artifacts add occurrence scope). Artifact/operation pairs without a rule never satisfy, so publish, deploy, overwrite, and file-level confirmations still ask.

Artifacts record a `specializations` trace (policy, predicate, satisfied, evidence) under protocol 1.1.0.

## Evidence so far

- Offline: `test/compiler.test.ts` asserts all six spent held-out-v3 confirmation cases specialize and fifteen negative controls still ask.
- Phase F smoke `run_b9daf24a2c394e8d` (11/12 executions, $0.0173) and Phase G regression `run_d28db856d3128b8a` (36/36, $0.0400): every compiled execution called the confirmed tool with the confirmed arguments; 0 discordant pairs; 0 critical regressions. Both are development evidence on the cases 0.8 was built from (`eval/audits/compiler-v0.8-smoke.md`, `eval/audits/compiler-v0.8-regression.md`).

## Intended claim and gates for held-out-v4

Claim under test: for frozen compiler 0.8, a request-specific compiler slice preserves the critical obligations satisfied by the full synthetic policy prompt while materially reducing model input and billed cost, on independently authored cases the compiler has never seen.

Gates (unchanged from held-out-v3, to be fixed in the v4 preregistration before any dry run):

- conditional critical-preservation point estimate at least 95%;
- Wilson 95% lower bound at least 90%;
- at most three cases with any full-pass/compiler-fail result;
- mean actual input-token reduction at least 90%;
- mean actual billed-cost reduction at least 15%;
- at least 90% of planned pairs complete.

Compiler 0.8 addressed one of the five held-out-v3 failure classes (redundant confirmation, 15 of 33 regressions). Tool negation, format-wrapper precedence, background-work fiction, "now" freshness misselection, and context asymmetry are untouched and are expected to recur on v4 at roughly their v3 rates. The gates are therefore a test of whether the whole compiler is ready, not of whether the confirmation fix works; the latter is read from the per-class root-cause breakdown after unblinding.

## Authoring independence

The agents constructing held-out-v4 may read only the authoring brief and the synthetic source prompt. They must not read this record, the compiler, policy packs, tests, prior datasets, run outputs, audits, the paper, or Git history. The brief asks for satisfied and unsatisfied preconditions across every domain because the handoff's Phase I list requires it; it does not describe the predicate, its field rules, or its negative controls.
