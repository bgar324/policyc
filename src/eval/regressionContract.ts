import { readFileSync } from "node:fs";
import type { ArtifactContext, Policy, PolicySelection } from "../policy/types.js";
import { generateCandidateSelections } from "../compiler/candidates.js";
import { emitRuntimePrompt } from "../compiler/emitter.js";
import type { Frontend } from "../ir/requestState.js";

/** A development regression case: a spent held-out case with its tool expectations and class tag. */
export type RegressionCase = {
  caseId: string;
  request: string;
  artifactContext: Record<string, unknown> | null;
  tools: Array<{ name: string }>;
  toolExpectation: { required: string[]; forbidden: string[] };
  tags: string[];
  applicableObligations: Array<{ validator: string; severity: string }>;
};

export function loadRegressions(path: string): RegressionCase[] {
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as RegressionCase);
}

export function regressionContext(item: RegressionCase): ArtifactContext {
  return { ...(item.artifactContext ?? {}), toolsAvailable: item.tools.map((tool) => tool.name) } as ArtifactContext;
}

export function compileRegressionCase(policies: Policy[], item: RegressionCase, frontend?: Frontend): { selection: PolicySelection; prompt: string } {
  const context = regressionContext(item);
  const selection = generateCandidateSelections(policies, item.request, context, frontend)[1].selection;
  return { selection, prompt: emitRuntimePrompt(selection, item.request, context) };
}

/**
 * The observable contract every regression case must meet, independent of
 * which case it is: no forbidden tool as a required action, every required
 * tool required without a re-ask, and every ask-side case still asking and
 * naming what to pin down. Returns the violations; empty means the case holds.
 */
export function regressionContractViolations(item: RegressionCase, selection: PolicySelection, prompt: string): string[] {
  const violations: string[] = [];
  for (const tool of item.toolExpectation.forbidden) {
    if (new RegExp(`- (call_tool|inspect_artifact):?${tool}`).test(prompt)) violations.push(`forbidden tool ${tool} is a required action`);
    if (/^- inspect_artifact$/m.test(prompt)) violations.push("bare inspect_artifact invites the forbidden tool");
  }
  for (const tool of item.toolExpectation.required) {
    if (!new RegExp(`- call_tool:${tool}`).test(prompt)) violations.push(`required tool ${tool} is not a required action`);
    if (/ask_confirmation/.test(prompt)) violations.push("required action is gated on re-asking");
  }
  const asks = item.applicableObligations.some((o) => o.validator === "asks_confirmation" && o.severity === "critical");
  if (asks) {
    if (!/ask_confirmation/.test(prompt)) violations.push("ask-side case does not ask");
    if (!/exact (target|action|event|thread|recipient)/i.test(prompt)) violations.push("ask does not name what to pin down");
    if ((selection.evaluations ?? []).some((record) => record.branchId === "already_authorized" && record.truth === "true")) violations.push("ask-side case resolved to execute");
  }
  return violations;
}
