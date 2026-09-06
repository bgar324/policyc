# Source-preserving slicing offline experiment

## Contract recorded before implementation

Question: for a fixed declared selection, what original conditions survive source-section emission but change under authored node emission and semantic evaluation, and what prompt compression remains? This offline work measures source fidelity, selection identity, prompt bytes, token counts, and executable integration. It does not measure assistant behavior.

The control is checkpoint `1fbe449b4b9972f63b132bac92abda42a9f7430b`. Work is uncommitted on `experiment/source-preserving-slice`. No release, freeze, provider calls, extractor calls, closed-evidence inspection, or recognizer changes are in scope.

Expected implementation footprint: one source-section mapping/projection module, small candidate/artifact/planner extensions, the artifact reader/schema extension required for provenance, one comparison command, focused boundary tests, and this report. Approximately 600-900 non-generated lines. No new RequestState fields or general evidence framework.

### Selection and arms

- A, `full_policy`: unchanged original policy bytes. This is also the strict retain-on-uncertainty control.
- B, `source_preserving_slice`: original whole source sections projected from the existing selector, with original ordering and exact bytes. The source map retains the integrity kernel, source-only operating context, definitions, exceptions, and dependencies. No branch evaluation, masking, tool lowering, generated obligation tokens, or semantic paraphrase enters its prompt.
- C, `source_matched_semantic`: evaluate the same declared node selection used by B with the existing evaluator and emitter. It is a matched-selection experiment, not the unchanged end-to-end compiler.
- D, `source_matched_authored`: emit that same selection's authored defaults without evaluation. C versus D isolates the existing evaluator bundle, including branch resolution, masking, limits, and unavailable-tool lowering, not branches alone.
- E, `compiler_slice`: unchanged end-to-end compiler control. Other existing semantic strategies also remain unchanged.

The shared selection is exactly the current selector's dependency-closed node set, computed once. Project it one way into whole source sections, then close source-section dependencies. Never let retained source context select additional authored nodes. An early bidirectional sketch would have expanded most requests through shared privacy and artifact mappings, activating unrelated unconditional YAML defaults. That sketch was removed before execution. B carries additional source rules even when its declared node set matches C and D. Section provenance lists every topically mapped node so the extra coverage is inspectable. B versus C includes source-to-YAML wording, coverage, ordering, envelope, and evaluation differences. B versus D excludes evaluation but still combines wording, coverage, ordering, and envelope differences. These are paired contrasts, not an additive loss decomposition.
 
The original integrity kernel and source-only operating context also accompany C and D verbatim. This keeps their precedence and exceptions common rather than trusting the semantic emitter's generic execution contract as an equivalent replacement. C and D append the existing emitter's output after this common context. B preserves the original source order.

The current `ArtifactContext` contains optional positive hints, not an exhaustive task-scope declaration. A missing match is not trusted structural proof of irrelevance. B's omissions are explicitly labeled **existing-selector semantic predictions**. They are useful for the fixed-selection diagnostic, not evidence of safe conservative exclusion. An unmapped section or unrecognized source boundary cannot be silently discarded. Unresolved applicability retains source context. Tool unavailability alone never excludes a source section. With no semantic exclusion predictions admitted, the existing A arm is the correct conservative result: full retention and zero reduction. This experiment does not disguise that result as a working new selector.

Mapping is topical, not a claim that a node fully encodes a section. Exact node-to-clause reconstruction is unavailable. Do not delete source qualifications to manufacture equivalent coverage. The source file's historical preamble calls YAML authoritative for v1; the current mission instead treats the original Markdown as authoritative. Preserve that preamble's bytes and report the historical inconsistency rather than silently editing either control.

### Verification and evidence boundary

Use only the prior explicit 97-case visible allowlist for prompt comparison. Preserve the checkpoint's four semantic strategies byte-for-byte across all 388 comparisons. Do not expand the allowlist to held-out or heldback filenames. Existing historical regression tests remain unchanged, including the tuned five-case test; their green results are not fresh evidence.

Prove original byte spans, conditions, dependency closure, unknown-state behavior, matched selection, source/strategy identity, and the real rebuilt CLI/planner/Python path. Run `pnpm build && pnpm test:all && pnpm eval`. A uniquely named fake-provider run must have its own evidence retained before deleting only its trial rows, then its run row, then its temporary output. Restore and verify the pre-run catalog inventory.

Research evidence was backed up before implementation. Initial catalog: 23 runs and 2,236 trials. Backup manifest is outside the repository under `policyc-source-slice-backup-j24hvu39/manifest.json` in the system temporary directory. The owner's untracked mission file remains untouched.

The failed 0.10 hidden result measured the default deterministic frontend's RequestState label agreement: 333/440 matched assertions, 75.68%; 93/180 complete cases, 51.67%; 107 mismatches; zero frontend fallbacks. It did not score selection, branches, masking, emitted prompts, answering-model behavior, or the revision-3 model-assisted extractor. It is not comparable to the previous paid v5 preservation percentage. The scorer recorded HEAD and a dirty flag, not hashes of the uncommitted implementation; later safety changes followed the score. The final checkpoint therefore has no inherited fresh score. Five fresh slices remain permanently spent and closed.

## Results

The offline deliverable works. On the 97 visible development cases, the source arm retains original conditional text with **46.59% mean prompt-token reduction**. This is not a behavioral-preservation result. Source-versus-specialized behavior remains unmeasured.

### What existed, and what changed

| Investigation question | Finding |
| --- | --- |
| Where are original bytes loaded? | `src/experiment/plan.ts::runExperimentCommand` reads `prompts/synthetic-enterprise-agent.md` as UTF-8 and passes it to `createArtifact`. `src/cli.ts` also reads it for the compile command's full-token baseline. `src/policy/loader.ts` loads YAML, not original-source spans. |
| Can nodes map to source? | There was no span metadata. `src/compiler/sourceSlice.ts` now records a topical map for all 46 nodes across 21 complete Markdown sections and the preamble. This is not exact node-to-clause equivalence. |
| Where can conditions be lost before evaluation? | Authored defaults already differ from source. Writing defaults mandate Draft/Notes although source makes notes conditional on usefulness. The no-browse default omits source exceptions. The destructive default prohibits drafting before confirmation although source prefers previews and drafts. Selection can omit a governing node before any branch runs. |
| Was there an equivalent sliced baseline? | No. Only `full_policy` emits original source bytes. All four previous sliced strategies evaluate YAML nodes and use the semantic emitter. Disabling evaluation alone would still emit authored defaults and obligation tokens. |
| Can selection be reused? | Yes. Candidate generation already computes one state and one dependency-closed selector result. The new arms reuse that result, and the semantic arm reuses its evaluated control rather than selecting or evaluating again. |

The fifth, optional `sourcePolicyText` argument to `generateCandidateSelections` enables the three experimental arms. Four-argument calls still return exactly the five original candidates. The CLI enables source projection only when an experimental strategy is requested. No YAML, selector, frontend, mask, evaluator, or semantic-emitter behavior changed.

New artifacts use compiler `0.10.0-source-slice.1` and protocol `1.4.0`. Existing artifacts remain `0.10.0` / `1.3.0`, with no new property added to their serialized identity. The Python reader and JSON schema require source provenance only for experimental artifacts. This format identifier is not a compiler release or freeze.

### Identities and durable local evidence

- Original source: 84,626 bytes, SHA-256 `961150058da20550d6004e52bdbd9a35954028d182883b3a4fcf19ff71ec803a`.
- Source-map contract: `source-sections-v1`, SHA-256 `faad4acb2d69145c6a57126b12d3632b2ce62a8437eec19eed8b4f9ddbd6ba4f`.
- [Measurements and per-case prompt hashes](../../output/source-slice-offline/measurements.json): SHA-256 `7f5142eb9292f2dc8fd97129f5f50d96b0ef8837ad3b1d98acf162e14ea59f8f`.
- That JSON records 109 per-file source/configuration/test hashes. SHA-256 of its `current.codeHashes` array, serialized with sorted keys and compact JSON separators: `ed04b8dc5b7c58ea2fa7ce838b8dc3f7a073dee949f2ad55ba7a7291b7edcea4`. All 109 files were checked against the inventory. This identifies the uncommitted code, unlike a commit-plus-dirty flag alone.
- [Fake-run evidence archive](../../output/source-slice-offline/run_78ab049dbb173a44-fake-evidence.tar.gz): SHA-256 `e7a30999735a0a1ef9f0462061aea3a067cb6d3468d91c325d1a3c54084ae788`.
- [Catalog cleanup evidence](../../output/source-slice-offline/smoke-cleanup.json): SHA-256 `fd58acfa269b7d42c6bf544ebb45472ea8b360b79f4fb217e60b96ff0b96f222`.

These are local, uncommitted deliverables. The fake archive contains only this task's run, including its manifest, artifacts, report, budget, and simulated responses. It is not the research-history backup.

### Explicit visible dataset allowlist

Every file below is under `eval/behavioral/`. The command pins each file's SHA-256, verifies the checkpoint copy has the same bytes, and refuses duplicates or a count other than 97. Full file hashes and dataset hashes are in the measurement JSON and command source.

| File | Cases |
| --- | ---: |
| `smoke-v1.jsonl` | 1 |
| `development-v1.jsonl` | 2 |
| `pilot-v1.jsonl` | 20 |
| `pilot-v2.jsonl` | 20 |
| `compiler-v0.4-regression-smoke-v1.jsonl` | 4 |
| `compiler-v0.6-regression-v1.jsonl` | 9 |
| `compiler-v0.7-regressions.jsonl` | 4 |
| `compiler-v0.8-regressions.jsonl` | 6 |
| `compiler-v0.9-regressions.jsonl` | 20 |
| `compiler-v0.10-regressions.jsonl` | 11 |
| Total | 97 |

No held-out or heldback file enters this comparison. The mandated existing full test suite still executes its historical regression fixtures, including the tuned five-case set. It does not access the five fresh closed 0.10 slices or their one-shot scorer. No new generality evidence was authored or consumed.

### Prompt measurements

Exact `o200k_base` counts of the artifact's system prompt, excluding the provider's separate request, tool definitions, and message framing:

| Arm | Mean tokens | Range | Mean reduction against A |
| --- | ---: | ---: | ---: |
| A, full original | 16,191.00 | 16,191 | 0% |
| B, source-preserving slice | 8,647.58 | 6,572–12,270 | 46.59% |
| C, matched semantic plus common source context | 6,898.63 | 6,730–7,224 | 57.39% |
| D, matched authored defaults plus common source context | 6,894.05 | 6,730–7,190 | 57.42% |
| E, unchanged `compiler_slice` | 326.63 | 158–652 | 97.98% |

C and D differ in 50/97 prompt hashes. Evaluation adds 4.58 tokens on average in this contrast. Neither the changed hashes nor that mean indicates whether evaluation helps or harms behavior.

B produces 17 distinct source slices. It retains 10–17 of the 22 source units, mean 12.58. Across cases, 1,220 section instances are retained and 914 omitted. Ten common-context units are always retained. The 97-case allowlist never triggers full retention, but the unresolved-applicability boundary test does, reproducing A exactly.

Topical retention counts, each out of 97: web 32, citations 32, writing 11, image generation 3, image interpretation 14, numeric extraction 27, PDF 5, spreadsheets 8, slides 3, email 38, calendar 28, destructive actions 49. The JSON records every inclusion reason and prediction-labeled omission, source byte offsets, span hashes, seed IDs, and topically mapped extra coverage. The common context alone costs 6,572 tokens. Whole-section granularity and repeated original context impose a substantial compression floor; no qualifications or repeated source prose were deleted to improve it.

The structural evaluator's 292-token average covers a different 157-case dataset. It is not the 97-case comparison average and did not change.

### Verification and requirement ledger

| Requirement | Evidence |
| --- | --- |
| Original wording, conditions, exceptions, source order | 97/97 B prompts independently reconstructed from original UTF-8 bytes. Every recorded span also matches an independently split complete original section. |
| Definitions, dependencies, precedence | Original common context retained in all experimental arms; declared node IDs and dependency edges match in 97/97 cases; selected nodes have mapped source sections. Source section dependencies are recorded separately from node selection. |
| Unknown does not manufacture an action or question | Focused test makes the applicability read unresolved and tools unavailable. B equals the full original source. Another test changes authorization/disclosure readings: B stays byte-identical while C changes. |
| Shared selection | 97/97 B/C/D artifacts match E's selected node IDs and dependency edges. Source/context retention never adds semantic nodes. |
| Baseline isolation | 388/388 legacy compiled prompt hashes and candidate IDs match checkpoint `1fbe449`; 97/97 full-policy identities also match. Opting into extra arms does not perturb legacy artifacts. |
| Source and strategy identity | Source/map/span hashes recorded inside experimental candidate identity; changed source and unmapped-node inputs rejected; Python load rejects provenance tampering and incompatible protocol/strategy pairs. |
| Real CLI/planner/runtime execution | Rebuilt `dist/cli.js` fake-provider run completed 5/5 trials across A/B/C/D/E, with zero failed or ambiguous trials. |
| Required suite | `pnpm build && pnpm test:all && pnpm eval` passed: 82 TypeScript tests, 111 Python tests, graph 46 policies / 35 edges, Ruff/mypy/typecheck clean. |
| Structural baseline | 157 cases; precision 88.3%, recall 99.8%, critical recall 100%, obligation checks 100%, forbidden-behavior validator rate 0%, 292 compiled tokens, 98.2% reduction. These are offline validator metrics. |

Four focused TypeScript boundary tests and four Python protocol tests were added. The existing schema-layout assertion was replaced by actual artifact acceptance/rejection checks across protocols 1.0 through 1.4, preserving historical trace/fact compatibility coverage without pinning JSON-schema structure. The comparison command uses Node's assertion API, which also narrows types, after the first integrated build caught its handwritten assertion's missing type narrowing.

### Fake smoke and catalog cleanup

Run `run_78ab049dbb173a44`, one case from `smoke-v1.jsonl`, five strategies, one sample each, concurrency two, no retries. Actual provider spend: **$0**. The fake accounting value `$0.0092545` is simulated, not an API charge.

The real runtime loaded two protocol-1.3 controls and three protocol-1.4 experimental artifacts. Their prompt and candidate hashes were independently recomputed from the saved files. C and D happen to have the same prompt in this one-case smoke, but distinct candidate IDs; the 97-case comparison exercises their differences.

Catalog counts changed `23 runs / 2,236 trials` → `24 / 2,241` → `23 / 2,236`. The run ID and resolved directory were checked before deletion. Exactly its five trial rows were deleted, then exactly its one run row, in a transaction. A fresh read confirmed zero rows for that ID and the original run-ID inventory. The temporary output was removed only after archiving the smoke. The backup of research history remains outside the repository.

### Reproducible commands

From this working tree with dependencies installed:

```sh
pnpm build && pnpm test:all && pnpm eval

CONTROL=$(mktemp -d /tmp/policyc-source-control.XXXXXX)
git worktree add --detach "$CONTROL/checkpoint" 1fbe449b4b9972f63b132bac92abda42a9f7430b
[ -e "$CONTROL/checkpoint/node_modules" ] || ln -s "$PWD/node_modules" "$CONTROL/checkpoint/node_modules"
env -u OPENAI_API_KEY pnpm compare:source \
  --baseline "$CONTROL/checkpoint" \
  --output output/source-slice-offline/measurements.json
```

The comparison command makes no provider call and does not write the catalog. It refuses a different checkpoint, changed allowlist bytes, mismatched source, identity drift, incomplete sections, or unmatched selections. It records a fresh timestamp and local paths, so the complete measurement-file hash changes on a rerun even when prompt hashes do not.

For a fake smoke, first make a SQLite-consistent catalog backup and preserve `runs/`, then record current counts and run IDs. Use a fresh directory and label:

```sh
SMOKE=$(mktemp -d /tmp/policyc-source-smoke.XXXXXX)
env -u OPENAI_API_KEY node dist/cli.js experiment \
  --cases eval/behavioral/smoke-v1.jsonl \
  --strategies full_policy,compiler_slice,source_preserving_slice,source_matched_authored,source_matched_semantic \
  --provider fake --model gpt-5-mini-2025-08-07 \
  --samples 1 --concurrency 2 --max-output-tokens 1024 \
  --max-calls 7 --max-cost-usd 0.10 --retries 0 \
  --run-label "$(basename "$SMOKE")" --output "$SMOKE" --yes
```

After inspecting and archiving that directory, read its `manifest.v2.json` run ID. In one transaction, delete `trials WHERE run_id = ?`, then `runs WHERE run_id = ? AND run_directory = ?`, bound to that verified ID and resolved directory only. Confirm the pre-run counts and inventory before removing its output. Do not use a path-prefix or bulk `/tmp` deletion. Remove only the newly created control worktree when finished.

### What remains unmeasured

This establishes an executable source-preserving emission baseline, a controlled evaluator contrast, and a measured compression cost. It does not establish that B preserves required behavior, that E causes semantic damage, or that C's changes are harmful.

Remaining confounds and limits:

- The selector remains a semantic predictor. No current context field proves exhaustive task scope. Strict refusal to admit predicted exclusions yields A and zero reduction.
- The map is topical. Distributed artifact-inspection meaning stays with the selected artifact section and common operating context, rather than activating every artifact domain. Generic bypass refusal, connector names, and several confirmation programs have only partial or no literal source counterparts. New source bytes or new nodes require map review; the experiment fails closed rather than guessing a reconstruction.
- B has whole-section/source-only coverage that C and D's nodes do not encode. This is recorded, not removed to make the arms look matched.
- C versus D isolates evaluation only under the shared source-context envelope. It does not isolate each branch or mask separately. E remains the separate unchanged end-to-end control.
- A and B do not embed the request or artifact metadata in their system prompt. The semantic emitter does. The provider sends the request separately to every arm and sends the same tool definitions, but does not separately send `artifactContext`. This duplication/context-interface asymmetry must be controlled in a behavioral study.
- The current runtime's native paired report and blind-grading tools compare A with E, not every new pair. Its forward/reverse ordering is not a balanced multi-arm design. Fake responses cannot validate these behavioral-study requirements. No native B/C preservation rate is claimed.
- Selection quality, source segmentation adequacy, downstream interpretation, stochastic variation, end-to-end cost/latency, and the revision-3 extractor remain unmeasured here.

### Proposed behavioral study, not authorized or run

Propose a bounded developmental study, not v6 or a release gate: 24 fresh cases, three samples per arm, A/B/C/D/E plus an independent repeated-full slot A2. That is 432 answering-model calls. A versus A2 supplies 72 matched full/full pairs and measures the noise floor under the same sampling protocol; report uncertainty rather than treating 72 pairs as a precise estimate.

Before any call, an isolated author sees only original source and a source-grounded situation brief, not this diff or spent requests. An independent auditor checks expectations and action scope. Lock source/code/data identities, case-specific critical obligations, acceptable outcomes, scoring rules, exclusions, dispatch order, and ambiguity handling before execution. No closed slice is reopened. Graders see source-grounded rubrics and shuffled responses without strategy names; lock grades before unblinding.

Score source-derived correctness first. Separately report conditional full-pass/slice-fail preservation for A/B, B/C, D/C, and A/E, with per-case critical losses and uncertainty intervals. Full-policy output is not an oracle. Do not offset critical full-only losses with unrelated slice-only wins. Keep the contrasts separate rather than adding them into a decomposition. Include paired coverage, stochastic repeats, input/output/tool use, total pipeline cost, and latency.

Before this study can run, add balanced multi-arm ordering and blinded packet support, plus a common request/metadata envelope or self-contained requests that remove the context-interface asymmetry. Those changes, fixture authoring, and their verification are future work, not hidden additions to this offline task.

Tentative provider ceiling using the repository's `pricing/openai-v2.json`, no caching discount or retries, input bounded to 22,000 tokens per call including request/tools/framing, output cap 3,072:

| Pipeline component | Ceiling |
| --- | ---: |
| 432 × 22,000 input tokens at $0.25/million | $2.376000 |
| 432 × 3,072 output tokens at $2/million | $2.654208 |
| At most one native web call per response at $0.01 | $4.320000 |
| Extractor and model-grader calls | $0, neither proposed |
| Total provider ceiling | $9.350208 |

Reserve **$10 only after explicit owner approval of the plan and spend**. Use manual blind grading, not an unpriced model grader. Recheck live rates and reject any case exceeding the stated input/tool bound before requesting approval. Price the whole inference pipeline, not only the reduced system prompts. No paid dry run, provider call, extractor call, evidence authoring, release freeze, commit, or push is authorized by this proposal.

### Independent review corrections

The code review found no mission blocker, patch regression, or mandatory-safety issue. The evidence review required three corrections: restrict the comparator's Git-status dataset pathspecs to the explicit allowlist, distinguish B/D's four non-evaluation confounds correctly, and retain the historical gate's 107 mismatches and zero fallbacks. All three were corrected.

After the metadata-guard change, the complete build/test/eval/comparison command passed again. A disposable, non-allowlisted text sentinel remained in the isolated control checkout during this run; it did not enter the status guard, corpus, or output. All 97 cases' arm hashes, candidate IDs, and token measurements match the pre-correction run. The code inventory and report hashes above identify the corrected command. No closed requests, labels, projections, or traces were opened.

Targeted evidence re-review approved all three corrections and the refreshed identities, with no remaining blocker. The owned control worktrees and disposable probes were removed. The archived fake run and research-history backup remain available; all repository changes are uncommitted.

Follow-up advisories corrected the schema description to label omissions, not uncertainty retention, as predictions; made dependency setup safe when an APFS worktree already has `node_modules`; and restored historical protocol coverage with behavioral validation rather than schema-layout assertions. The dependency guard passed twice, all protocol 1.0–1.4 acceptance/rejection checks passed, and the full build/test/eval/comparison command passed again. The refreshed inventory above matches the final code. Every case's prompt hashes, candidate IDs, and token measurements remain unchanged.

### Follow-on: worked examples

The allowlist moved into `src/tools/visibleAllowlist.ts`, shared by the comparator and a new stage tracer (`pnpm trace:source`). The comparator was rerun after that refactor against a fresh checkpoint control: identities unchanged (388/388, 97/97, 97/97 matched, 97/97 byte-exact), every per-case arm hash and token count identical to the previous run. The tracer's output and the five-case analysis are in [the source-first worked examples](source-first-worked-examples.md).
