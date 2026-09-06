# Full-versus-full noise floor

Date: 2026-09-05. Computed from existing graded runs; no provider calls.

## Question

Every paired study since v1 conditions on one stochastic full-policy sample passing and asks whether the compiled sample also passes. If two independent full-policy samples disagree, some of the reported preservation loss is sampling variance, not compiler error. The 95% gate was set without measuring this. The measurement needs no new run: every paired study already drew two or three independent full-policy samples per case and graded each one.

## Method

For each case with $n$ graded full-policy samples, every ordered pair of distinct samples $(i, j)$ contributes one observation to

$$
P(F_2 \text{ passes} \mid F_1 \text{ passes}) = \frac{\#\{(i,j): F_i \text{ pass}, F_j \text{ pass}\}}{\#\{(i,j): F_i \text{ pass}\}}
$$

which is exactly the paired-preservation statistic with the full policy in both slots. Pairwise agreement counts unordered pairs where both samples have the same verdict. A case is *split* when its samples disagree.

Verdicts are the critical-obligation pass recorded by the study's own blind grader; no response was re-read for this report.

## Results

| Set | Cases | Samples per case | $P(F_2 \mid F_1)$ | Pairwise agreement | All pass | Split | All fail | Full pass rate |
|---|---|---|---|---|---|---|---|---|
| held-out v5 (spent), independent blind grades | 60 | 3 (57 cases), fewer on 3 | **0.904** | 0.851 | 38 | 13 | 9 | 0.774 |
| canary v2 (spent), independent blind grades, source-grounded rubric | 8 | 2 | 1.000 | 1.000 | 3 | 0 | 5 | 0.375 |
| canary v1 (spent), author-graded | 4 | 2 | 0.800 | 0.750 | 2 | 1 | 1 | 0.625 |

Source: `runs/compiler-v0.9-held-out-v5/blind/semantic-results.json` (`pairs[].strategies.full_policy.criticalPassed`, 177 pairs), `output/source-slice-offline/canary-v2-grades.jsonl` joined to `canary-v2-answer-map.private.json`, and the v1 grade lock. Computation: `noise_floor()` in the session kernel, reproduced by the script in the appendix.

The v5 number is the one that matters: 60 fresh cases, three samples, a blind independent grader, and the same rubric convention as every paid study. Thirteen of sixty cases split, which is 22% of cases and 15% of sample pairs.

## What it means

- **A copy of the full policy would score 90.4% on v5's own preservation metric.** The 95% gate was above the reference's self-agreement. Compiler 0.9's 75.91% on v5 is therefore 14.5 points below the full policy's self-consistency, not 19 below the gate; that baseline, not the gate, is the honest comparison.
- **90.4% is a baseline, not a ceiling.** It is the full policy's *empirical self-consistency*: how well one sample of the reference reproduces another. A different representation can be more stable, or more correct, than the reference and exceed it; nothing in the metric forbids that. Read it as the number a copy of the reference would score, and as the number an arm has to be compared against, not as a bound on what an arm can reach. (Owner's correction, 2026-09-05.)
- **The v5 bins do not change.** The 33 lost pairs were binned by reading each pair; the 13 split cases account for at most some of the "stochastic 2" bin plus whatever fraction of the other bins landed on a split case. Attributing lost pairs to noise requires the split-case list, which is in the appendix; it was not used to re-bin anything here.
- **Canary v2's 100% self-agreement is 8 cases at $n=2$ and does not contradict v5.** Its rubric was source-grounded (the full policy scored 37.5%), which produces more all-fail cases and fewer splits.
- **Reporting rule from here on.** Every paired result reports the in-run full-versus-full agreement beside the compiled arm's preservation, from the same samples. A study with $s$ samples per case gets this for free; it costs nothing to compute and it puts the arm's number in context.

## v5 split cases

hv5-001, hv5-018, hv5-020, hv5-024, hv5-025, hv5-026, hv5-028, hv5-031, hv5-033, hv5-034, hv5-042, hv5-046, hv5-053. Listed for reproducibility; v5 is spent and these were not reopened.

## Appendix: computation

```python
import itertools, json
pairs = json.load(open("runs/compiler-v0.9-held-out-v5/blind/semantic-results.json"))["pairs"]
rows = {}
for p in pairs:
    rows.setdefault(p["caseId"], {})[p["sampleIndex"]] = p["strategies"]["full_policy"]["criticalPassed"]
num = den = 0
for samples in rows.values():
    ps = [samples[k] for k in sorted(samples)]
    for a, b in itertools.permutations(range(len(ps)), 2):
        if ps[a]:
            den += 1; num += ps[b]
print(num / den)  # 0.9044
```
