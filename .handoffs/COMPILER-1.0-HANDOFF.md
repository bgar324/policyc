# PolicyC Compiler 1.0 Handoff

> Comprehensive operating brief for the next Codex agent continuing PolicyC.
>
> This document is deliberately opinionated. PolicyC is a research system, not
> merely a prompt-shortening demo. Preserve its experimental integrity while
> improving the compiler.

## 1. Mission

PolicyC investigates one question:

> Given a large system policy prompt `P` and a user request `x`, can we compile
> `P` into a much smaller active policy subset `P_x` such that a model using
> `P_x` preserves the same critical obligations as a model using the full
> prompt `P`?

The project has already established a strong efficiency result and a negative,
but useful, behavioral result:

- Request-specific compilation can remove roughly 90--98% of input context in
  the synthetic policy system.
- The current compiler does **not** preserve enough full-prompt critical
  successes to claim equivalence.
- Compiler 0.7 achieved 93.75% lower mean input tokens but only 79.75%
  conditional critical-obligation preservation in its frozen held-out study.
- The dominant failure was not simply selecting the wrong node. It was emitting
  a correctly selected conditional policy as an unconditional instruction.

The next research milestone is a predicate-aware compiler 0.8. The release
milestone is compiler 1.0, earned by fresh held-out evidence rather than chosen
because the code feels finished.

## 2. The central lesson

The first compiler treated the policy prompt primarily as a document that could
be filtered:

1. match request and artifact context to policy nodes;
2. retain universal and conservative safety nodes;
3. compute transitive dependency closure;
4. emit the selected text.

That approach produced large compression, but it was semantically incomplete.
Policies contain control flow:

- `if`
- `unless`
- `only when`
- `before`
- `after`
- `already confirmed`
- exceptions
- precedence
- satisfied preconditions

Compiler 0.7 often retained the right subject while losing this logic. For
example, a source rule equivalent to:

> Ask for confirmation before a destructive action unless the user has already
> confirmed that exact action.

could become:

> Required action: ask for confirmation.

The node was selected, yet the compiled instruction was behaviorally wrong.
The next compiler must therefore specialize a policy program, not summarize a
bag of policy strings.

## 3. Non-negotiable research posture

The agent continuing this work must follow these principles.

### 3.1 Do not optimize the story

Optimize the compiler and the experiment. Report the result that occurs.

- Do not call PolicyC equivalent to the full prompt.
- Do not hide full-pass/compiler-fail pairs behind similar marginal pass rates.
- Do not loosen a preregistered gate after seeing results.
- Do not silently remove incomplete or inconvenient trials.
- Do not describe model-agent reviewers as human annotators.
- Do not treat the selector's own output as independent ground truth.
- Do not compare different compiler versions as if their different held-out
  datasets formed a controlled longitudinal benchmark.

### 3.2 Efficiency and preservation are separate claims

A 98% context reduction does not compensate for dropping a critical
obligation. Always report both:

- the efficiency plane: input tokens, billed cost, uncached-equivalent cost,
  output tokens, latency, and tool fees;
- the behavioral plane: critical passes, paired outcomes, conditional
  preservation, uncertainty, and failure categories.

### 3.3 A failed held-out run is valuable evidence

When a frozen run fails:

1. lock and preserve the evidence;
2. unblind only after grades are locked;
3. localize each regression;
4. convert confirmed defects into development tests;
5. never reuse that opened dataset as fresh held-out evidence;
6. build the next version against development cases;
7. evaluate it on a new frozen set.

This is how compilers 0.5, 0.6, and 0.7 were developed. Continue the same
discipline.

## 4. Verified experimental record

Reconcile these values against the immutable run artifacts before updating any
public claim. The audit Markdown files are readable summaries; the run
directories are the underlying scientific record.

| Compiler | Cases | Model executions | Complete pairs | Recorded cost | Input reduction | Billed-cost reduction | Uncached-equivalent reduction | Conditional preservation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.5 / held-out v1 | 50 | 300 | 129/150 | $0.68807105 | 98.23% | 23.01% | 67.80% | 92/107 = 85.98% |
| 0.6 / held-out v2 | 50 | 300 | 139/150 before semantic ungradables | $1.03568580 | 89.69% | 24.50% | 55.36% | 64/74 = 86.49% |
| 0.7 / held-out v3 | 60 | 360 | 180/180 | $0.93327915 | 93.75% | 12.14% | 59.46% | 130/163 = 79.75% |

Totals across these three studies:

- 160 independently authored cases across three datasets;
- 960 model executions;
- $2.657036 recorded cost, conventionally rounded to $2.66;
- 61 provider-reported built-in web searches;
- 89.69--98.23% lower mean actual input tokens;
- 55.36--67.80% lower uncached-equivalent cost;
- 79.75--86.49% conditional critical-obligation preservation.

Do not say "960 paired calls." There were 960 model executions arranged into
paired full-policy/compiler-slice experiments.

### 4.1 Held-out v1 / compiler 0.5

- Policy graph: 39 manually structured nodes across six domains.
- Critical semantic outcomes among 129 complete pairs:
  - 92 both pass;
  - 15 full-only pass;
  - 9 compiler-only pass;
  - 13 both fail.
- Full-policy critical pass rate: 107/129 = 82.95%.
- Compiler-slice critical pass rate: 101/129 = 78.29%.
- Conditional preservation: 92/107 = 85.98%.
- Trial-level Wilson 95% interval: 78.15--91.32%.
- Exact two-sided McNemar `p = 0.3075`.
- Twenty-six trials hit the 2,048-token completion ceiling; incomplete trials
  remained failures.
- Eleven of the 15 full-only regressions came from one internal-directive
  leakage/emission defect.

Primary audit:

- `eval/audits/held-out-v1-findings.md`
- `runs/openai-held-out-v1/`

### 4.2 Held-out v2 / compiler 0.6

- Compiler 0.6 removed the internal tool-status directive leaked by 0.5 and
  incorporated confirmed v1 regressions into development policy/tests.
- The evaluation expanded the policy surface with web and synthetic function
  tool cases.
- Critical semantic outcomes reported from the opened study:
  - 64 both pass;
  - 10 full-only pass;
  - 9 compiler-only pass;
  - 53 both fail;
  - 3 semantically ungradable pairs.
- Full critical rate: 74/138 = 53.62%.
- Compiled critical rate: 73/136 = 53.68%.
- Conditional preservation: 64/74 = 86.49%.
- Trial-level Wilson 95% interval: 76.88--92.49%.
- Exact two-sided McNemar `p = 1.0`.
- Similar marginal pass rates did not mean preserved behavior; successes were
  exchanged across different pairs.

Infrastructure incidents were preserved rather than erased:

- web-search activity records were initially confused with billable search
  requests;
- strict empty function schemas were rejected by the provider;
- resume reconstruction could incorrectly promote truncated outcomes;
- blind packets initially omitted strategy-neutral tool evidence.

Each repair was separated from compiler changes, tested, and documented.

Primary audit:

- `eval/audits/held-out-v2-execution.md`
- `runs/openai-held-out-v2-v3/`

### 4.3 Held-out v3 / compiler 0.7

- Policy graph: 43 manually structured nodes across six domains.
- 60 cases, three samples, two strategies, 360 completed executions.
- GPT-5 mini snapshot: `gpt-5-mini-2025-08-07`.
- Concurrency: six.
- No active trial failed or remained ambiguous.
- Critical semantic outcomes among 180 pairs:
  - 130 both pass;
  - 33 full-only pass;
  - 11 compiler-only pass;
  - 6 both fail.
- Full-policy critical pass rate: 163/180 = 90.56%.
- Compiler-slice critical pass rate: 141/180 = 78.33%.
- Conditional preservation: 130/163 = 79.75%.
- Trial-level Wilson 95% interval: 72.93--85.21%.
- Packet-level exact McNemar `p = 0.0013`.
- Sixteen distinct cases contained at least one full-only regression.
- Leave-one-case-out preservation ranged from 79.38% to 81.25%, so one case did
  not explain the failure.
- Compiler 0.7 passed only two of six preregistered gates.

Root-cause attribution for the 33 full-only pairs:

- 21: lossy emitter wording;
- 7: selector errors;
- 2: context/interface mismatch;
- 3: primarily stochastic model variance.

Fifteen regressions involved redundant confirmation. This is the clearest
architectural signal for 0.8.

Primary audits:

- `eval/audits/held-out-v3-construction.md`
- `eval/audits/held-out-v3-blind-grade-lock.md`
- `eval/audits/held-out-v3-provider-schema-incident.md`
- `eval/audits/held-out-v3-execution.md`
- `runs/compiler-v0.7-held-out-v3/`

## 5. Current architecture

### 5.1 TypeScript is the compiler authority

TypeScript owns:

- loading and validating the YAML policy packs;
- intent detection;
- request, artifact, operation, domain, risk, and tool matching;
- universal and conservative retention;
- transitive dependency closure;
- deterministic ordering;
- prompt emission;
- candidate and prompt hashing;
- schema-bound artifact generation.

Zod validates runtime objects. JSON Schema defines the TypeScript/Python
boundary. Keep one source of authority: Python must not independently recreate
selection or prompt emission.

### 5.2 Python is the behavioral-runtime authority

Python owns:

- provider calls;
- `asyncio` concurrency and rate limiting;
- retry classification;
- timeouts;
- hard call, token, tool, and dollar ceilings;
- raw response persistence before parsing;
- resumability;
- deterministic evaluation;
- report generation;
- SQLite catalog ingestion and rebuilding.

### 5.3 Immutable artifacts are authoritative

SQLite is an index for viewing and querying run history. It is not the only
copy of the experiment and not the source of scientific truth. Immutable run
directories must remain sufficient to rebuild the catalog.

Every paid attempt should retain:

- candidate identity and hashes;
- request payload provenance;
- raw provider response;
- response and request IDs;
- actual model;
- usage and cache usage;
- latency;
- generation and tool cost;
- parsed result;
- evaluation result;
- resume status;
- run manifest and source commit.

Never overwrite evidence from a rejected, incomplete, ambiguous, or repaired
attempt. Quarantine it and document why it is excluded from the active ledger.

## 6. Read-first order for the next agent

Before changing code:

1. Run `git status --short` and preserve all existing user changes.
2. Run `git log --oneline -20` and record the current commit.
3. Read `README.md` completely.
4. Read this handoff completely.
5. Read the four held-out audit groups listed above.
6. Read `paper/policyc.tex` for the precise public research framing.
7. Read `paper/project-entry.md` for claims that are and are not defensible.
8. Inspect `package.json` and the Python project metadata; do not assume command
   names from this document when the repository can answer directly.
9. Run `pnpm policyc --help` and `pnpm policyc experiment --help` before forming
   any new paid command.
10. Locate the policy schemas, selector, closure implementation, emitter,
    behavioral runtime, provider adapter, and SQLite catalog code with `rg`.
11. Run the existing TypeScript and Python suites before editing.

There were uncommitted paper artifacts when this handoff was drafted:

- `paper/policyc.tex`
- `paper/project-entry.md`
- `output/pdf/policyc.pdf`

Verify their current status. Do not discard, replace, stage, or commit them
without understanding whether the user still wants those changes.

## 7. How to communicate with the user

The user wants a collaborator who can move quickly without obscuring what is
happening.

### 7.1 Lead with the outcome

Say what a step will establish, whether it spends money, and what happens next.
Do not drown the user in implementation details before answering their direct
question.

Good:

> This dry run costs nothing. It will compile 60 cases into 120 logical trials,
> validate the hashes and budgets, and write the manifest. It will not contact
> OpenAI.

Bad:

> I am invoking the manifest serialization layer and then initializing the
> provider abstraction.

### 7.2 Never blur free and paid work

Before every command or workflow that may contact a paid provider, state:

- exactly what leaves the machine;
- provider and pinned model;
- maximum model attempts;
- maximum built-in tool calls/searches;
- hard scheduler ceiling;
- expected cost based on the dry run;
- whether retries are enabled;
- whether storage is disabled;
- the output directory.

Do not spend based on an old authorization. Obtain authorization scoped to the
new compiler, dataset, call count, tool count, and ceiling.

### 7.3 Explain numbers in plain language

The user will ask whether a result is good. Answer directly:

- efficiency can be excellent while preservation fails;
- marginal equality can hide paired regressions;
- cached billed cost and uncached-equivalent cost answer different questions;
- a completion cap can invalidate comparisons;
- concurrency improves throughput, not necessarily per-response latency.

### 7.4 Do not patronize or over-hedge

Be honest and decisive. If a claim is unsupported, explain the exact missing
control. Then offer the strongest defensible version rather than merely saying
no.

Example: the first 300-call run completed in 8.35 minutes while its stored
provider-call durations summed to 49.12 minutes. It is defensible to describe a
5.88x effective throughput ratio or an elapsed time 83.0% below cumulative
provider latency. It is not defensible to call that a measured 5.88x speedup
over a sequential control, because no sequential control was executed.

## 8. Compiler 0.8 design direction

Do not begin by adding more keywords. First design a minimal semantic
intermediate representation.

### 8.1 Required conceptual model

A policy rule should be able to represent at least:

```text
rule_id
priority / authority
activation predicate
preconditions
action or obligation
prohibition
exceptions
satisfied-by predicate
dependencies / definitions
conflict or precedence relationship
evidence required to determine state
fallback when state is unknown
```

Illustrative structure only; fit it to the existing schemas rather than copying
it mechanically:

```ts
type PolicyRule = {
  id: string;
  when: Predicate;
  require?: Action[];
  forbid?: Action[];
  unless?: Predicate;
  satisfiedBy?: Predicate;
  requires?: string[];
  priority: number;
  unknownBehavior: "retain_condition" | "fail_closed";
};
```

The runtime context should distinguish facts such as:

```ts
type RequestState = {
  requestedAction?: ActionDescriptor;
  destructiveScope?: ScopeDescriptor;
  confirmation?: {
    present: boolean;
    exactActionMatched: boolean;
    exactScopeMatched: boolean;
  };
  availableTools: string[];
  artifact?: ArtifactDescriptor;
  domains: string[];
  risks: string[];
  evidence: EvidenceDescriptor[];
};
```

### 8.2 Partial evaluation

For each selected policy:

1. Evaluate only predicates supported by explicit request/context evidence.
2. If a policy is inapplicable, omit it and record why.
3. If its obligation is already satisfied, do not emit the obligation again;
   record the satisfied state in the compiler trace.
4. If applicability is unknown and the policy is high impact, retain the
   conditional rule rather than converting it into an unconditional action.
5. Preserve exceptions and precedence in model-visible text.
6. Emit deterministic, inspectable explanations and hashes.

The compiler trace should distinguish:

- matched;
- pulled in by dependency;
- conservatively retained;
- condition true;
- condition false;
- condition unknown;
- obligation already satisfied;
- suppressed by a higher-priority rule;
- emitted conditionally.

### 8.3 Preserve backward compatibility deliberately

The existing YAML graph is valuable. Avoid rewriting all 43 nodes before the
new representation proves useful.

A sensible migration path is:

1. add optional structured predicates and effects;
2. retain current text emission for unmigrated rules;
3. migrate the confirmed failure clusters first;
4. add schema validation that prevents contradictory structured/text fields;
5. version the candidate and compiled-prompt schemas;
6. require explicit migration before claiming a node is predicate-aware.

### 8.4 First 0.8 regression targets

Start with cases that expose semantic structure:

- destructive action requiring confirmation;
- exact confirmation already supplied;
- confirmation for a different action or scope;
- non-destructive wording that contains words such as "delete" or "remove";
- required tool available;
- required tool unavailable;
- explicitly forbidden tool;
- artifact claimed but absent;
- artifact present but uninspected;
- current-information request requiring web;
- rewrite request explicitly not requiring web;
- uncertainty and exact-number fabrication;
- competing output-format and safety obligations;
- policy exception overriding a general rule.

Each confirmed old regression should become:

- a selector/trace assertion;
- an emitted-prompt assertion;
- a behavioral development case;
- a short root-cause note.

## 9. Iteration workflow: develop one compiler correctly

### Phase A: establish the baseline

1. Verify worktree status and current commit.
2. Run the full existing test suite.
3. Rebuild/validate the policy graph.
4. Confirm that frozen 0.7 artifacts still hash correctly.
5. Reproduce existing offline reports without provider calls.
6. Record any baseline failure before editing.

### Phase B: write failing development tests

1. Extract the smallest confirmed counterexample from the audits.
2. Add a deterministic test that fails for the correct reason.
3. Assert selection and emission separately.
4. If the issue is in the cross-language schema, assert both TypeScript output
   and Python ingestion.
5. Do not encode the desired final answer into the selector.

### Phase C: implement the narrow semantic fix

1. Change the representation only as far as the failing semantic class needs.
2. Preserve deterministic ordering and hashes.
3. Avoid unrelated infrastructure work.
4. Add negative tests so the fix does not over-trigger.
5. Run focused tests, then the full suite.

### Phase D: offline compiler audit

For every development case, inspect:

- matched intents;
- direct matches;
- conservative retention;
- dependency closure;
- evaluated predicates;
- satisfied obligations;
- emitted model-visible instructions;
- prompt size;
- expected independent obligations.

Structural success means the prompt is what the compiler intended. It is not
yet behavioral success.

### Phase E: zero-cost Codex development evaluation

Codex subscriptions can provide useful development evidence, but these runs do
not continue the GPT-5 mini API series.

Use an isolated harness:

- fresh task and context for every response;
- empty directory without repository files;
- no project `AGENTS.md` except the deliberately injected condition;
- account for global `~/.codex/AGENTS.md` discovery;
- disable memories, skills, plugins, connectors, web, and tools where possible;
- use one fixed Codex model and reasoning effort;
- never allow the response worker to inspect PolicyC, the paired answer, or the
  rubric;
- persist the exact prompt hash and output.

Compare three conditions if capacity permits:

1. full policy;
2. compiler 0.7;
3. compiler 0.8.

This can answer whether 0.8 improves over 0.7 inside the same Codex harness. It
cannot be plotted as an apples-to-apples continuation of the API 0.5--0.7
numbers because Codex contributes its own higher-priority system/developer
instructions and tool harness.

### Phase F: paid API smoke

Only after all offline and Codex development checks pass:

1. commit or otherwise freeze the implementation;
2. record the exact source commit in the manifest;
3. prepare a tiny paired smoke manifest;
4. run `--dry-run` first;
5. inspect call, token, tool, and cost ceilings;
6. tell the user exactly what will be transmitted;
7. obtain fresh explicit authorization;
8. run without `--yes` initially so the run-specific confirmation is typed;
9. inspect every artifact;
10. rerun the same command and prove resume makes no provider calls;
11. scan for secret leakage without printing the secret.

### Phase G: development regression experiment

Run a small paid paired suite only if the API surface itself could change the
result. This is development evidence. Fix actual failures; do not add unrelated
architecture once the smoke passes.

### Phase H: freeze the compiler

Before constructing or opening the next held-out set:

1. freeze the compiler version;
2. freeze policy graph and schema versions;
3. freeze provider adapter and evaluator versions;
4. record the source commit;
5. document the intended claims and gates;
6. ensure the agent constructing held-out cases is not asked to optimize for
   known selector internals.

### Phase I: independently author the held-out set

The held-out set must specify obligations independently of compiler output.
It should include:

- paraphrased triggers;
- multiple simultaneous obligations;
- absent and present tools;
- satisfied and unsatisfied preconditions;
- policy exceptions;
- artifact metadata that carries obligations not stated in surface text;
- negative controls that resemble triggers lexically but do not activate them;
- cases likely to reveal failures rather than only easy successes.

Once any result is inspected, the set is no longer fresh for subsequent
compiler development.

### Phase J: preregister

At minimum preregister:

- dataset hash;
- compiler and source commit;
- model snapshot;
- strategies;
- sample count;
- tool surface;
- output cap;
- concurrency and retry policy;
- primary metric;
- incomplete/ambiguous handling;
- success gates;
- planned statistical summaries;
- maximum calls, tools, tokens, and dollars;
- stopping conditions.

### Phase K: execute, grade, and unblind

1. Execute both strategies with deterministic counterbalancing.
2. Persist raw responses atomically before parsing.
3. Do not retry ambiguous outcomes unless the preregistration allowed it.
4. Produce strategy-blind packets containing request, obligations, rubric, and
   only strategy-neutral tool evidence.
5. Omit strategy, prompt size, tokens, latency, cost, and private mapping.
6. Send disjoint batches to isolated Codex reviewer agents.
7. Reviewers assign semantic verdicts; they are not human annotators.
8. Hash-lock all returned grades before joining answer IDs to strategies.
9. Record grade coverage and any ungradable answer.
10. Unblind once.
11. Generate paired results and root-cause each full-only failure.

### Phase L: decide honestly

If the gates pass, replicate on a new set before 1.0. If they fail, preserve the
run, convert it to development evidence, and implement the next compiler.

## 10. Metrics and formulas

### 10.1 Paired critical outcomes

For every complete pair classify exactly one:

- both pass;
- full passes, compiled fails (`full-only`);
- compiled passes, full fails (`compiler-only`);
- both fail.

The core failure signal is `full-only`.

### 10.2 Conditional critical-obligation preservation

```text
preservation = both_pass / (both_pass + full_only)
```

This asks: among answers where the full prompt successfully carried its
critical obligations, how often did the compiled prompt also succeed?

Do not put both-fail pairs in the denominator. They provide no evidence that a
full-prompt success was preserved.

### 10.3 Statistical reporting

Report:

- trial-level Wilson 95% interval for preservation;
- exact two-sided McNemar test over discordant pairs;
- number of distinct cases with a full-only regression;
- case-level or cluster-aware sensitivity analysis;
- leave-one-case-out sensitivity for concentrated failures.

Three samples from one case are not three independent policy situations.
Describe trial-level intervals as descriptive unless the analysis explicitly
models clustering.

### 10.4 Efficiency

```text
input reduction = 1 - mean_compiled_input / mean_full_input
billed reduction = 1 - compiled_billed_cost / full_billed_cost
uncached reduction = 1 - compiled_uncached_equivalent / full_uncached_equivalent
latency change = mean_compiled_latency / mean_full_latency - 1
```

Always separate:

- regular input tokens;
- cached input tokens;
- retrieved tool/search context;
- output and reasoning tokens;
- generation cost;
- built-in tool fees;
- actual billed cost;
- uncached-equivalent cost.

The uncached-equivalent metric isolates the compiler's prompt-size economics.
Actual billed cost reflects prompt caching and is operationally real. Report
both.

### 10.5 Concurrency

Across the three held-out runs, stored timing artifacts indicated:

- 134.11 minutes of cumulative provider-call duration;
- 37.24 aggregate minutes of observed concurrent execution;
- 3.60x effective throughput relative to the summed-latency baseline;
- elapsed time 72.2% below cumulative provider latency.

This is an inferred serial-latency baseline, not a controlled sequential run.
If a publication needs a true speedup number, execute a controlled sequential
condition with the same cases, model, outputs, and time window.

## 11. Safe paid-experiment policy

The repository contains or expects a local `.env` with `OPENAI_API_KEY`. Never:

- print it;
- commit it;
- include it in logs or manifests;
- interpolate the full key into a shell command that may be retained in shell
  history;
- scan with a command that echoes the full expanded key;
- send it to a subagent or reviewer.

Provider payloads for PolicyC should remain synthetic unless the user
explicitly expands scope. Set provider storage off where supported.

Every paid run must have:

- a preceding dry run;
- exact input and output ceilings;
- exact provider-attempt ceiling;
- exact built-in tool ceiling;
- exact cost ceiling;
- retries disabled by default;
- run-specific confirmation;
- atomic raw persistence;
- resume verification;
- complete usage accounting.

If usage is unknown, cost is unknown. Never turn null usage into zero cost.

## 12. Suggested $5 path to compiler 1.0

The user has considered purchasing $5 of API credit. That money is probably
enough to validate a disciplined path, but it cannot guarantee success.

Historical reference: held-out v3 cost $0.9333 for 360 executions and 20
provider-reported searches. Use a fresh dry run rather than assuming identical
future pricing or output behavior.

Suggested ceilings:

| Stage | Goal | Ceiling |
| --- | --- | ---: |
| Offline and Codex development | Implement predicate-aware 0.8 | $0 API |
| API smoke | Validate adapter, hashes, persistence, resume | $0.15 |
| Known regression experiment | Confirm old defects are fixed | $0.35 |
| Fresh held-out v4 | Evaluate frozen 0.8 | $1.25 |
| Remediation reserve | Target newly opened failures | $0.50 |
| Fresh held-out v5 | Evaluate the next frozen compiler if needed | $1.25 |
| Final replication | Confirm the release candidate | $1.00 |
| Safety reserve | Truncation, tools, or incident recovery | $0.50 |

Do not mechanically spend every bucket. Stop when a run reveals an
architectural defect. Return to free implementation and development testing.

## 13. Proposed compiler 1.0 release gates

The next agent should confirm these with the user and preregister them before
the decisive run. A reasonable standard is:

### Correctness

- all confirmed 0.5--0.7 deterministic regressions pass;
- structured conditions, exceptions, negation, precedence, and satisfied
  confirmation state survive compilation;
- no unresolved high-severity selector or emitter defect;
- no dominant repeated full-only failure class;
- at least 95% conditional critical-obligation preservation on a fresh held-out
  set;
- uncertainty interval and case-level sensitivity are reported, not hidden;
- a second fresh evaluation confirms the release candidate.

### Efficiency

- at least 90% lower mean actual input context;
- meaningful uncached-equivalent cost reduction;
- billed cost, tool fees, output expansion, and latency disclosed separately;
- no efficiency claim based only on a provider cache advantage.

### Reproducibility

- source commit and graph version frozen;
- dataset and manifest hashes recorded;
- actual model and response IDs recorded;
- raw responses immutable;
- blind grades hash-locked before unblinding;
- SQLite catalog rebuildable from artifacts;
- resume proven not to issue duplicate paid calls;
- secret scan clean;
- complete test suite green.

Passing a single small development suite is not enough for 1.0.

## 14. Common failure modes and correct responses

### Selector misses a policy

- Add the minimal request/context feature needed.
- Test paraphrase and negative-control variants.
- Check whether the missing signal belongs in artifact metadata rather than
  lexical matching.
- Do not retain the entire domain just to make one case pass unless the
  conservative tradeoff is explicit and measured.

### Dependency closure is incomplete

- Fix the graph edge or schema invariant.
- Add cycle, reachability, and closure tests.
- Check whether the dependency is truly unconditional or should be a semantic
  predicate.

### Emitter changes meaning

- Reproduce the source condition and emitted condition side by side.
- Move logic into the structured representation.
- Do not patch with ad hoc English that only fits one case.
- Test satisfied, unsatisfied, and unknown states.

### Both strategies fail

- Do not count the pair as preservation evidence.
- Check case validity, output truncation, tool availability, and base-prompt
  clarity.
- If the case is valid, it may reveal a source-policy or model limitation rather
  than a compiler regression.

### Compiler-only pass

- Preserve it as evidence.
- Determine whether compilation removed distracting/conflicting policy text or
  whether the result is stochastic.
- Never use compiler-only passes to cancel full-only failures in the primary
  conditional-preservation metric.

### Output hits the cap

- Mark it incomplete exactly as returned.
- Do not reclassify it on resume.
- If the cap prevents valid answers, document and fix the protocol during
  development; do not silently alter the cap mid-held-out run.

### Provider rejects a tool schema

- Preserve the rejected HTTP artifact.
- Separate adapter repair from compiler changes.
- Run the complete local suite.
- Resume only the rejected trials under the documented repair.
- Count total HTTP attempts and model executions separately.

### Evaluator is obviously wrong

- Preserve the old evaluation.
- Version the evaluator.
- Regrade all affected strategies symmetrically.
- Do not change only the compiled verdict.
- If semantic grading is required, blind and lock it.

## 15. Subagent policy

Use subagents where isolation is scientifically useful, not merely to generate
activity.

Good uses:

- strategy-blind semantic grading of disjoint packet batches;
- independent audit of hashes and coverage;
- independent root-cause classification after evidence is locked;
- parallel review of mutually exclusive compiler components;
- Codex-surface development trials in fresh contexts.

Bad uses:

- letting a response agent see the rubric or expected answer;
- calling each subagent a benchmark;
- letting graders see strategy, tokens, cost, or the paired response;
- using two accounts as interchangeable generators without blocking for account
  and model differences;
- treating Codex subscription runs as identical to the Responses API series;
- asking agents to vote until PolicyC wins.

The statistical unit is the paired trial or case. A subagent is only a worker.

## 16. Public and résumé claims

The strongest defensible project summary is:

> Policy-prompt compiler that cuts LLM context by up to 98% while measuring
> whether request-specific policy slices preserve the full prompt's critical
> obligations.

Top technologies:

- TypeScript
- Python
- OpenAI API
- SQLite

Resume claims already derived from evidence include:

- 43-node, six-domain dependency graph;
- up to 98.23% lower mean input context;
- 960 GPT-5 mini executions in paired experiments;
- $2.66 total recorded cost across the three frozen studies;
- normalized uncached projection of approximately $2.43 for an all-compiled
  960-call workload versus $6.17 for an all-full-policy workload, a 60.6%
  aggregate reduction;
- up to 67.8% uncached-equivalent reduction in one study;
- 3.60x aggregate effective throughput against cumulative provider latency,
  explicitly labeled as an inferred rather than controlled serial baseline.

Before repeating normalized projections, recalculate them from the immutable
reports and explain the counterfactual. Do not compare the actual mixed-arm
$2.66 experiment directly to the $6.17 all-full counterfactual.

## 17. Definition of done for each session

A compiler-development session should end with:

- the question tested;
- exact files changed;
- focused and full verification results;
- whether any provider call occurred;
- exact spend if it did;
- observed result, including failures;
- the evidence that determines the next change;
- worktree status;
- a clear next action.

Do not end with vague language such as "looks good" when a measurable gate
exists.

## 18. Immediate recommended next action

The next agent should **not** start a paid run immediately.

1. Audit the current worktree and reconcile this handoff with the latest commit.
2. Preserve the uncommitted paper/resume work.
3. Turn the redundant-confirmation failures into minimal deterministic fixtures.
4. Propose the predicate/effect schema for 0.8 with backward compatibility.
5. Implement one vertical slice:
   - exact destructive action;
   - exact confirmation state;
   - `unless already confirmed` partial evaluation;
   - compiler trace;
   - correct conditional emission;
   - negative controls.
6. Run the complete offline suite.
7. Show the user the before/after source policy, trace, and emitted prompt.
8. Only then expand to tool availability, negation, and precedence.
9. Use isolated Codex trials as development evidence.
10. Ask for a paid smoke only when compiler 0.8 is frozen enough that the API
    call will answer a research question rather than debug obvious code.

## 19. Copy-paste opening prompt for the next agent

```text
You are continuing PolicyC toward compiler 1.0. Read
.handoffs/COMPILER-1.0-HANDOFF.md, .handoffs/2026-09-03-recall-brief.md,
README.md, paper/policyc.tex, and every held-out audit they link before editing.
Begin by reporting the current git status, source
commit, test baseline, and any discrepancy between the handoff and repository.

Preserve all existing user changes. Do not contact a paid provider until you
have run a dry run, stated exactly what data will be sent, shown exact call/tool/
token/cost ceilings, and received fresh explicit authorization. Never print or
persist the API key.

Develop compiler versions from confirmed paired regressions. Separate selector,
dependency, emitter, context-interface, evaluator, provider, and stochastic
failures. Do not reuse an opened held-out dataset as fresh evidence. Keep blind
reviewers isolated and lock their grades before unblinding.

The immediate engineering target is predicate-aware compiler 0.8. Start with
the v0.7 redundant-confirmation failures: represent the confirmation condition,
exact action/scope, exception, and satisfied state explicitly, then partially
evaluate them without flattening conditional policies into unconditional
actions. Add deterministic tests before implementation and show the emitted
prompt before proposing any paid experiment.

The research target remains at least 95% conditional preservation on fresh
held-out evidence while retaining at least 90% mean input reduction. Do not call
the system equivalent or 1.0 unless the preregistered gates and replication
actually pass.
```

## 20. Final reminder

PolicyC became interesting when the attractive compression number and the
disappointing preservation number appeared together. Preserve that tension.

The project is not successful because it can delete prompt text. It will be
successful when it can prove which policy logic is safe to specialize, retain
the obligations that still matter, recognize obligations already satisfied,
and expose the remaining uncertainty honestly.

