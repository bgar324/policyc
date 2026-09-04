# Held-out v5 blind-grade lock

This record freezes the exhaustive strategy-blind semantic grading of run `run_0129a7e9a2e6730b` before the private answer-to-strategy map is opened. At the time of this lock, the graders and the merging process had not used `answer-map.private.json`; the merged sheet contains only anonymous judgments joined to packet and answer IDs.

## Source integrity

- Bundle `adjudication_b7d366280b2f3950` at `runs/compiler-v0.9-held-out-v5/blind/adjudication-v1/`, built with `policyc-runtime adjudication-bundle --all-complete`: 177 packets (every pair with two completed answers), 354 answers.
- Bundle `packets.json` sha256 `54921c83354b8c54e6b1957206a67a66948b606ea88d1b243f5deee57f883a02`; `manifest.json` sha256 `27d7d7e7c760685ce936baa2b342822661d40125a225c0c8b6490bff528bc0a3`; source blind packets sha256 `8ed37d1dc83e3d65e50961fd7effddf76f36a922faf4f0fbe60057e60c4e2cab`; source report sha256 `309cf1810a085a72a4e7046c75df076cb66df0c25dc986d5dfaf813bf6e1955e`.

## Independent reviewer batches

Three `task` graders, each in its own temporary directory holding only `README.md`, `manifest.json`, the batch's `packets.json`, and its `grades.template.json` filtered by packet ID; forbidden every other path, the web, `hub` messaging, and the shared `eval` kernel. Transcript audit after the fact: no grader opened the run report, trial files, compiler artifacts, or the private maps; every path outside the grader's directory is the harness's spill of the grader's own read output. Graders 2 and 3 resliced their `packets.json` into one packet per line inside their own directories (grader 2 through a helper agent that ran only that command); grader 1 read the file with `tail -c` from its own directory.

| Batch | Cases | Packets | Answers | Reviewer | `grades.completed.json` sha256 | batch `packets.json` sha256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | hv5-001..020 | 60 | 120 | heldout-v5-reviewer-1 | `7f9413e1062a9276ac869d05547fc2def728e58a137e3eb04c99109c139a163b` | `1c5000f966001f4a10545957ab5783fb4ef09bccf5e22c556e9a0a5f8a456743` |
| 2 | hv5-021..040 | 60 | 120 | heldout-v5-reviewer-2 | `bbae0f64d92232ffcb6636d93a43089999eb2d13deff55caa92ae5da66e3d61b` | `d383b9064b6ff5561795c456d737c2e369f3a3c8f98c02baa14569bdf7a877d9` |
| 3 | hv5-041..060 | 57 | 114 | heldout-v5-reviewer-3 | `f5af3e40d3eb41109e4f5bbd536eb4393eb32c28e60592d17ce91b0c562d33e6` | `6737cc4be1ae5aca05f2a0c5be15cf3b8530e23a769e42252ff7d39adcfc508a` |

## Merged sheet

`runs/compiler-v0.9-held-out-v5/blind/adjudication-v1/grades.completed.json`, merged with `jq -n --slurpfile` into one object, sha256 `148855415cb5b2dcc1e8466a6fe5adf453f8ffeab9a2e0e7934db03899f31472`. Verified before this lock: the packet ID set equals the bundle's 177, the answer ID set equals the bundle's 354, zero null verdicts, every verdict in {pass, fail, ungradable}. Anonymous totals: 262 pass, 92 fail, 0 ungradable.

This lock commits only anonymous judgments. Comparative results must be derived after this record is committed by mechanically joining answer IDs to the private strategy map.
