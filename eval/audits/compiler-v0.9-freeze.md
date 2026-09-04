# Compiler 0.9 freeze record

## Frozen identity

- Compiler: 0.9.0 at source commit `d96477b394c24c42cf827300b438952562578121`, clean tree
- Policy graph: 44 nodes, 33 dependency edges, `policyPackHash` `26d53d4f90d29bb8da5ee0f2c33ef58978d3cf2ac2514af65ecf5cd29c060fa8`
- Compiled-artifact protocol: 1.2.0 (`protocol/compiled-policy-artifact.schema.json`, sha256 `c71e727d798e8e36c50da4d5426576c3d10aaf2d395ce9ee4fbfee38512222c8`)
- Frontend for any paid evaluation: `extractor:gpt-5-mini-2025-08-07:54d7f0ac870e`, that is `prompts/request-state-extractor.md` (sha256 `fe85f25948e651b274b293f5713991e40eeb92d232835e6c887ffc4a88e7eb53`, revision 2) plus the field contract of `src/ir/deterministicFrontend.ts` (read contract sha256 `54d7f0ac870ef004…`), run through `policyc extract` with `max_output_tokens` 4096 on `gpt-5-mini-2025-08-07`; reads are persisted, hashed, and named in the run manifest. The deterministic frontend is the in-process fallback for a request with no read and never the frontend of a study.
- Behavioral evaluator: `independent-rules` 2.6.0
- Provider adapter: OpenAI Responses adapter as of `d96477b` (last adapter-file change `b91bd88`, the `post` seam; request construction unchanged since `ea863d2`)
- Synthetic source prompt: sha256 `961150058da20550d6004e52bdbd9a35954028d182883b3a4fcf19ff71ec803a`
- Pricing registry: `pricing/openai-v2.json`, version `openai-2026-07-12`
- Model snapshot for any paid evaluation: `gpt-5-mini-2025-08-07`

No compiler, policy-pack, schema, evaluator, adapter, extractor-prompt, or field-contract change may land between this commit and the completion of the held-out-v5 experiment. Any such change makes v5 a development iteration for the changed code.

## What changed from compiler 0.8

Compiler 0.8 was a filter with one regex predicate bolted on. Compiler 0.9 is a compiler:

- **Request state** (`src/ir/requestState.ts`): one typed object per request (authorization, limit, deliverable, purpose and whether a permitted task stands beside it, format, stated fields, operation named and negated, tools), built once by a frontend and recorded in every artifact.
- **Frontends**: the deterministic reader (regexes, 12/23 on the blind paraphrase fixtures) and the extractor (one strict structured-output call at compile time, 21/23; `eval/audits/compiler-v0.9-extractor.md`). The persisted frontend takes context facts from the case, treats an unread required field as missing, and caps a `present` read beside a stated disqualifier.
- **Conditions and branches** (`src/ir/conditions.ts`, YAML `branches`): the seven confirmation nodes declare `already_authorized`; the generic destructive node also declares `approved_without_scope`; the two writing template nodes declare `user_stated_format`. First true branch wins; unknown falls to the conservative default.
- **Obligation algebra** (`src/ir/obligations.ts`): masks (text limit, unresolved limit, ask, forbidden purpose) and which obligation types yield to them, declared once; `mandated` on the two web nodes exempts from user-origin masks. When the program asks, the first active rule names the acting tools that must wait.
- **Selection** changes, all in data: "ship to prod"/"save over"/"clear out" as destructive intents; "as of today" as current information; an `artifactOperations` trigger so an image edit selects the generation tool; `asynchronous_work_request` as a content-gated node with the source prompt's paragraph; ask-side checklists on the confirmation nodes. `pnpm eval` selector metrics: 157 cases, precision 90.2%, recall 99.8%, critical recall 100% (the two background-request labels now expect the new node).
- **Emitter** prints the resolved program and decides nothing; the unavailable-tool lowering moved into evaluation.

## Evidence so far

- Offline: 46 TypeScript tests, 106 pytest; corpus IR contract (every node resolves to its first true branch or its default, no conflicts) over 87 cases; held-back gate 7/7 under the extractor's reads.
- Extraction (`eval/audits/compiler-v0.9-extractor.md`): 133 calls, $0.4930; fixtures 21/23 (one over-limit read remains), held-back 7/7, visible 20/20 after the image-edit trigger.
- Phase F smoke `run_d86bedf057ce1ae6` (40/40, $0.1775; `compiler-v0.9-smoke.md`): input −91.86%, billed −27.53%, 11 both-pass, 2 full-only (one a real gap, fixed in `4b710c8`), 3 compiler-only.
- Phase G regression, three runs (`compiler-v0.9-regression.md`), final `run_95c8702cc05f17eb` (42/42, $0.0852): 18 both-pass, 1 full-only, 2 compiler-only, 0 both-fail.

All of it is development evidence on spent cases.

## Intended claim and gates for held-out-v5

Claim under test: for frozen compiler 0.9 with the extractor frontend, a request-specific compiler slice preserves the critical obligations satisfied by the full synthetic policy prompt while materially reducing model input and billed cost, on independently authored cases neither the compiler nor the extractor prompt has seen.

Gates (unchanged from v3 and v4, to be fixed in the v5 preregistration before any dry run):

- conditional critical-preservation point estimate at least 95%;
- Wilson 95% lower bound at least 90%;
- at most three cases with any full-pass/compiler-fail result;
- mean actual input-token reduction at least 90%;
- mean actual billed-cost reduction at least 15%;
- at least 90% of planned pairs complete.

Every v3 and v4 failure class now has a representation in the compiler (confirmation state, tool limits, ask-side text, format precedence, asynchronous work, image edits, current-information markers). The gates therefore test the whole compiler on fresh phrasing; which class fails, if any, is read from the per-class root-cause breakdown after unblinding. The extractor's reads of v5 are made once, after the dataset freezes and before the preregistration, and the preregistration names their hash.

## Authoring independence

The agents constructing held-out-v5 may read only the authoring brief and the synthetic source prompt. They must not read this record, the compiler, the extractor prompt, policy packs, tests, prior datasets, run outputs, audits, the paper, or Git history. The brief is the v4 brief with version strings swapped plus sections written in the synthetic prompt's own words; it does not describe the state, the branches, the field contract, or the tool naming convention.
