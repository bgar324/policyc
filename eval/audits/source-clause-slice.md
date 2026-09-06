# Source clause slice: implementation and offline measurement

Date: 2026-09-04. Implements the [source-first decision record](../../.handoffs/2026-09-04-source-first-decisions.md) as a fourth experimental strategy, `source_clause_slice`. Uncommitted on `experiment/source-preserving-slice`. No provider call was made; the fake-provider run below cost $0.

## The result, first

On the 97 visible cases the clause arm emits **one prompt**: 3,259 tokens, identical for every case, 79.87% below the 16,191-token full policy. Nothing was pruned in any case. The entire reduction is the audited deduplication of repeated boilerplate.

That is what the decision record asks for. No case in the visible corpus declares its context exhaustive, so no structural fact establishes irrelevance, so every clause is retained. The compiler made no decision about any request. Readers who expected a per-request slice should read this as the finding: **with the rules as decided, and the corpus as it exists, source-first compilation is dedupe.** Whether that is enough is a behavioral question this document does not answer.

## What was built

### Context schema: `exhaustive`

`ArtifactContext` gains `exhaustive?: { artifacts?: true; tools?: true }`. `artifacts: true` declares that the request touches no artifact beyond `artifactType` and `features` (none at all when `artifactType` is absent). `tools: true` declares `toolsAvailable` complete. The case loader parses the field strictly and rejects unknown keys or non-`true` values. No existing case sets it; all 97 load unchanged.

### Clause map: `src/compiler/sourceClauses.ts`

Sixty-one clauses, one per prose paragraph of the pinned source (SHA-256 `961150058da2…`), addressed by line number and hash-checked at projection. The projector refuses a source whose prose lines do not match the map exactly, in either direction: an unmapped prose line or a mapped non-prose line is an error, so the map cannot silently drift from the file. Line 3, the file's description of itself ("not the source of truth for v1; YAML policy packs are"), is declared non-policy metadata and never emitted.

Each clause carries:

- `scope`, optional: the one structural condition that can remove it. Either `artifacts: [...]` (irrelevant when artifacts are declared exhaustive and the declared type is outside the list) or `tools: [...]` (irrelevant when tools are declared exhaustive and none is available). Thirty-two clauses have a scope; twenty-nine have none and are retained unconditionally. Every scoped clause carries an `audit` note saying why the scope is a structural fact; the projector rejects a scope without one.
- `dependsOn`: clauses whose removal could change when, whether, or how this one applies. Retained transitively with it.
- `nodes`: authored YAML nodes whose selection is a positive signal. A signal retains; absence of one never prunes.

No `tools` scope is used anywhere in this map. Every tool-related clause (line 101 on verifying before answering, line 421 on failed tools, line 168 on not claiming an image was created) governs what to do when the tool is absent, so the decision record's rule forbids pruning them on absence. The scope kind exists in the type so a future clause can use it with an audit note; nothing today qualifies.

### Boilerplate dedupe

Twenty sections end with the same nine bullet lines, differing only in the section name embedded in each. The projector groups bullets by their text with the label stripped, keeps the first occurrence of each distinct text as the canonical copy, and records every subsumed copy with its own section, line, span, and hash. Nine canonical lines subsume 171 copies. A bullet whose text differs from its group in any way other than the label would form its own group; none does in this source.

Per the owner's rule, a subsumed copy is one whose normalized text is byte-identical and whose label changes no scope, precedence, applicability, or effect. In this source every boilerplate line instructs the reader to apply "this section" conservatively; the label names the section but the instruction is the same for all twenty. That is the equivalence claim. It is recorded as provenance so a reviewer can disagree with it per line.

### Emission

`emitSourceClauses` prints, in source order: the `##` heading of every section with a retained clause, each retained clause line, and each retained canonical boilerplate line. The two fixed sub-headings ("Detailed operational rules:", "Examples and edge cases:") print only when a kept boilerplate line follows them in that section. Blank lines collapse to one. Every emitted line is a byte-exact source line; no text is generated, and no obligation or prohibition token appears.

### Protocol

Artifacts declare protocol `1.4.0` and compiler `0.10.0-source-slice.1` with a `sourceClauseSelection` block instead of the section arms' `sourceSelection`. The Python reader enforces: unique clause ids, source order without overlap, dependency ids resolve, every pruned clause cites a trusted structural fact, at least one clause retained, and the 1.4 gate now distinguishes section arms (must carry `sourceSelection`, must not carry `sourceClauseSelection`) from the clause arm (the reverse). Legacy 1.0–1.3 artifacts are unaffected. The JSON schema mirrors these constraints where JSON Schema can express them.

## What was verified

| Check | Result |
| --- | --- |
| Full gate `pnpm build && pnpm test:all && pnpm eval` | 88 TypeScript tests, 111 Python tests, graph 46/35, structural metrics unchanged (157 cases, 88.3/99.8/100, 292 tokens) |
| Legacy identity (comparator, fresh `1fbe449` control) | 388/388 compiled prompt hashes and candidate ids unchanged; 97/97 full-policy unchanged; the three section arms' per-case hashes and tokens unchanged from the prior run |
| Clause reconstruction | 97/97: every kept span is exactly one original line hashing to its recorded digest; the prompt's non-heading lines equal the kept clause and boilerplate lines in source order |
| Pruning discipline | 97/97: no case declares exhaustive context and no case prunes; a pruned clause (in tests) always cites a structural fact and always has a declared scope; no retained clause loses a dependency |
| Semantic state cannot move the slice | Test: authorization `absent`/disclosure `unknown`/limit `limited` versus `present`/`safe`/`none` produce byte-identical clause prompts; the exhaustive declaration, by contrast, does change the prompt (positive control) |
| Tool absence never prunes reporting clauses | Test: with `tools` exhaustive and empty, `web.verify-first`, `citations.when-required`, `tools.use-and-failure`, and `core.no-false-success` are retained |
| Changed source refused | Test: a one-character change to line 333 makes the projector throw |
| Cross-language round-trip | A TypeScript-emitted clause artifact with exhaustive email context (51 retained, 10 pruned) loads through `load_artifact` and validates against the JSON schema |
| Real CLI/planner/runtime | `run_436c82435beb9558`, fake provider, `full_policy,compiler_slice,source_clause_slice`, 3/3 completed. Archived at `output/source-slice-offline/run_436c82435beb9558-fake-evidence.tar.gz` (SHA-256 `5c7f928cd06d…`); its 3 trial rows and 1 run row deleted; catalog back at 23 runs / 2,236 trials |

Identities: measurements JSON SHA-256 `704924dbaf224ea7d561570ee3bb79a726ef8608f84abbce1acc82900f85ded8`; code inventory (111 files, sorted-key compact JSON of `current.codeHashes`) SHA-256 `50f01d913336252b33f13794a4d0e2eae33a209a22f1a44a2a83b752d1e89590`; clause map SHA-256 `bb1e1039f9a9b9acc1c5d1f098df9bfac30da8d8fe6e6e5f1a0134d8bf78cce5`.

## What pruning looks like when a case does declare

The visible corpus never triggers it, so here are the three test contexts, same request ("Forward the report to Dana."):

| Context | Retained | Pruned | Tokens |
| --- | ---: | ---: | ---: |
| email/forward, gmail, no declaration | 61 | 0 | 3,259 |
| email/forward, gmail, `exhaustive: {artifacts, tools}` | 51 | 10 | 2,921 |
| no artifact, no tools, `exhaustive: {artifacts, tools}` | 48 | 13 | 2,804 |

With exhaustive email context the map prunes the three image-generation clauses, the sensitive-attributes-from-appearance clause, the visual-estimate clause, the PDF coverage clause, the three slide clauses, and the calendar-destructive clause. It keeps `image-read.inspect-and-identify` and `numbers.caution` because the unscoped example paragraph at line 448 ("What does this image show?" with person and chart) depends on them, and `calendar.mutations` because `destructive_email_calendar_confirm` is a selected node that names it as a signal. With no artifact at all, `email.state-changes` still survives because line 149 ("A writing task that mentions email is not automatically a Gmail action") depends on it.

Those retentions are the dependency rule doing what it was told to. The example paragraphs are unscoped, mention many domains, and pull those domains' clauses in. Even a fully declared context prunes at most 13 of 61 clauses, about 450 tokens. **Structural pruning under this map is worth roughly 10 to 14% on top of dedupe.** The map could be tightened, for instance by scoping the example clauses, but every tightening is a judgment that the decision record says to resolve toward retention.

## What this means for the comparison

On the visible corpus the arms now look like this:

| Arm | Mean tokens | What varies per case |
| --- | ---: | --- |
| Full policy | 16,191 | nothing |
| Clause slice | 3,259 | nothing |
| Section slice | 8,648 | which sections the selector's prediction retained |
| Current compiler | 327 | everything: selection, branches, masks, lowering |

The clause slice on this corpus is a fixed prompt. A behavioral study of full versus clause would measure whether 2,449 tokens of prose plus one copy of the boilerplate elicits the same behavior as 16,191 tokens. That is a real and cheap question, and its answer is not obvious: the repeated boilerplate might matter to the answering model, or the prose alone might do as well or better. But it is not a study of selection, because no selection happened.

To measure selection under these rules, cases must declare exhaustive context. The synthetic corpus was authored before the field existed. Adding the declaration to existing cases would be a labeling decision by someone reading each request; on the visible allowlist that is development work, not fresh evidence.

## Limitations

- The 79.87% figure is a property of this synthetic source, whose boilerplate is 83% of its tokens. A real policy that does not repeat itself would see close to zero from dedupe, and its reduction would depend entirely on how many clauses carry a scope and how many cases declare exhaustive context.
- The clause map is one author's reading, audited once. Thirty-two scope assignments and roughly ninety dependency edges are judgments. The record's fallback (retain when uncertain) was applied throughout, which is why the example paragraphs and the tool-reporting clauses are unscoped.
- The dedupe equivalence claim (label changes nothing) holds for this source's boilerplate by inspection. It is recorded per subsumed copy so it can be contested line by line.
- Nothing here measures whether an answering model given the clause slice behaves as it does with the full policy. The fake provider proves the artifact contract and the runtime path, not behavior.

## Reproduction

```sh
pnpm build && pnpm test:all && pnpm eval
pnpm exec tsx --test test/sourceClauses.test.ts
CONTROL=$(mktemp -d /tmp/policyc-source-control.XXXXXX)
git worktree add --detach "$CONTROL/checkpoint" 1fbe449b4b9972f63b132bac92abda42a9f7430b
[ -e "$CONTROL/checkpoint/node_modules" ] || ln -s "$PWD/node_modules" "$CONTROL/checkpoint/node_modules"
env -u OPENAI_API_KEY pnpm compare:source --baseline "$CONTROL/checkpoint" --output output/source-slice-offline/measurements.json
```

The fake smoke command and its cleanup follow the procedure in [the section-arm report](source-slice-offline.md#reproducible-commands), with `--strategies full_policy,compiler_slice,source_clause_slice` and `--max-calls 5`.
