import type { ArtifactContext, ArtifactType, OperationTrigger } from "../policy/types.js";
import { baselineAuthorizationReader, insideQuotation, inUserVoice } from "../compiler/authorization.js";
import { evaluateExplicitLimit, isInlineTextRewrite } from "../compiler/limits.js";
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
      for (const field of rule) fields[field.name] = field.recognize?.(input) ?? field.pattern.test(input);
      const missing = Object.entries(fields).filter(([, present]) => !present).map(([field]) => field);
      evidence.push(missing.length ? `fields missing for ${operation}: ${missing.join(", ")}` : `all ${operation} fields stated`);
    } else if (operation) {
      evidence.push(`no field rule for ${context?.artifactType ?? "unknown"} ${operation}`);
    }

    const sourceOperation = resolveOperationFacts(input, operation, false, false);
    const inlineTextRewrite = isInlineTextRewrite(input, context);
    const operationNamed = sourceOperation.operationNamed && !inlineTextRewrite;
    const operationNegated = operationNamed && sourceOperation.operationNegated;
    evidence.push(...sourceOperation.evidence.map((line) => `operation: ${line}`));
    if (inlineTextRewrite) evidence.push("declared rewrite applies to text supplied in the request, not an external artifact");
    else if (operation && !operationNamed) evidence.push(`request does not name the ${operation} action`);
    if (operationNegated) evidence.push(`the ${operation} action is negated in the request`);

    const proved = provesAction({ authorization: authorization.state, operationNamed, operationNegated, fields });
    const deliverable = resolveDeliverable(limit.verdict, proved);
    if (limit.verdict === "ambiguous") evidence.push(proved ? "ambiguous limit resolved by the proved action" : "ambiguous limit unresolved");

    const currentInformation = resolveCurrentInformation(input, context, false);
    const deferredWork = resolveDeferredWork(input, context, false);
    const slideTask = resolveSlideTask(input, context, false);
    const externalDisclosure = resolveExternalDisclosure(input, context, "unknown");
    const requestedSlideReorder = resolveRequestedSlideReorder(input, context, slideTask, false);
    if (currentInformation) evidence.push("current information: request needs a time-sensitive fact");
    if (deferredWork) evidence.push("deferred work: request asks for work or reporting after this turn");
    if (slideTask) evidence.push("slide task: request refers to an existing deck structure");
    if (externalDisclosure === "confidential_external") evidence.push("external disclosure: confidential material would go to an external recipient");
    if (requestedSlideReorder) evidence.push("slide reorder: named existing slides have a stated destination");

    return {
      operation,
      artifactType: context?.artifactType,
      currentInformation,
      deferredWork,
      slideTask,
      externalDisclosure,
      requestedSlideReorder,
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
const CURRENT_TIME = /\b(?:today|tonight|now|currently|at present|this (?:week|month|year))\b/i;
const CURRENT_PREDICATE = /\b(?:rate|price|status|guidance|rule|law|regulation|release|version|score|weather|forecast|stands?|appl(?:y|ies|ying)|effective|in effect)\b/i;
const FUTURE_ACTION = /\b(?:once|when|after|as soon as|if)\b[\s\S]{0,160}\b(?:send|forward|update|edit|delete|archive|move|swap|change|notify|message|let me know)\b/i;
const SLIDE_OPERATIONS = new Set<OperationTrigger>(["summarize", "extract", "analyze", "describe", "edit", "rewrite", "update", "delete"]);
const SLIDE_CONTEXT_VALUES = new Set(["slide", "slides", "slide_deck", "presentation_deck", "ppt", "pptx"]);
const DECK_REFERENCE = /\b(?:the|this|that|my|our|attached|existing|shared|board|sales|pitch)\s+deck\b|\b[\w.-]+\.pptx?\b|\bslides?\s+(?:\d+(?:\s*(?:through|to|-|–)\s*\d+)?|(?:named|called|titled)\b)|\b(?:the|these|those|my|our|attached|existing|shared)(?:\s+[\w'-]+){0,3}\s+slides?\b|\b(?:title|intro(?:duction)?|agenda|appendix)\s+slides?\b/i;
const SLIDE_REORDER_ACTION = /\b(?:move|reorder|rearrange|arrange|resequence|shift|place|put|position|relocate|swap|switch|exchange|make)\b/i;
const SLIDE_REORDER_TARGET_SOURCE = `(?:slides?\\s+(?:\\d+(?:\\s*(?:through|to|-|–)\\s*\\d+)?|(?:named|called|titled)\\b)|(?:the\\s+)?(?:(?!(?:before|after|behind|following|preceding|ahead|to|into|at|it|this|that|them|they)\\b)[\\w'-]+\\s+){0,4}(?:slides?|section|appendix|agenda)|intro(?:duction)?|appendix|agenda)`;
const SLIDE_REORDER_TARGET = new RegExp(`\\b${SLIDE_REORDER_TARGET_SOURCE}\\b`, "i");
const SLIDE_REORDER_DESTINATION = new RegExp(
  `\\b(?:before|after|behind|following|preceding)\\b[\\s\\S]{0,80}\\b${SLIDE_REORDER_TARGET_SOURCE}\\b|\\bahead\\s+of\\b[\\s\\S]{0,80}\\b${SLIDE_REORDER_TARGET_SOURCE}\\b|\\bbetween\\b[\\s\\S]{0,80}\\bslides?\\s+\\d+\\s+and\\s+(?:slides?\\s+)?\\d+\\b|\\b(?:to|into|at)\\s+(?:position|slot|number)\\s+\\d+\\b|\\b(?:as|to)\\s+(?:the\\s+)?(?:first|second|third|last|final)\\s+(?:slides?|section)\\b`,
  "i",
);
const SLIDE_ORDER_RELATION = /\b(?:before|after|behind|following|preceding|ahead\s+of)\b|\bbetween\b|\b(?:to|into|at)\s+(?:position|slot|number)\b|\b(?:as|to)\s+(?:the\s+)?(?:first|second|third|last|final)\b/i;
const VAGUE_DECK_PART = /\b(?:it|this|that|them|they|there|somewhere|anywhere|wherever|whatever|something|anything|content|text|chart|image|table|stuff|things?|some slides?|the slides?|a slide|another slide)\b/i;
const SLIDE_SWAP_ACTION = /^(?:swap|switch|exchange)$/i;
const SLIDE_SWAP_SEPARATOR = /\b(?:with|and|for)\b/i;
const SLIDE_ORDINAL_DESTINATION = /\b(?:the\s+)?(?:first|second|third|last|final)\s+(?:slides?|section)\b/i;
const SLIDE_RELATIONAL_ORDER = /\b(?:should\s+|must\s+)?(?:come|go|sit|appear|land|belong)\s+(?:before|after|behind|ahead\s+of|following|preceding)\b|\b(?:follows?|precedes?)\b/i;
const DIRECT_REORDER_QUESTION = /\b(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:move|reorder|rearrange|arrange|resequence|shift|place|put|position|relocate|swap|switch|exchange|make)\b/i;
const HYPOTHETICAL_REORDER = /(?:^|[.!?;]\s*)\s*(?:what if|if|suppose|assuming|imagine|hypothetically)\b/i;
const SLIDE_LIST_MARKER = /(?:^|[\s,:;])(?:to|as|order(?:ed)?(?:\s+is)?)[\s:]+/i;
const SLIDE_LIST_SEPARATOR = /\s*(?:,|;|\bthen\b|\bfollowed\s+by\b)\s*/i;

/** Applies trusted monotone floors to a frontend's current-information read. */
export function resolveCurrentInformation(input: string, context: ArtifactContext | null | undefined, read: boolean | null): boolean | null {
  const hints = normalizedContextValues(context);
  const intentFloor = detectIntents(input, context).some((intent) => intent === "current_info" || intent === "weather");
  const contextFloor = context?.operation === "lookup" || hints.some((hint) => ["current_info", "current_information", "realtime_information"].includes(hint));
  const languageFloor = CURRENT_TIME.test(input) && CURRENT_PREDICATE.test(input);
  return intentFloor || contextFloor || languageFloor ? true : read;
}

/** Applies the legacy background-work detector and a source-derived future-action floor. */
export function resolveDeferredWork(input: string, context: ArtifactContext | null | undefined, read: boolean | null): boolean | null {
  return detectIntents(input, context).includes("background_work") || FUTURE_ACTION.test(input) ? true : read;
}

/** Caps deck reads to an existing-document operation and applies trusted deck-reference floors. */
export function resolveSlideTask(input: string, context: ArtifactContext | null | undefined, read: boolean | null): boolean | null {
  if (context?.artifactType !== "document" || !context.operation || !SLIDE_OPERATIONS.has(context.operation)) return false;
  const exactContextFloor = [...(context.features ?? []), ...(context.domainHints ?? [])]
    .map(normalizeContextValue)
    .some((value) => SLIDE_CONTEXT_VALUES.has(value));
  return exactContextFloor || DECK_REFERENCE.test(input) ? true : read;
}

/** Caps confidential disclosure reads at the trusted email-send boundary. */
export function resolveExternalDisclosure(
  input: string,
  context: ArtifactContext | null | undefined,
  read: RequestState["externalDisclosure"],
): RequestState["externalDisclosure"] {
  if (context?.artifactType !== "email" || !["send", "forward"].includes(context.operation ?? "")) return "safe";
  const values = normalizedContextValues(context);
  const confidential = values.some((value) => ["confidential", "confidential_content", "private", "private_content", "legal", "legal_text", "privileged", "privileged_content", "unreleased"].includes(value))
    || /\b(?:confidential|private|privileged|legally privileged|trade secret|unreleased)\b/i.test(input);
  const external = values.some((value) => ["external", "external_recipient", "outside_recipient", "third_party", "vendor", "contractor"].includes(value))
    || /\b(?:external|outside|third[- ]party|vendor|contractor)\b/i.test(input);
  const internal = values.some((value) => ["internal_recipient", "recipient_internal", "same_organization_recipient"].includes(value))
    || /\bto\s+(?:(?:our|my)\s+(?:internal\s+)?(?:team|coworker|colleague|employee|staff|distribution list|alias)|[A-Z][\w'’-]+(?:\s*,?\s+(?:who\s+is\s+)?(?:our|my)\s+(?:coworker|colleague|employee)))\b/.test(input);
  if (confidential && external) return "confidential_external";
  if (internal || !confidential) return read === "confidential_external" ? read : "safe";
  return read;
}

/** Caps reorder reads to named existing slides with an explicit destination. */
export function resolveRequestedSlideReorder(
  input: string,
  context: ArtifactContext | null | undefined,
  slideTask: boolean | null,
  read: boolean | null,
): boolean | null {
  if (slideTask !== true || context?.artifactType !== "document" || !["edit", "update"].includes(context.operation ?? "")) return false;
  if (isNonDirectiveReorder(input)) return false;
  const action = SLIDE_REORDER_ACTION.exec(input);
  if (action && reorderActionNegated(input, action)) return false;
  if (!action) return hasRelationalReorder(input) ? true : read;
  const clause = input.slice(action.index + action[0].length);
  if (SLIDE_SWAP_ACTION.test(action[0]) && hasNamedSwap(clause)) return true;
  if (/^make$/i.test(action[0])) {
    const ordinal = SLIDE_ORDINAL_DESTINATION.exec(clause);
    if (ordinal && namedDeckPart(clause.slice(0, ordinal.index))) return true;
  }
  const target = SLIDE_REORDER_TARGET.exec(clause);
  const destination = SLIDE_REORDER_DESTINATION.exec(clause);
  const prefix = input.slice(0, action.index);
  const prefixDestination = SLIDE_REORDER_DESTINATION.test(prefix);
  if (target && ((destination && target.index < destination.index) || prefixDestination)) return true;
  return hasNamedReorderParts(clause, prefix) || hasOrderedSlideList(clause) || hasRelationalReorder(input) ? true : read;
}

function hasNamedReorderParts(clause: string, prefix: string): boolean {
  const relation = SLIDE_ORDER_RELATION.exec(clause);

  if (relation
    && namedDeckPart(clause.slice(0, relation.index))
    && namedDeckPart(clause.slice(relation.index + relation[0].length))) return true;
  const prefixRelation = SLIDE_ORDER_RELATION.exec(prefix);
  return Boolean(
    prefixRelation
      && namedDeckPart(clause)
      && namedDeckPart(prefix.slice(prefixRelation.index + prefixRelation[0].length)),
  );
}
function hasNamedSwap(clause: string): boolean {
  const separator = SLIDE_SWAP_SEPARATOR.exec(clause);
  return Boolean(
    separator
      && namedDeckPart(clause.slice(0, separator.index))
      && namedDeckPart(clause.slice(separator.index + separator[0].length)),
  );
}
function hasRelationalReorder(input: string): boolean {
  const link = SLIDE_RELATIONAL_ORDER.exec(input);
  if (!link) return false;
  const start = Math.max(input.lastIndexOf(".", link.index), input.lastIndexOf(";", link.index), input.lastIndexOf("\n", link.index)) + 1;
  const before = input.slice(start, link.index);
  if (CLAUSE_NEGATED.test(before)) return false;
  return namedDeckPart(before) && namedDeckPart(input.slice(link.index + link[0].length));
}

function isNonDirectiveReorder(input: string): boolean {
  const question = /\?\s*$/.test(input);
  if (question
    && !DIRECT_REORDER_QUESTION.test(input)
    && (SLIDE_REORDER_ACTION.test(input) || SLIDE_RELATIONAL_ORDER.test(input))) return true;
  const reorderClauses = [SLIDE_REORDER_ACTION.exec(input), SLIDE_RELATIONAL_ORDER.exec(input)]
    .filter((match): match is RegExpExecArray => match !== null);
  return HYPOTHETICAL_REORDER.test(input) || reorderClauses.some((match) => !inUserVoice(input, match));
}

function hasOrderedSlideList(clause: string): boolean {
  const marker = SLIDE_LIST_MARKER.exec(clause);
  if (!marker) return false;
  const parts = clause.slice(marker.index + marker[0].length).split(SLIDE_LIST_SEPARATOR).filter(Boolean);
  return parts.length >= 2 && parts.every(namedDeckPart);
}


function namedDeckPart(value: string): boolean {
  const phrase = value.split(/[.;\n]/, 1)[0]?.replace(/^[\s,:-]+|[\s,:-]+$/g, "") ?? "";
  if (!phrase || VAGUE_DECK_PART.test(phrase)) return false;
  if (SLIDE_REORDER_TARGET.test(phrase)) return true;
  const words = phrase.match(/[A-Za-z0-9][\w'-]*/g) ?? [];
  const meaningful = words.filter((word) => !/^(?:the|a|an|these|those|my|our|named|called|titled|slide|slides|section|please|right|immediately)$/i.test(word));
  return meaningful.length >= 1 && meaningful.length <= 8;
}

function reorderActionNegated(input: string, action: RegExpExecArray): boolean {
  const start = Math.max(input.lastIndexOf(".", action.index), input.lastIndexOf(";", action.index), input.lastIndexOf("\n", action.index), input.lastIndexOf(" - ", action.index), input.lastIndexOf(": ", action.index)) + 1;
  const before = input.slice(start, action.index);
  const after = input.slice(action.index + action[0].length);
  return CLAUSE_NEGATED.test(before) || /^\W*(?:no|not|nothing|none|neither)\b/i.test(after);
}

function normalizedContextValues(context: ArtifactContext | null | undefined): string[] {
  return [...(context?.features ?? []), ...(context?.domainHints ?? []), ...(context?.riskHints ?? [])].map(normalizeContextValue);
}

function normalizeContextValue(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
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

// Action words that name each operation. Exported for the evidence binder,
// which uses them to locate proposed actions and never to judge them.
export const ACTION_WORDS: Array<[RegExp, OperationTrigger]> = [
  [/\bsend(?:ing|s)?\b/i, "send"],
  [/\bforward(?:ing|s)?\b/i, "forward"],
  [/\b(?:creat(?:e|ing|es)|add(?:ing|s)?|schedul(?:e|ing|es)|book(?:ing|s)?)\b/i, "create"],
  [/\b(?:reschedul(?:e|ing|es)|mov(?:e|ing|es))\b/i, "reschedule"],
  [/\barchiv(?:e|ing|es)\b/i, "archive"],
  [/\b(?:delet(?:e|ing|es)|remov(?:e|ing|es)|trash(?:ing|es)?|cancel(?:l?ing|s)?|drop(?:ping|s)?|clear(?:ing|s|ed)?|purge(?:s|d|ing)?|wip(?:e|ing|es|ed)|nuk(?:e|ing|es|ed)|eras(?:e|ing|es|ed)|excis(?:e|ing|es|ed)|eliminat(?:e|ing|es|ed)|discard(?:ing|s|ed)?|omit(?:ting|s|ted)?|strip(?:ping|s|ped)?|cut(?:ting|s)?|(?:tak(?:e|es|en|ing)|get(?:s|ting)?|mov(?:e|es|ed|ing)|shift(?:s|ed|ing)?|slid(?:e|es|ing)|push(?:es|ed|ing)?|yank(?:s|ed|ing)?)\b(?:\s+\S+){0,8}\s+(?:out|off|away)|(?:pull(?:s|ed|ing)?|cut(?:s|ting)?|strik(?:e|es|ing)|lift(?:s|ed|ing)?|strip(?:s|ped|ping)?|kick(?:s|ed|ing)?)\b(?:\s+\S+){0,8}\s+(?:out|off|away|from)|leav(?:e|es|ing)\b(?:\s+\S+){0,8}\s+(?:out|off|behind)|get(?:ting|s)?\s+rid\s+of)\b/i, "delete"],
  [/\b(?:edit(?:ing|s)?|updat(?:e|ing|es)|modif(?:y|ying|ies)|chang(?:e|ing|es)|replac(?:e|ing|es)|rewrit(?:e|ing|es)|mov(?:e|ing|es)|reorder(?:ing|s)?|remov(?:e|ing|es)|delet(?:e|ing|es)|set(?:ting|s)?|format(?:ting|s|ted)?|renam(?:e|ing|es)|convert(?:ing|s|ed)?|fill(?:ing|s|ed)?|populat(?:e|ing|es)|sort(?:ing|s|ed)?|deduplicat(?:e|ing|es)|dedup(?:e|ing|es)|bold(?:ing|s|ed)?|italiciz(?:e|ing|es)|freez(?:e|ing|es)|hid(?:e|ing|es)|mak(?:e|ing)|put(?:ting|s)?|turn(?:ing|s|ed)?|appl(?:y|ying|ies)|us(?:e|ing|es)|cop(?:y|ying|ies)|duplicat(?:e|ing|es)|restor(?:e|ing|es))\b/i, "edit"],
  [/\b(?:rewrit(?:e|ing|es)|rephras(?:e|ing|es)|revis(?:e|ing|es)|shorten(?:ing|s)?|tighten(?:ing|s)?|polish(?:ing|es)?)\b/i, "rewrite"],
  [/\b(?:updat(?:e|ing|es)|edit(?:ing|s)?|modif(?:y|ying|ies)|chang(?:e|ing|es)|replac(?:e|ing|es)|mov(?:e|ing|es)|reorder(?:ing|s)?|swapp?(?:ing|s|ed)?|dropp?(?:ing|s|ed)?|insert(?:ing|s|ed)?|add(?:ing|s|ed)?|remov(?:e|ing|es)|delet(?:e|ing|es)|set(?:ting|s)?|format(?:ting|s|ted)?|renam(?:e|ing|es)|convert(?:ing|s|ed)?|fill(?:ing|s|ed)?|populat(?:e|ing|es)|cop(?:y|ying|ies)|sort(?:ing|s|ed)?|deduplicat(?:e|ing|es)|dedup(?:e|ing|es)|bold(?:ing|s|ed)?|italiciz(?:e|ing|es)|freez(?:e|ing|es)|hid(?:e|ing|es)|clear(?:ing|s|ed)?|mak(?:e|ing)|put(?:ting|s)?|turn(?:ing|s|ed)?|appl(?:y|ying|ies)|us(?:e|ing|es)|duplicat(?:e|ing|es)|restor(?:e|ing|es))\b/i, "update"],
  [/\bdraft(?:ing|s)?\b/i, "draft"],
];
const CLAUSE_NEGATED = /\b(?:not|never|no|don't|won't|cannot|can't)\b/i;
const OBJECT_NEGATED = /^\s*(?:(?:absolutely|literally|exactly)\s+)?(?:no|not|nothing|none|neither)\b/i;


function operationMatches(input: string, operation: OperationTrigger): RegExpExecArray[] {
  return ACTION_WORDS
    .filter(([, action]) => action === operation)
    .flatMap(([pattern]) => [...input.matchAll(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`))])
    .sort((left, right) => left.index - right.index);
}


/**
 * Applies source-derived safety caps to semantic operation reads. An extractor
 * may recognize unseen action wording, but it cannot turn a quoted/reported
 * known action or an explicitly negated action into executable intent.
 */
export function resolveOperationFacts(
  input: string,
  operation: OperationTrigger | undefined,
  namedRead: boolean,
  negatedRead: boolean,
): { operationNamed: boolean; operationNegated: boolean; evidence: string[] } {
  if (!operation) return { operationNamed: false, operationNegated: false, evidence: [] };
  const matches = operationMatches(input, operation);
  const voiced = matches.filter((match) => inUserVoice(input, match));
  const onlyReported = matches.length > 0 && voiced.length === 0;
  const negatedMatch = voiced.find((match) => isNegated(input, match, operation));
  return {
    operationNamed: onlyReported ? false : namedRead || voiced.length > 0,
    operationNegated: negatedRead || Boolean(negatedMatch),
    evidence: [
      ...(onlyReported ? [`${operation} appears only in quoted or reported text`] : []),
      ...(negatedMatch && !negatedRead ? [`source text explicitly negates ${operation} at "${negatedMatch[0]}"`] : []),
    ],
  };
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
const ARTIFACT_TARGET = new RegExp(
  `${NAMED_TARGET.source}|\\b(?:the|this|that|my|our)\\s+(?:[\\w'-]+\\s+){0,4}(?:tab|sheet|range|row|column|cell|section|page|slide|paragraph|footnote)\\b|\\b(?:[\\w'-]+\\s+){1,4}(?:tab|sheet|row|column|cell|section|page|slide|paragraph|footnote)\\b|\\b(?:rows?|columns?|cells?|slides?|pages?|footnotes?|sections?|paragraphs?)\\s+(?:\\d+|[A-Z]+\\d*)(?:\\s*(?:through|to|-|–|and)\\s*(?:\\d+|[A-Z]+\\d*))?\\b|\\b[A-Z]{1,3}\\d+(?::[A-Z]{1,3}\\d+)?\\b`,
  "i",
);
const NAMED_TARGET_NOUN = String.raw`thread|email|message|event|meeting|sync|review|standup|walkthrough|call|invite|hold|block|series|label|folder|file|workbook|sheet|model|deck`;
const ARTIFACT_TARGET_NOUN = String.raw`tab|sheet|range|row|column|cell|section|page|slide|paragraph|footnote`;
const DEFINITE_NAMED_TARGET = new RegExp(String.raw`\b(?:the|this|that|my|our)\s+(?:[A-Za-z0-9][\w'’-]*\s+){1,4}(?:${NAMED_TARGET_NOUN})\b`, "i");
const DEFINITE_ARTIFACT_TARGET = new RegExp(String.raw`\b(?:the|this|that|my|our)\s+(?:[A-Za-z0-9][\w'’-]*\s+){1,4}(?:${ARTIFACT_TARGET_NOUN})\b`, "i");
const EXPLICITLY_NAMED_TARGET = new RegExp(
  String.raw`\b(?:${NAMED_TARGET_NOUN}|${ARTIFACT_TARGET_NOUN})\s+(?:named|called|titled|tagged|labeled|labelled)\s+(?:${QUOTED.source}|[A-Za-z0-9][\w'’-]*(?:\s+[A-Za-z0-9][\w'’-]*){0,3})`,
  "i",
);
const NUMBERED_ARTIFACT_TARGET = /\b(?:rows?|columns?|cells?|slides?|pages?|footnotes?|sections?|paragraphs?)\s+(?:\d+|[A-Z]{1,3}\d+)(?:\s*(?:through|to|-|–|and)\s*(?:\d+|[A-Z]{1,3}\d+))?\b|\b[A-Z]{1,3}\d+(?::[A-Z]{1,3}\d+)?\b/i;
const LETTERED_COLUMN_TARGET = /\bcolumns?\s+[A-Z]{1,3}\b/;
const NUMBERED_NAMED_TARGET = /\b\d+\s+(?:messages?|emails?|threads?)\b/i;
const QUOTED_ACTION_TARGET = /\b(?:archive|cancel|create|delete|drop|edit|format|forward|move|remove|replace|reschedule|rewrite|send|update)\s+(?:the\s+)?['"‘“][^'"’”]{2,}['"’”]/i;
const QUOTED_NAMED_TARGET = new RegExp(String.raw`['"‘“][^'"’”]{0,80}\b(?:${NAMED_TARGET_NOUN})['"’”]`, "i");
const QUOTED_PREFIX_TARGET = new RegExp(
  String.raw`\b(?:(?:the|this|that|my|our)\s+)?${QUOTED.source}\s+(?:${NAMED_TARGET_NOUN}|${ARTIFACT_TARGET_NOUN})s?\b`,
  "i",
);
const SCOPED_NAMED_TARGET = new RegExp(
  String.raw`\b(?:messages?|emails?|threads?|events?|meetings?|syncs?|calls?|invites?|holds?|series|labels?|folders?|files?|workbooks?|sheets?|models?|decks?)\s+(?:from|to|with|about|for|in|under|dated|before|after|between|containing|matching|marked|tagged|labeled|labelled|whose|where|that)\s+([^.;,\n]{1,80})`,
  "gi",
);
const VAGUE_SCOPED_VALUE = /^(?:the\s+)?(?:it|this|that|them|those|these|artifact|content|document|file|workbook|sheet|deck|presentation|thing|things|stuff|somewhere|anything|whatever)\b/i;

function hasScopedTarget(input: string, pattern: RegExp): boolean {
  for (const match of input.matchAll(pattern)) {
    if (insideQuotation(input, match.index)) continue;
    const scope = match[1]?.trim() ?? "";
    if (scope && !VAGUE_SCOPED_VALUE.test(scope)) return true;
  }
  return false;
}



function hasUnquotedMatch(input: string, pattern: RegExp): boolean {
  return [...input.matchAll(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`))]
    .some((match) => !insideQuotation(input, match.index));
}

function hasSpecificNamedTarget(input: string): boolean {
  return hasUnquotedMatch(input, NUMBERED_NAMED_TARGET)
    || hasUnquotedMatch(input, QUOTED_NAMED_TARGET)
    || hasUnquotedMatch(input, DEFINITE_NAMED_TARGET)
    || hasUnquotedMatch(input, QUOTED_PREFIX_TARGET)
    || hasScopedTarget(input, SCOPED_NAMED_TARGET)
    || hasUnquotedMatch(input, EXPLICITLY_NAMED_TARGET);
}

function hasSpecificArtifactTarget(input: string): boolean {
  return hasUnquotedMatch(input, NUMBERED_ARTIFACT_TARGET)
    || hasUnquotedMatch(input, LETTERED_COLUMN_TARGET)
    || hasUnquotedMatch(input, QUOTED_ACTION_TARGET)
    || hasUnquotedMatch(input, DEFINITE_ARTIFACT_TARGET)
    || hasUnquotedMatch(input, QUOTED_PREFIX_TARGET)
    || hasUnquotedMatch(input, EXPLICITLY_NAMED_TARGET)
    || hasSpecificNamedTarget(input);
}
const ARTIFACT_CHANGE = new RegExp(
  [
    `\\b(?:replace|change|set|rename|move|reorder|swap|convert|format|trim|shorten|tighten|rewrite|revise|update|edit|fix|correct|insert|add|remove|drop|fill|populate|copy|duplicate|restore|apply|use|turn|put|make)\\b[\\s\\S]{0,120}\\b(?:to|with|for|into|after|before|from|by|as|in|on|using|match|say|read|show|contain)\\b`,
    `\\b(?:remove|delete|drop|clear|bold|italicize|underline|sort|dedupe|deduplicate|freeze|hide|unhide|merge|split|duplicate|restore)\\b[\\s\\S]{0,80}(?:${ARTIFACT_TARGET.source})`,
    `(?:${ARTIFACT_TARGET.source})[\\s\\S]{0,80}\\b(?:remove|delete|drop|clear|bold|italicize|underline|sort|dedupe|deduplicate|freeze|hide|unhide|merge|split|duplicate|restore)\\b`,
    `\\b(?:cell|range|row|column|page|slide|section|paragraph|footnote)s?\\b[\\s\\S]{0,80}(?:=|:=|→|->)\\s*\\S`,
    `\\bmake\\b[\\s\\S]{0,100}\\b(?:bold|italic|underlined|uppercase|lowercase|currency|percent|percentage|date|hidden|visible|a copy|a duplicate|match)\\b`,
    `\\b(?:preserve|leave|keep)\\b[\\s\\S]{0,80}\\b(?:while|and|but|exactly|unchanged)\\b`,
  ].join("|"),
  "i",
);
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

/**
 * A required field: its name, the way people state it (the description an
 * extractor is given, so a model reads the field by the same convention the
 * recognizer encodes), and the recognizer the deterministic frontend applies.
 */
export type RequiredField = { name: string; description: string; pattern: RegExp; recognize?: (input: string) => boolean };
type FieldRule = RequiredField[];

const FIELD = {
  recipient: { name: "recipient", description: "an email address, or a named person the message goes to", pattern: ADDRESS },
  body: { name: "body", description: "what the message must say, quoted or described (\"body should say\", \"saying\")", pattern: BODY },
  attachmentScope: { name: "attachment scope", description: "what is attached or that nothing is; when the body is fully stated and nothing mentions an attachment, the scope is none and counts as stated", pattern: ATTACHMENT_SCOPE },
  contentScope: { name: "thread or content scope", description: "the uniquely named thread, message, or content being forwarded", pattern: NAMED_TARGET, recognize: hasSpecificNamedTarget },
  exactTarget: { name: "exact target", description: "the uniquely named thread, message set, count of messages, label, folder, or event the action applies to; a bare this/that/the target is incomplete", pattern: NAMED_TARGET, recognize: hasSpecificNamedTarget },
  artifactTarget: { name: "artifact target", description: "the numbered, ranged, or uniquely named sheet, tab, range, rows, columns, cells, slides, pages, footnote, paragraph, or section the operation applies to; a bare this/that/the target is incomplete", pattern: ARTIFACT_TARGET, recognize: hasSpecificArtifactTarget },
  change: { name: "change", description: "the exact content or transformation requested, including both the slides being moved and their stated destination for a reorder", pattern: ARTIFACT_CHANGE },
  event: { name: "event", description: "the uniquely named event, meeting, or series", pattern: NAMED_TARGET, recognize: hasSpecificNamedTarget },
  title: { name: "title", description: "the event's unique name", pattern: NAMED_TARGET, recognize: hasSpecificNamedTarget },
  date: { name: "date", description: "the calendar date, or a weekday that fixes one", pattern: DATE },
  time: { name: "time", description: "the clock time or time range", pattern: TIME },
  timeZone: { name: "time zone", description: "a time zone, a city or region that fixes one, or the user's or attendees' own time", pattern: TIME_ZONE },
  attendeeScope: { name: "attendee scope", description: "who attends, including only the user or the same people as before", pattern: ATTENDEE_SCOPE },
  location: { name: "location or conferencing", description: "the venue, a room, in person or virtual, or the conferencing link or bridge", pattern: LOCATION_OR_CONFERENCING },
  recurrenceScope: { name: "recurrence scope", description: "whether it recurs and how, or that it happens once", pattern: RECURRENCE_SCOPE },
  occurrenceScope: { name: "occurrence scope", description: "whether the change applies to one occurrence, several, or the whole series", pattern: OCCURRENCE_SCOPE },
} satisfies Record<string, RequiredField>;

const CALENDAR_CHANGE: FieldRule = [FIELD.event, FIELD.date, FIELD.time, FIELD.timeZone];

/**
 * Fields the source policy requires before an action is executable, keyed by
 * artifact type and operation. Combinations without an entry have no fields,
 * which the confirmation condition treats as undecidable (ask). Recurring
 * calendar artifacts additionally require an occurrence scope.
 */
const REQUIRED_FIELDS: Partial<Record<ArtifactType, Partial<Record<OperationTrigger, FieldRule>>>> = {
  email: {
    send: [FIELD.recipient, FIELD.body, FIELD.attachmentScope],
    forward: [FIELD.recipient, FIELD.contentScope, FIELD.attachmentScope],
    archive: [FIELD.exactTarget],
    delete: [FIELD.exactTarget],
  },
  spreadsheet: {
    edit: [FIELD.artifactTarget, FIELD.change],
    update: [FIELD.artifactTarget, FIELD.change],
    delete: [FIELD.artifactTarget],
  },
  document: {
    edit: [FIELD.artifactTarget, FIELD.change],
    rewrite: [FIELD.artifactTarget, FIELD.change],
    update: [FIELD.artifactTarget, FIELD.change],
    delete: [FIELD.artifactTarget],
  },
  pdf: {
    edit: [FIELD.artifactTarget, FIELD.change],
    update: [FIELD.artifactTarget, FIELD.change],
    delete: [FIELD.artifactTarget],
  },
  calendar_event: {
    // The source policy: "Confirm title, attendees, date, time, time zone, location, conferencing, and recurrence."
    // Location and conferencing are one field here: a virtual meeting's "location" is its bridge.
    create: [FIELD.title, FIELD.date, FIELD.time, FIELD.timeZone, FIELD.attendeeScope, FIELD.location, FIELD.recurrenceScope],
    reschedule: CALENDAR_CHANGE,
    update: CALENDAR_CHANGE,
    delete: CALENDAR_CHANGE,
  },
};

/** Every field the policy can require, with its description: the read contract an extractor is held to. */
export function fieldContract(): Array<{ name: string; description: string }> {
  return Object.values(FIELD).map(({ name, description }) => ({ name, description })).sort((a, b) => a.name.localeCompare(b.name));
}

export type FieldAssignment = {
  artifactType: ArtifactType;
  operation: OperationTrigger;
  requiredFields: string[];
  feature?: string;
};

/** Stable operation-to-field inventory used in the extractor contract identity. */
export function fieldAssignments(): FieldAssignment[] {
  const assignments: FieldAssignment[] = [];
  for (const [artifactType, operations] of Object.entries(REQUIRED_FIELDS) as Array<[ArtifactType, Partial<Record<OperationTrigger, FieldRule>>]>) {
    for (const [operation, rule] of Object.entries(operations) as Array<[OperationTrigger, FieldRule]>) {
      assignments.push({ artifactType, operation, requiredFields: rule.map((field) => field.name) });
      if (artifactType === "calendar_event") {
        assignments.push({ artifactType, operation, feature: "recurring", requiredFields: [...rule, FIELD.occurrenceScope].map((field) => field.name) });
      }
    }
  }
  return assignments.sort((left, right) =>
    `${left.artifactType}:${left.operation}:${left.feature ?? ""}`.localeCompare(`${right.artifactType}:${right.operation}:${right.feature ?? ""}`)
  );
}

/** The fields the policy requires for the declared operation; empty when no rule exists. */
export function requiredFieldRules(context: ArtifactContext | null | undefined): RequiredField[] {
  return context ? (requiredFields(context) ?? []) : [];
}

export function requiredFieldNames(context: ArtifactContext | null | undefined): string[] {
  return requiredFieldRules(context).map((field) => field.name);
}

function requiredFields(context: ArtifactContext): FieldRule | undefined {
  if (!context.artifactType || !context.operation) return undefined;
  const rule = REQUIRED_FIELDS[context.artifactType]?.[context.operation];
  if (!rule) return undefined;
  return context.artifactType === "calendar_event" && context.features?.includes("recurring")
    ? [...rule, FIELD.occurrenceScope]
    : rule;
}
