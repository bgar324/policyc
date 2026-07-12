# PolicyC pilot v2 truncation follow-up

Status: **offline dry run passed; paid execution requires separate user authorization**

This is a post-pilot follow-up, not the preregistered primary run. It was defined after run `run_fbd3fb9dc4b8370f` showed that 31 of 120 responses reached the 1,024-token output ceiling. It must be reported separately from the original run.

## Purpose

Repeat the same 20 cases, strategies, and three samples with enough output budget to reduce truncation. No cases or declared obligations change. Evaluator 2.2.0 corrects documented lexical false positives and is applied consistently to all completed responses.

## Configuration

- Dataset: `eval/behavioral/pilot-v2.jsonl`
- Dataset SHA-256: `dc12214a370d72a1438e1b66b02a6dbd10ca779c16789b189921192ba192b0c9`
- Model: `gpt-5-mini-2025-08-07`
- Strategies: `full_policy`, `compiler_slice`
- Samples: 3
- Logical trials / maximum calls: 120 / 120
- Concurrency: 6
- Maximum output tokens per call: 2,048
- Retries: 0
- Evaluator: `independent-rules` 2.2.0
- Hard cost ceiling: $0.80
- Run label: `pilot-v2-c6-2048`
- Output: `runs/openai-pilot-v2-c6-2048`

The offline dry run produced run ID `run_c1213fca726df2e1`, an estimated expected cost of $0.49447725, and a no-cache logical maximum of $0.74023725. These values fit under the $0.80 hard ceiling. The expected-cost estimate intentionally uses 50% of the new output cap and is conservative relative to the first run's observed $0.21085255 cost.

## Interpretation rules

1. Report this as a truncation follow-up prompted by the first run, not confirmatory held-out evidence.
2. Do not pool trials across runs as independent samples.
3. Primary paired counts require both responses to complete.
4. Preserve and report any remaining incomplete responses.
5. Separately document the known selector miss on `pilot2-001` and current-information over-selection on `pilot2-017`.
6. Preserve original and derived reports from the first run unchanged.

## Planned command

```bash
pnpm policyc experiment \
  --cases eval/behavioral/pilot-v2.jsonl \
  --strategies full_policy,compiler_slice \
  --provider openai \
  --model gpt-5-mini-2025-08-07 \
  --samples 3 \
  --concurrency 6 \
  --max-output-tokens 2048 \
  --max-calls 120 \
  --max-cost-usd 0.80 \
  --retries 0 \
  --run-label pilot-v2-c6-2048 \
  --output runs/openai-pilot-v2-c6-2048 \
  --dry-run
```
