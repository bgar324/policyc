# PolicyC

PolicyC is a polyglot research system for testing whether a task-specific slice of a large policy prompt can preserve the behaviorally relevant obligations of the full policy while using less context.

It deliberately separates two concerns:

- TypeScript is the single authority for policy loading, validation, matching, graph closure, candidate construction, prompt emission, hashing, and artifact serialization.
- Python owns repeated model trials, bounded concurrency, rate limiting, retries, timeouts, cancellation, streamed events, persistence, evaluation, statistics, and baseline comparison.

PolicyC does **not** currently prove behavioral equivalence. Its included end-to-end demo uses a deterministic fake provider to verify runtime mechanics. A real OpenAI adapter is available only when explicitly configured with credentials.

## Architecture

```mermaid
flowchart LR
    P["YAML policy packs"] --> V["Zod runtime validation"]
    V --> G["Graph validation"]
    X["Request + artifact context"] --> S["Deterministic selector"]
    G --> S
    S --> C["Five candidate strategies"]
    C --> A["Versioned JSON artifacts + hashes"]
    A --> M["Run manifest"]
    M --> R["Python asyncio runtime"]
    R --> Q["Bounded worker queue + rate limiter"]
    Q --> F["Fake or OpenAI provider"]
    F --> E["Rule-based evaluator"]
    E --> O["Atomic trials + JSONL/SSE events + report"]
```

The protocol boundary is defined by JSON Schemas under [`protocol/`](protocol/). Python validates TypeScript artifacts and verifies candidate and compiled-prompt hashes before execution.

## Compiler pipeline

The compiler loads 39 manually structured policy nodes from six YAML packs. PolicyC does not yet extract those nodes from arbitrary natural-language prompts.

1. Zod validates required fields, enums, priorities, triggers, and unknown fields.
2. Graph validation rejects duplicate IDs/edges, missing references, self-dependencies, cycles, unreachable structural nodes, unknown validators, and invalid always-active configurations.
3. Regex intent detection and structured artifact context select seed policies.
4. Queue-based traversal adds the transitive `requires` closure.
5. Policies are ordered deterministically and emitted as a runtime prompt.
6. The compiler serializes five experimental candidates:
   - `full_policy`
   - `compiler_slice`
   - `kernel_only`
   - `direct_matches`
   - `conservative_expanded`

Candidate names describe construction strategies, not behavioral equivalence.

## Python runtime

The Python package lives in [`runtime/python`](runtime/python) and targets Python 3.12+.

The scheduler creates a fixed number of worker tasks and feeds them through a bounded queue. A second semaphore enforces provider-specific concurrency. An in-process sliding-window limiter can constrain requests and estimated prompt tokens. Each invocation has a timeout; retryable failures use exponential backoff with deterministic jitter and optional provider `Retry-After` values.

Trial IDs are hashes of stable run, provider, model, candidate, and sample inputs. Completed trials are written atomically and reused after restart when their provenance hash matches. Incomplete and retryable trials execute again. Cancellation propagates to active provider tasks.

Events receive a per-run monotonic sequence number, persist as JSONL, and serialize as SSE. FastAPI provides:

- `POST /runs`
- `GET /runs/{run_id}`
- `GET /runs/{run_id}/events`
- `POST /runs/{run_id}/cancel`
- `GET /runs/{run_id}/report`

Raw response retention is explicit in each manifest: `none`, `text`, or `full`. Secrets are never written by the runtime.

## Evaluation

Structural evidence and behavioral evidence are kept separate.

Structural evaluation covers selected-policy precision/recall, critical-policy recall, dependency completeness, graph validity, deterministic artifact construction, and exact or estimated token counts.

Behavioral evaluation records obligation checks, violations, answer-quality heuristics, tool use, latency, provider token usage, and estimated cost. Reports compare each candidate with the full-policy baseline and calculate mean, median, sample standard deviation, and an approximate 95% confidence interval. A configurable non-inferiority margin is experimental; it is not proof, and candidates missing compiler-slice critical policies are rejected before size ranking.

The built-in evaluator is intentionally small and deterministic. Model graders can be added as adapters, but should not be treated as ground truth.

## Setup

```bash
pnpm install
pnpm build

python3.12 -m venv .venv
.venv/bin/pip install -e 'runtime/python[dev]'
```

The local environment may use a newer Python, but CI verifies Python 3.12.

## CLI

Existing commands remain available:

```bash
pnpm policyc select --input "what's the latest OpenAI news?"
pnpm policyc compile --input "rewrite this email professionally"
pnpm policyc inspect --policy current_info_requires_web
pnpm policyc eval
```

Generate cross-language experiment artifacts:

```bash
node dist/cli.js compile-candidates \
  --input "what's the latest OpenAI news?" \
  --output experiment \
  --model fake-v1
```

Run and stream an offline experiment:

```bash
.venv/bin/policyc-runtime run experiment/manifest.json
```

Or run the complete demo:

```bash
pnpm demo
```

The demo compiles five candidates, executes three samples per candidate with maximum concurrency four, streams SSE-compatible events, atomically persists 15 trial results, and produces `report.json`. Its compliance results are fake-provider evidence only.

## Real provider

The isolated OpenAI Responses API adapter is selected by setting `provider` to `openai` in the manifest and exporting `OPENAI_API_KEY`. Offline tests never require or call a real provider. Provider responses can be expensive or contain sensitive data; review the manifest's retention setting and output directory before running.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm graph:validate

pnpm py:format
pnpm py:lint
pnpm py:typecheck
pnpm py:test

pnpm test:all
```

CI installs both environments, builds TypeScript, validates the graph and cross-language artifacts, runs all offline tests, and executes the fake-provider demo without credentials.

## Token accounting

Modern OpenAI-family models use exact `o200k_base` BPE counts through `gpt-tokenizer`. Unsupported model names use the documented whitespace estimator `ceil(words / 0.75)`. Every artifact records `tokens`, `method`, `tokenizer`, and `model`; reports never silently mix estimated and exact values.

## Persistence layout

```text
experiment/
  manifest.json                 # input manifest
  artifacts/*.json              # compiler candidates
  manifest.canonical.json       # normalized run configuration
  environment.json              # environment and reproduction command
  events.jsonl                  # ordered run events
  trials/<trial-id>.json        # atomic individual results
  report.json                   # aggregate comparison
```

## Known limitations

- Policy nodes and dependency edges are manually authored; prompt-to-IR extraction is not implemented.
- Intent detection is lexical and can miss paraphrases.
- The existing 157-case selector evaluation is repository-authored, not held out.
- The deterministic evaluator uses regular expressions and is not a complete judge of model behavior.
- The fake provider validates scheduling and reproducibility, not policy preservation.
- Real-provider results require repeated trials and careful interpretation; no single run proves equivalence.
- The API is an in-process research service, not a distributed production control plane.
