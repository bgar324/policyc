# Compiler 0.10 development audit

## Status

Compiler 0.10 is an **unfrozen development implementation** based on baseline commit `55862c5` (`test: freeze compiler 0.10 regression baseline`). The owner subsequently authorized a WIP checkpoint of the implementation and handoff. This is not a release freeze. It emits compiler version `0.10.0` and artifact protocol `1.3.0`, but the one-shot hidden frontend gate failed and the implementation is not release-eligible.

No PolicyC experiment or extractor requests were sent to OpenAI or another paid provider. No paid noise-floor measurement, Phase F run, Phase G run, or held-out-v6 run was made. Every experiment execution used the fake provider. This records experiment spending, not coding-assistant session usage.

## Development evidence and boundary

The visible regression set is `eval/behavioral/compiler-v0.10-regressions.jsonl` (11 cases, SHA-256 `e2e78b89a6a58d9c2a2f341b77174bb201291690b62ea58a7079e5143860eb9e`). The second regression slice is `eval/behavioral/compiler-v0.10-regressions-heldback.jsonl` (5 cases, SHA-256 `3850124e8c4bb9f3b3828a0df9a9b56fc00642b67d9da96303e4cf5f3d3d02d9`). The generic contract checks required tools, ask-side behavior, acting-tool suppression, and recorded ask/action conflicts. Its own mixed ask-plus-act control proves those last two checks fail closed. The contract was committed while red before implementation; both slices now pass.

The five-case slice is not held-back evidence. Its request text was exposed, a coarse request-state diagnostic was emitted during debugging, and one quoted-name-before-noun target form directly informed the recognizer that resolved its final failure. It is now a tuned, permanently spent regression set. Its green result establishes only that the known regression is covered.

Evidence discipline was imperfect and is not being hidden:

- Broad searches exposed the five-case regression text and held-out-v5 request text after the evidence freeze. Subsequent corpus reads and hash checks used explicit visible-file allowlists.
- During one aggregate regression failure, a temporary diagnostic reported one class tag and a coarse request-state signature. It did not report a case ID, evidence trace, or compiler trace. The diagnostic was removed.
- The fresh five-slice generality evidence remained request-text and trace blind to the implementation author. Its custody verifier and one-shot scorer emitted aggregate results only.

The full incident record remains session-local at `local://compiler-010-evidence-incidents.tsv`.

## What changed

### One request-state read drives selection and evaluation

`RequestState` adds five strict semantic observations:

- `currentInformation: boolean | null`
- `deferredWork: boolean | null`
- `slideTask: boolean | null`
- `externalDisclosure: safe | confidential_external | unknown`
- `requestedSlideReorder: boolean | null`

The frontend still runs once per request. The same state selects policies and evaluates every candidate. State triggers are positive whitelists; artifact and operation scopes are pure gates. Unknown selection-driving facts retain the safety node after its scopes pass.

The deterministic frontend applies trusted boundaries and monotone floors. It recognizes current-information and deferred-work requests, existing-deck work, exact slide reorders, disclosure risk, authorization acts, operation naming/negation, and artifact field contracts. Inline supplied-text rewrites do not become external artifact mutations. Quoted or reported operations—including single-quoted text, delegated actors, and third-party colon/dash attribution—cannot authorize action. A dash imperative overrides an earlier first-person report only when the user explicitly says stakeholders were notified and there will be no surprise. Explicit same-operation negation fails closed when intent is mixed. Confidential material is treated as internal only from explicitly recipient-scoped context or recipient-bound wording; any external marker wins.

### Artifact mutation contracts and connectors

Spreadsheet, document/slide, PDF, email, and calendar operations now have explicit field contracts. A complete action requires authorization in the user's voice, a named non-negated operation, and every operation-specific target/change field. Coordinates, ranges, quoted or explicitly named structural objects, and connector-supported message scopes can identify a target; bare references and arbitrary modified sets such as `this page` or `old messages` are incomplete. `approved_without_scope` applies only when authorization is present and fields are incomplete.

Artifact policies emit concrete connectors rather than relying on an unbound inspection abstraction:

- PDF reads use `pdf_read`; PDF mutations use `pdf_edit`.
- Spreadsheet mutations use `spreadsheet_edit`.
- Existing-slide mutations and exact reorders use `slides_edit`.
- Email actions use `gmail`; calendar actions use `calendar`.

Artifact-specific branch conditions prevent one artifact's connector from leaking into another. An authorized exact calendar deletion, for example, emits only `calendar`, not `gmail`, and does not re-ask.

### Effect-aware masking

Connector obligations are classified as read or act before masking. Ask-side confirmation suppresses acting connectors but preserves reads needed to answer safely. Text-only limits suppress tool actions; forbidden-purpose masks retain only the permitted read work. Compilation records a conflict if an acting tool survives beside a confirmation ask, if a required and forbidden tool collide, or if a tool survives a text-only limit.

### Extractor revision 3 and persisted-read identity

The extractor prompt now defines all five facts, authorization precedence, exact field-name conventions, attachment-by-omission, exact targets, slide reorder boundaries, and the distinction between output format and a tool/action limit.

`src/extractor/contract.ts` hashes the complete read contract: prompt, response schema, field inventory, field assignments, and a canonical input-envelope matrix covering null and empty context, every populated context list, and zero/one/many required fields. Persisted reads must include the 64-character contract hash, and their frontend ID must name its 12-character prefix. Legacy reads fail closed with a re-extraction error; historical compiled artifacts remain loadable.

The manifest records `readContractSha256`. Fixture parsing is a strict discriminated union. Aggregate-only read scoring/check output is available for evidence gates.

### Protocol cutover

Current artifacts emit protocol `1.3.0` and compiler `0.10.0`. Protocol 1.3 requires `requestState`, `evaluations`, `conflicts`, all five compiler-0.10 facts, and the same artifact-type enum in TypeScript, JSON Schema, and Python. Python and JSON Schema continue to accept historical protocols 1.0, 1.1, and 1.2; 1.2 request states receive conservative defaults for the new facts and retain their historically permissive artifact-type field.

The current extractor prompt SHA-256 is `432ee665be63a9d55bb135fbca0fb74236463321c6d2f636ad3d5ba634de4664`. The input-envelope matrix SHA-256 is `1f6f01e32c3b2390007cdb7cb7c20de9906c93af3bd418c6b932a18578a2a075`. The complete read-contract SHA-256 is `474dfe7c1274b256eed3dc9da33d762b297c083181af010ae993e137f2f59c06`.

## Offline verification

`pnpm build && pnpm test:all && pnpm eval` completed successfully:

- 78 TypeScript tests passed.
- Policy graph valid: 46 policies, 35 dependency edges.
- Ruff format/check and mypy passed.
- 107 Python tests passed.
- Structural evaluation: 157 cases; policy precision 88.3%; policy recall 99.8%; critical policy recall 100%; obligation and critical-obligation pass rates 100%; forbidden behavior rate 0%; average compiled prompt 292 tokens; token reduction 98.2%; severity-weighted failure score 2.0.

The pre-change selector baseline was 90.2% precision, 99.8% recall, 100% critical recall, and 98.3% token reduction. The precision and token changes are expected consequences of state-driven current-information retention and conservative artifact-mutation nodes. Critical recall and obligation safety remain intact.

A visible-only emission parity lever compared all four compiled strategies over 97 explicitly allowlisted, non-held-back behavioral cases: 388 prompts total, 210 byte-identical and 178 changed. Every change was classified: 139 policy-selection changes, 20 request-limit changes, 14 resolved-effect changes, and 5 current-information task-type changes; zero unclassified deltas. The complete per-case hash inventory is session-local at `local://compiler-010-visible-emission-deltas.json` (SHA-256 `c07e63d199f065c9be581963ce866bfbfdc300693448256a5e7745b860047dd0`). Hidden files were intentionally excluded and handled only by the blind aggregate scorer.

The final fake-provider end-to-end run (`run_036519770d68fddc`) completed 2/2 trials with zero failures or ambiguities. Both artifacts validated as protocol `1.3.0`, compiler `0.10.0`, with all five request-state facts. Temporary catalog rows were deleted; the research catalog returned to 23 runs and 2,236 trials with zero rows for that run ID. Temporary fake-run files were removed.

An independent different-model-family review returned six initial findings and four targeted re-review findings. The repairs cover slide-order advice, bare or arbitrarily modified targets, explanatory and quoted no-reask wording, reported/delegated operation text, mixed negation, disclosure floors, protocol artifact-type agreement, ask-side act suppression/conflicts, and complete extractor-envelope identity. A final author pass added direct controls for first-person delegation and third-party dash attribution. Full offline verification and the fake-provider smoke were rerun after the final code changes.

## Fresh hidden generality gate: failed

The frozen evidence custody verifier (SHA-256 `58fc97b483b556d32711701fedeaf2bbcf5271d301b288feba3b4c570860fe6a`) passed before scoring: 5 slices, 180 rows, 440 assertions, manifest SHA-256 `bcfa64deacdf6cf5ad31875584c4b621334083c4d30d4065e787eb2abb48e905`.

The one-shot aggregate scorer (SHA-256 `6989b7f58fb4effba92676aca7824b231acca4dcfab7ff55844517ab75bc0763`) then produced:

- 333/440 matched assertions (75.68%).
- 93/180 fully matched cases (51.67%).
- 107 mismatched assertions.
- Zero frontend fallbacks.

Measurement clarification: the scorer loads `defaultFrontend`, which is the guarded deterministic frontend, and compares returned `RequestState` values with independently authored labels. These are frontend label-agreement scores, not end-to-end preservation measurements. The scorer does not evaluate selection, branches, masking, emitted prompts, or an answering model. The 75.68% result is not directly comparable to the prior paid v5 preservation rate.

The scorer records only `HEAD` and a dirty flag, not hashes of the uncommitted implementation. Its custody and script hashes do not identify the exact compiler bytes scored. Session chronology records safety corrections after scoring, so the later WIP checkpoint has no new fresh generality score. Committing it does not retroactively repair that provenance limitation.

This is a failed development gate. The five fresh slices and all their fixtures are permanently spent. They must not be inspected, diagnosed, rerun, or used for tuning. Passing visible tests, the tuned five-case regression set, structural evaluation, and the fake-provider smoke does not offset this failure.

## Decision and next admissible step

Do not promote this WIP checkpoint to a compiler release or freeze. Do not prepare Phase F, Phase G, or held-out v6 from it. The owner authorized a development checkpoint, not acceptance of the failed gate.

The latest proposed next step is a source-preserving conservative slicing baseline before another architecture or additional semantic machinery. A full-policy, source-preserving, and specialized comparison must hold selection fixed where it claims to isolate transformation loss. The owner asked to preserve this proposal in the handoff, not to build or execute it yet. A future model-assisted reading gate must use newly isolated evidence, a keyless costed plan, and explicit authorization before provider calls. See [the midway discussion](../../.handoffs/0.10-midway-learnings-and-decisions.md) and [the operational handoff](../../.handoffs/2026-09-04-compiler-010-checkpoint.md). This checkpoint is development work, not preservation evidence or a release candidate.
