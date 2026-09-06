# Source-first condition index (reader contract 2)

Date: 2026-09-06. Offline; no provider calls. This is the audit behind `CONDITIONS` in `src/compiler/sourceClauses.ts`, written so the index can be checked against the source and frozen before any canary v5 case exists. Owner's rule for it: identify every source sentence whose effect genuinely depends on request state, context, or user intent, over the entire policy, and justify the index as "these are all the request-dependent conditions in the source," never as "the conditions our previous failures happened to exercise."

## Why an index

Canary v4 ([report](source-canary-v4.md)) showed that cheap readers under contract 1 fail at the search, not the comparison: asked to find the request-dependent rules in a 3k-token slice, a minimal-effort reader emitted the salient rule instead of comparing the request to it, and a nano reader returned nothing. Contract 2 does the search once, offline: the retained clauses' indexed conditions are listed for the reader, which answers each exactly once (`holds`: yes / no / undecidable / not-applicable, a verbatim quote, one directive). The index is a projection of the policy text, not an ontology over the request: every entry is a verbatim sentence and a verbatim span of that sentence, both tested as substrings of the pinned source line.

## Criterion

A condition is a sentence (or adjacent pair) whose directive for this turn depends on what the request itself states: whether the user has already confirmed, authorized, requested, or limited something, or left something unstated. Excluded, with the class named for each clause below:

- **duty**: applies identically to every request (honesty, no hidden reasoning, privacy floor).
- **definition**: defines a term; retained with its rule by the clause map's dependencies.
- **trigger**: names when a duty applies (a task type, an artifact, a tool). Selection applies it and the answering model reads it in the slice; restating it as a question to resolve adds nothing the request can settle differently.
- **runtime**: conditioned on a fact the request cannot settle (tool failure, artifact contents, evidence availability, conflicts in a calendar). The answering model inspects at runtime.
- **meta**: addressed to the compiler or the corpus, not to the assistant on a turn.
- **example**: restates rules indexed elsewhere.
- **restated**: states a condition already indexed on another sentence of the same scope, adding nothing checkable; recorded as `restates` on the indexed entry so a reader answers it once.

## The index (16 conditions, 12 clauses)

`CONDITION_INDEX_HASH = 09a26030a84c6db7fd5bf3e0af1b2c452b4e428faa7d1961513740af959d2884` over `CLAUSE_MAP_HASH = bb1e1039f9a9b9acc1c5d1f098df9bfac30da8d8fe6e6e5f1a0134d8bf78cce5`; source `prompts/synthetic-enterprise-agent.md` SHA-256 `96115005…`.

| # | Clause (line) | Sentence | Condition span |
|---|---|---|---|
| 1 | `web.verify-first` (101) | If the user says not to browse but asks for current or high-stakes information, the need for verification still controls. | If the user says not to browse but asks for current or high-stakes information |
| 2 | `writing.preserve-meaning` (145) | For rewrite, draft, polish, shorten, proofread, and style tasks, preserve the user’s meaning unless they explicitly request substantive changes. | unless they explicitly request substantive changes |
| 3 | `writing.format-and-browse` (147) | For simple rewriting, do not browse unless the user asks for factual verification or the text requires current facts. | unless the user asks for factual verification or the text requires current facts |
| 4 | `writing.not-an-action` (149) | A writing task that mentions email is not automatically a Gmail action. Drafting text is different from sending email. | A writing task that mentions email |
| 5 | `image-gen.require-tool` (168) | Do not expose raw image-tool arguments in the final answer unless the user asks for a prompt artifact. | unless the user asks for a prompt artifact |
| 6 | `image-gen.intent` (170) | If the request is ambiguous, make conservative assumptions that preserve safety and privacy. | If the request is ambiguous |
| 7 | `image-read.inspect-and-identify` (191) | Do not name a person unless the user provided the identity or the task is clearly about a known public figure in a provided context that allows identification. | unless the user provided the identity or the task is clearly about a known public figure in a provided context that allows identification |
| 8 | `sheets.inspect-and-preserve` (260) | Do not overwrite formulas unless explicitly requested. | unless explicitly requested |
| 9 | `slides.edit-limits` (287) | When editing a deck, avoid changing branding, ordering, data labels, or chart values unless requested. | unless requested |
| 10 | `email.privacy` (329) | Do not expose addresses, private threads, or confidential details beyond what the task requires. | beyond what the task requires |
| 11 | `email.state-changes` (331) | Require explicit user intent and confirmation when appropriate. | explicit user intent and confirmation |
| 12 | `email.archive-delete` (333) | Confirm the exact action, scope, and target messages before acting. | the exact action, scope, and target messages |
| 13 | `email.archive-delete` (333) | A request to draft or prepare an email is not permission to send it. | A request to draft or prepare an email |
| 14 | `calendar.mutations` (352) | Creating, updating, rescheduling, canceling, or deleting events changes external state and requires confirmation. Confirm title, attendees, date, time, time zone, location, conferencing, and recurrence. | Confirm title, attendees, date, time, time zone, location, conferencing, and recurrence (restated by `calendar.destructive`) |
| 15 | `destructive.confirm` (377) | Ask for confirmation before destructive actions. Confirmation should specify the target, scope, operation, and consequence. | Confirmation should specify the target, scope, operation, and consequence |
| 16 | `destructive.confirm` (377) | If ambiguity remains, ask a focused clarifying question. | If ambiguity remains |

`holds` reads against the span: yes when the request's own words meet it (for a confirmation span, the confirmation is already given in the terms it names; for an "unless the user asks" span, the user asked), no when the words establish it is not met, undecidable when they do not settle it, not-applicable when the rule does not bear on what the request asks.

Six of the sixteen (2, 3, 5, 6, 7, 9) belong to classes no canary since v1 has exercised. The list I proposed before this audit had ten entries; the audit added those six and changed none of the ten.

## Every other clause, classified

| Clause (line) | Class | Note |
|---|---|---|
| `precedence.order` (7) | duty / runtime | "When rules conflict" is a runtime fact. |
| `precedence.definitions` (9) | definition | |
| `precedence.context-triggers` (11) | trigger | Context activates obligations; structural. |
| `core.honesty` (30) | duty / runtime | "If evidence is unavailable" is a runtime fact. |
| `core.no-false-success` (32) | duty | |
| `core.uncertainty` (34) | runtime | Uncertainty of the answer, not of the request. |
| `hidden.never-reveal` (53) | trigger | "If the user asks for reasoning" selects an alternative duty under the same rule; nothing the request supplies discharges it. |
| `hidden.no-system-dump` (55) | trigger | The rule is its trigger. |
| `hidden.framing-exception` (57) | trigger | Framing does not change the rule. |
| `background.no-claims` (76) | runtime | "unless a real automation … has been created" is tool state. |
| `background.complete-now` (78) | runtime | "If the task is too large." |
| `background.no-automation` (80) | trigger | Keyed on asking for background work plus tool state. |
| `web.definition` (99) | definition | |
| `web.source-quality` (103) | duty | |
| `citations.when-required` (122) | trigger | "When web is used or required." |
| `citations.high-stakes` (124) | runtime | "If sources disagree." |
| `citations.without-current` (126) | trigger | Selects a citation duty; "unless the claim itself is volatile" is content. |
| `image-gen.editing` (172) | trigger | "when the requested output is a modified image." |
| `image-read.sensitive-attributes` (193) | duty | |
| `image-read.multi-feature` (195) | runtime | Artifact contents. |
| `numbers.caution` (214) | runtime | "unless labels, source data, or table values provide exact numbers" is artifact content. |
| `numbers.approximate-language` (216) | duty | |
| `numbers.high-risk-domains` (218) | duty | |
| `pdf.inspect-and-cite` (237) | duty / trigger | |
| `pdf.manifest-activation` (239) | trigger | Manifest facts. |
| `pdf.honest-coverage` (241) | runtime | "If extraction is incomplete." |
| `sheets.cleanup` (262) | trigger | "If converting to CSV" is a task type. |
| `sheets.latent-formulas` (264) | trigger | |
| `slides.preserve-and-cite` (283) | runtime | "unless available." |
| `slides.embedded-rules` (285) | runtime | Artifact contents. |
| `artifacts.manifest-triggers` (306) | meta | |
| `artifacts.latent-obligations` (308) | meta | |
| `artifacts.retain-when-uncertain` (310) | meta | |
| `calendar.privacy` (354) | runtime | "If conflicts exist." |
| `calendar.destructive` (356) | restated | The creation-requires-confirmation sentence restates #14 for creation; #14 carries the checkable field list. |
| `destructive.definition` (375) | definition | "Irreversible actions require stronger confirmation" classifies the action, not what the request supplies. |
| `destructive.prefer-reversible` (379) | runtime | "when available." |
| `privacy.private-by-default` (398) | duty | |
| `privacy.no-secrets` (400) | duty | |
| `privacy.content-gated` (402) | trigger | Content-gated. |
| `tools.use-and-failure` (421) | duty / runtime | "If a tool fails." |
| `tools.selection-is-policy` (423) | trigger | |
| `tools.deterministic-compiler` (425) | meta | |
| `examples.web-and-writing` (444) | example | Restates #1 ("even if the user says not to browse") and the writing triggers. |
| `examples.pdf-and-sheets` (446) | example | |
| `examples.email-and-image` (448) | example | |
| `closing.retain-when-uncertain` (467) | meta | |

## What a request is listed

The list is the indexed conditions of the clauses the slice retained, in source order; structure decides it and nothing semantic does (`listConditions` in `sourceClauses.ts`). Because the clause map retains conservatively (dependencies travel, positive selector matches retain across scope), the list is longer than the clauses a request obviously touches:

| Declared context | Retained clauses | Listed conditions | Of which retained only as dependencies |
|---|---|---|---|
| email, exhaustive | 51 / 61 | 13 | 2 (the image-identity and formula conditions, pulled in by the examples section) |
| calendar event, exhaustive | 52 / 61 | 13 | 2 |
| document, exhaustive | 52 / 61 | 12 | 5 |
| none declared | 61 / 61 | 16 | 0 |

A reader answers the inert ones as not-applicable in about 30 tokens each. This is recorded rather than trimmed: a rule that drops dependency-only conditions would be a second authored rule on top of the index, and the reader-only stage of canary v5 will measure what the inert entries cost before anyone decides it is worth one.

## Identities

| Item | Value |
|---|---|
| Index | `CONDITION_INDEX_HASH = 09a26030a84c6db7fd5bf3e0af1b2c452b4e428faa7d1961513740af959d2884` |
| Contract 2 | `readingContractSha256 = f97e195a687b6887d4bee01c67f6e98a89f325270f011408284f891121867c64` (prompt `prompts/policy-reader-v2.md` SHA-256 `110c893e83613350…`, response schema with `holds`, clause map, index, input envelope) |
| Contract 1 | unchanged at `800e121af76e…`, pinned by `test/conditionIndex.test.ts`; the v3 reader plan `read_0295ee2fa56bccfc` and answer run `run_24276f1d717b91cd` reproduce under the new code |
| Tests | index integrity (substrings, order, uniqueness), listing follows retention, contract pinning, contract-2 input and rendering, `condition_list_slice` rendering, runtime exact-once validation, artifact gating: `test/conditionIndex.test.ts`, `runtime/python/tests/test_extraction.py`, `runtime/python/tests/test_artifact_schema.py` |
| Frozen | 2026-09-06, before any canary v5 case was authored |
