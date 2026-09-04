# Compiler 0.9 development smoke (Phase F)

## Status

Development evidence on the 20 visible regression cases, one sample each, automated evaluator 2.6.0 only (no semantic grading). Its purpose is to prove the harness executes compiler 0.9 artifacts (protocol 1.2.0) under the extractor frontend on a live model and that the compiled prompts behave sanely. It is not a preservation estimate: every case here is spent, and the evaluator is a regex judge.

## Run identity

- Run `run_d86bedf057ce1ae6`, directory `runs/compiler-v0.9-smoke/`, commit `bc03b35` (clean), compiler `0.9.0`, protocol `1.2.0`, evaluator `2.6.0`.
- Frontend `extractor:gpt-5-mini-2025-08-07:54d7f0ac870e`, reads `runs/extract-cv09-visible-r2/reads.json` (sha256 `247b88301ce8c39e…`), compiler hash `72a376aaa134…`.
- Model `gpt-5-mini-2025-08-07`, output cap 3,072, concurrency 2, retries 0, ceiling $0.60 (dry-run worst case $0.3704).
- sha256: manifest `95651843adcd03a0…`, report `8bb01639ff7a7889…`, budget `f9f8c33a17076578…`.

## Accounting

- 40 of 40 calls completed, 0 ambiguous, 0 failed; 4 built-in web searches (the planned maximum); `unknownUsageAttempts` 0; ambiguous exposure $0.
- Billed **$0.1775** against a $0.3704 worst case (0.48×).
- Input tokens: full 343,773 (cached 199,808), compiled 27,986 (cached 3,584): **91.86% less input**. Output tokens: full 20,959, compiled 24,192. Billed: full $0.1029, compiled $0.0746: **27.53% less billed**.
- Resume proof: the identical command at commit `bc03b35` exits 0 in 1 s with calls and cost unchanged and 40 raw files. (At a later commit the planner refuses the directory as belonging to a different run, which is the guard working: the artifacts changed.)
- Secret scan: zero occurrences of the key across the run directory and the catalog; two `sk-` pattern hits with foreign prefixes inside encrypted reasoning blobs.

## Behavior (automated evaluator, one sample)

Full 13/20, compiled 14/20; both pass 11, full-only 2, compiler-only 3.

| Case | Full | Compiled | Full tools | Compiled tools | Full critical failures | Compiled critical failures | Full input | Compiled input |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `cv09-001v3` | pass | pass | web,web | web,web | - | - | 25,105 | 9,373 |
| `cv09-003v3` | pass | pass | web | web,web | - | - | 25,204 | 9,483 |
| `cv09-006v3` | fail | pass | gmail | - | confirm-vendor-send | - | 16,308 | 611 |
| `cv09-009v3` | pass | pass | - | - | - | - | 16,319 | 746 |
| `cv09-014v3` | pass | fail | - | - | - | state-missing-contracts | 16,244 | 321 |
| `cv09-017v4` | pass | pass | - | - | - | - | 16,219 | 440 |
| `cv09-018v3` | fail | fail | - | - | preserve-incident-uncertainty | preserve-incident-uncertainty | 16,256 | 464 |
| `cv09-019v4` | pass | pass | - | - | - | - | 16,286 | 586 |
| `cv09-022v3` | fail | pass | - | image_generate | b22-edit-with-tool | - | 16,294 | 366 |
| `cv09-024v4` | pass | pass | - | - | - | - | 16,344 | 477 |
| `cv09-025v4` | pass | pass | - | - | - | - | 16,292 | 508 |
| `cv09-029v3` | fail | fail | - | - | b29-compute-from-text | b29-compute-from-text | 16,334 | 448 |
| `cv09-031v4` | pass | pass | - | - | - | - | 16,301 | 470 |
| `cv09-033v4` | fail | fail | spreadsheet_edit | spreadsheet_edit | ask-which,hold-off | ask-which,hold-off | 16,312 | 539 |
| `cv09-038v4` | pass | fail | - | - | - | qualify-claim | 16,318 | 407 |
| `cv09-041v4` | fail | pass | - | gmail | send-now | - | 16,363 | 548 |
| `cv09-044v4` | pass | pass | calendar | calendar | - | - | 16,331 | 631 |
| `cv09-046v4` | pass | pass | - | - | - | - | 16,351 | 549 |
| `cv09-056v3` | fail | fail | - | - | avoid-private-inference | avoid-private-inference | 16,304 | 481 |
| `cv09-060v4` | pass | pass | - | - | - | - | 16,288 | 538 |

Compiler-only passes are the three classes 0.9 targeted: `cv09-041v4` executed the authorized send (full re-asked), `cv09-022v3` used `image_generate` for the image edit (full did not), and `cv09-006v3`, where the full prompt sent the vendor email the user said they had not reviewed while the compiled prompt asked (the extractor read `present` and the disqualifier cap turned it to `absent`).

Full-only failures are both `states_uncertainty` regex misses on the compiled response, and one of them hid a real gap: on `cv09-014v3` the compiled model opened with "I'm working on it" before caveating, the present-tense fiction the source prompt forbids (lines 75–78). The compiled prompt only carried the kernel clause "or claim future background work" because the universal node's text never prints. Fixed after the smoke in `4b710c8`: a content-gated `asynchronous_work_request` node carries the source prompt's paragraph when the `background_work` intent fires, and that intent no longer fires on image backgrounds (`/\bbackground\b/` had matched "the background should become warm gray"). Five corpus cases change, all asynchronous-work requests. `cv09-038v4`'s compiled response ("Not verifiable from the slide as described") states the uncertainty in words the regex does not recognize; no compiler change.

Because `4b710c8` changed a prompt in this set after the smoke, Phase G runs on the final code and stands as the smoke of what freezes.

## Claims boundary

No preservation number. The extractor frontend, the disqualifier cap, and the format and image-edit fixes are exercised on a live model here for the first time; all of them are development evidence on spent cases.
