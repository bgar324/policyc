import type { ArtifactContext, IntentTrigger, Policy, SelectionInput } from "./types.js";

const INTENT_KEYWORDS: Array<{ intent: IntentTrigger; patterns: RegExp[] }> = [
  {
    intent: "current_info",
    patterns: [
      /\blatest\b/i,
      /\bcurrent(?:ly)?\b/i,
      /\brecent(?:ly)?\b/i,
      /\bnew guidance\b/i,
      /\bnews\b/i,
      /\b(?:today|this week|now)\b.{0,40}\b(?:news|weather|forecast|price|score|status|guidance|release|update|ceo)\b/i,
      /\b(?:news|weather|forecast|price|score|status|guidance|release|update|ceo)\b.{0,40}\b(?:today|this week|now)\b/i,
    ],
  },
  { intent: "weather", patterns: [/\bweather\b/i, /\bforecast\b/i, /\btemperature\b/i, /\brain\b/i] },
  { intent: "rewrite", patterns: [/\brewrite\b/i, /\brephrase\b/i, /\bshorten\b/i, /\bmake .* professional\b/i, /\bclean up this (email|text|draft)\b/i] },
  {
    intent: "draft",
    patterns: [
      /^\s*draft\b/i,
      /\b(?:please|can you|could you|would you)\s+draft\b/i,
      /\b(?:want|need) you to draft\b/i,
      /\bdraft\s+(?:me\s+)?(?:an?|the)\b/i,
      /\bwrite (an?|the)\b/i,
      /\bcompose\b/i,
    ],
  },
  { intent: "polish", patterns: [/\bpolish\b/i, /\bimprove\b/i, /\bproofread\b/i, /\bedit this (text|paragraph|message|email|draft|sentence|note)\b/i] },
  { intent: "image_generation", patterns: [/\bgenerate (an? )?image\b/i, /\bcreate (an? )?(picture|image|illustration)\b/i, /\bedit (this|the|an?) image\b/i, /\bmodify (this|the|an?) image\b/i, /\bdraw\b/i] },
  { intent: "image_interpretation", patterns: [/\bwhat does this image show\b/i, /\bdescribe this image\b/i, /\blook at this image\b/i, /\binterpret this image\b/i] },
  { intent: "chart_interpretation", patterns: [/\bchart\b/i, /\bgraph\b/i, /\bplot\b/i, /\baxis\b/i] },
  { intent: "pdf_summary", patterns: [/\bsummarize this pdf\b/i, /\bpdf\b/i] },
  { intent: "spreadsheet_edit", patterns: [/\bspreadsheet\b/i, /\bexcel\b/i, /\bcsv\b/i, /\bformula(s)?\b/i, /\bclean up this sheet\b/i] },
  {
    intent: "destructive_action",
    patterns: [
      /\bdelete\b/i,
      /\bremove all\b/i,
      /\barchive\b/i,
      /\bcancel\b/i,
      /\berase\b/i,
      /\btrash\b/i,
      /\bpublish\b/i,
      /\bdeploy\b/i,
      /\boverwrite\b/i,
      /\breplace (?:the )?(?:whole|entire)\b/i,
      /\bmake (?:it|this|the .{0,30}) live\b/i,
    ],
  },
  { intent: "send_email", patterns: [/\bsend (this )?(email|message)\b/i, /\bemail .* to\b/i, /\bforward\b/i] },
  { intent: "draft_email", patterns: [/\bdraft (an? )?email\b/i, /\bprepare (an? )?email\b/i] },
  {
    intent: "calendar_mutation",
    patterns: [
      /\bcreate .* calendar\b/i,
      /\bschedule\b/i,
      /\bmove .* meeting\b/i,
      /\bdelete .* event\b/i,
      /\bcancel\b.{0,80}\b(?:event|calendar|meeting|sync|appointment|series)\b/i,
    ],
  },
  { intent: "background_work", patterns: [/\bdo this later\b/i, /\bkeep working\b/i, /\bnotify me when\b/i, /\bbackground\b/i, /\bmessage me when\b/i, /\bwork on this for (?:a few|several|\d+) hours\b/i] },
  { intent: "hidden_reasoning", patterns: [/\bchain[- ]of[- ]thought\b/i, /\bhidden reasoning\b/i, /\bshow your reasoning\b/i, /\bverbatim thoughts\b/i] },
  { intent: "citation_request", patterns: [/\bcite\b/i, /\bcitations?\b/i, /\b(?:provide|include|with|list) sources?\b/i, /\breferences?\b/i] },
  { intent: "identification", patterns: [/\bwho is this\b/i, /\bidentify (this|the) person\b/i, /\bname this person\b/i] },
  { intent: "sensitive_attribute", patterns: [/\brace\b/i, /\bethnicity\b/i, /\breligion\b/i, /\bpolitical\b/i, /\bdisability\b/i, /\bsexual orientation\b/i] },
  { intent: "policy_bypass", patterns: [/\bbypass\b/i, /\bignore policy\b/i, /\bpolicy x\b/i, /\bjailbreak\b/i, /\b(?:get around|evade|disable|circumvent)\b.{0,40}\b(?:restrictions?|safeguards?|safety controls?|rules?)\b/i] }
];

export function detectIntents(input: string, context?: ArtifactContext | null): IntentTrigger[] {
  const intents = new Set<IntentTrigger>();
  for (const detector of INTENT_KEYWORDS) {
    if (detector.patterns.some((pattern) => pattern.test(input))) {
      intents.add(detector.intent);
    }
  }

  if (context?.artifactType === "pdf" && context.operation === "summarize") intents.add("pdf_summary");
  if (context?.artifactType === "spreadsheet") intents.add("spreadsheet_edit");
  if (context?.artifactType === "image") intents.add("image_interpretation");
  if (context?.artifactType === "generated_image") intents.add("image_generation");
  if (context?.features?.some((feature) => ["chart", "charts", "graph", "graphs"].includes(feature))) {
    intents.add("chart_interpretation");
  }
  if (context?.operation && ["delete", "archive"].includes(context.operation)) intents.add("destructive_action");
  if (context?.operation === "send") intents.add("send_email");
  if (context?.operation === "draft") intents.add("draft_email");
  if (context?.artifactType === "calendar_event" && ["create", "update", "delete"].includes(context.operation ?? "")) {
    intents.add("calendar_mutation");
  }

  return Array.from(intents).sort();
}

export function matchPolicy(policy: Policy, selectionInput: SelectionInput, detectedIntents: IntentTrigger[]): string[] {
  const reasons: string[] = [];
  const input = selectionInput.input.toLowerCase();
  const context = selectionInput.context ?? undefined;
  const triggers = policy.triggers ?? {};
  const artifactTypes = triggers.artifactTypes ?? [];

  if (context?.artifactType && artifactTypes.length && !artifactTypes.includes(context.artifactType)) {
    return [];
  }

  if (triggers.keywords?.some((keyword) => keywordMatches(input, keyword))) {
    reasons.push("keyword trigger");
  }

  const intentHits = triggers.intents?.filter((intent) => detectedIntents.includes(intent)) ?? [];
  if (intentHits.length) reasons.push(`intent trigger: ${intentHits.join(", ")}`);

  if (
    context?.artifactType &&
    artifactTypes.includes(context.artifactType) &&
    !(triggers.artifactFeatures?.length || triggers.risks?.length)
  ) {
    reasons.push(`artifact type: ${context.artifactType}`);
  }

  const featureHits = intersect(normalizeList(context?.features), normalizeList(triggers.artifactFeatures));
  if (featureHits.length) reasons.push(`artifact feature: ${featureHits.join(", ")}`);

  const toolContext = [...(context?.toolsAvailable ?? []), ...(context?.toolsRequested ?? [])];
  const toolHits = intersect(normalizeList(toolContext), normalizeList(triggers.tools));
  if (toolHits.length) reasons.push(`tool trigger: ${toolHits.join(", ")}`);

  if (
    context?.operation &&
    triggers.operations?.includes(context.operation) &&
    (!artifactTypes.length || artifactTypes.includes(context.artifactType ?? "unknown"))
  ) {
    reasons.push(`operation: ${context.operation}`);
  }

  const domainHits = intersect(normalizeList(context?.domainHints), normalizeList(triggers.domains));
  if (domainHits.length) reasons.push(`domain: ${domainHits.join(", ")}`);

  const riskHits = intersect(normalizeList(context?.riskHints), normalizeList(triggers.risks));
  if (riskHits.length) reasons.push(`risk: ${riskHits.join(", ")}`);

  return reasons;
}

export function obligationToString(obligation: { type: string; value?: string }): string {
  return obligation.value ? `${obligation.type}:${obligation.value}` : obligation.type;
}

export function prohibitionToString(prohibition: { type: string; value?: string }): string {
  return prohibition.value ? `${prohibition.type}:${prohibition.value}` : prohibition.type;
}

function normalizeList(values?: string[]): string[] {
  return (values ?? []).map((value) => value.toLowerCase());
}

function keywordMatches(input: string, keyword: string): boolean {
  const normalized = keyword.toLowerCase();
  if (/[^a-z0-9_]/i.test(normalized)) return input.includes(normalized);
  return new RegExp(`\\b${escapeRegExp(normalized)}\\b`, "i").test(input);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function intersect(left: string[], right: string[]): string[] {
  if (!left.length || !right.length) return [];
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}
