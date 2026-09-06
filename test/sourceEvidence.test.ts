import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createArtifact, type CompilationStrategy, type CompiledPolicyArtifact } from "../src/compiler/artifact.js";
import { generateCandidateSelections } from "../src/compiler/candidates.js";
import { conservativeState } from "../src/ir/requestState.js";
import { loadPolicies } from "../src/policy/loader.js";
import type { ArtifactContext } from "../src/policy/types.js";

const policies = loadPolicies();
const source = readFileSync("prompts/synthetic-enterprise-agent.md", "utf8");
const email: ArtifactContext = { artifactType: "email", operation: "send", toolsAvailable: ["gmail"], exhaustive: { artifacts: true, tools: true } };

function arm(strategy: CompilationStrategy, request: string, ctx: ArtifactContext = email, frontend?: Parameters<typeof generateCandidateSelections>[3]): CompiledPolicyArtifact {
  const candidate = generateCandidateSelections(policies, request, ctx, frontend, source).find((item) => item.strategy === strategy);
  assert.ok(candidate, strategy);
  return createArtifact({ policies, selection: candidate.selection, request, context: ctx, strategy, sourcePolicyId: "s", sourcePolicyText: source });
}

test("every quote is a verbatim whole sentence of the request at its recorded offsets", () => {
  const request = "I have read the final wording below and it is exactly what I want, and there are no attachments. Send it now to dana@northbridge.example with the subject 'Q3 review'. Body: 'Thursday at 10:00 works. Thanks.'";
  const evidence = arm("source_evidence_bare", request).sourceEvidence;
  assert.ok(evidence);
  assert.ok(evidence.bindings.length > 0);
  for (const binding of evidence.bindings) for (const quote of binding.quotes) {
    assert.equal(request.slice(quote.start, quote.end).trim(), quote.text);
    assert.ok(request.includes(quote.text));
  }
  // The address and the quoted body did not split the sentence.
  const texts = new Set(evidence.bindings.flatMap((binding) => binding.quotes.map((quote) => quote.text)));
  assert.ok([...texts].some((text) => text.includes("dana@northbridge.example with the subject")));
  assert.ok([...texts].some((text) => text.startsWith("Body: 'Thursday at 10:00 works. Thanks.'")));
});

test("the binding carries no verdict: the same request binds identically whatever the frontend reads", () => {
  const request = "Send the note to Pat now, I already approved it.";
  const base = conservativeState(email, "test", "controlled");
  const hashes = (["absent", "present"] as const).map((authorization) =>
    arm("source_evidence_bare", request, email, () => ({ ...base, authorization, externalDisclosure: authorization === "present" ? "safe" : "unknown", operationNamed: true, fields: { recipient: true, body: true, "attachment scope": true } })).compiledPromptHash,
  );
  assert.equal(hashes[0], hashes[1]);
  const serialized = JSON.stringify(arm("source_evidence_bare", request).sourceEvidence);
  for (const forbidden of ["present", "absent", "satisfied", "\"safe\"", "complete", "verdict"]) assert.ok(!serialized.includes(forbidden), `binding leaks a verdict-like token: ${forbidden}`);
});

test("evidence binds per proposed action; a multi-action request keeps each action's sentences apart", () => {
  const request = "Forward the 'Meridian' thread to counsel@firm.example, I signed off on that. Then delete the three drafts in the Outbox, but do not touch anything else.";
  const evidence = arm("source_evidence_bare", request, { artifactType: "email", operation: "forward", toolsAvailable: ["gmail"], exhaustive: { artifacts: true, tools: true } }).sourceEvidence;
  assert.ok(evidence);
  const operations = evidence.actions.map((action) => action.operation);
  assert.ok(operations.includes("forward") && operations.includes("delete"), operations.join(","));
  const forwardId = evidence.actions.find((action) => action.operation === "forward")!.id;
  const deleteId = evidence.actions.find((action) => action.operation === "delete")!.id;
  const confirmForward = evidence.bindings.find((binding) => binding.clause === "destructive.confirm" && binding.action === forwardId);
  const confirmDelete = evidence.bindings.find((binding) => binding.clause === "destructive.confirm" && binding.action === deleteId);
  assert.ok(confirmForward && confirmDelete, "destructive.confirm binds once per governed action");
  // Both actions see the whole request's evidence; what differs is the action each binding is for.
  assert.notEqual(confirmForward.action, confirmDelete.action);
  assert.ok(confirmForward.quotes.some((quote) => quote.text.includes("signed off")));
});

test("frames differ by exactly the neutral application sentence; neither instructs ask, act, or refuse", () => {
  const request = "Send it now to dana@northbridge.example, I confirmed the wording.";
  const bare = arm("source_evidence_bare", request).compiledPrompt;
  const apply = arm("source_evidence_apply", request).compiledPrompt;
  assert.equal(apply, `${bare}\nApply the policy above to the request as stated.\n`);
  // Only lines the frame itself writes; policy lines and quotes are source and request text.
  const frameLines = bare.slice(bare.indexOf("## Evidence bound")).split("\n").filter((line) => !line.startsWith("Policy (") && !/^\s*\[/.test(line));
  for (const directive of [/\bask (?:for|the user)\b/i, /\bdo not (?:send|call|act)\b/i, /\brefuse\b/i, /\bproceed\b/i, /\bgo ahead\b/i]) {
    assert.ok(!frameLines.some((line) => directive.test(line)), `frame text instructs: ${directive}`);
  }
});

test("a clause that governs no proposed action binds nothing, and an any-operation clause binds only when the request speaks to it", () => {
  const rewrite = arm("source_evidence_bare", "Tighten this paragraph and return only the rewritten paragraph: 'The pilot ran six weeks.'", { artifactType: "document", operation: "rewrite", toolsAvailable: ["web"], exhaustive: { artifacts: true, tools: true } }).sourceEvidence;
  assert.ok(rewrite);
  assert.ok(!rewrite.bindings.some((binding) => binding.clause === "calendar.mutations" || binding.clause === "email.state-changes"));
  assert.ok(!rewrite.bindings.some((binding) => binding.clause === "web.verify-first"), "no limit or verification sentence, so the any-operation clause binds nothing");
  assert.ok(rewrite.bindings.some((binding) => binding.clause === "writing.format-and-browse"));
});
