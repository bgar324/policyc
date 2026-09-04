# PolicyC project entry

## Portfolio one-liner

Policy-prompt compiler that cuts LLM context by up to 98% while measuring whether request-specific policy slices preserve the full prompt's critical obligations.

## Top four technologies

TypeScript · Python · OpenAI API · SQLite

## Portfolio metadata

- **Name:** PolicyC
- **Source:** <https://github.com/bgar324/policyc>
- **One-liner:** Policy-prompt compiler that cuts LLM context by up to 98% while measuring whether request-specific policy slices preserve the full prompt's critical obligations.
- **Technology line:** TypeScript · Python · OpenAI API · SQLite

## Resume entry — LaTeX

```latex
\resumeProjectHeading
{\textbf{\href{https://github.com/bgar324/policyc}{PolicyC}} $|$ \emph{TypeScript, Python, OpenAI API, SQLite}}{2026 -- Present}
\resumeItemListStart
\resumeItem{Built a deterministic policy compiler that converts a \textbf{44-node, six-domain dependency graph} into request-specific runtime prompts, reducing mean model input by \textbf{93.75\%} in the latest frozen \textbf{60-case, 360-call} held-out study.}

\resumeItem{Engineered a resumable Python \texttt{asyncio} evaluation runtime with bounded concurrency, hard call/token/cost limits, atomic raw-response persistence, hash-linked manifests, blind grading packets, and a rebuildable \textbf{SQLite} run catalog.}

\resumeItem{Executed \textbf{1,680 GPT-5 mini executions in paired experiments} across five frozen held-out studies for \textbf{\$4.90}, measuring \textbf{89.69--98.23\% lower input context}, \textbf{55.36--67.80\% lower uncached-equivalent cost}, and \textbf{75.76--86.49\% critical-obligation preservation} while localizing confirmation, tool-limit, selector, and policy-representation regressions.}
\resumeItemListEnd
```

## Resume entry — plain text

**PolicyC — Policy-prompt compiler and evaluation system**
*TypeScript, Python, OpenAI API, SQLite | 2026–Present*

- Built a deterministic policy compiler that converts a **44-node, six-domain dependency graph** into request-specific runtime prompts, reducing mean model input by **94.76%** in the latest frozen **60-case, 360-call** held-out study.
- Engineered a resumable Python `asyncio` evaluation runtime with bounded concurrency, hard call/token/cost limits, atomic raw-response persistence, hash-linked manifests, blind grading packets, and a rebuildable **SQLite** run catalog.
- Executed **1,680 GPT-5 mini executions in paired experiments** across five frozen held-out studies for **$4.90**, measuring **89.69–98.23% lower input context**, **55.36–67.80% lower uncached-equivalent cost**, and **75.76–86.49% critical-obligation preservation** while localizing confirmation, tool-routing, and emitter regressions.

## Compact two-bullet version

- Built **PolicyC**, a TypeScript/Python compiler that transforms a 44-node policy graph into dependency-closed, request-specific prompts, cutting held-out model input by **89.69–98.23%** and uncached-equivalent cost by **55.36–67.80%**.
- Created a safety-bounded, resumable `asyncio` experiment platform with immutable provenance, blind grading, and SQLite history; ran **1,680 GPT-5 mini executions for $4.90** and converted behavioral regressions into exact compiler test cases.

## Portfolio description

PolicyC investigates whether a large system policy prompt can be compiled into a much smaller request-specific subset without losing critical behavioral obligations. The system represents policies as a validated YAML dependency graph, uses deterministic intent and artifact-context matching to select active nodes, closes transitive dependencies, and emits a compact runtime contract. A separate Python runtime performs paired full-policy versus compiler-slice experiments with bounded asynchronous execution, exact token and cost accounting, resumable atomic artifacts, strategy-blind grading packets, and persistent SQLite run history.

Across five frozen held-out studies totaling 280 cases and 1,680 GPT-5 mini executions, compiled prompts reduced mean model input by 89.69–98.23% and uncached-equivalent cost by 55.36–67.80%. Conditional critical-obligation preservation ranged from 75.76% to 86.49%, below the preregistered 95% target. Rather than claiming equivalence, PolicyC uses the paired failures to expose concrete compiler defects in confirmation state, tool negation, output-format precedence, and context symmetry.

## Interview framing

> PolicyC's strongest result is a repeatable efficiency gain: roughly 90–98% less input context and 55–68% lower uncached-equivalent cost across four frozen studies. The behavioral result is intentionally negative: the current compiler preserves only about 76–86% of full-prompt critical successes. The interesting engineering result is that most failures were not random model noise; they were traceable compiler defects. Compiler 0.7 flattened conditional confirmation policies into unconditional instructions; compiler 0.8 fixed that with a predicate that passed every development case and matched none of the fresh phrasings real authors used, which is its own finding about pattern-matching user intent. The project turned a vague prompt-compression idea into a reproducible systems experiment with falsifiable gates and concrete counterexamples.

## Claims to avoid

- Do not say PolicyC proved prompt or policy equivalence.
- Do not describe three generations per case as independent policy situations.
- Do not compare compiler versions as a controlled benchmark; each held-out version used a different case set.
- Do not call the semantic reviewers human annotators; they were isolated, strategy-blind Codex reviewer agents.
- Do not attribute prompt-cache discounts to compiler savings; report billed and uncached-equivalent cost separately.
- Do not claim the current compiler handles arbitrary unstructured prompts; it compiles 44 manually structured policy nodes.
