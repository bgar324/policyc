# Held-out v2 construction record

## Frozen dataset

- Path: `eval/behavioral/held-out-v2.jsonl`
- Cases: 50
- Dataset version: `held-out-v2`
- Split: `held-out`
- Canonical SHA-256: `1cec47233fd3a88cea343fe9d38634eefabefc6fae486971439cf543606da263`

## Independence procedure

A context-isolated author received only:

1. `prompts/synthetic-enterprise-agent.md`
2. `protocol/behavioral-case.schema.json`

The author was explicitly prohibited from reading compiler code, selectors, structured YAML policies, prior datasets, audits, tests, run outputs, the paper, README, or Git history. The primary agent did not inspect case contents and performed only schema validation, canonical hashing, line counting, and aggregate tool counting.

A second context-isolated reviewer received only the two source files above plus the proposed dataset. It audited all 50 cases for source grounding, validator/tool/rubric consistency, refusal correctness, feasibility, duplication, breadth, answerability within 2,048 output tokens, and absence of real secrets or proprietary data.

The first audit found 10 high-, six medium-, and one low-severity issue. After isolated repairs, the second audit found two medium issues. After the final repairs, the independent audit returned PASS with zero critical, high, medium, or low issues. Machine validation then accepted all 50 cases and produced the hash above.

## Freeze rule

The dataset is frozen at the recorded hash before candidate compilation, dry-run generation, or paid execution. Compiler 0.6 must not be tuned using these cases. Any later correction invalidates this hash and requires a new dataset version; `held-out-v2` must not be rerun and described as fresh held-out evidence after inspecting its model outputs.

The dataset contains 11 cases with built-in web search. Pricing registry v2 accounts for the $0.01 per-search fee, sets `max_tool_calls: 1`, uses low search context, and charges actual search-content tokens reported by the provider. OpenAI documents that low context is not an exact token bound, so the preregistration must disclose possible single-request token-estimate overshoot and use a conservative configured ceiling.
