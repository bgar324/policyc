# Held-out v4 construction record

## Frozen dataset

- Path: `eval/behavioral/held-out-v4.jsonl`
- Cases: 60
- Dataset version/split: `held-out-v4` / `held-out`
- Canonical SHA-256: `197dee9fe2719f20848d81e5a4144218e217690b1a1c5c1f3aa2922d66efdfb1` (supersedes `2c19952831d74beddffc2dddc7efd9504f811369c6f5848c5a9b18b9e3a6cfbf`, frozen at `de05e6f`; see "Post-freeze correction")
- Frozen compiler: 0.8.0 at `2e5fc441eeffacf576f389b17f352287987c73dc` (`eval/audits/compiler-v0.8-freeze.md`)
- Authoring brief: `eval/authoring/held-out-v4/authoring-brief.md`, committed at `9cb1227` before any author ran
- Synthetic source-prompt SHA-256: `961150058da20550d6004e52bdbd9a35954028d182883b3a4fcf19ff71ec803a`

No candidate prompt was compiled, no experiment dry run was generated, and no provider call was made against held-out v4 before the dataset freeze commit. The compiler implementation was not changed during dataset construction.

## What differs from held-out v3

The brief is v3's verbatim with one added section, "Precondition state", asking each batch for at least three cases where a careful reader of the synthetic prompt would judge a destructive or externally visible action already authorized by the request (so acting is correct and re-asking fails) and at least three where it could be read as authorized but a careful reader would still ask. The section quotes only the synthetic prompt's own requirements and tells authors to choose the reasons themselves. It does not describe compiler 0.8's predicate, its field rules, or its negative controls. A first draft of that section did list the compiler's own rejection reasons; it was replaced before any author ran, and no author saw it.

## Independent authoring procedure

Three context-isolated authors were each created without conversation history in a fresh temporary directory containing only the brief and the synthetic prompt. They were prohibited from reading anything else, from web search, from messaging each other, and from the shared evaluation kernel; each read the two files, composed its batch, wrote it with a single write, and validated it with `jq` inside its directory. Their transcripts were checked afterward: every read was inside the author's directory, every command was a `jq` validation there, and no eval, glob, grep, or search call occurred.

A first spawn was cancelled and discarded before any batch was used because the harness's shared kernel let one author see another's in-progress data; the second spawn ran with the kernel forbidden.

- batch A, `hv4-001`–`hv4-020`: universal/current-information, writing, privacy, and destructive actions outside email and calendar;
- batch B, `hv4-021`–`hv4-040`: images, PDFs, spreadsheets, slides, and artifact near misses, with explicit tool limits;
- batch C, `hv4-041`–`hv4-060`: email, calendar, connectors, and composed obligations, carrying the heaviest precondition-state load.

The raw batches are preserved unchanged under `eval/authoring/held-out-v4/batch-{a,b,c}.jsonl` (commit `cf161ad`). All 60 raw cases passed the strict loader before any repair.

## Audit and repair procedure

Each author cross-audited another author's batch under the same isolation boundary (A by C, B by A, C by B). The first audits found 3 high, 23 medium, and 21 low findings. The highs were: hv4-014 (act-side case whose replacement values were absent from the request, so neither acting nor asking was gradable), hv4-021 (rubric treated identification and team inference as decisive while only the inspection call was critical), and hv4-024 (critique of an image whose content was never described, with a rubric that failed the honest verifiability caveat).

The coordinating agent applied only dataset wording, label, schema-compatibility, and harness-observability repairs. Every transformation is replayable in `eval/authoring/held-out-v4/revisions.jq`; the original authored JSONL and audit reports remain intact. Medium findings of the form "a validator cannot observe tool arguments or post-tool prose" were left to the rubric and the strategy-blind semantic reviewers, as in held-out v3. Findings that were label errors, self-containment gaps, inverted or vacuous validators, or rubric wording that failed a correct answer were repaired.

Verification round one (same auditor per batch, revised batch plus their prior audit plus the revision script): all three returned `pass: true` with zero high findings and five residual mediums. A second revision round addressed those five; a fresh isolated verifier found two of the five repairs incomplete (hv4-042's term choice, hv4-054's obligation text left contradicting its reframed request). A third revision round fixed both; a second fresh verifier returned `pass: true` with zero high, zero medium, and two low findings of the known nonempty-cannot-check-a-two-part-answer class, which the rubric carries. No selector or compiler change was made in response to these cases.

## Post-freeze correction

After the `de05e6f` freeze, a review found that `hv4-042` still carried `artifactContext.operation: "archive"` while its request ("get rid of them") deliberately leaves archive-versus-delete open and its critical obligation is to ask which one is meant. The planner passes artifact context into candidate selection, so that field would have pre-resolved the ambiguity for the compiler strategy only. This is the same defect repaired in `hv4-019` during round one and missed here. The field was removed by one added `revisions.jq` transformation; no other case changed. A sweep of every case whose critical obligation is asking for confirmation found no other instance: the remaining ask-side cases either carry no operation or state the operation in the request and hinge on scope, second-hand permission, or range instead.

The corrected dataset was re-frozen under the hash above. The prior preregistration's single permitted dry run (`run_9332cb6c03fc44a5`, against the superseded hash under a $1.50 ceiling) compiled 120 candidate artifacts, was refused by the budget guard at a $2.53 worst case before any provider call, and its directory was then deleted rather than preserved, contrary to that preregistration. No compiled prompt was inspected and no model response exists, so no behavioral evidence was spent; the superseding preregistration records this and authorizes a replacement dry run that must be preserved.

Audit files: `audit-{a-by-c,b-by-a,c-by-b}.json`, `verification-{a-by-c,b-by-a,c-by-b}.json`, `verification-final-1.json`, `verification-final-2.json`.

## Frozen composition

- 60 unique IDs and 60 unique requests
- 94 critical-obligation references
- 59 multi-obligation cases
- 46 cases with artifact context
- 44 cases with an available tool: 39 synthetic-function cases and five built-in web-search cases
- 16 cases requiring a tool call
- 12 cases where asking for confirmation is critical
- Expected refusal: one required, 32 forbidden, 27 allowed
- Tools represented: Gmail 14, spreadsheet 7, Calendar 7, web 5, image inspection 3, PDF reader 3, slides 3, image generation 2

Authors reported their precondition-state coverage as: batch A act 3 / ask 3, batch B act 4 / ask 3, batch C act 5 / ask 6. Those labels are the authors' own and were not verified against the compiler.

The loader test pins the case count, split, unique IDs and requests, nonempty critical labels, and canonical hash.

## Evidence boundary

Held-out v4 is fresh evidence only for compiler 0.8 as frozen above. Inspecting any compiler-0.8 candidate prompt or model response spends the dataset for that compiler. Any subsequent compiler or dataset change creates a development iteration and cannot be rerun on held-out v4 as fresh evidence.
