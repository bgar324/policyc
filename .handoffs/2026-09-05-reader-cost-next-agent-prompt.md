# Next-agent prompt: continue PolicyC from the model-reader turning point

Paste everything below the line into the new chat.

---

You are continuing work on PolicyC in `/Users/bg/windsurf/toy projects/policyc` (the git checkout; `/Users/bg/windsurf/policyc` is a stray non-git directory). In discussion documents the project is called Polaris; do not rename anything in the repository.

Invoke the managed skill `policyc-reader-cost-canary` and follow it. Its entry point is `.handoffs/2026-09-05-reader-cost-handoff.md`; read that file completely before doing anything else, then `.handoffs/2026-09-05-turning-point-model-reader.md`, `eval/audits/source-canary-v3.md`, and `eval/audits/noise-floor.md`.

Where we are, in one paragraph. Six compiler versions plateaued at ~75% preservation of the full policy's critical passes against a 95% gate. This session showed two things: the full policy only reproduces its own passes 90.4% of the time (so the gate was above the reference's self-consistency; that number is a baseline, never a ceiling), and a model reading the verbatim source clauses and writing directives (`model_reader_slice`) matched the full policy's passes, took zero unsafe actions to its three, and kept 4 of 6 full-policy passes where the deterministic compiler kept 1. The regex frontend read all four fresh confirmations as absent; the model reader read three. The reader call costs $0.0059 and 24 s per request, so the pipeline is 2× the cost and 4× the latency of the full policy while the prompt is 80% smaller. The plan is to hold the reader contract fixed and attack reader cost with cheaper readers (canary v4).

Before proposing anything: verify the checkout matches the handoff (branch `experiment/source-preserving-slice` at `1fbe449`, ~43 uncommitted paths that must be preserved, `pnpm build && pnpm test:all && pnpm eval` green at 98 TS / 113 Python, catalog at 28 runs / 2,414 trials), back up `runs/` and `.policyc/catalog.sqlite` outside the repo, then stop and present a one-screen plan: the reader candidates, the case count, the keyless dry-run costs you will show me, and what each stage needs authorized.

Rules that stand. Never edit `prompts/policy-reader.md` (it is hashed into the reader contract). Never reopen spent evidence (held-out v1–v5, the 0.10 hidden slices, canary v1/v2/v3). Never commit, push, freeze, or assign a version number; I commit. Every paid call needs a keyless dry run I have seen and my typed `RUN <id>`; I check credit first. Fresh evidence comes from an isolated author and a separate isolated blind grader, rubric locked before any output. Report source-grounded correctness, preservation versus full, and full/full self-consistency side by side, always. What I care about: latency, prompt reduction, cost reduction, and above all critical obligation parity.

Nothing beyond reading, verification, backups, keyless dry runs, offline tests, and presenting the plan is authorized by this prompt.
