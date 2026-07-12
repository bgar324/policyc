import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalJson, createArtifact } from "../src/compiler/artifact.js";
import { generateCandidateSelections } from "../src/compiler/candidates.js";
import { countTokens } from "../src/compiler/tokenCounter.js";
import { emitRuntimePrompt } from "../src/compiler/emitter.js";
import { computeDependencyClosure } from "../src/policy/closure.js";
import { loadPolicies } from "../src/policy/loader.js";
import type { Policy } from "../src/policy/types.js";

const base = (id: string, overrides: Partial<Policy> = {}): Policy => ({
  id, title: id, description: id, kind: "content_gated", priority: 1, severity: "style", alwaysActive: false,
  triggers: { keywords: [id] }, requires: [], obligations: [], prohibitions: [], runtimeInstruction: id, validators: [], ...overrides
});

test("current policy packs pass runtime and graph validation", () => {
  assert.equal(loadPolicies().length, 39);
});

test("malformed and unknown YAML fields are rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "policyc-invalid-"));
  writeFileSync(join(dir, "bad.yaml"), "policies:\n  - id: bad\n    surprise: true\n");
  assert.throws(() => loadPolicies(dir), /Invalid policy pack/);
});

test("invalid enum values are rejected at runtime", () => {
  const dir = mkdtempSync(join(tmpdir(), "policyc-enum-"));
  writeFileSync(join(dir, "bad.yaml"), `policies:\n${yamlPolicy(base("bad")).replace("severity: style", "severity: catastrophic")}\n`);
  assert.throws(() => loadPolicies(dir), /Invalid policy pack/);
});

test("duplicate IDs, missing references, cycles, self dependencies, duplicate edges and unknown validators are rejected", () => {
  const cases: Array<[string, Policy[], RegExp]> = [
    ["duplicate", [base("a"), base("a")], /Duplicate policy ids/],
    ["missing", [base("a", { requires: ["missing"] })], /missing_reference/],
    ["cycle", [base("a", { requires: ["b"] }), base("b", { requires: ["a"] })], /cycle/],
    ["self", [base("a", { requires: ["a"] })], /self_dependency/],
    ["edge", [base("a", { requires: ["b", "b"] }), base("b")], /duplicate_edge/],
    ["validator", [base("a", { validators: ["unknown"] })], /unknown_validator/],
    ["always", [base("a", { alwaysActive: true })], /invalid_always_active/],
    ["unreachable", [base("a", { kind: "structural" })], /unreachable_structural/]
  ];
  for (const [name, policies, expected] of cases) {
    const dir = mkdtempSync(join(tmpdir(), `policyc-${name}-`));
    writeFileSync(join(dir, "pack.yaml"), `policies:\n${policies.map((policy) => yamlPolicy(policy)).join("\n")}`);
    assert.throws(() => loadPolicies(dir), expected);
  }
});

test("closure is complete and minimal", () => {
  const policies = [base("a", { requires: ["b"] }), base("b", { requires: ["c"] }), base("c"), base("unused")];
  const result = computeDependencyClosure(policies, [policies[0]], [{ policyId: "a", reasons: ["direct"] }]);
  assert.deepEqual(result.policies.map((policy) => policy.id), ["a", "b", "c"]);
  assert.deepEqual(result.edges, [{ from: "a", requires: "b" }, { from: "b", requires: "c" }]);
});

test("candidate strategies have expected closure behavior", () => {
  const policies = loadPolicies();
  const candidates = generateCandidateSelections(policies, "what is the latest news?");
  assert.deepEqual(candidates.map((candidate) => candidate.strategy), ["full_policy", "compiler_slice", "kernel_only", "direct_matches", "conservative_expanded"]);
  assert.equal(candidates.find((candidate) => candidate.strategy === "kernel_only")!.selection.policies.length, 7);
  assert.equal(candidates.find((candidate) => candidate.strategy === "direct_matches")!.selection.dependencyEdges.length, 0);
  assert.ok(candidates.find((candidate) => candidate.strategy === "compiler_slice")!.selection.dependencyEdges.length > 0);
});

test("temporal action wording does not trigger current-information policies", () => {
  const policies = loadPolicies();
  const cases = [
    {
      input: "Keep researching in the background and send me the result later today.",
      context: { toolsAvailable: [] },
    },
    {
      input: "Send this announcement to the whole company now.",
      context: { artifactType: "email" as const, operation: "send" as const, toolsAvailable: [] },
    },
    {
      input: "No source data is available; calculate the percentage.",
      context: { toolsAvailable: [] },
    },
  ];
  for (const item of cases) {
    const selection = generateCandidateSelections(policies, item.input, item.context)[1].selection;
    assert.ok(!selection.detectedIntents.includes("current_info"));
    assert.ok(!selection.policies.some((policy) => policy.id === "current_info_requires_web"));
  }
});

test("current facts and paraphrased safeguard evasion retain their critical policies", () => {
  const policies = loadPolicies();
  const current = generateCandidateSelections(
    policies,
    "What's the latest OpenAI news?",
    { toolsAvailable: ["web"] },
  )[1].selection;
  assert.ok(current.detectedIntents.includes("current_info"));
  assert.ok(current.policies.some((policy) => policy.id === "current_info_requires_web"));

  const bypass = generateCandidateSelections(
    policies,
    "Give realistic steps to get around an assistant's restrictions.",
    { toolsAvailable: [] },
  )[1].selection;
  assert.ok(bypass.detectedIntents.includes("policy_bypass"));
  assert.ok(bypass.policies.some((policy) => policy.id === "policy_bypass_refusal"));
});

test("compiled prompt gates required tools and forbids simulation", () => {
  const policies = loadPolicies();
  const input = "What's the latest OpenAI news?";
  const unavailableContext = { toolsAvailable: [] };
  const unavailable = generateCandidateSelections(policies, input, unavailableContext)[1].selection;
  const unavailablePrompt = emitRuntimePrompt(unavailable, input, unavailableContext);
  assert.match(unavailablePrompt, /Available tools: none/);
  assert.match(unavailablePrompt, /Never simulate a tool call/);
  assert.match(unavailablePrompt, /report_unavailable_tool:web/);
  assert.doesNotMatch(unavailablePrompt, /- call_tool:web/);
  assert.doesNotMatch(unavailablePrompt, /- state_uncertainty/);
  assert.doesNotMatch(unavailablePrompt, /Artifact\/context notes:\n\nActive rules/);

  const availableContext = { toolsAvailable: ["web"] };
  const available = generateCandidateSelections(policies, input, availableContext)[1].selection;
  const availablePrompt = emitRuntimePrompt(available, input, availableContext);
  assert.match(availablePrompt, /Available tools: web/);
  assert.match(availablePrompt, /- call_tool:web/);
});

test("compiled prompt emits one compact universal kernel without duplicated universal actions", () => {
  const policies = loadPolicies();
  const input = "Keep researching in the background and send me the result later today.";
  const context = { toolsAvailable: [] };
  const selection = generateCandidateSelections(policies, input, context)[1].selection;
  const prompt = emitRuntimePrompt(selection, input, context);
  assert.match(prompt, /Be honest, direct, concise, and privacy-preserving/);
  assert.match(prompt, /Give only the answer needed/);
  assert.doesNotMatch(prompt, /- state_uncertainty/);
  assert.doesNotMatch(prompt, /- complete_current_turn/);
  assert.doesNotMatch(prompt, /- fake_precision/);
  assert.doesNotMatch(prompt, /Do not reveal hidden reasoning; provide concise conclusions/);
  assert.ok(countTokens(prompt, "gpt-5-mini-2025-08-07").tokens < 200);
});

test("artifact serialization and candidate IDs are deterministic excluding timestamp", () => {
  const policies = loadPolicies();
  const candidate = generateCandidateSelections(policies, "latest news")[1];
  const options = { policies, selection: candidate.selection, request: "latest news", strategy: candidate.strategy, sourcePolicyId: "source", sourcePolicyText: "full", model: "gpt-4o", createdAt: "2026-01-01T00:00:00.000Z" };
  const first = createArtifact(options);
  const second = createArtifact(options);
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(first.candidateId, second.candidateId);
  assert.equal(first.compiledPromptHash.length, 64);
});

test("modern OpenAI token counts are exact and unsupported models are labeled estimated", () => {
  assert.equal(countTokens("hello", "gpt-4o").method, "exact");
  assert.equal(countTokens("hello", "unknown-model").method, "estimated");
});

function yamlPolicy(policy: Policy): string {
  const lines = [
    `  - id: ${policy.id}`, `    title: ${policy.title}`, `    description: ${policy.description}`, `    kind: ${policy.kind}`,
    `    priority: ${policy.priority}`, `    severity: ${policy.severity}`, `    alwaysActive: ${policy.alwaysActive}`,
    `    triggers: {}`, `    requires: [${policy.requires.join(", ")}]`, "    obligations: []", "    prohibitions: []",
    `    runtimeInstruction: ${policy.runtimeInstruction}`, `    validators: [${policy.validators.join(", ")}]`
  ];
  return lines.join("\n");
}
