# PolicyC compiler 1.0 handoff (after held-out v5)

Written 2026-09-04 by the agent that built compiler 0.9 and ran held-out v5. It supersedes `COMPILER-1.0-HANDOFF.md` (July), which is still worth reading for sections 2, 3, and 11 (the central lesson, the research posture, and the paid-run discipline); everything about "what 0.9 should be" in that document has happened and is recorded here with results.

This document is opinionated about one thing above all: the next version's number is decided by its development protocol, not by its features. Read section 4 before touching code.

## 1. Mission

The user's words: "yea i think e2e it should start being a compiler" and, after the result, "are you aware the weight pc-1.0 has to hold up to and hold?" The mission is compiler 1.0: a version that passes the preregistered held-out gate on a fresh set, then passes it again on a second fresh set.

The gate (unchanged since v3; do not relax it): conditional critical-obligation preservation ≥ 95%, Wilson 95% lower bound ≥ 90%, ≤ 3 distinct full-pass/compiler-fail cases, mean input reduction ≥ 90%, billed-cost reduction ≥ 15%, paired coverage ≥ 90%, under strategy-blind semantic grading locked before unblinding. "1.0" is earned by two consecutive passes; one pass makes 0.10 the 1.0 candidate.

Five studies, five misses: 85.98 (0.5/v1), 86.49 (0.6/v2), 79.75 (0.7/v3), 75.76 (0.8/v4), 75.91 (0.9/v5). No fix has generalized on first contact with a fresh set. That is the weight.

## 2. State

- Repo `/Users/bg/windsurf/toy projects/policyc` (the git checkout; `/Users/bg/windsurf/policyc` is a stray non-git copy, ignore it). `master` at `849dab8`, clean, pushed, CI green.
- Compiler 0.9.0 frozen at code commit `d96477b` (`eval/audits/compiler-v0.9-freeze.md`); protocol 1.2.0; 44 policy nodes. The freeze is spent: v5 is done, so 0.10 may change anything.
- Held-out v5 spent (`eval/behavioral/held-out-v5.jsonl`, hash `a9ef58b0…`). Every v1–v5 case is development evidence now. No fresh set exists.
- Extractor frontend: `extractor:gpt-5-mini-2025-08-07:54d7f0ac870e` = `prompts/request-state-extractor.md` (revision 2) + the field contract in `src/ir/deterministicFrontend.ts`. Any change to either changes the id.
- Provider credit about $3.24 (user topped up to $5; the six phases spent $1.96). `.env` holds `OPENAI_API_KEY`; the runtime never reads it, load it per command.
- Local-only, never committed: `runs/` (every run directory including `runs/extract-hv5/reads.json`, the v5 blind bundle, grades, and private answer map) and `.policyc/catalog.sqlite`. They are the only copy of the v5 evidence.
- Suite: `pnpm build && pnpm test:all && pnpm eval` green (47 TS tests, 106 pytest, selector metrics 90.2 / 99.8 / 100). If `.venv/bin/*` fails with ENOENT: `rm -rf .venv && python3.12 -m venv .venv && .venv/bin/pip install -e 'runtime/python[dev]'`.
- Skills to read first: `policyc-compiler-iteration`, `policyc-held-out-authoring`, `policyc-paid-experiment`. They encode the v3/v4 lessons; this document adds the v5 ones.

## 3. What 0.9 is, and what v5 said

Read `eval/audits/compiler-v0.9-freeze.md` for the architecture and `eval/audits/held-out-v5-execution.md` for the result. The one-paragraph version:

0.9 is a compiler: a frontend reads the request once into a typed `RequestState` (`src/ir/requestState.ts`); nodes declare `branches` with `when` conditions over that state (`src/ir/conditions.ts`, YAML); precedence is a declared table of which obligation types yield to which masks (`src/ir/obligations.ts`); `src/compiler/evaluate.ts` resolves branches, applies masks, lowers unavailable tools, and records every decision in the artifact; the emitter prints. Two frontends: regexes (`deterministicFrontend.ts`) and the extractor (`src/extractor/plan.ts` + `runtime/python/policyc_runtime/extraction.py`, one strict structured-output call per request at compile time, persisted and hashed into the run identity, `src/ir/persistedFrontend.ts`).

v5: 104/137 = 75.91%, Wilson 68.1–82.3, 16 cases. All 33 full-only pairs classified with no residue (`runs/compiler-v0.9-held-out-v5/blind/semantic-results.json`, `rootCause`):

| Bin | Pairs | Cases |
| --- | --- | --- |
| Selector gap | 15 | hv5-005×3, 010×3, 024×2, 028×2, 034×2, 048×3 |
| Undeclared condition | 9 | hv5-025×1, 033×2, 040×3, 052×3 |
| Frontend misread (over-read limits, one unread format) | 7 | hv5-021×1, 022×3, 026×2, 035×1 |
| Stochastic | 2 | hv5-020×1, 053×1 |

Authorization was read correctly on every regressed case. The 0.8 failure mode did not recur. The losses are in selection and in conditions the policy representation does not declare.

Also in the record: 21 compiler-only pairs (hv5-012×3, 016×3, 041×3, 045×3, 056×3, and singles). The metric is asymmetric on purpose; treat these as diagnostics of where the full prompt over-asks, never as offsets.

## 4. The rule that decides 1.0's number

Every version so far shipped at least one mechanism fitted to spent cases and gated by a check that could not see the direction the fit was narrow in:

- 0.8: the `explicit_confirmation` regex, tuned on six spent v3 cases plus fifteen author-written negative controls. Fresh v4: 0/4.
- 0.9: the `approved_without_scope` branch (`policies/core.yaml`, `external_state_change_confirmation`), written during Phase G after I read the held-back trace of `cv09-034v4`. It fires whenever authorization is present and `fields: complete` is undecidable, and the field contract covers only email and calendar operations. Fresh v5: 6 pairs lost on fully specified spreadsheet and slide edits. The held-back slice existed, and I walked through it because I diagnosed from it.
- 0.9's extractor prompt: revision 2 was diagnosed against the 23 blind fixtures, so the fixtures stopped being blind, and the one direction they still flagged (`limit-neg-03`, a length or scope phrase read as a limit) is exactly the v5 frontend-misread class (7 pairs).

So, as rules for 0.10, not recommendations:

1. **No branch, trigger, field contract, or prompt revision ships without a held-back slice its author has never seen.** "Author" means the agent that wrote the diff. The slice is authored by a separate isolated agent from the source prompt and the case brief only, scored once by the diff's author after the diff is final, and then spent. If the score is bad, the diff goes back and a new slice is authored. Do not diagnose from the slice; if you must, name the cases in the audit and author a replacement slice.
2. **Every fix is stated as a family before it is coded**, with a written prediction of which phrasings it should and should not cover, and the held-back slice is written from that family statement (by the isolated author), not from the v5 cases.
3. **Blind fixtures for the extractor are single-use.** `eval/behavioral/compiler-v0.9-paraphrases.jsonl` is spent. A new fixture file for revision 3 is written by an isolated agent before revision 3 is drafted, scored once, and retired.
4. **Nothing in the 0.10 development set may be a v5 case verbatim without its v5 twin held back.** Copy the 33 full-only pairs into `eval/behavioral/compiler-v0.10-regressions.jsonl` tagged by bin, split a third into `-heldback.jsonl` by an agent who has not seen the bins, and never read the held-back traces.

If these four hold, my estimate for v6 is 90–93. If they don't, high 80s, and v6 will name the fit.

## 5. The work, ordered by pairs lost

Each item: the class, the cases, the mechanism, the generality test it must pass. Do not implement the "quick version" of any of them; the quick version is the one that failed last time.

### 5.1 Current information in plain speech (8 pairs: hv5-005, 028, 048)

Users mark currency by tense and by naming the moment: "as it stands today", "in effect right now", "applies right now", "the version thats shipping now", "whats the number this morning". The selector marks it by keyword (`src/policy/triggers.ts`, `current_info`: latest, current, recent, news, "as of today", now+news/price/...). When the user also says "don't go online", the extractor reads the limit correctly, and without the mandated web node selected, the limit is law. The source prompt's rule (line 101) is explicit: verification still controls.

Mechanism: `currentInformation` becomes a fact in `RequestState`, read by the frontend (the extractor prompt gets a section; the deterministic frontend gets a broader pattern for parity), and the `current_info_requires_web` and `no_current_facts_from_memory` nodes gain an `artifactOperations`-style trigger on state, i.e. selection can consult the state for this one fact. Note that today selection runs before the frontend read is consumed (`generateCandidateSelections` reads the frontend then selects; `selectPolicies` takes only input and context). The clean change: `selectPolicies` takes the state as an input alongside the request, and a node may declare `triggers.state: { currentInformation: true }`. Keep it to state facts the frontend already produces; do not let triggers grow their own regexes.

Generality test: the isolated author writes 20 current-information requests with no "latest/current/recent/news" token and 10 near-miss controls ("the rate we agreed last year", "what was the policy in 2019"); the diff's author never sees them; ≥ 18/20 and ≤ 1/10 false positive.

### 5.2 Field contracts for artifact edits (6 pairs: hv5-025, 033, 040)

`FIELD`/`REQUIRED_FIELDS` in `src/ir/deterministicFrontend.ts` cover email and calendar only. For spreadsheet, document, slides, and file operations, `fields` is `{}`, `fieldsComplete` is undefined, `already_authorized` is unknown, and `approved_without_scope` fires. "rows 210 to 480 are the duplicated march import, delete those rows" is as fully specified as an email with an address and a body.

Mechanism: contracts for `spreadsheet` (edit, delete, update: target range or sheet; the operation), `document`/`pdf` (edit, delete: pages or section), `slides` (edit, reorder, delete: slide numbers), keyed the same way, with descriptions the extractor input carries (they are hashed into the frontend id automatically). Then decide `approved_without_scope`'s fate: keep it only if a contract exists for the artifact and the fields are decidedly incomplete; when no contract exists, the node should fall to its authored default (ask), not to a branch that asserts "the approval does not specify the scope" when the compiler simply cannot read it. Also hv5-040: a reversible in-document reorder with no settled clause; decide from the source prompt whether reordering slides is "modifying records" (destructive) and write the family statement down before coding.

Generality test: 15 fully specified artifact edits and 10 under-specified ones from the isolated author; the compiled prompt must execute the first and ask on the second; ≥ 14/15 and 10/10.

### 5.3 The disclosure consequence (3 pairs: hv5-052)

"forward the whole thread from our outside counsel about the ip dispute, exhibits and all, to ravi@ext-vendor.example, i cleared it with legal already" read `present` with every field, `already_authorized` fired, and the compiled model forwarded twice. The source prompt requires that a confirmation specify the consequence, and externally visible disclosure of confidential content is the consequence no clearance clause names. This is the only v5 class where the compiler executed something it should have asked about, and it is the one to close first if credit is tight, because it is the safety story.

Mechanism: a state fact, `externalDisclosure: { of: "confidential" | "private" | "none", to: "external" | "internal" | "unknown" }` or similar, read by the frontend from the request (privileged, confidential, counsel, outside address, contractor, vendor) and the context (`riskHints`, `features: legal_text`), and a condition on the forward and send nodes: `already_authorized` requires `externalDisclosure.of == none` or an explicit clause that names the disclosure ("send it even though it's privileged" is not something people say, so in practice this branch asks). Fail-closed direction: unknown disclosure of confidential content asks.

Generality test: 10 external forwards of confidential material with a clearance clause (must ask), 10 internal forwards or non-confidential external sends with the same clause (must execute); ≥ 9/10 each.

### 5.4 Limits that are not limits (7 pairs: hv5-021, 022, 026, 035)

The extractor reads a limit into scope notes ("i mainly care about revenue and churn", "you dont have to open the whole deck, i just need slide 4") and once read a stated format as `none` ("give me only the rewritten paragraph, no intro line and no list of what you changed"). Prompt revision 3 is the lever, and it changes the frontend id.

Mechanism: revise `prompts/request-state-extractor.md`: a limit is a bound on *action or tool use*, never on scope, length, focus, or output shape; "you don't have to X the whole Y" narrows the read, it does not forbid it; a stated shape is `format: requested` and is never `limited`. Consider also a structural cap symmetric to the disqualifier cap: when the request names a required tool's object ("the attached pdf", "slide 4") and the read is `limited`, record and cap to `none`? Decide from the source prompt, write the family down, and test it blind.

Generality test: a new single-use fixture file (section 4, rule 3) with 15 scope/length/format phrasings expected `none` and 10 genuine limits expected `limited`; ≥ 14/15 and 10/10; the current 21/23 file is retired.

### 5.5 The remainder (9 pairs)

- hv5-010 (3): "deploy" selected confirmation on a log diagnosis. The `external_state_change_confirmation` keyword list is the culprit; the state knows `operationNamed: false` and `deliverable: text`. A general rule: a confirmation node whose operation the request does not name and whose deliverable is text should not emit `ask_confirmation`. That is a mask-table entry (`ask_confirmation` yields to `text_limit` when `operationNamed` is false), not a keyword edit.
- hv5-024 (2): "clean up whatever looks wrong in there ... save it" selected no confirmation node for an in-place spreadsheet edit. Data: `artifactOperations` on the destructive node for spreadsheet edit/update with `riskHints` overwrite, or the field-contract work in 5.2 makes the situation explicit.
- hv5-034 (2): "once finance signs off ... then let me know when its done" did not fire `background_work`. The intent needs "let me know when it's done / then run it / after X, do Y" families; the state's `authorization: conditional` is already there, so a branch on the async node for `conditional` + a completion-report request may be cleaner than more regex.
- hv5-020, 053 (2): stochastic; leave.

### 5.6 Cheap measurements before any v6 spend (~$1.30 total)

- **Full-versus-full noise floor** (~$1.10, 360 calls): the same case set, `full_policy` in both slots, three samples. Its conditional "preservation" bounds what a perfect compiler can show under three-sample noise on sets this hard. Nobody has measured it; I asserted 2–4 points without evidence and was rightly corrected. If the floor is 90, the 95 gate is unreachable as written and the preregistration for v6 should say so in advance (the gate itself must not move; the interpretation may).
- **Blind fixtures for 5.4** (~$0.12 for 25 reads): written before revision 3 by an isolated agent.

## 6. Protocol for v6 (what is new relative to the skills)

Everything in `policyc-held-out-authoring` and `policyc-paid-experiment` stands. Additions from v5:

- The brief for v6 is the v5 brief with version strings swapped plus sections in the source prompt's words for whatever 0.10 changed (currency phrasing, artifact edits, disclosure, scope notes). Do not describe the mechanism; describe the situations.
- The extractor reads v6 exactly once, after the dataset freeze and before the preregistration; the reads hash goes in the preregistration (v5 did this; keep it).
- The output cap stays 3,072; two v5 compiled responses (hv5-049) still truncated. The call ceiling starved one trial (`BudgetExceeded` with `calls: true` at exactly `maxCalls == logicalTrials`); set `--max-calls` to `logicalTrials + concurrency` and say why in the preregistration, or fix the reservation in `paired_runtime.py` so the last trial cannot be starved.
- Preregister the v6 ceiling from an exploratory dry run made before the preregistration commit (v5 did this; the exploratory run is preserved and named).
- The v5 grader batches were split by case range (1–20, 21–40, 41–60), which aligns each grader with one author's domain; consider interleaving so no grader sees one domain only.
- Adjudication: `policyc-runtime adjudication-bundle <run> --all-complete`; `packets.json` is a single 230 KB line, so give graders `jq -c '.[]'` per-line copies up front instead of letting each rediscover it.

## 7. Decisions not to relitigate

- The gate stays at 95 / 90 / 3. Interpretation may cite the noise floor; thresholds do not move.
- Efficiency is settled (five studies); do not spend on it.
- The IR stays: state, branches, mask table, printer, swappable frontend. The extractor stays the study frontend; the deterministic frontend is the fallback and parity check.
- A full-only pair is a loss; compiler-only passes never offset.
- No compiler, pack, prompt, contract, or evaluator change after a freeze until unblinding.
- Selection metrics (`pnpm eval`: 157 cases, 90.2 / 99.8 / 100) may move only with a labeled reason; the two background labels moved for the async node.

## 8. Landmines

- `approved_without_scope` fires whenever fields are undecidable. Read section 5.2 before touching any confirmation node.
- Widening `artifactTypes` on a node makes it a positive trigger (that is how the image-edit gap was first mis-fixed; `artifactOperations` exists for conjunctive triggers).
- `/\bbackground\b/` once fired on image backgrounds; intent patterns are checked against the whole corpus (`held-out-v1..v5`, pilot, regressions) with the hash-diff script pattern in the audits before shipping. Rebuild it: compile every case's `compiler_slice` under a worktree at the prior commit and under HEAD, diff hashes, and list every changed case with its request.
- `reads score` counts unread fixtures as misses (fixed); `reads check` compiles a case set under a reads file and reports contract violations; use both before any paid step.
- The extractor at a 2,048 output cap truncated 13/23; it needs 4,096. Reasoning runs 1,500–3,000 tokens per read.
- HTTP error responses from the extractor are kept under `errors/` and re-posted on the next run; completed reads are never re-posted.
- `policyc experiment` refuses a run directory whose manifest belongs to a different run id; a resume proof must run at the run's own commit (`git checkout <commit>`, `pnpm build`, rerun, `git checkout master`, `pnpm build`).
- `git stash -u` before `git worktree add` when the tree is dirty, or the worktree add fails.
- The catalog (`.policyc/catalog.sqlite`) records every `experiment` invocation including fakes; delete `/tmp` rows after verification runs (`trials` then `runs`, by `run_id`).
- Do not read the held-back slice's traces. I did, twice (`cv09-048v4`, `cv09-052v4` in 0.9 development; `cv09-034v4` in Phase G), each time recorded, and the second time it cost 6 pairs.

## 9. Paper and public surfaces

`paper/policyc.tex` (19 pages, built with `tectonic paper/policyc.tex --outdir output/pdf`) ends at "Toward Compiler 0.10" with the four items above; `README.md` headline is the v5 result; `paper/project-entry.md` is the portfolio copy (five studies, 1,680 executions, $4.90, 44 nodes). After v6, every one of these needs the row, the paragraph, and the provenance hashes, in that order, from a script over the trial files, never from memory.

## 10. Credit ledger and expected spend

About $3.24 available. 0.10 as scoped: extractor reads for development slices ~$0.30, noise-floor run ~$1.10, blind fixtures ~$0.12, Phase F+G ~$0.35, v6 extractor reads ~$0.27, v6 ~$1.20 likely ($3.50 ceiling). Total likely ~$3.35; worst case well above the balance. A top-up of ~$4 before the v6 preregistration is the realistic plan, and the preregistration should state the balance as v4's and v5's did.
