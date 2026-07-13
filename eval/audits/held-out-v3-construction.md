# Held-out v3 construction record

## Frozen dataset

- Path: `eval/behavioral/held-out-v3.jsonl`
- Cases: 60
- Dataset version/split: `held-out-v3` / `held-out`
- Canonical SHA-256: `8d6bf6999fcb7232e92633412f1eaf93be53a910dbfc1993f4fef7b6d49a7de3`
- Dataset freeze commit: `564781c95825f1ec3057ececcca220bacd5b3965`
- Frozen compiler: 0.7.0 at `67f3cdef310d15e9d86a732611b1d64ac46c13a0`
- Synthetic source-prompt SHA-256: `961150058da20550d6004e52bdbd9a35954028d182883b3a4fcf19ff71ec803a`

No candidate prompt was compiled, no experiment dry run was generated, and no provider call was made against held-out v3 before the dataset freeze commit. The compiler implementation was not changed during dataset construction.

## Independent authoring procedure

Three context-isolated authors were each created without conversation history. Each could read only:

1. `eval/authoring/held-out-v3/authoring-brief.md`
2. `prompts/synthetic-enterprise-agent.md`

They were prohibited from reading selectors, compiler or evaluator source, structured policy nodes, prior datasets, tests, audits, run outputs, the paper, README, or Git history. Each wrote 20 cases in a disjoint ID and domain range:

- batch A, `hv3-001`–`hv3-020`: universal/current-information, writing, privacy, and destructive-action cases;
- batch B, `hv3-021`–`hv3-040`: images, PDFs, spreadsheets, slides, charts, and artifact near misses;
- batch C, `hv3-041`–`hv3-060`: email, calendar, connectors, and composed obligations.

The raw batches are preserved unchanged under `eval/authoring/held-out-v3/`. Every obligation-critical fact had to appear in the user request; artifact context could duplicate but not secretly supply it.

## Audit and repair procedure

Each author cross-audited another author's batch under the same repository-isolation boundary. The first audits found 15 issues: five high, seven medium, and three low. They covered ambiguous operations, unsupported one-call workflows, mismatched validators, under-specified time windows, stale metadata, and overly policy-like wording.

The coordinating agent applied only dataset wording, label, schema-compatibility, and harness-observability repairs. Every transformation is replayable in `eval/authoring/held-out-v3/revisions.jq`; the original authored JSONL and initial audit reports remain intact. A first verification pass found seven residual issues—two high, four medium, and one low—recorded in `verification-history.json`. After the second ledger revision, all three independent reviewers returned `pass: true` with zero findings. No selector or compiler change was made in response to these cases.

One harness limitation materially shaped the labels: synthetic function tools return no result and the runtime does not send a second model turn. For a required function-tool case, the critical observable is therefore the correct one-turn tool decision; argument fidelity and post-tool prose remain strategy-blind semantic diagnostics. Built-in web search can return a final answer and is graded normally.

## Frozen composition

- 60 unique IDs and 60 unique requests
- 90 critical-obligation references
- 52 multi-obligation cases
- 46 cases with artifact context
- 47 cases with an available tool: 42 synthetic-function cases and five built-in web-search cases
- 25 cases requiring a tool call
- 15 tagged near-miss controls
- Expected refusal: four required, 32 forbidden, 24 allowed
- Tools represented: Gmail 14, Calendar 10, image inspection five, web five, spreadsheet four, image generation three, PDF reader three, and slides three

The exact loader test pins the case count, split, unique IDs, nonempty critical labels, and canonical hash. At freeze, the full local gate passed: 20 TypeScript tests, 87 Python tests, TypeScript and Python type checks, Ruff formatting/linting, and validation of the 43-policy/32-edge graph.

## Evidence boundary

Held-out v3 is fresh evidence only for compiler 0.7 as frozen above. Inspecting any compiler-0.7 candidate prompt or model response spends the dataset for that compiler. Any subsequent compiler or dataset change creates a development iteration and cannot be rerun on held-out v3 as fresh evidence.
