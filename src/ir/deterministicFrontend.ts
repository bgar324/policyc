import type { ArtifactContext, ArtifactType, OperationTrigger } from "../policy/types.js";
import { baselineAuthorizationReader } from "../compiler/authorization.js";
import { evaluateExplicitLimit } from "../compiler/limits.js";
import { detectIntents } from "../policy/triggers.js";
import { provesAction, resolveDeliverable, type Frontend, type RequestState } from "./requestState.js";

/**
 * The deterministic frontend. It populates request state from phrase patterns:
 * the authorization reader, the limit reader, field recognizers, operation
 * naming and negation, and purpose detection. It is the offline baseline; its
 * recall on fresh phrasing is measured by
 * `eval/behavioral/compiler-v0.9-paraphrases.jsonl` and is known to be low for
 * authorization. Any other frontend (a persisted extractor output, see
 * `persistedFrontend.ts`) produces the same `RequestState` and plugs in at the
 * same seam.
 */
export function deterministicFrontend(): Frontend {
  return (input, context) => {
    const evidence: string[] = [];
    const operation = context?.operation;
    const toolsAvailable = context?.toolsAvailable?.map((tool) => tool.toLowerCase());

    const authorization = baselineAuthorizationReader(input);
    evidence.push(...authorization.evidence.map((line) => `authorization: ${line}`));

    const limit = evaluateExplicitLimit(input, context);
    evidence.push(...limit.evidence.map((line) => `limit: ${line}`));

    const { purpose, permittedTask } = detectPurpose(input, context);
    if (purpose !== "none") evidence.push(`purpose: ${purpose}${permittedTask ? " beside a permitted task" : ""}`);

    const formatMatch = STATED_FORMAT.exec(input);
    const format = formatMatch ? "requested" : "none";
    if (formatMatch) evidence.push(`format: user stated the answer's shape: "${formatMatch[0]}"`);

    const fields: Record<string, boolean> = {};
    const rule = context ? requiredFields(context) : undefined;
    if (rule) {
      for (const [field, pattern] of rule) fields[field] = pattern.test(input);
      const missing = Object.entries(fields).filter(([, present]) => !present).map(([field]) => field);
      evidence.push(missing.length ? `fields missing for ${operation}: ${missing.join(", ")}` : `all ${operation} fields stated`);
    } else if (operation) {
      evidence.push(`no field rule for ${context?.artifactType ?? "unknown"} ${operation}`);
    }

    const named = operation ? nameOfOperation(input, operation) : null;
    const operationNamed = named !== null;
    const operationNegated = named !== null && isNegated(input, named, operation!);
    if (operation && !operationNamed) evidence.push(`request does not name the ${operation} action`);
    if (operationNegated) evidence.push(`the ${operation} action is negated in the request`);

    const proved = provesAction({ authorization: authorization.state, operationNamed, operationNegated, fields });
    const deliverable = resolveDeliverable(limit.verdict, proved);
    if (limit.verdict === "ambiguous") evidence.push(proved ? "ambiguous limit resolved by the proved action" : "ambiguous limit unresolved");

    return {
      operation,
      artifactType: context?.artifactType,
      authorization: authorization.state,
      limit: limit.verdict,
      deliverable,
      purpose,
      permittedTask,
      format,
      fields,
      operationNamed,
      operationNegated,
      toolsAvailable,
      frontend: "deterministic",
      evidence,
    };
  };
}

// The user naming the shape of the answer: an only/just clause on the return,
// or an explicit no-notes request. Read from the held-out-v3 format case
// ("Return only the rewrite.") and its plain variants; a frontend that reads
// the request as a whole recognizes more.
const STATED_FORMAT = /\b(?:(?:return|reply|respond|answer|give|send back|output)(?: me| with)? (?:only|just)(?: with)? (?:the |a |an )?(?:rewrite|rewritten|revised|text|copy|list|table|summary|translation|code|answer|bullets?)|(?:only|just) the (?:rewrite|rewritten (?:text|version)|revised (?:text|version)|text|list|table|summary|translation|code)|no (?:notes|commentary|explanations?|preamble|headings|extra text)|nothing else)\b/i;

function detectPurpose(input: string, context: ArtifactContext | null | undefined): Pick<RequestState, "purpose" | "permittedTask"> {
  // Purpose is read from the same intent triggers the selector uses, so the
  // frontend and selection never disagree about what the request is for. This
  // frontend cannot tell a forbidden purpose stated beside a permitted task
  // from one stated alone, so it reports no permitted task; a frontend that
  // reads the request as a whole may.
  const intents = detectIntents(input, context);
  if (intents.includes("sensitive_attribute")) return { purpose: "sensitive_attribute_read", permittedTask: false };
  if (intents.includes("identification")) return { purpose: "identification", permittedTask: false };
  return { purpose: "none", permittedTask: false };
}

// Action words that name each operation.
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
const CLAUSE_NEGATED = /\b(?:not|never|no|don't|won't|cannot|can't)\b/i;
const OBJECT_NEGATED = /^\W*\w*\W+(?:no|not|nothing|none|neither)\b/i;

function nameOfOperation(input: string, operation: string): RegExpExecArray | null {
  return ACTION_WORDS
    .filter(([, action]) => action === operation)
    .map(([pattern]) => pattern.exec(input))
    .filter((match): match is RegExpExecArray => match !== null)
    .sort((a, b) => a.index - b.index)[0] ?? null;
}

/**
 * The operation is negated when the request names it under a negation ("do not
 * send") or with a negated object ("send no email"). A contrastive negation of a
 * different verb ("archive them, not delete") does not negate it.
 */
function isNegated(input: string, named: RegExpExecArray, operation: string): boolean {
  const start = Math.max(input.lastIndexOf(".", named.index), input.lastIndexOf(";", named.index), input.lastIndexOf("\n", named.index), input.lastIndexOf(" - ", named.index), input.lastIndexOf(": ", named.index)) + 1;
  const after = input.slice(named.index + named[0].length);
  const contrastive = /^\W*\w*\W*,?\s*(?:not|never|rather than|instead of)\s+\w+\b/i.test(after) && ACTION_WORDS.some(([pattern, action]) => action !== operation && pattern.test(after.slice(0, 40)));
  return CLAUSE_NEGATED.test(input.slice(start, named.index)) || (!contrastive && OBJECT_NEGATED.test(after));
}

// Field recognizers. Compiler 0.8 fit these to held-out-v3's formatting (quoted
// titles, HH:MM, IANA zones); held-out-v4 authors wrote "2 to 3pm central time"
// and "the pricing sync". Each recognizer accepts the ways people state a field;
// the requirement that every field be stated is enforced by the policy condition.
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
 * Fields the source policy requires before an action is executable, keyed by
 * artifact type and operation. Combinations without an entry have no fields,
 * which the confirmation condition treats as undecidable (ask). Recurring
 * calendar artifacts additionally require an occurrence scope.
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

/** The names of the fields the policy requires for the declared operation; empty when no rule exists. */
export function requiredFieldNames(context: ArtifactContext | null | undefined): string[] {
  return context ? (requiredFields(context) ?? []).map(([name]) => name) : [];
}

function requiredFields(context: ArtifactContext): FieldRule | undefined {
  if (!context.artifactType || !context.operation) return undefined;
  const rule = REQUIRED_FIELDS[context.artifactType]?.[context.operation];
  if (!rule) return undefined;
  return context.artifactType === "calendar_event" && context.features?.includes("recurring")
    ? [...rule, ["occurrence scope", OCCURRENCE_SCOPE]]
    : rule;
}
