# Compiler 0.10 checkpoint handoff

Date: 2026-09-04. This is a development checkpoint, not a release or compiler freeze.

## 1. Mission

The owner asked to preserve the discussion in one Markdown document, then requested a handoff. During handoff preparation, they supplied a follow-up arguing for an experiment before another architecture and said, "include this." They also explicitly instructed: "also if there is any WIP please commit those."

The requested deliverable is therefore a committed WIP snapshot containing the existing implementation and updated discussion records. It does not authorize building the proposed slicer, running an experiment, spending provider credit, or pushing the commit.

Read the [midway synthesis](0.10-midway-learnings-and-decisions.md), especially sections 4, 12, 13, and 17, before proposing further work. The owner intends to read and decide. Do not interpret this handoff as instructions to resume the old compiler roadmap automatically.

## 2. State

- Checkout: `/Users/bg/windsurf/toy projects/policyc`. The similarly named `/Users/bg/windsurf/policyc` is not the active checkout.
- Branch: `master`. Before this checkpoint, HEAD was `55862c5e4d84b2722e67034995e921dfd064ce05`, `test: freeze compiler 0.10 regression baseline`.
- The owner-authorized WIP checkpoint is the commit containing this handoff. Use Git to identify that commit rather than treating the baseline as the implementation snapshot.
- Before handoff edits, the tree had 36 modified implementation/test/protocol files and three untracked files: the development audit, `src/extractor/contract.ts`, and the midway synthesis. This handoff is the fourth new file. All are included in the WIP checkpoint.
- Compiler artifacts identify themselves as `0.10.0` and protocol `1.3.0`. Those constants do not imply a successful freeze.
- No managed daemons were running when this handoff was prepared. No service or port is needed to resume. This is not an inventory of unrelated system processes.
- No credentials were changed for the documentation or checkpoint. No paid PolicyC experiment or extractor call occurred during the 0.10 iteration.
- `runs/`, `.policyc/catalog.sqlite`, and `.env` are Git-ignored and excluded from the checkpoint. The catalog was checked read-only at 23 runs and 2,236 trials.
- The owner requested the display name Polaris only in `0.10-midway-learnings-and-decisions.md`. Repository paths, code, package names, and this handoff were not globally renamed.

## 3. Done so far

The existing implementation extends `RequestState` with current-information, deferred-work, slide-task, disclosure, and requested-reorder facts. It shares one frontend read across selection and evaluation, adds artifact field contracts and exact connector scopes, tightens effect-aware masking, and introduces extractor contract identity and protocol 1.3 compatibility.

The [development audit](../eval/audits/compiler-v0.10-development.md) contains the detailed implementation and verification record. The last full verification of this code passed:

```text
pnpm build && pnpm test:all && pnpm eval
```

Recorded results: 78 TypeScript tests, 107 Python tests, graph validation for 46 policies and 35 edges, and clean Ruff/mypy/TypeScript checks. Structural evaluation covered 157 cases with 88.3% precision, 99.8% recall, 100% critical recall, 100% obligation pass rates, 0% forbidden behavior, a 292-token compiled average, and 98.2% token reduction. These are offline contract metrics, not end-to-end preservation claims.

Visible-only prompt comparison covered 97 allowlisted cases across four compiled strategies: 388 prompts, 210 identical, 178 classified changes, zero unclassified. The inventory SHA-256 is `c07e63d199f065c9be581963ce866bfbfdc300693448256a5e7745b860047dd0`.

The final recorded fake-provider smoke, `run_036519770d68fddc`, passed 2/2 and validated the artifact contract. Its files and catalog rows were removed. It was not a real-model behavioral experiment.

The synthesis now includes the owner's latest experiment-first follow-up. The audit was corrected to distinguish the failed frontend gate from end-to-end compiler behavior and to permit the explicitly authorized WIP checkpoint without implying release eligibility.

## 4. Open threads and next actions

### First: isolate mechanisms rather than build another architecture

The latest proposal separates six hypotheses: poor deterministic reading, inadequate state representation, selection errors despite good semantics, harmful specialization/masking, lossy source segmentation/runtime wording, and downstream model differences despite faithful residual policy.

The proposed first baseline is a **source-preserving conservative slicer**. It would retain integrity rules and original conditional source sections, remove a section only with a stated justification of irrelevance, and perform no nuanced semantic specialization. Unknown must preserve the conditional rule, not become an unconditional ask or execution instruction.

On an authorized resumption, first check visible code and experiment definitions for an existing same-selection source-preserving baseline. The conversation did not establish whether such a clean comparison already exists. Then present a bounded comparison plan before implementation.

The proposed arms are full policy, source-preserving slice, and specialized slice. To isolate transformation loss, the sliced arms must use the same selected sections and account consistently for dependencies, source boundaries, and precedence. If the conservative slicer and current compiler select differently, their contrast is confounded. Treat end-to-end selector comparisons and matched-selection specialization comparisons as distinct questions.

The suggested 95% preservation/85% reduction and 80% preservation outcomes are hypothetical. A strong source slice does not prove universal selector correctness. A weak source slice shows that removing specialization is insufficient, not that specialization cannot still cause substantial additional loss. Preserve the planned noise-floor discipline before interpreting small differences.

### Later, if still useful: test the semantic reader separately

Revision 3's model-assisted extractor has not been evaluated on a fresh paid reading gate in this iteration. If state remains relevant after the source-preserving comparison, a separate fresh, independently authored reading study could test that reader against the same declared semantic contract.

No such run is authorized. High label agreement would not guarantee correctness on every critical action-bound fact. Low agreement could implicate the reader, prompt, labels, or representation. Do not decide among those explanations from one aggregate percentage.

Policy-local claims, shared action-scoped evidence, and global precedence are possible later tools. Do not build them before the simpler baseline has demonstrated a need.

## 5. Decisions and constraints

- The owner's WIP-commit instruction supersedes the earlier instruction to leave the implementation uncommitted. It authorizes preservation in Git, not a release, freeze, push, or paid run.
- The fresh gate reported 333/440 matched assertions and 93/180 fully matched cases, with 107 mismatches and zero frontend fallbacks. **It measured the default deterministic frontend's agreement with RequestState labels.** It did not score selection, branch evaluation, masks, emitted prompts, or downstream assistant behavior.
- The 75.68% frontend figure is not directly comparable to the previous paid v5 preservation rate of 75.91%.
- The scorer imported the then-live dirty tree. It recorded HEAD and a dirty flag, not hashes of uncommitted source. Safety edits followed the score. This WIP checkpoint preserves the final code but cannot retroactively identify the earlier scored bytes or inherit a fresh score.
- The five-case file named `compiler-v0.10-regressions-heldback.jsonl` was exposed and informed a recognizer. It is tuned regression evidence only. Its test now says "tuned five-case". Do not relabel it as independent evidence.
- The separate five fresh slices are permanently spent and closed. Never inspect their requests, labels, traces, or per-case results to diagnose or tune; never rerun their one-shot scorer.
- Do not freeze or promote 0.10, proceed to Phase F/G, or author/run v6 from this checkpoint. Any new study needs an appropriate fresh protocol. Paid work also requires a keyless costed plan and explicit owner authorization.
- Do not describe relevance pruning as a newly discovered thesis. It was the original goal. Whether source-preserving slicing works better remains unproven.
- An LLM entailment judgment or quotation is not automatically a proof. Unknown retaining source text is a design goal, not a guarantee that larger prompts always behave better.

## 6. Landmines and resume references

Old handoffs and the task ledger may still say that a source-derived redesign must come before any measurement. The latest discussion instead prioritizes isolating the mechanisms with a simpler source-preserving baseline. Neither record grants permission to implement or pay without the owner's next instruction.

Before any experiment command, preserve the local evidence and catalog. Even fake-provider and dry-run experiment commands can write catalog rows. Remove only verification rows belonging to your own run ID, trials first and runs second. Never bulk-delete the real history. Do not stage credentials, the catalog, or run data with a broad `git add -A`.

Do not use a broad search over `eval/behavioral/`. Use explicit visible-file allowlists. The known fresh score does not justify another regex fitted to spent wording.

Source-preserving means original conditional semantics, not merely disabling branches while emitting already-lossy default instructions. An unavailable connector does not make its policy irrelevant; the policy may still require an unavailable-tool explanation. High-risk source conditions, exceptions, action scope, and cross-policy precedence must remain intact.

The main source anchors are `src/ir/requestState.ts`, `src/ir/deterministicFrontend.ts`, `src/ir/persistedFrontend.ts`, `src/policy/selector.ts`, `src/compiler/evaluate.ts`, `src/ir/obligations.ts`, and the policy YAML files. The midpoint synthesis explains their roles and preserves the architectural arguments.

The scorer source was `/tmp/policyc-cv010-score/aggregate-scorer/score.mts`, SHA-256 `6989b7f58fb4effba92676aca7824b231acca4dcfab7ff55844517ab75bc0763`. Its default-frontend call and state-label comparison were inspected without opening hidden data or rerunning the scorer. Temporary paths and `local://` links are supplemental provenance, not prerequisites to understand this handoff. The synthesis includes the relevant facts and source-identity caveat inline.

Useful skills on an authorized resumption: `policyc-compiler-iteration`, `policyc-verify-and-smoke`, the emission-equivalence skills, and `typescript-best-practices`. For new paid studies also read `policyc-extractor-reads`, `policyc-paid-experiment`, and `policyc-held-out-authoring`. Current owner instructions and the latest evidence clarification override stale instructions in older skills and handoffs.
