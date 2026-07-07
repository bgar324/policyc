# policyc

`policyc` is a CLI-first research prototype for treating LLM system prompts as source code.

Core phrase:

> System prompt as source code. Policy IR as intermediate representation. Runtime prompt as compiled output. Validators as tests.

The project lowers YAML policy packs into a typed Policy IR, selects a conservative active policy closure for a request and optional artifact context, emits a compact runtime prompt, and evaluates whether the compiled prompt preserves critical obligations.

## Research Question

Can a conservative policy compiler reduce active system prompt context while preserving critical obligations under dependency closure?

The goal is not just shorter prompts. The goal is preserving behavior. A compiler that saves tokens by dropping safety, privacy, tool-use, citation, or artifact obligations has failed.

## Why Not Naive Summarization?

Large system prompts contain universal rules, conditional rules, definitions, exceptions, and tool-specific instructions. A naive summary may remove a policy that does not look relevant from the user's words but is required by the artifact, tool, operation, domain, or risk context.

That failure mode is **latent obligation loss**. Example: the user says "summarize this PDF", but the artifact manifest says the PDF contains financial tables and charts. A request-only compiler may keep a generic PDF summary rule while dropping chart/table numeric caution and page-citation obligations.

## Policy Kinds

`policyc` splits policies into three kinds:

- `universal`: always active and never dropped, such as honesty, no hidden reasoning reveal, no background-work claims, and a privacy floor.
- `content_gated`: activated by text, intent, artifact type, artifact feature, tool, operation, domain, or risk triggers. These are the compressible part.
- `structural`: definitions, precedence rules, exceptions, and support rules. They are included when retained policies depend on them through `requires`.

For restrictive safety policies, recall matters more than precision. False positives cost tokens or over-caution. False negatives can lose critical behavior. The selector is intentionally conservative.

## Artifact Context

Eval cases and CLI inputs can include optional context:

```json
{
  "artifactType": "pdf",
  "features": ["charts", "tables"],
  "operation": "summarize",
  "domainHints": ["finance"],
  "riskHints": ["numeric_accuracy"]
}
```

The selector uses both request text and context. Artifact-triggered policies are how `policyc` guards against latent obligation loss.

## CLI

Install and build:

```bash
pnpm install
pnpm build
```

Select policies:

```bash
pnpm policyc select --input "what's the latest OpenAI news?"
```

Compile a runtime prompt:

```bash
pnpm policyc compile --input "rewrite this email professionally: yo send it"
```

Select with artifact context:

```bash
pnpm policyc select \
  --input "summarize this PDF" \
  --context '{"artifactType":"pdf","features":["charts","tables"],"operation":"summarize"}'
```

Inspect one policy:

```bash
pnpm policyc inspect --policy current_info_requires_web
```

Run evals:

```bash
pnpm policyc eval
```

Run mock model-strategy comparison and persist traces:

```bash
pnpm policyc compare-models --limit 20
pnpm policyc eval-model --strategy compiled_prompt --limit 20
```

## Eval Metrics

`policyc eval` loads YAML policies and JSONL eval cases, runs deterministic selection, compiles a runtime prompt, creates mocked traces, and runs code validators.

The report includes:

- policy precision
- policy recall
- critical policy recall
- dependency closure completeness
- average full prompt tokens
- average compiled prompt tokens
- average token reduction
- obligation pass rate
- critical obligation pass rate
- forbidden behavior rate
- severity-weighted failure score
- top failing case IDs

Policy recall and critical recall are more important than precision.

## Initial Eval Results

Latest local run:

```bash
pnpm build
pnpm policyc eval
```

Current results:

| Metric | Value |
| --- | ---: |
| Eval cases | 157 |
| Policy precision | 94.4% |
| Policy recall | 100.0% |
| Critical policy recall | 100.0% |
| Dependency closure completeness | 100.0% |
| Average full prompt tokens | 16358 |
| Average compiled prompt tokens | 256 |
| Average token reduction | 98.4% |
| Obligation/validator pass rate | 100.0% |
| Critical obligation pass rate | 100.0% |
| Validator sanity tests | 8/8 passed |

Prompt strategy token table:

| Strategy | Avg tokens |
| --- | ---: |
| Full prompt | 16358 |
| Compiled prompt | 256 |
| Minimal prompt | 7 |
| Naive summary | future work |

Top failure categories:

- `over_inclusion`: 25 cases

Over-inclusion breakdown:

- `acceptable_conservative_over_inclusion`: 7 cases
- `eval_label_too_narrow`: 7 cases
- `overly_broad_intent_trigger`: 7 cases
- `overly_broad_keyword_trigger`: 4 cases

There are currently no missing-policy, missing-dependency, artifact-trigger-miss, or validator-failure cases in the eval report. The remaining failures are conservative retention or broad trigger matches that include extra policies. Examples include citation/source-quality rules for citation-adjacent wording, writing rules on some structured-file cleanup requests, and person/image caution retained when the eval label is narrower.

This is a useful failure mode for the prototype: the compiler is preserving critical obligations, but it is not yet highly precise. For restrictive policies this is the intended bias, but the report now makes the cost visible.

## Next-Stage Evaluation

The v0 eval measures selector and compiler correctness. It checks whether deterministic policy selection retains expected active policies, closes dependencies, emits a smaller runtime prompt, and attaches validators that can catch obvious behavioral failures.

It does not yet prove model behavioral equivalence. The next stage compares model outputs under four prompt strategies:

- `full_prompt`: the expanded synthetic enterprise prompt.
- `compiled_prompt`: the task-specific prompt emitted from selected Policy IR.
- `naive_summary`: a deliberately shallow summary baseline.
- `minimal_prompt`: a small generic assistant prompt.

The success condition is not just token reduction. A useful compiled prompt should preserve critical validator pass rate and forbidden-behavior avoidance while using far fewer prompt tokens than the full baseline.

`policyc compare-models` currently uses a mock runner and writes traces to `runs/<timestamp>/traces.jsonl` plus `runs/<timestamp>/summary.json`. The trace schema includes case id, input, context, strategy, selected policies, prompt token counts, system prompt used, output, tools called, validator results, and failure categories. The runner interface is ready for OpenAI, Anthropic, or local model implementations, but no provider key is required in v1.

Example mock comparison:

```text
Strategy          Avg tokens  Validator pass  Critical pass  Forbidden rate  Latent miss  Weighted failures
full_prompt            16358          100.0%         100.0%            0.0%         0.0%                0.0
compiled_prompt          281          100.0%         100.0%            0.0%         0.0%                0.0
naive_summary             70          100.0%         100.0%            0.0%         0.0%                0.0
minimal_prompt             7           75.0%          60.0%            0.0%       100.0%               64.0
```

## Repo Layout

```text
src/
  cli.ts
  policy/
  compiler/
  model/
  validators/
  eval/
  traces/
  util/
policies/
evals/
prompts/
```

## Limitations

This does not prove universal behavioral equivalence. It only measures compliance over bounded evals.

The selector is safety-critical and needs red-teaming. Prompt policy is not a replacement for hard runtime gates on irreversible actions. The validators are regex and trace checks, so they are approximate. The eval runner uses mocked traces for v1, so validator pass rates mean "the validators behave on the mocked traces", not that a real model will comply. LLM-assisted extraction from giant prompts is future work and is not trusted in v1.

## Future Work

- model-provider runner interface for real compiled-prompt evaluations
- baselines for full prompt, summarized prompt, and minimal prompt
- richer parser for existing enterprise prompts
- confidence-aware selector traces
- stronger validators and optional LLM judges
- hard runtime gates for irreversible actions
