# Turning point: the reader, not the compression, was the plateau

Date: 2026-09-05. Discussion record, written at the owner's request after canary v3 and the noise-floor measurement. It records what changed in the project's understanding, on what evidence, and what it does not yet establish. It is not a freeze, a release, a preregistration, or an authorization to spend. The owner's name for the project in discussion documents is Polaris; the repository, packages, and code remain PolicyC.

Evidence behind this record: [canary v3](../eval/audits/source-canary-v3.md), [noise floor](../eval/audits/noise-floor.md), and the two earlier canaries ([v1](../eval/audits/source-canary-v1.md), [v2](../eval/audits/source-canary-v2.md)). The operational continuation, with the complete learnings ledger and the cheaper-reader canary plan, is [2026-09-05-reader-cost-handoff.md](2026-09-05-reader-cost-handoff.md). Owner decisions are in the [decision record](2026-09-04-source-first-decisions.md).

## 1. What the project believed until today

Six compiler versions (0.5 through 0.10) and five paid held-out studies produced the same shape of result: a request-specific slice of the 16k-token policy, 30 to 50 times smaller, preserved roughly three quarters of the full policy's critical passes and never reached the preregistered 95% gate. The working diagnosis was that compression destroys 20 to 25% of the policy's semantics, and each version tried to win the missing quarter back by teaching a deterministic frontend (regexes over the request, a typed `RequestState`, authored YAML branches) to recognize more of the ways people say "I have authorized this." Each fix fitted to spent cases generalized worst on the next fresh set. The [midway synthesis](0.10-midway-learnings-and-decisions.md) records that history.

## 2. What two measurements changed

### 2a. The 95% gate was set above the reference's own self-consistency

The paired metric conditions on one stochastic full-policy sample passing and asks whether the compiled sample also passes. Nobody had asked how often a second full-policy sample passes. From held-out v5's own blind grades, over 60 fresh cases with three samples each:

$$
P(F_2 \text{ passes} \mid F_1 \text{ passes}) = 0.904, \qquad 13 \text{ of } 60 \text{ cases split.}
$$

A byte-identical copy of the full prompt would have failed the 95% gate on that dataset. Compiler 0.9's 75.9% is 14.5 points under the full policy's self-consistency, not 19 under the gate.

**Correction to the language used earlier this session.** 90.4% is not a mathematical ceiling. It is the full policy's *empirical self-consistency baseline*: the number a copy of the reference would score. A different representation can be more stable, or more correct, than the reference and exceed it. The v3 reader arm points that way directionally (section 2b). Reports must call it the self-consistency baseline or reproducibility reference, and every paired result must show it beside the compiled arm's number, computed from the same samples.

### 2b. A model reading the source clauses recognized what six versions of regex could not

Canary v3 held the clause slice fixed and added one thing: a `gpt-5-mini` call that reads the verbatim source clauses and the request, resolves the policy's own conditions, and writes request-specific directives, which are appended to the slice. No `RequestState`, no regex, no enumerated authorization vocabulary anywhere on the path. Eight fresh cases by an isolated author, an isolated blind grader, the reader prompt frozen before the cases existed, the rubric locked before any output.

| Arm | Pass /16 | Unsafe action /16 | Redundant re-ask /16 | Kept full-policy passes |
|---|---|---|---|---|
| deterministic compiler (`compiler_slice`) | 2 | 0 | 8 | 1/6 |
| raw source slice (`source_clause_slice`) | 5 | 2 | 3 | 2/6 |
| full policy | 6 | 3 | 2 | 2/6 (against its own other sample) |
| **model-reader slice** (`model_reader_slice`) | **6** | **0** | **2** | **4/6** |

On the four fresh confirmation phrasings ("Word for word the text is…", "read it back and it is exactly…", "Carry on…", and the reviewed line in the two-part request), the deterministic frontend read `authorization: absent` on every one, so the compiler took its default ask branch on every sample. The model reader read three of the four as confirmed, emitted "proceed … do not ask for further confirmation," and the answering model acted in every corresponding sample. Its one miss was the safe direction: it turned a fully specified reschedule into a re-ask, as the full policy itself did on one sample.

The reader arm did not merely mimic the full policy. It was safer in this canary: zero unsafe actions where the full policy forwarded privileged counsel material once and overwrote spreadsheet formulas twice.

## 3. The reframed diagnosis

The story was:

> We compressed the policy and destroyed 20 to 25% of its semantics.

The evidence now reads:

> We compressed the policy successfully, then spent six versions trying to reconstruct natural-language policy state with the wrong semantic frontend.

What generalized to fresh phrasing was not a better ontology or a longer regex; it was a model reading the source clauses themselves. That is why it handled phrasings nobody had imagined, and it is why fitting recognizers to spent cases kept failing: the space of ways a person says "I approve" is not enumerable, and every enumeration was tested on the next set of phrasings outside it.

## 4. The architecture to take seriously

$$
(P_x,\ x) \xrightarrow{\ \text{semantic reader}\ } D_x, \qquad (P_x + D_x,\ x) \xrightarrow{\ \text{answer model}\ } y
$$

- $P_x$: the source clause slice, verbatim, selected by trusted structural facts only (the source-first rules in the decision record).
- $D_x$: request-specific directives, written by a model that reads $P_x$ and $x$ and resolves the policy's own conditions. The reader returns `{condition, finding, directive}` triples; only directives are emitted, because canary v2 showed that quoting evidence beside a rule makes the answering model re-verify rather than act.
- $y$: the answer, produced from a prompt about 80% smaller than the full policy.

Implemented on `experiment/source-preserving-slice` as `policyc read` (plan), the Python extraction runtime with `kind: policy-reading` (paid call, same ceilings, confirmation, retention, and resume rules as every other paid call), and `policyc experiment --policy-readings` (rendering). Reader contract id `reader:gpt-5-mini-2025-08-07:800e121af76e`; prompt `prompts/policy-reader.md`. An empty reading renders the bare slice, so the arm degrades to source-first retention, never to a manufactured directive.

## 5. The bottleneck moved to economics

| | Answer cost | Pipeline cost per answer |
|---|---|---|
| full policy (17k input, 71% cache-served) | $0.00462 | $0.00462 |
| model-reader slice | $0.00353 | **$0.00945** (one read per answer); $0.00649 amortized over two samples |

The reader call costs about $0.00592 per case: 3.6k input tokens and 2.9k output tokens, of which roughly 2.0k are reasoning. On `gpt-5-mini` with cached-input pricing at a tenth of fresh input, the full prompt is already cheap per call, and a reader that thinks for two thousand tokens costs more than the whole full-policy answer.

So the problem has inverted:

- Old Polaris: cheap and tiny, behaviorally brittle.
- Model-reader Polaris: behaviorally promising, tiny final prompt, about twice as expensive as doing nothing.

That is a better place for a systems project to be. The question is no longer "how do we enumerate human meaning?" but "how cheaply can the semantic compilation step be performed?" That question has ordinary knobs: a smaller reader model; a non-reasoning reader; distillation; caching readings across samples and repeated requests; batch reading; reading only for semantically conditional clauses; a deterministic fast path with semantic fallback; running the reader only on the ambiguous fraction of traffic. None of these has been tried.

## 6. Reporting rule going forward

Every evaluation reports three quantities side by side, from the same samples:

$$
\text{source-grounded correctness}, \qquad \text{preservation versus full}, \qquad \text{full/full self-consistency}
$$

A compiler at 94% preservation against a reference whose own self-consistency is 90%, while improving source-grounded correctness, is a different result from "failed to reach 95%," and the reports must be able to say so.

## 7. What this does not establish

- Any preservation rate. Eight cases, six full-pass trials, in-run full-versus-full at 2 of 6. The direction is consistent with the hypothesis; the magnitude is unmeasured.
- Generality of the reader prompt. It was written once, before the cases, and not revised, but by the same agent that ran the study and had read the spent v1 and v2 cases. The v3 situations are the policy's condition classes, not v1/v2 phrasings, but the choice of situations is not independent.
- That model-written directives beat authored directives on the same case. The compiler's authored directives never fired on v3, so that comparison has one side empty.
- The economics on any other model. A smaller or non-reasoning reader, or a model without cached-input pricing, changes the arithmetic in either direction and was not tested.

Do not write the negative-result ending. Do not declare victory either. This is the first point in the sequence where the plateau looks explained rather than patched, on eight cases.

## 8. The next research move

Hold the model-reader architecture and the reader contract fixed. Attack reader cost. The next canary: same reader contract, same clause slice, cheaper semantic readers, fresh isolated cases and grader, rubric locked before outputs, all three quantities reported. If the behavioral direction survives while reader cost falls from about $0.0059 toward $0.001 to $0.002 per case, the project's economics change. If it does not survive, the cost of semantic reading is the finding.

Nothing in this section is authorized. Every paid phase needs its own plan and explicit approval of spend.

**Status (2026-09-06).** The move was run as canary v4 ([report](../eval/audits/source-canary-v4.md)): same contract, same slice, eight fresh isolated-author cases, three cheaper readers, a confirmation-ledger gate before any answer run. All three were killed at the gate at a total cost of $0.026: the same model at minimal effort lost the confirmed reading on three of five actions; the nano tier returned nothing at minimal and inverted the reading at low (ask on every confirmed action, proceed on the privileged external send). Under this contract on this provider, the semantic reading that generalized in v3 costs what v3 paid, about $0.006 and 20 s. The knobs still untried are the ones that change the contract or the architecture rather than the model: a shorter response schema, reading the request before the rule, caching readings across samples and repeated requests, a deterministic fast path with semantic fallback, other providers. None is authorized.

**Status (2026-09-06, later).** Contract 2 moved the search offline: a source-first condition index over the whole policy ([audit](../eval/audits/condition-index.md), frozen at `09a26030…`), the reader answering each listed condition once with a verdict. Canary v5 ([report](../eval/audits/source-canary-v5.md), $0.245): the cheap readers still did not read (mini at minimal says yes to everything and asks anyway; nano at low cannot follow the list), and the contract made those failures countable; the reference reader read every confirmed action's specific condition correctly, at higher cost than under contract 1. A single-call arm that lists the conditions inside the answer prompt cut redundant re-asks and cost a third less than the full policy but re-asked on a confirmed archive: a resolution the answering model performs for itself does not act like a directive it is given. The reader's directives downstream under contract 2 are unmeasured. Nothing further is authorized.

## Appendix: the owner's analysis, verbatim

The following text was supplied by the owner on 2026-09-05 (from their discussion with another assistant) with the instruction to include it. It is preserved as written; the correction it makes to the "ceiling" language has been applied throughout the repository's reports.

---

This is a **major result**. It changes my read of the entire six-version plateau.

Two things are now clear.

First, your 95% gate was miscalibrated as a *self-reproducibility* target. On v5, independently sampled full-policy outputs only preserve one another at **90.4%**, with 13/60 cases splitting across samples. So an identical copy of the full prompt would have failed your preregistered 95% gate on that dataset.

One correction to the agent's language: **90.4% is not a mathematical ceiling.** A different policy representation could be more stable or more correct than the full prompt and exceed full-vs-full self-agreement. Your v3 reader arm already illustrates that possibility directionally. It's better called the **empirical self-consistency baseline** or reproducibility reference.

Second—and more important—the v3 canary is the first evidence that really points to the **reader abstraction** as the bottleneck.

The comparison is unusually clean:

* deterministic compiler: **2/16 passes, 8 redundant re-asks**
* raw source slice: **5/16**
* full policy: **6/16, 3 unsafe**
* model-reader slice: **6/16, 0 unsafe, 2 re-asks**

And on the fresh confirmation phrasings, the distinction is stark. The deterministic frontend read **all four as authorization absent**. The model reader understood three of them and emitted explicit proceed directives, after which the answering model acted in every corresponding sample.

That is exactly the experiment we wanted.

It means the story is no longer:

> "We compressed the policy and apparently destroyed 20–25% of its semantics."

It is looking more like:

> **"We compressed the policy successfully, but then spent six versions trying to reconstruct natural-language policy state with the wrong semantic frontend."**

That is a substantially better diagnosis.

### The architecture I would now take seriously

Your model-reader arm is conceptually very simple:

$$
(P_x, x) \xrightarrow{\text{semantic reader}} D_x
$$

then

$$
(P_x + D_x, x) \xrightarrow{\text{answer model}} y
$$

The reader gets the **actual source clauses**, not a hand-designed ontology. It returns request-specific directives. No `RequestState`, no growing list of regexes, no manually enumerated authorization vocabulary. That's why it can generalize to:

> "Word for word the text is…"
> "read it back and it is exactly…"
> "Carry on…"

without you first having to imagine those phrasings.

That's a pretty fundamental architectural shift.

### But now the bottleneck moved to economics

The behavior result is encouraging.

The cost result sucks.

The reader call alone costs about **$0.00592/case**, including ~2,016 reasoning tokens. The resulting pipeline costs **$0.00945 per answer**, versus **$0.00462** for the cached 16k full prompt.

So you have essentially inverted the problem:

**Old Polaris**

> Cheap and tiny, behaviorally brittle.

**Model-reader Polaris**

> Behaviorally promising, tiny final prompt, but ~2× as expensive as doing nothing.

That's actually a good place for a systems project to arrive, because the problem is now much more conventional.

You no longer need to ask:

> "How the hell do I enumerate human meaning?"

Now you can ask:

> **"How cheaply can I perform the semantic compilation step?"**

That's tractable.

Smaller reader model. Non-reasoning reader. Distillation. Caching readings across samples. Batch reading. Reader only for semantically conditional nodes. Deterministic fast-path + semantic fallback. Even running the reader on only the ambiguous fraction of traffic.

Those are normal engineering/research knobs.

### And there is another important result buried here

The model reader didn't merely mimic the full policy. It was **safer in this canary**: zero unsafe actions versus three for full policy.

That opens a stronger objective than "preserve the baseline at all costs."

Your future evaluation should probably report three quantities side by side:

$$
\text{source correctness},\quad
\text{preservation vs full},\quad
\text{full/full self-consistency}
$$

Because if a compiler gets 94% preservation against a baseline whose own reproducibility is 90%, while also improving source-grounded correctness, that's a very different result from "failed to reach 95%."

### So where are you now?

I would **not write the negative-result ending yet**.

You've finally produced evidence supporting a qualitatively different hypothesis, and importantly it was:

* fresh cases,
* prompt frozen before cases,
* independent author,
* independent blind grader,
* no `RequestState`/regex path,
* and the result moved dramatically in the predicted direction.

It's still only eight cases, so don't declare victory.

But I think the next research move is very clear now:

> **Hold the model-reader architecture fixed and attack reader cost.**

The next canary I'd want is **same reader contract, cheaper semantic reader(s)**. If you can retain the behavioral direction while taking reader cost from ~$0.0059 to perhaps <$0.001–0.002, the entire project changes.

And, Benjamin, this is probably the first point in this whole sequence where I'd say the plateau actually looks *explained*, rather than merely patched.
