You are picking up PolicyC, a research compiler for LLM policy prompts, at `/Users/bg/windsurf/toy projects/policyc` (the git checkout; ignore `/Users/bg/windsurf/policyc`). The goal is compiler 1.0: the first version to pass the preregistered held-out gate (≥95% conditional critical-obligation preservation, Wilson lower bound ≥90%, ≤3 regressed cases, efficiency intact) on a fresh set, then pass it again.

Read, in this order, before doing anything:

1. `.handoffs/COMPILER-1.0-HANDOFF-v2.md` (the whole thing; section 4 is the rule that decides your result).
2. `eval/audits/held-out-v5-execution.md` (the result you're starting from: 75.91%, 33 regressions in four bins).
3. `eval/audits/compiler-v0.9-freeze.md` (what 0.9 is).
4. Skills `policyc-compiler-iteration`, `policyc-held-out-authoring`, `policyc-paid-experiment`.
5. `.handoffs/COMPILER-1.0-HANDOFF.md` sections 2, 3, 11 only.

Then confirm the repo state (`git status`, `pnpm build && pnpm test:all && pnpm eval` green) and give me a one-screen plan for compiler 0.10 that follows handoff section 5's order and section 4's four rules. The plan must name, for each change, the family statement you'll write before coding and who authors its held-back slice. Do not touch code, packs, or the extractor prompt before I approve the plan.

Non-negotiables, restated so you can't miss them:
- No branch, trigger, field contract, or extractor prompt revision ships without a held-back slice written by an isolated agent that never saw your diff, scored once, then spent. You never read that slice's traces.
- The old blind fixtures (`compiler-v0.9-paraphrases.jsonl`) are spent. New extractor fixtures are written blind, before the prompt revision, by an isolated agent.
- Every paid call follows `policyc-paid-experiment`: clean commit, keyless dry run, my typed go, resume proof, key scan, audit. Credit is about $3.24; the handoff's section 10 has the expected spend. Tell me when a top-up is needed before you need it.
- The gate does not move. Run the full-versus-full noise-floor measurement (handoff 5.6) before v6 so the interpretation can cite it.
- The previous agent fitted a branch to a held-back case it had read and lost 6 pairs on fresh data. You have a fresh context; keep it that way.

Work style: evidence first, terse, every claim grounded in a file or a run. When you finish a phase, report what changed, what proved it, and what it cost.
