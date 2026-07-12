import type { ArtifactContext, Policy, PolicySelection, PolicySelectionReason, SelectionInput } from "./types.js";
import { computeDependencyClosure } from "./closure.js";
import { detectIntents, matchPolicy } from "./triggers.js";

const severityRank: Record<string, number> = {
  safety: 5,
  privacy: 4,
  tool: 3,
  format: 2,
  style: 1
};

export function selectPolicies(policies: Policy[], selectionInput: SelectionInput): PolicySelection {
  const detectedIntents = detectIntents(selectionInput.input, selectionInput.context);
  const selected: Policy[] = [];
  const reasons: PolicySelectionReason[] = [];

  for (const policy of policies) {
    if (policy.kind === "structural" && !policy.alwaysActive) continue;

    const reasonList: string[] = [];
    if (policy.kind === "universal") reasonList.push("universal policy");
    if (policy.alwaysActive) reasonList.push("always active");
    if (!suppressDirectMatch(policy, detectedIntents, selectionInput.context)) {
      reasonList.push(...matchPolicy(policy, selectionInput, detectedIntents));
    }

    if (policy.id === "do_not_browse_for_simple_rewrites" && detectedIntents.includes("current_info")) {
      continue;
    }

    if (shouldConservativelyRetain(policy, selectionInput.input, detectedIntents, selectionInput.context)) {
      reasonList.push("conservative retention for high-impact risk");
    }

    if (reasonList.length) {
      selected.push(policy);
      reasons.push({ policyId: policy.id, reasons: Array.from(new Set(reasonList)) });
    }
  }

  const closed = computeDependencyClosure(policies, selected, reasons);
  const sortedPolicies = closed.policies.sort(comparePolicies);
  const reasonMap = new Map(closed.reasons.map((reason) => [reason.policyId, reason]));
  return {
    policies: sortedPolicies,
    reasons: sortedPolicies.map((policy) => reasonMap.get(policy.id) ?? { policyId: policy.id, reasons: ["selected"] }),
    detectedIntents,
    dependencyEdges: closed.edges
  };
}

function suppressDirectMatch(
  policy: Policy,
  detectedIntents: string[],
  context?: ArtifactContext | null,
): boolean {
  const currentIntent = detectedIntents.some((intent) => ["current_info", "weather"].includes(intent))
    || context?.operation === "lookup";
  if (["current_info_requires_web", "no_current_facts_from_memory"].includes(policy.id)) {
    return !currentIntent;
  }
  if (["citations_required", "authoritative_sources_preferred"].includes(policy.id)) {
    const webAvailable = [...(context?.toolsAvailable ?? []), ...(context?.toolsRequested ?? [])]
      .some((tool) => tool.toLowerCase() === "web");
    return !currentIntent && !detectedIntents.includes("citation_request") && !webAvailable;
  }
  return false;
}

function comparePolicies(left: Policy, right: Policy): number {
  const priority = right.priority - left.priority;
  if (priority !== 0) return priority;
  const severity = (severityRank[right.severity] ?? 0) - (severityRank[left.severity] ?? 0);
  if (severity !== 0) return severity;
  return left.id.localeCompare(right.id);
}

function shouldConservativelyRetain(policy: Policy, input: string, detectedIntents: string[], context?: ArtifactContext | null): boolean {
  if (policy.kind !== "content_gated") return false;
  if (["current_info_requires_web", "no_current_facts_from_memory"].includes(policy.id)) {
    return detectedIntents.some((intent) => ["current_info", "weather"].includes(intent))
      || context?.operation === "lookup";
  }
  if (!["safety", "privacy", "tool"].includes(policy.severity)) return false;
  if (policy.id === "send_email_requires_explicit_request") return false;
  const artifactTypes = policy.triggers.artifactTypes ?? [];
  if (!context?.artifactType && artifactTypes.length) return false;
  if (context?.artifactType && artifactTypes.length && !artifactTypes.includes(context.artifactType)) return false;
  const artifactFeatures = policy.triggers.artifactFeatures ?? [];
  if (
    artifactFeatures.length &&
    !artifactFeatures.some((feature) => (context?.features ?? []).map((value) => value.toLowerCase()).includes(feature.toLowerCase()))
  ) {
    return false;
  }
  const risks = policy.triggers.risks ?? [];
  if (risks.length && !risks.some((risk) => (context?.riskHints ?? []).map((value) => value.toLowerCase()).includes(risk.toLowerCase()))) {
    return false;
  }
  if (
    detectedIntents.some((intent) => ["rewrite", "draft", "polish"].includes(intent)) &&
    !detectedIntents.some((intent) => ["send_email", "destructive_action", "calendar_mutation"].includes(intent))
  ) {
    return false;
  }

  const lower = input.toLowerCase();
  const highRiskHints = [
    "delete",
    "send",
    "archive",
    "identify",
    "latest",
    "current",
    "today",
    "chart",
    "pdf",
    "spreadsheet"
  ];
  const hasHighRiskSurface = highRiskHints.some((hint) => lower.includes(hint));
  if (!hasHighRiskSurface) return false;

  const policyTriggerText = [
    ...(policy.triggers.keywords ?? []),
    ...(policy.triggers.intents ?? []),
    ...(policy.triggers.artifactTypes ?? []),
    ...(policy.triggers.artifactFeatures ?? []),
    ...(policy.triggers.operations ?? []),
    ...(policy.triggers.domains ?? []),
    ...(policy.triggers.risks ?? [])
  ].join(" ");

  if (!policyTriggerText) return false;
  return highRiskHints.some((hint) => policyTriggerText.toLowerCase().includes(hint) && lower.includes(hint));
}
