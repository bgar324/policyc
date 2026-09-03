# PolicyC recall brief, 2026-09-03

Reconstructed after seven weeks dormant. Every claim below was checked against
the working tree, the run catalog, GitHub Actions, or the Codex transcripts on
2026-09-03. Read this next to `COMPILER-1.0-HANDOFF.md` in this folder: that
file is the research posture and the compiler 0.8 plan; this file is the live
state and the restart order.

Repo: `/Users/bg/windsurf/toy projects/policyc`, `bgar324/policyc`, branch
`master`, HEAD `cebff5a` "Report compiler 0.7 held-out results" (2026-07-12
23:55 PDT). Local and `origin/master` are identical. No GitHub issues or PRs.

## Capsule

- PolicyC is a TypeScript compiler (43-node YAML policy graph, request-
  conditioned slice) plus a Python asyncio paired-trial runtime. Three frozen
  held-out studies, 960 GPT-5 mini executions, $2.657036 recorded. Compression
  works (89.69-98.23% less input). Preservation does not (79.75-86.49% against
  the preregistered 95% gate).
- The last real work was one Codex session (`019f53eb-68d5-76e1-860d-8484a2f89cc9`,
  07/11 18:22 to 07/13 01:12). It ended with compiler 0.7 failing held-out-v3
  on four of six gates, commit `cebff5a` pushed, then the owner's words:
  "gonna halt on production for a little bit. lets work on resume, portfolio,
  and research paper stuff."
- The paper was written in that final turn and never committed. It is a
  finished 12-page draft, not a half-edit.
- The tree is healthy today: `pnpm typecheck`, 20 TS tests, 89 pytest, mypy,
  ruff, and graph validation (43 policies, 32 edges) all pass. `.venv`
  (Python 3.14), `node_modules`, `dist`, and `tectonic` are present.
- GitHub CI has been red on every push since 07/12. The cause is a stale
  workflow step, not code. Details under "CI".

## Threads

- `[merged cebff5a]` Held-out-v3 / compiler 0.7. 60 cases, 360 executions,
  $0.93327915. 130 both-pass, 33 full-only, 11 compiler-only, 6 both-fail.
  130/163 = 79.75% (Wilson 72.93-85.21%). Verdict verbatim: "Compiler 0.7
  therefore fails the frozen held-out-v3 test" (`eval/audits/held-out-v3-execution.md:173-176`).
  v3 is burned as fresh evidence (`eval/audits/held-out-v3-construction.md:54`).
- `[verified, uncommitted]` Paper. `paper/policyc.tex` (+448/-157 against
  HEAD), `paper/project-entry.md`, untracked `output/pdf/policyc.pdf`. HEAD
  holds a stale compiler-0.5, one-study paper. The working copy covers
  0.5 through 0.7, all three studies, a "Toward Compiler 0.8" section
  (lines 393-410), and a provenance table. No TODOs, no dangling references,
  headline numbers match README and the audits. Plain `11pt article`, no venue,
  no page limit. Committable as a checkpoint; venue selection is a separate
  decision.
- `[planned, not started]` Compiler 0.8. `src/compiler/artifact.ts` still says
  0.7.0. `eval/behavioral/compiler-v0.7-regressions.jsonl` has four rows
  (cv07-001, 032, 036, 037). None of the 33 v3 full-only pairs has been
  promoted to a development regression. The design brief is
  `paper/policyc.tex:393-408` and handoff section 8.
- `[planned, not started]` Held-out-v4. Required after 0.8 freezes. Must be
  independently authored the way v3 was (three isolated author/cross-audit
  agents, transcripts `019f5a11-3f74`, `019f5a11-58c8`, `019f5a11-7091`).
  Ceiling precedent: $2.25, $3.00, $3.50.
- `[planned, not started]` CI repair. See below.
- `[planned, not started]` README drift. Line 274 says the OpenAI adapter "has
  not yet been verified by a live call"; 960 live executions say otherwise.
  Line 222 says "Evaluator 2.4"; `runtime/python/policyc_runtime/case_evaluator.py`
  has `EVALUATOR_VERSION = "2.6.0"`. Lines 107-128 document the dead
  `compile-candidates` flow.

## CI

Nine consecutive failures from `5c662e2` (07/12) through `cebff5a`; the last
green run was `17e097b`. In every red run `pnpm test:all` passed inside CI,
then the demo step died:

    policyc error: compile-candidates is deprecated; use policyc experiment with explicit strategies, samples, provider, model, and budgets

`src/cli.ts:73-74` has thrown on that command since `6175141` (07/11).
Stale callers: `.github/workflows/ci.yml:28-29`, `package.json:20`
(`pnpm demo`), README lines 107-128.

Proven replacement. Ran locally on 2026-09-03 with no key: exit 0, two fake
trials completed, `report.json` written. The catalog row and `/tmp` directory
it created were removed afterward.

    node dist/cli.js experiment \
      --cases eval/behavioral/smoke-v1.jsonl \
      --strategies full_policy,compiler_slice \
      --provider fake --model gpt-5-mini-2025-08-07 \
      --samples 1 --concurrency 1 --max-output-tokens 1024 \
      --max-calls 2 --max-cost-usd 0.02 --retries 0 \
      --run-label ci-smoke --output /tmp/policyc-ci-smoke --yes

The TypeScript command invokes the Python runtime itself, so `ci.yml:29` goes
away with the swap.

## Problems

1. Confirmation flattening. 15 of 33 regressions (hv3-007, 010, 047, 051,
   053, 058). `policies/core.yaml:157-174` `external_state_change_confirmation`
   carries an unconditional `runtimeInstruction` (line 172: "then ask for
   explicit confirmation; do not provide immediate execution steps first").
   The source prompt is conditional ("Require explicit user intent and
   confirmation when appropriate", `prompts/synthetic-enterprise-agent.md:331`;
   "If ambiguity remains, ask a focused clarifying question", line 377).
   `src/compiler/emitter.ts:16-24` concatenates every selected policy's
   instruction into "Active rules" with no state. `ArtifactContext`
   (`src/policy/types.ts:121-129`) has no field for authorization already
   present. Open since 0.6.
2. Tool routing. Explicit negation ignored (hv3-023 image generation x3,
   hv3-029 spreadsheet x1); required edit missed (hv3-022 x2). The 0.7
   `image`/`image_generate` alias fix did not touch negation
   (`eval/audits/compiler-v0.7-development.md:57-60`).
3. Other emitter losses. User rewrite-only format lost to a generic Draft/Notes
   wrapper (hv3-018 x3), present-tense background-work fiction (hv3-014 x3),
   "now" falsely activating the freshness/web policy (hv3-006).
4. Context asymmetry. Compact-only domain hints reach the grader; "work
   calendar" context differs between conditions (hv3-009 x2). Pipeline
   contract, not compiler (`eval/audits/held-out-v3-execution.md:115-122`).
5. Billed cost. Tokens fell 93.75% but billed cost only 12.14% (gate 15%)
   because the compiled condition ran more paid searches and the full prompt
   gets cache discounts. The gate keeps failing unless 0.8 also stops
   over-triggering search.

Operational, closed: the strict optional-argument schema incident (36
pre-model rejections, fixed in `ea863d2`, documented in
`eval/audits/held-out-v3-provider-schema-incident.md`). Catalog:
15 runs, 1,302 trials, $3.24 recorded lifetime, $0.11 ambiguous exposure,
nothing in flight.

## Handoff reconciliation

`COMPILER-1.0-HANDOFF.md` was written by a separate ChatGPT session and left at
`/Users/bg/windsurf/policyc/docs/` (outside the git checkout). Its numbers
were checked against the audits on 2026-09-03: v1 (`held-out-v1-findings.md:25-60,174-196`),
v2 (`held-out-v2-execution.md:19,33-36,60-85`), v3 (`held-out-v3-execution.md:24-28`,
`preregistration-held-out-v3.md:26`). All match, including the 61 total
searches (v2 41 + v3 20, v1 no-tool) and the four v2 infrastructure incidents
with their commit hashes. The only edit on copy was the self-referencing path
in its section 19. It does not mention the CI breakage; this file does.

## Next move

Commit the paper. It has sat one `git add` away from loss since 07/13.

    git add paper/policyc.tex paper/project-entry.md output/pdf/policyc.pdf
    git commit -m "Write three-study paper and compiler 0.8 agenda"

Decide first whether `output/pdf` belongs in git; if not, ignore it before
committing.

## Pickup order after that

1. Fix CI in one commit: swap the command above into `ci.yml` and `pnpm demo`,
   update README 107-128, 222, and 274. Push, confirm the run is green.
2. Start 0.8 the way v1 became 0.6 and v2 became 0.7. Copy (never move) the 33
   v3 full-only pairs from `runs/compiler-v0.7-held-out-v3/blind/semantic-results.json`
   into `eval/behavioral/compiler-v0.8-regressions.jsonl`, development-only.
   Write offline tests in `test/compiler.test.ts` asserting selected nodes,
   emitted predicate, tool routing, and exact required/forbidden actions.
   They should fail on 0.7.
3. Build the semantic IR and stateful emitter against those tests.
   Confirmation state first (15/33), then tool negation (6/33), then format
   precedence. Bump `artifact.ts` to 0.8.0. Handoff section 18 has the
   vertical-slice order.
4. Paid development smoke on the 0.8 regression set. Precedent: 18-24 calls,
   $0.03-0.06, `--max-cost-usd 0.10`. Development evidence only.
5. Freeze 0.8, preregister held-out-v4, spawn three isolated authors, run
   once. That is the first fresh preservation number since v3.

## Sources

Transcripts: `019f53eb-68d5-76e1-860d-8484a2f89cc9` (parent session),
`019f5a35-f8a4-78c1-85c0-eddff5a0d1c2` (v3 root-cause audit),
`019f3a7c-d676-7e61-b455-8b271abe01ef` (initial build). Repo:
`eval/audits/held-out-v3-execution.md`, `eval/audits/compiler-v0.7-development.md`,
`eval/preregistration-held-out-v3.md`, `paper/policyc.tex`. Live:
`gh run list` (nine failures, last success `17e097b`),
`.policyc/catalog.sqlite:runs`, `pnpm typecheck`, `pnpm test`,
`pnpm graph:validate`, `.venv/bin/pytest -q runtime/python/tests`.
