import type { ArtifactContext, ArtifactType, Obligation, OperationTrigger, Policy, PolicySelection, SpecializationRecord } from "../policy/types.js";
import { selectPolicies } from "../policy/selector.js";
import { baselineAuthorizationReader, guardedReader, type AuthorizationReader } from "./authorization.js";
import { evaluateExplicitLimit, limitInstruction } from "./limits.js";

/** Selection plus specialization: the one path every emitted compiled prompt goes through. */
export function compileSelection(policies: Policy[], input: string, context?: ArtifactContext | null, reader?: AuthorizationReader): PolicySelection {
  return specializeSelection(selectPolicies(policies, { input, context }), input, context, reader);
}

/** The reader used when none is injected: the deterministic baseline, guarded. */
export const defaultAuthorizationReader: AuthorizationReader = guardedReader(baselineAuthorizationReader, "baseline");

/**
 * Specialization runs after selection and dependency closure and before emission.
 * It never adds or removes policies. Two predicates run here:
 *
 *  - `explicit_confirmation`, per node: a policy that declares a specialization
 *    swaps in its authored `satisfied` branch when the user has already supplied
 *    the confirmation state the policy asks for. Unsatisfied leaves the node as
 *    authored, so the conservative branch (ask) is the default.
 *  - `explicit_limit`, per request: when the user has bounded the turn to a text
 *    answer, every selected node's tool obligations (`call_tool`,
 *    `inspect_artifact`) are withheld and a prose limit is emitted instead. An
 *    ambiguous limit also withholds them and asks the model to check before
 *    acting, because the harm avoided here is an unwanted action.
 *
 * Every evaluation is recorded in the selection's `specializations` trace.
 */
export function specializeSelection(selection: PolicySelection, input: string, context?: ArtifactContext | null, reader: AuthorizationReader = defaultAuthorizationReader): PolicySelection {
  const confirmation = evaluateExplicitConfirmation(input, context, reader);
  const limit = evaluateExplicitLimit(input, context);
  const specializations: SpecializationRecord[] = [];
  const toolBound = (obligation: Obligation) => obligation.type === "call_tool" || obligation.type === "inspect_artifact";
  const policies = selection.policies.map((policy) => {
    let next = policy;
    if (policy.specialization) {
      specializations.push({ policyId: policy.id, predicate: policy.specialization.predicate, satisfied: confirmation.satisfied, evidence: confirmation.evidence });
      if (confirmation.satisfied) {
        const branch = policy.specialization.satisfied;
        next = { ...policy, runtimeInstruction: branch.runtimeInstruction, obligations: branch.obligations, prohibitions: branch.prohibitions };
      }
    }
    // Precedence between the two reads. A satisfied confirmation proved the
    // exact action and every required field, so it outranks an *ambiguous*
    // limit; an explicit *limited* verdict (do not call, text only) still wins,
    // because the user said so directly.
    const confirmedHere = Boolean(policy.specialization) && confirmation.satisfied;
    // A policy that requires a tool *and* forbids the alternative (current facts
    // must come from live research, never memory) is mandated by the source
    // prompt and outranks the user's limit; the limit still applies elsewhere.
    const mandated = isMandatedTool(policy);
    const limitApplies = !mandated && (limit.verdict === "limited" || (limit.verdict === "ambiguous" && !confirmedHere));
    if (limitApplies && next.obligations.some(toolBound)) {
      specializations.push({ policyId: policy.id, predicate: "explicit_limit", satisfied: true, evidence: [`verdict ${limit.verdict}`, ...limit.evidence] });
      next = { ...next, obligations: next.obligations.filter((obligation) => !toolBound(obligation)) };
    }
    return next;
  });
  if (limit.verdict !== "none" && !specializations.some((record) => record.predicate === "explicit_limit")) {
    // Recorded even when no node carried a tool obligation, so the trace shows the read.
    specializations.push({ policyId: "*", predicate: "explicit_limit", satisfied: true, evidence: [`verdict ${limit.verdict}`, ...limit.evidence] });
  }
  const anyMandated = selection.policies.some(isMandatedTool);
  const emitLimit = !anyMandated && (limit.verdict === "limited" || (limit.verdict === "ambiguous" && !confirmation.satisfied));
  const tools = (context?.toolsAvailable ?? []).map((tool) => tool.toLowerCase());
  const emitted = emitLimit && limit.verdict !== "none" ? { verdict: limit.verdict, instruction: limitInstruction(limit.verdict, tools) } : undefined;
  return { ...selection, policies, specializations, limit: emitted };
}

type PredicateResult = { satisfied: boolean; evidence: string[] };

function isMandatedTool(policy: Policy): boolean {
  return policy.obligations.some((obligation) => obligation.type === "call_tool")
    && policy.prohibitions.some((prohibition) => prohibition.type === "answer_current_info_from_memory");
}

const CLAUSE_NEGATED = /\b(?:not|never|no|don't|won't|cannot|can't)\b/i;
const OBJECT_NEGATED = /^\W*\w*\W+(?:no|not|nothing|none|neither)\b/i;

const ACTION_WORDS: Array<[RegExp, OperationTrigger]> = [
  [/\bsend(?:ing|s)?\b/i, "send"],
  [/\bforward(?:ing|s)?\b/i, "forward"],
  [/\b(?:creat(?:e|ing|es)|add(?:ing|s)?|schedul(?:e|ing|es)|book(?:ing|s)?)\b/i, "create"],
  [/\b(?:reschedul(?:e|ing|es)|mov(?:e|ing|es))\b/i, "reschedule"],
  [/\barchiv(?:e|ing|es)\b/i, "archive"],
  [/\b(?:delet(?:e|ing|es)|remov(?:e|ing|es)|trash(?:ing|es)?|cancel(?:l?ing|s)?)\b/i, "delete"],
  [/\b(?:updat(?:e|ing|es)|edit(?:ing|s)?|modif(?:y|ying|ies))\b/i, "update"],
  [/\bdraft(?:ing|s)?\b/i, "draft"],
];

// Field recognizers. Compiler 0.8 fit these to held-out-v3's formatting (quoted
// titles, HH:MM, IANA zones); held-out-v4 authors wrote "2 to 3pm central time"
// and "the pricing sync". Each recognizer now accepts the ways people state a
// field; the requirement that every field be stated is unchanged.
const ADDRESS = /[\w.+-]+@[\w-]+\.[\w.-]+|\bto\s+[A-Z][\w'-]+\b/;
const QUOTED = /['"‘“][^'"’”]{2,}['"’”]/;
const NAMED_TARGET = new RegExp(`${QUOTED.source}|\\b(?:the|this|that|my|our)\\s+(?:[\\w'-]+\\s+){0,4}(?:thread|email|message|messages|event|meeting|sync|review|standup|walkthrough|call|invite|hold|block|series|label|folder|file|workbook|sheet|model|deck)\\b|\\b\\d+\\s+(?:messages?|emails?|threads?)\\b`, "i");
const BODY = new RegExp(`${QUOTED.source}|\\b(?:body|text|message|wording)\\s+(?:should\\s+)?(?:say|read|be|is)\\b|\\bsaying\\b|\\bthat says\\b`, "i");
const DATE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b\d{4}-\d{2}-\d{2}\b|\b(?:mon|tues?|wed(?:nes)?|thurs?|fri|sat(?:ur)?|sun)day\b/i;
const TIME = /\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(?:[ap]\.?m\b|o'clock)|\b\d{1,2}\s*(?:to|-|–)\s*\d{1,2}\s*[ap]\.?m\b|\bnoon\b|\bmidnight\b/i;
const TIME_ZONE = /\b(?:[A-Z][a-z]+\/[A-Z][A-Za-z_]+|UTC|GMT|BST|CET|CEST|IST|[PMCE][SD]?T|(?:pacific|mountain|central|eastern|london|uk|new york|chicago|la|berlin|paris|tokyo|sydney|india)\s+time|time ?zone|my time|their time|local time)\b/i;
// A send whose body is stated and which never mentions attachments has, in
// ordinary reading, no attachments; the scope is resolved rather than open.
const ATTACHMENT_SCOPE = /\battach|\bno files?\b|(?=[\s\S]*\b(?:body|text|message|wording)\s+(?:should\s+)?(?:say|read|be|is)\b)(?![\s\S]*\battach)/i;
const ATTENDEE_SCOPE = /\b(?:attendees?|invitees?|invite|for only me|only me|just me|private|same people|same attendees|everyone on the invite|with [A-Z][a-z]+)\b/i;
const RECURRENCE_SCOPE = /\b(?:recurr\w*|one[- ]off|one-time|one time|once|single|series|occurrences?|not repeating|weekly|daily|monthly)\b/i;
const OCCURRENCE_SCOPE = /\b(?:occurrences?|series|all future|only the|this instance|just the|the rest of the|leave the (?:rest|others))\b/i;
const LOCATION_OR_CONFERENCING = /\b(?:location|room|on-?site|in[- ]person|virtual|remote|conferenc\w*|video|zoom|google meet|teams|meet link|dial-?in|call link|bridge|same link|no location)\b/i;

type FieldRule = Array<[string, RegExp]>;
const CALENDAR_CHANGE: FieldRule = [["event", NAMED_TARGET], ["date", DATE], ["time", TIME], ["time zone", TIME_ZONE]];

/**
 * Fields the full policy requires a confirmation to name before an action is
 * executable, keyed by artifact type and operation. Combinations without an
 * entry never satisfy the predicate; recurring calendar artifacts additionally
 * require an occurrence scope for any change.
 */
const REQUIRED_FIELDS: Partial<Record<ArtifactType, Partial<Record<OperationTrigger, FieldRule>>>> = {
  email: {
    send: [["recipient", ADDRESS], ["body", BODY], ["attachment scope", ATTACHMENT_SCOPE]],
    forward: [["recipient", ADDRESS], ["thread or content scope", NAMED_TARGET], ["attachment scope", ATTACHMENT_SCOPE]],
    archive: [["exact thread", NAMED_TARGET]],
    delete: [["exact thread", NAMED_TARGET]],
  },
  calendar_event: {
    // The source policy: "Confirm title, attendees, date, time, time zone, location, conferencing, and recurrence."
    // Location and conferencing are one field here: a virtual meeting's "location" is its bridge.
    create: [["title", NAMED_TARGET], ["date", DATE], ["time", TIME], ["time zone", TIME_ZONE], ["attendee scope", ATTENDEE_SCOPE], ["location or conferencing", LOCATION_OR_CONFERENCING], ["recurrence scope", RECURRENCE_SCOPE]],
    reschedule: CALENDAR_CHANGE,
    update: CALENDAR_CHANGE,
    delete: CALENDAR_CHANGE,
  },
};

function requiredFields(context: ArtifactContext): FieldRule | undefined {
  if (!context.artifactType || !context.operation) return undefined;
  const rule = REQUIRED_FIELDS[context.artifactType]?.[context.operation];
  if (!rule) return undefined;
  return context.artifactType === "calendar_event" && context.features?.includes("recurring")
    ? [...rule, ["occurrence scope", OCCURRENCE_SCOPE]]
    : rule;
}

/**
 * Explicit confirmation holds when the authorization read returns `present`, the
 * request names the same operation the artifact context declares without
 * negating it, and the request supplies every field the full policy requires for
 * that artifact and operation. Reported, conditional, or absent authorization,
 * missing context, mismatched or negated actions, unknown artifact/operation
 * pairs, and missing fields all evaluate to unsatisfied.
 *
 * Compiler 0.8 required all of this inside one sentence beginning "I confirm";
 * held-out v4 showed users spread authorization, action, and fields across
 * sentences and rarely use that verb. The read is now request-level and
 * structural; the field checks are unchanged.
 */
function evaluateExplicitConfirmation(input: string, context: ArtifactContext | null | undefined, reader: AuthorizationReader): PredicateResult {
  const operation = context?.operation;
  if (!context || !operation) return { satisfied: false, evidence: ["no operation in artifact context"] };
  const required = requiredFields(context);
  if (!required) return { satisfied: false, evidence: [`no completeness rule for ${context.artifactType ?? "unknown"} ${operation}`] };
  const read = reader(input);
  if (read.state !== "present") {
    return { satisfied: false, evidence: [`authorization ${read.state}`, ...read.evidence] };
  }
  const confirmed = ACTION_WORDS
    .map(([pattern, action]) => ({ match: pattern.exec(input), action }))
    .filter((item): item is { match: RegExpExecArray; action: OperationTrigger } => item.match !== null)
    .filter((item) => item.action === operation)
    .sort((a, b) => a.match.index - b.match.index)[0];
  if (!confirmed) {
    return { satisfied: false, evidence: [...read.evidence, `request does not name the "${operation}" action`] };
  }
  const actionEnd = confirmed.match.index + confirmed.match[0].length;
  const sentenceStart = Math.max(input.lastIndexOf(".", confirmed.match.index), input.lastIndexOf(";", confirmed.match.index), input.lastIndexOf("\n", confirmed.match.index), input.lastIndexOf(" - ", confirmed.match.index), input.lastIndexOf(": ", confirmed.match.index)) + 1;
  // "archive them, not delete" negates the other verb, not the confirmed action.
  const after = input.slice(actionEnd);
  const contrastive = /^\W*\w*\W*,?\s*(?:not|never|rather than|instead of)\s+(?:\w+ing|\w+e|\w+)\b/i.test(after) && ACTION_WORDS.some(([pattern, action]) => action !== operation && pattern.test(after.slice(0, 40)));
  if (CLAUSE_NEGATED.test(input.slice(sentenceStart, confirmed.match.index)) || (!contrastive && OBJECT_NEGATED.test(after))) {
    return { satisfied: false, evidence: [...read.evidence, `the "${operation}" action is negated in ${quote(input.slice(sentenceStart, actionEnd + 30))}`] };
  }
  const found = required.map(([field, pattern]) => ({ field, match: pattern.exec(input) }));
  const missing = found.filter((item) => !item.match).map((item) => item.field);
  if (missing.length) {
    return { satisfied: false, evidence: [...read.evidence, `missing ${operation} fields: ${missing.join(", ")}`] };
  }
  return {
    satisfied: true,
    evidence: [
      ...read.evidence,
      `request names the "${operation}" action: ${quote(confirmed.match[0])}`,
      ...found.map((item) => `${item.field} ${quote(item.match![0])}`),
    ],
  };
}



function quote(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return `"${trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed}"`;
}
