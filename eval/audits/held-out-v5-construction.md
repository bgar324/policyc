# Held-out v5 construction record

## Status

Frozen dataset for the compiler 0.9 held-out study: `eval/behavioral/held-out-v5.jsonl`, 60 cases, canonical SHA-256 `a9ef58b0a4f728edbedb76d0aa206248afda319c13c2b5b5c83638fd6fc4f3b7`, pinned in `test/experiment.test.ts`. Compiler 0.9 was frozen first (`compiler-v0.9-freeze.md`, code commit `d96477b`, record `a8c99cd`); the brief was committed (`fb8ac40`) before any author ran.

## Procedure

1. **Brief.** `eval/authoring/held-out-v5/authoring-brief.md` is the v4 brief verbatim with version strings swapped, plus five sections written in the synthetic prompt's own words: what the user allows this turn, the shape of the answer, work after this turn, images and current information, and how users say a condition is met. It does not describe the compiler's request state, branches, field contract, masks, or tool naming convention.
2. **Authors.** Three `task` agents, each in its own temporary directory holding only the brief and the synthetic prompt, forbidden every other path, the web, `hub`, and the shared `eval` kernel. Domains: A universal/writing/privacy/destructive outside connectors (hv5-001..020), B artifacts (021..040), C email/calendar/composed (041..060). Transcript audit after the fact: every `path` inside the author's own directory; tools used were `read`, `write`, one `bash` (the prescribed jq check), `yield`. Raw batches committed untouched (`251490a`).
3. **Cross-audit.** A by C, B by A, C by B, each in a fresh isolated directory with the brief, the prompt, and the batch. Findings: 3 high, 18 medium, 21 low. Transcript audit: every path in-directory; auditor C ran one `grep` on the synthetic prompt in its own directory and auditor of A one extra `wc -l` on its own files, both disclosed, neither reaching outside.
4. **Repair.** Only through `eval/authoring/held-out-v5/revisions.jq`, one commented entry per finding citing its audit; raw batches never edited. Twenty cases changed. The coordinator's mechanical check added two repairs the audits rated low or missed: `hv5-042` ("get rid of" with `operation: delete`) and `hv5-046` ("kill the series" with `delete`) carried a resolving operation on an ask-side case, the hv4-042 defect class; both operations removed. `hv5-024`'s `operation: clean` (outside the brief's vocabulary) became `edit`.
5. **Verification.** The same auditors received the revised batch, the prior audit, and `revisions.jq`. A and B: zero high, zero medium residual. C: one medium (`hv5-044`'s new `omits_terms` list still carried "Let me know", the token the same round removed from `hv5-004`); fixed in `revisions.jq`, and a fresh final verifier confirmed zero high and zero medium. Low residuals (35 across the four verifications) are recorded in the verification files and left as rubric diagnostics: `riskHints` wording that names the graded trap, `contains_terms` values that echo the request, `nonempty` on secondary obligations, and one act-side calendar case (`hv5-060`) whose user says "cancel" while the vocabulary offers only `delete`.
6. **Freeze.** `policyc cases freeze` hash pinned; the test also asserts 60 unique ids and requests, nonempty critical ids, and that no ask-side case whose request leaves the operation open carries one in context.

## Composition

| Batch | Cases | Ask-side critical | Required tool | Forbidden tool | No tool |
| --- | --- | --- | --- | --- | --- |
| A (001–020) | 20 | 4 | 4 | 4 | 12 |
| B (021–040) | 20 | 2 | 10 | 6 | 3 |
| C (041–060) | 20 | 6 | 6 | 12 | 2 |

Tools declared: calendar 7, gmail 9, image_generate 3, image_inspect 1, pdf_read 3, slides_edit 5, spreadsheet_edit 7, web 8. Eight cases carry the built-in web tool. No case uses `expectedRefusal: required` (a coverage gap the A auditor noted; hard refusals are not part of this study's question).

## Evidence boundary

The authors never saw the compiler, its prompt, or any prior dataset; the auditors and verifiers saw only the brief, the prompt, and the batches. The coordinator (the agent that built compiler 0.9) read the batches to apply repairs and write this record; it made no compiler change after the freeze and will make none before unblinding. The extractor frontend reads these cases exactly once, after this freeze and before the preregistration, and the preregistration names the reads file's hash.
