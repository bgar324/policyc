# PolicyC project entry

## Resume-ready version

**PolicyC — Policy-prompt compiler and evaluation system**

*TypeScript, Python, asyncio, OpenAI API, SQLite, Zod, FastAPI, JSON Schema*

- Built a deterministic compiler that converts a 39-node, six-domain policy graph into request-specific, dependency-closed runtime prompts; reduced mean model input from 16,242 to 288 tokens (**98.23%**) in a frozen 50-case held-out experiment.
- Engineered a resumable Python `asyncio` runtime with bounded concurrency, hard budgets, atomic persistence, and SQLite provenance; completed 300 GPT calls in 8.35 minutes versus 49.12 minutes of aggregate provider latency (**5.88× effective throughput**, **83.0% less wall time** than the observed serial-latency baseline).
- Executed a preregistered 300-call GPT-5 mini study for **$0.69**, measuring **19.95% lower latency**, **23.01% lower billed cost**, and **67.80% lower uncached-equivalent cost** for compiled prompts while identifying concrete confirmation, uncertainty, and selector regressions that prevent an overclaimed equivalence result.

## Compact two-bullet version

- Built **PolicyC**, a TypeScript/Python research compiler that selects dependency-closed policy subsets from 39 structured rules, cutting held-out mean input context by **98.23%** and uncached-equivalent model cost by **67.80%**.
- Created a safety-bounded, resumable `asyncio` experiment platform that completed **300 paired OpenAI trials in 8.35 minutes** at concurrency six—**5.88× effective throughput** versus summed request latency—with immutable provenance, SQLite history, blind grading artifacts, and explicit failure analysis.

## Portfolio / project-page description

PolicyC investigates whether a large system policy prompt can be compiled into a much smaller request-specific subset without losing critical behavioral obligations. The system represents policies as a validated YAML dependency graph, uses deterministic intent and artifact-context matching to select active nodes, closes transitive dependencies, and emits a compact runtime contract. A separate Python runtime performs paired full-policy versus compiler-slice experiments with bounded asynchronous execution, exact token and cost accounting, resumable atomic artifacts, blind grading packets, and persistent SQLite run history.

The first frozen 50-case held-out run reduced mean input tokens from 16,242 to 288, latency by 19.95%, and uncached-equivalent cost by 67.80%. Blind semantic grading of all 129 complete pairs measured 85.98% conditional critical-obligation preservation. Eleven of 15 regressions came from one internal-directive leakage bug; four confirmation and meaning-preservation failures define the remaining compiler regression suite. The project therefore reports strong efficiency without claiming general policy equivalence.

## Technical highlights

- 39 typed policy nodes across six YAML packs
- Deterministic trigger matching, conservative risk retention, and transitive dependency closure
- Five serializable compiler strategies with canonical hashes and exact modern-model token counts
- TypeScript compiler authority with a JSON-Schema-validated Python execution boundary
- Bounded worker queue, concurrency semaphore, rate limiting, timeouts, and retry classification
- Hard provider-call, token, and dollar ceilings with run-specific paid confirmation
- Atomic raw-response and trial persistence with safe resume semantics
- Git commit, manifest, dataset, compiler, prompt, and response provenance
- SQLite catalog rebuildable from immutable run artifacts
- Paired obligation evaluation, Wilson intervals, McNemar analysis, and blind answer packets
- Offline versioned regrading that never mutates original evidence

## Honest interview framing

> The strongest result is the efficiency gain: roughly 98% less policy context with about 20% lower latency and 68% lower uncached-equivalent cost. The behavioral result is intentionally reported as mixed. The held-out run exposed a few real selector misses—especially production publishing and destructive file overwrite—as well as weaknesses in the lexical evaluator. I consider that a research success because the system produced reproducible counterexamples instead of a misleading aggregate win.

## What not to claim yet

- Do not say PolicyC proved general policy equivalence.
- Do not describe three samples per case as 150 independent held-out cases.
- Do not claim tool-use preservation; the held-out run exposed no provider tools.
- Do not attribute prompt-cache discounts to the compiler.
- Do not describe the 85.98% held-out preservation result as general policy equivalence.
