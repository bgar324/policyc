import type { ArtifactContext, ArtifactType, OperationTrigger, Policy, PolicySelection, SpecializationRecord } from "../policy/types.js";
import { selectPolicies } from "../policy/selector.js";

/** Selection plus specialization: the one path every emitted compiled prompt goes through. */
export function compileSelection(policies: Policy[], input: string, context?: ArtifactContext | null): PolicySelection {
  return specializeSelection(selectPolicies(policies, { input, context }), input, context);
}

/**
 * Specialization runs after selection and dependency closure and before emission.
 * It never adds or removes policies. For each selected policy that declares a
 * `specialization`, it evaluates the predicate against the request and context,
 * swaps in the authored `satisfied` branch when the predicate holds, and records
 * the evidence. An unsatisfied predicate leaves the policy exactly as authored,
 * so the conservative branch (ask) is the default.
 */
export function specializeSelection(selection: PolicySelection, input: string, context?: ArtifactContext | null): PolicySelection {
  const confirmation = evaluateExplicitConfirmation(input, context);
  const specializations: SpecializationRecord[] = [];
  const policies = selection.policies.map((policy) => {
    if (!policy.specialization) return policy;
    specializations.push({ policyId: policy.id, predicate: policy.specialization.predicate, satisfied: confirmation.satisfied, evidence: confirmation.evidence });
    if (!confirmation.satisfied) return policy;
    const branch = policy.specialization.satisfied;
    return { ...policy, runtimeInstruction: branch.runtimeInstruction, obligations: branch.obligations, prohibitions: branch.prohibitions };
  });
  return { ...selection, policies, specializations };
}

type PredicateResult = { satisfied: boolean; evidence: string[] };

const SENTENCE_END = /(?<!\b(?:[ap]\.m|e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|St))[.!?;]['"’”]?(?=\s+[A-Z(]|\s*$)/;
const CONFIRMATION_VERB = /\b(?:confirm|authorize|approve)\b/i;
const FIRST_PERSON = /\b(?:I|we)\b/i;
// The verb must follow its first-person subject directly, allowing only adverbs
// or a coordinator ("I reviewed it and explicitly confirm"), so "I heard Pat
// confirm" and "I want Pat to confirm" never bind to the user.
const SUBJECT_BOUND = /(?:\b(?:I|we)\b|\band\b|\bthen\b)\s+(?:(?:explicitly|hereby|now|also|formally|fully|again|do)\s+)*$/i;
const REPORTED_SPEECH = /\b(?:said|says|saying|wrote|writes|writing|told|tells|replied|replies|texted|emailed|messaged|noted|notes|reads|heard|hear|according to|quote|quoting)\b/i;
const FUTURE_OR_MODAL = /\b(?:will|would|could|might|may|shall|should|going to|want|wants|need|needs|plan|plans|intend|intends|can)\b/i;
const SENTENCE_CONDITIONAL = /^\s*(?:if|when|once|unless|before|after|until|whether|should|would|could|can|do|don't|didn't|please)\b/i;
const VERB_NEGATED = /\b(?:not|never|don't|do not|didn't|cannot|can't|won't|to)\s+(?:\w+\s+)?$/i;
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

const ADDRESS = /[\w.+-]+@[\w-]+\.[\w.-]+|\bto\s+[A-Z][\w'-]+\b/;
const QUOTED = /['"‘“][^'"’”]{2,}['"’”]/;
const DATE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?\b|\b\d{4}-\d{2}-\d{2}\b/i;
const TIME = /\b\d{1,2}:\d{2}\b/;
const TIME_ZONE = /\b(?:[A-Z][a-z]+\/[A-Z][A-Za-z_]+|UTC|GMT|[PMCE][SD]?T|time ?zone)\b/;
const ATTACHMENT_SCOPE = /\battach/i;
const ATTENDEE_SCOPE = /\b(?:attendees?|invitees?|invite|for only me|only me|just me|private)\b/i;
const RECURRENCE_SCOPE = /\b(?:recurr\w*|one-time|one time|once|single|series|occurrences?)\b/i;
const OCCURRENCE_SCOPE = /\b(?:occurrences?|series|all future|only the|this instance)\b/i;

type FieldRule = Array<[string, RegExp]>;
const CALENDAR_CHANGE: FieldRule = [["event", QUOTED], ["date", DATE], ["time", TIME], ["time zone", TIME_ZONE]];

/**
 * Fields the full policy requires a confirmation to name before an action is
 * executable, keyed by artifact type and operation. Combinations without an
 * entry never satisfy the predicate; recurring calendar artifacts additionally
 * require an occurrence scope for any change.
 */
const REQUIRED_FIELDS: Partial<Record<ArtifactType, Partial<Record<OperationTrigger, FieldRule>>>> = {
  email: {
    send: [["recipient", ADDRESS], ["body", QUOTED], ["attachment scope", ATTACHMENT_SCOPE]],
    forward: [["recipient", ADDRESS], ["thread or content scope", QUOTED], ["attachment scope", ATTACHMENT_SCOPE]],
    archive: [["exact thread", QUOTED]],
    delete: [["exact thread", QUOTED]],
  },
  calendar_event: {
    create: [["title", QUOTED], ["date", DATE], ["time", TIME], ["time zone", TIME_ZONE], ["attendee scope", ATTENDEE_SCOPE], ["recurrence scope", RECURRENCE_SCOPE]],
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
 * Explicit confirmation holds only when one sentence of the request contains a
 * first-person, present-tense confirmation whose clause names the same operation
 * the artifact context declares, without negation, and that same sentence
 * supplies every field the full policy requires for that artifact and operation.
 * Conditionals, questions, negations, missing context, mismatched actions,
 * unknown artifact/operation pairs, and fields stated only elsewhere in the
 * request all evaluate to unsatisfied.
 */
function evaluateExplicitConfirmation(input: string, context?: ArtifactContext | null): PredicateResult {
  const operation = context?.operation;
  if (!context || !operation) return { satisfied: false, evidence: ["no operation in artifact context"] };
  const required = requiredFields(context);
  if (!required) return { satisfied: false, evidence: [`no completeness rule for ${context.artifactType ?? "unknown"} ${operation}`] };
  const evidence: string[] = [];
  for (const text of sentences(input)) {
    const verb = CONFIRMATION_VERB.exec(text);
    if (!verb) continue;
    const before = text.slice(0, verb.index);
    const clause = text.slice(verb.index + verb[0].length);
    const statement = quote(text.slice(verb.index));
    if (!FIRST_PERSON.test(before) || !SUBJECT_BOUND.test(before)) {
      evidence.push(`ignored clause whose confirming subject is not the user ${statement}`);
      continue;
    }
    if (insideQuotation(before) || REPORTED_SPEECH.test(before)) {
      evidence.push(`ignored reported or quoted confirmation ${quote(text)}`);
      continue;
    }
    if (SENTENCE_CONDITIONAL.test(before) || VERB_NEGATED.test(before) || FUTURE_OR_MODAL.test(before)) {
      evidence.push(`ignored conditional, negated, or future clause ${quote(text)}`);
      continue;
    }
    if (clause.trimEnd().endsWith("?")) {
      evidence.push(`ignored question ${statement}`);
      continue;
    }
    const confirmed = ACTION_WORDS
      .map(([pattern, action]) => ({ match: pattern.exec(clause), action }))
      .filter((item): item is { match: RegExpExecArray; action: OperationTrigger } => item.match !== null)
      .sort((a, b) => a.match.index - b.match.index)[0];
    if (!confirmed) {
      evidence.push(`no confirmed action named in ${statement}`);
      continue;
    }
    const actionEnd = confirmed.match.index + confirmed.match[0].length;
    if (CLAUSE_NEGATED.test(clause.slice(0, confirmed.match.index)) || OBJECT_NEGATED.test(clause.slice(actionEnd))) {
      evidence.push(`confirmed action is negated in ${statement}`);
      continue;
    }
    if (confirmed.action !== operation) {
      evidence.push(`confirmed action "${confirmed.action}" does not match operation "${operation}"`);
      continue;
    }
    const found = required.map(([field, pattern]) => ({ field, match: pattern.exec(text) }));
    const missing = found.filter((item) => !item.match).map((item) => item.field);
    if (missing.length) {
      evidence.push(`missing ${operation} fields: ${missing.join(", ")}`);
      continue;
    }
    return {
      satisfied: true,
      evidence: [
        `request states ${statement}`,
        `confirmed action matches operation "${operation}"`,
        ...found.map((item) => `${item.field} ${quote(item.match![0])}`),
      ],
    };
  }
  return { satisfied: false, evidence: evidence.length ? evidence : ["no explicit first-person confirmation in request"] };
}

function sentences(text: string): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length) {
    const end = SENTENCE_END.exec(rest);
    if (!end) {
      parts.push(rest);
      break;
    }
    const cut = end.index + end[0].length;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  return parts;
}

/** An odd number of double quotes before the verb means it sits inside someone else's words. */
function insideQuotation(before: string): boolean {
  return (before.match(/["“”]/g)?.length ?? 0) % 2 === 1;
}

function quote(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return `"${trimmed.length > 160 ? `${trimmed.slice(0, 157)}...` : trimmed}"`;
}
