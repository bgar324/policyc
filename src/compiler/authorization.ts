/**
 * Authorization read. Compiler 0.8 matched one surface form ("I confirm ...")
 * and missed every fresh phrasing in held-out v4. This reads the request for the
 * structure of an authorization act instead, and returns a typed state that the
 * deterministic field-completeness checks in `specialize.ts` then verify.
 *
 * An authorization act has up to three parts, any of which may carry it:
 *  - a settled-state clause: something is already decided, approved, reviewed, or
 *    cleared ("priya already signed off", "everyone's confirmed", "I've been
 *    through the list myself", "I confirm");
 *  - a no-re-ask clause: the user asks not to be checked with again ("no need to
 *    loop back", "I don't need another readback", "no need to check back",
 *    "don't ask me anything");
 *  - a go clause: an unconditional imperative to proceed ("go ahead", "send it,
 *    don't draft it", "create it now").
 *
 * States:
 *  - `present`: the user, in their own voice, asserts the action is authorized
 *    now. Requires a settled or go clause in first person or imperative, and no
 *    disqualifier.
 *  - `reported`: authorization is attributed to someone else without the user
 *    adopting it ("Pat said it's fine", quoted text).
 *  - `conditional`: authorization hinges on a future or hypothetical event.
 *  - `absent`: nothing recognizable.
 *
 * Fail-closed: anything other than `present` leaves the ask in place. A `present`
 * read still needs every required field in the request before it can execute;
 * that check is not this module's job.
 */

import { z } from "zod";

export const authorizationReadSchema = z.object({
  state: z.enum(["present", "reported", "conditional", "absent"]),
  evidence: z.array(z.string()).min(1),
  statement: z.string().optional(),
}).strict();

export type AuthorizationState = z.infer<typeof authorizationReadSchema>["state"];
export type AuthorizationRead = z.infer<typeof authorizationReadSchema>;

/**
 * The boundary the specialization stage calls. Any reader (this deterministic
 * baseline, a fixture-backed reader in tests, or a compile-time model-assisted
 * extractor once one is authorized) must return a schema-valid read. Readers are
 * injected; the stage never calls a provider itself.
 */
export type AuthorizationReader = (input: string) => AuthorizationRead;

const SETTLED_FIRST_PERSON = /\b(?:(?:I|we|ive|i've|we've|i’ve|we’ve)\s+(?:(?:explicitly|hereby|now|also|formally|fully|again|do|already|myself)\s+)*(?:confirm|authorize|approve|consent|sign(?:ed|ing)? off|give (?:my|our) (?:approval|authorization|consent|sign[- ]?off)|have (?:already )?(?:reviewed|checked|looked (?:it|this|them) over|been through|cleared|approved|signed off)|(?:'ve|’ve) (?:already )?(?:reviewed|checked|looked (?:it|this|them) over|been through|cleared|approved|signed off)|been through|reviewed|checked|cleared)|(?:I|we)(?:'m|’m| am| are|'re|’re)\s+(?:fine|good|okay|ok)\s+with|you have my (?:approval|authorization|sign[- ]?off|green light)|this has my (?:approval|authorization|sign[- ]?off|green light)|consider (?:this|it) (?:(?:my|our) (?:approval|authorization|sign[- ]?off|green light)|(?:approved|authorized|confirmed|signed off)))\b/i;
const SETTLED_FIRST_PERSON_PAST = /\b(?:I|we)\s+(?:(?:explicitly|hereby|now|also|formally|fully|again|already|personally)\s+)*(?:confirmed|authorized|approved|consented|accepted|acknowledged|reviewed|checked|verified|validated|cleared)\b/i;
const SETTLED_IMPERSONAL = /\b(?:(?:this|that|it|the (?:change|edit|update|deletion|removal))\s+(?:is|was|has been)\s+(?:already\s+)?(?:approved|authorized|confirmed|cleared|signed off)|(?:approval|authorization|clearance|sign[- ]?off)\s+(?:is|was|has been)\s+(?:final|complete|given|granted)|(?:already\s+)?(?:approved|authorized|confirmed|cleared)\s+(?:and\s+)?(?:ready|final|complete))\b/i;
const THIRD_PARTY_SUBJECT = String.raw`(?!(?:I|we|you)\b)(?:(?:the|our|my)\s+)?(?:[A-Za-z][\w'’-]*\s+){0,4}(?:[A-Za-z][\w'’-]*|everyone|everybody)`;
const SETTLED_THIRD_PARTY = new RegExp(
  String.raw`\b${THIRD_PARTY_SUBJECT}\s+` +
    String.raw`(?:(?:(?:has|have|had|already|also|all|formally|finally)\s+){0,4}(?:signed\s+(?:(?:this|it|that|the\s+\w+)\s+)?off|approved|authorized|confirmed|cleared|okayed|ok'd|greenlit|reviewed|accepted|agreed|consented)|(?:gave|provided|issued|granted)\s+(?:(?:their|its|the|formal|final)\s+)?(?:approval|authorization|consent|clearance|sign[- ]?off|go-ahead|green light)|(?:is|are|was|were)\s+(?:fine|okay|ok|on board)(?:\s+with\s+(?:this|it|that|the\s+\w+))?)\b`,
  "i",
);
const NO_REASK = /\b(?:no need (?:for (?:another|further) (?:confirmation|check|review|pass|approval|sign[- ]?off)|to (?:loop back|check back|check in|check with me|come back to me|ask(?: me)?(?: again)?|confirm(?: with me)?(?: again)?|re-?confirm|double[- ]check|review(?: with me)?(?: again)?|run (?:it|this|that|them)?\s*(?:past|by) me))|(?:i |you )?(?:don'?t|do not) need (?:to )?(?:ask(?: me)?(?: again)?|check(?: back| in| with me)?(?: again)?|confirm(?: with me)?(?: again)?|another|a) (?:readback|confirmation|check|review|pass|approval|sign[- ]?off)?|(?:you )?(?:don'?t|do not) have to (?:ask|check|confirm|review|run|clear)(?: (?:it|this|that|them|the change))?(?: (?:past|by|with) me)?(?: again)?|(?:don'?t|do not) (?:bother )?(?:ask(?: me)?|check(?: with me)?|confirm(?: with me)?|review(?: with me)?)(?: again)?|(?:don'?t|do not) ask me anything|no (?:readback|second pass|further review)|skip (?:the )?(?:confirmation|readback|check|review|asking|sign[- ]?off)|without (?:asking|checking|confirming|reviewing) (?:me )?(?:again|first)|without (?:another|further) (?:confirmation|check|review|pass|approval|sign[- ]?off))\b/i;
const GO = /\b(?:go ahead(?: and)?|go for it|proceed|continue(?: with (?:it|this|that|the change))?|move forward|carry on|carry it out|make (?:the change|it happen)|just do it|do (?:it|this|that|so) now|take care of (?:it|this|that)|put (?:it|this|that) through|(?:apply|execute|implement|complete|finish|perform|effect|action|process) (?:it|this|that|the (?:change|edit|update|deletion|removal))|send it now|create it now|send it,? (?:don'?t|do not) draft|(?:send|create|archive|move|reschedule|forward|update|edit|delete|remove) (?:it|them|this|that) now)\b|(?:^|[.!?;]\s+)(?:please\s+)?(?:delete|remove|drop|take|pull|cut|strip|omit|discard|purge|erase)\b/i;
// Conditional on authorization itself ("if legal approves", "once Pat confirms"),
// not on content ("if you mention her, say ..."): the verb list is authorization
// verbs only, and the subject of the conditional must not be the assistant.
const CONDITIONAL = /\b(?:if|once|unless|when|assuming|provided that|as long as)\s+(?!you\b|the assistant\b)[^.;]{0,50}\b(?:confirms?|approves?|signs? off|agrees?|okays?|clears?|gets? back|gives? the (?:go|ok|okay|green light))\b|\b(?:will|would|could|might|going to)\s+(?:confirm|approve|sign off|authorize)\b|\bafter (?:i|we) (?:confirm|approve|check)\b/i;
const REPORTED_VERB = /\b(?:said|says|wrote|writes|told|replied|texted|emailed|messaged|heard|quoted|claims?|claimed|mentions?|mentioned|asks?|asked|requests?|requested|recommends?|recommended|suggests?|suggested|proposes?|proposed|instructs?|instructed|directs?|directed|wants?|wanted)\b/gi;
const ALWAYS_REPORTED_FRAME = /\b(?:according to|quote|quoting|i\s+(?:was|am|have been)\s+(?:told|asked|instructed|directed)|we\s+(?:were|are|have been)\s+(?:told|asked|instructed|directed))\b/i;
const NEGATED_SETTLED = /\b(?:not|never|haven'?t|hasn'?t|didn'?t|don'?t|do not|no one|nobody)\s+(?:\w+\s+){0,2}(?:confirm|approv|sign|clear|review|check|okay|ok'd)\w*/i;
const QUESTION = /\?\s*$/;

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}_]/u.test(value);
}

/** True when `index` is inside straight or typographic single/double quotes. */
export function insideQuotation(text: string, index: number): boolean {
  let straightDouble = false;
  let straightSingle = false;
  let smartDouble = false;
  let smartSingle = false;
  for (let cursor = 0; cursor < index; cursor += 1) {
    const character = text[cursor];
    if (character === '"') straightDouble = !straightDouble;
    else if (character === "“") smartDouble = true;
    else if (character === "”") smartDouble = false;
    else if (character === "‘") smartSingle = true;
    else if (character === "’") {
      if (!isWordCharacter(text[cursor - 1]) || !isWordCharacter(text[cursor + 1])) smartSingle = false;
    } else if (character === "'") {
      if (isWordCharacter(text[cursor - 1]) && isWordCharacter(text[cursor + 1])) continue;
      if (straightSingle || (!isWordCharacter(text[cursor - 1]) && !/\s/.test(text[cursor + 1] ?? ""))) {
        straightSingle = !straightSingle;
      }
    }
  }
  return straightDouble || straightSingle || smartDouble || smartSingle;
}

function hasReportedFrame(prefix: string): boolean {
  if (ALWAYS_REPORTED_FRAME.test(prefix)) return true;
  for (const verb of prefix.matchAll(REPORTED_VERB)) {
    const beforeVerb = prefix.slice(Math.max(0, verb.index - 48), verb.index);
    const afterVerb = prefix.slice(verb.index + verb[0].length);
    const firstPersonWant = /^wants?$/i.test(verb[0])
      && /\b(?:i|we)\b(?:\s+\w+){0,3}\s*$/i.test(beforeVerb)
      && /^[\s,;:—–-]*$/.test(afterVerb);
    if (firstPersonWant) continue;
    return true;
  }
  return false;
}

function hasExplicitDashAdoption(text: string, match: RegExpExecArray, clauseStart: number): boolean {
  const prefix = text.slice(clauseStart, match.index);
  const dash = /\s[-—–]\s+(?:please\s+)?$/i.exec(prefix);
  if (!dash) return false;
  const beforeDash = prefix.slice(0, dash.index);
  return /\b(?:i|we)\s+(?:already\s+)?(?:told|notified|warned|informed)\b[\s\S]{0,120}\bno surprises?\b/i.test(beforeDash);
}

/** Whether a matched clause is asserted by the user rather than quoted or attributed. */
export function inUserVoice(text: string, match: RegExpExecArray): boolean {
  const before = text.slice(0, match.index);
  const clauseStart = Math.max(
    before.lastIndexOf("."),
    before.lastIndexOf(";"),
    before.lastIndexOf("?"),
    before.lastIndexOf("!"),
    before.lastIndexOf("\n"),
  ) + 1;
  const prefix = text.slice(clauseStart, match.index);
  if (insideQuotation(text, match.index)) return false;
  return !hasReportedFrame(prefix) || hasExplicitDashAdoption(text, match, clauseStart);
}

const EMBEDDED_NO_REASK = /\b(?:explain|describe|discuss|analy[sz]e|tell me|show me|wonder|whether|why|what if|suppose|assuming|imagine|hypothetically|if)\b/i;

function noReaskAuthorizes(text: string, match: RegExpExecArray): boolean {
  const before = text.slice(0, match.index);
  const clauseStart = Math.max(
    before.lastIndexOf("."),
    before.lastIndexOf(";"),
    before.lastIndexOf("?"),
    before.lastIndexOf("!"),
    before.lastIndexOf("\n"),
  ) + 1;
  return !EMBEDDED_NO_REASK.test(text.slice(clauseStart, match.index));
}

/**
 * Deterministic baseline reader. It recognizes the three parts of an
 * authorization act by phrase pattern. This is an offline baseline, not the
 * planned extractor: it was tuned on spent held-out cases and its recall on
 * unseen phrasing is exactly what held-out v5 measures.
 */
export const baselineAuthorizationReader: AuthorizationReader = (input) => readAuthorization(input);

/**
 * The disqualifiers, exported for any frontend: a conditional clause or a
 * stated negation of review or approval. Either outranks every other act in
 * the request, so a frontend that reads `present` beside one is capped. The
 * cap only ever moves a read toward asking.
 */
export function authorizationDisqualifier(input: string): { state: "conditional" | "absent"; evidence: string } | undefined {
  const conditional = CONDITIONAL.exec(input);
  if (conditional) return { state: "conditional", evidence: `authorization is conditional: "${conditional[0]}"` };
  for (const negated of input.matchAll(NEGATED_SETTLED_ALL)) {
    // A negated check whose object is the user ("don't check back", "no need
    // to confirm with me") is a waiver, the opposite of a disqualifier.
    if (WAIVER_TAIL.test(input.slice(negated.index + negated[0].length))) continue;
    return { state: "absent", evidence: `authorization is negated: "${negated[0]}"` };
  }
  return undefined;
}

const NEGATED_SETTLED_ALL = new RegExp(NEGATED_SETTLED.source, "gi");
const WAIVER_TAIL = /^\s*(?:back|in|with me|me|again|first)\b/i;

export function readAuthorization(input: string): AuthorizationRead {
  const evidence: string[] = [];
  if (QUESTION.test(input.trim()) && !GO.test(input)) {
    return { state: "absent", evidence: ["request is a question"] };
  }
  const disqualifier = authorizationDisqualifier(input);
  if (disqualifier) return { state: disqualifier.state, evidence: [disqualifier.evidence] };

  const first = SETTLED_FIRST_PERSON.exec(input) ?? SETTLED_FIRST_PERSON_PAST.exec(input);
  const firstOk = first && inUserVoice(input, first);
  const impersonal = SETTLED_IMPERSONAL.exec(input);
  const impersonalOk = impersonal && inUserVoice(input, impersonal);
  const third = SETTLED_THIRD_PARTY.exec(input);
  const thirdOk = third && !insideQuotation(input, third.index);
  const noReask = NO_REASK.exec(input);
  const noReaskInUserVoice = noReask && inUserVoice(input, noReask);
  const noReaskOk = noReaskInUserVoice && noReaskAuthorizes(input, noReask);
  const go = GO.exec(input);
  const goOk = go && inUserVoice(input, go);

  if (first && !firstOk) evidence.push(`first-person settled clause is quoted or reported: "${first[0]}"`);
  if (firstOk) evidence.push(`user asserts settled state: "${first[0]}"`);
  if (thirdOk) evidence.push(`settled state attributed to others: "${third[0]}"`);
  if (noReaskOk) evidence.push(`user asks not to be re-asked: "${noReask[0]}"`);
  else if (noReaskInUserVoice) evidence.push(`no-reask wording is embedded rather than asserted: "${noReask[0]}"`);
  if (impersonal && !impersonalOk) evidence.push(`settled clause is quoted or reported: "${impersonal[0]}"`);
  if (impersonalOk) evidence.push(`user asserts settled state: "${impersonal[0]}"`);
  if (goOk) evidence.push(`unconditional go: "${go[0]}"`);

  // The user's own settled clause, a no-re-ask clause, or a third-party settled
  // clause the user adopts with an unconditional go is authorization in the
  // user's voice. The action request itself is not authorization.
  if (firstOk || impersonalOk || noReaskOk || (thirdOk && Boolean(goOk))) {
    const statement = firstOk ? first : impersonalOk ? impersonal : thirdOk && goOk ? third : noReaskOk ? noReask : go;
    return { state: "present", evidence, statement: statement?.[0] };
  }
  if (goOk && !thirdOk && !first && !impersonal) {
    // An action request alone is not a record that its prerequisites are met.
    evidence.push("go clause without a settled clause or no-re-ask clause");
    return { state: "absent", evidence };
  }
  if (thirdOk || (first && !firstOk) || (impersonal && !impersonalOk) || (noReask && !noReaskInUserVoice)) {
    return { state: "reported", evidence };
  }
  return { state: "absent", evidence: evidence.length ? evidence : ["no authorization act in request"] };
}
