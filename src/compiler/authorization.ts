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

/**
 * Wraps a reader so its output is validated and its failures fail closed: a
 * thrown error or an invalid shape becomes `absent`, with the reason recorded.
 */
export function guardedReader(reader: AuthorizationReader, name: string): AuthorizationReader {
  return (input) => {
    let raw: unknown;
    try {
      raw = reader(input);
    } catch (error) {
      return { state: "absent", evidence: [`${name} reader failed: ${error instanceof Error ? error.message : String(error)}`] };
    }
    const parsed = authorizationReadSchema.safeParse(raw);
    if (!parsed.success) return { state: "absent", evidence: [`${name} reader returned an invalid read: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`] };
    return parsed.data;
  };
}

const SETTLED_FIRST_PERSON = /\b(?:I|we|ive|i've|we've|i’ve|we’ve)\s+(?:(?:explicitly|hereby|now|also|formally|fully|again|do|already|myself)\s+)*(?:confirm|authorize|approve|sign(?:ed)? off|have (?:already )?(?:reviewed|checked|been through|cleared|approved|signed off)|(?:'ve|’ve) (?:already )?(?:reviewed|checked|been through|cleared|approved|signed off)|been through|reviewed|checked|cleared)\b/i;
const SETTLED_THIRD_PARTY = /\b(?!I\b|we\b)(?:[A-Z][a-z]+|[a-z]+|everyone|everybody|the team|legal|finance|my manager|she|he|they)(?:'s|’s)?\s+(?:already\s+|has\s+|have\s+|all\s+)*(?:signed off|confirmed|approved|cleared|okayed|ok'd|said (?:it's|its) fine|is fine with)\b/i;
const NO_REASK = /\b(?:no need to (?:loop back|check back|check with me|come back to me|ask(?: me)?|confirm(?: with me)?|re-?confirm|double[- ]check)|(?:i )?(?:don'?t|do not) need (?:another|a) (?:readback|confirmation|check|sign-?off)|(?:don'?t|do not) ask me anything|no readback|skip the (?:confirmation|readback|check)|without (?:asking|checking) (?:me )?(?:again|first))\b/i;
const GO = /\b(?:go ahead(?: and)?|proceed|just do it|do it now|send it now|create it now|send it,? (?:don'?t|do not) draft|(?:send|create|archive|move|reschedule|forward) (?:it|them|this|that) now)\b/i;
// Conditional on authorization itself ("if legal approves", "once Pat confirms"),
// not on content ("if you mention her, say ..."): the verb list is authorization
// verbs only, and the subject of the conditional must not be the assistant.
const CONDITIONAL = /\b(?:if|once|unless|when|assuming|provided that|as long as)\s+(?!you\b|the assistant\b)[^.;]{0,50}\b(?:confirms?|approves?|signs? off|agrees?|okays?|clears?|gets? back|gives? the (?:go|ok|okay|green light))\b|\b(?:will|would|could|might|going to)\s+(?:confirm|approve|sign off|authorize)\b|\bafter (?:i|we) (?:confirm|approve|check)\b/i;
const REPORTED_FRAME = /\b(?:said|says|wrote|told|replied|texted|emailed|messaged|heard|according to|quote|quoting|claims|mentioned)\b/i;
const NEGATED_SETTLED = /\b(?:not|never|haven'?t|hasn'?t|didn'?t|don'?t|do not|no one|nobody)\s+(?:\w+\s+){0,2}(?:confirm|approv|sign|clear|review|check|okay|ok'd)\w*/i;
const QUESTION = /\?\s*$/;

/** True when an odd number of double quotes precede `index`, i.e. inside someone else's words. */
function insideQuotation(text: string, index: number): boolean {
  return ((text.slice(0, index).match(/["“”]/g)?.length ?? 0) % 2) === 1;
}

/**
 * Deterministic baseline reader. It recognizes the three parts of an
 * authorization act by phrase pattern. This is an offline baseline, not the
 * planned extractor: it was tuned on spent held-out cases and its recall on
 * unseen phrasing is exactly what held-out v5 measures.
 */
export const baselineAuthorizationReader: AuthorizationReader = (input) => readAuthorization(input);

export function readAuthorization(input: string): AuthorizationRead {
  const evidence: string[] = [];
  if (QUESTION.test(input.trim()) && !GO.test(input)) {
    return { state: "absent", evidence: ["request is a question"] };
  }
  const conditional = CONDITIONAL.exec(input);
  if (conditional) {
    evidence.push(`authorization is conditional: "${conditional[0]}"`);
    return { state: "conditional", evidence };
  }
  const negated = NEGATED_SETTLED.exec(input);
  if (negated) {
    evidence.push(`authorization is negated: "${negated[0]}"`);
    return { state: "absent", evidence };
  }

  const first = SETTLED_FIRST_PERSON.exec(input);
  const firstOk = first && !insideQuotation(input, first.index) && !REPORTED_FRAME.test(input.slice(Math.max(0, first.index - 40), first.index));
  const third = SETTLED_THIRD_PARTY.exec(input);
  const thirdOk = third && !insideQuotation(input, third.index);
  const noReask = NO_REASK.exec(input);
  const go = GO.exec(input);

  if (first && !firstOk) evidence.push(`first-person settled clause is quoted or reported: "${first[0]}"`);
  if (firstOk) evidence.push(`user asserts settled state: "${first[0]}"`);
  if (thirdOk) evidence.push(`settled state attributed to others: "${third[0]}"`);
  if (noReask) evidence.push(`user asks not to be re-asked: "${noReask[0]}"`);
  if (go) evidence.push(`unconditional go: "${go[0]}"`);

  // The user's own settled clause, or a third-party clause the user adopts by
  // telling us not to re-ask or to go ahead, is authorization in the user's voice.
  if (firstOk || ((thirdOk || Boolean(go)) && noReask) || (firstOk === null && go && noReask)) {
    return { state: "present", evidence, statement: (first ?? third ?? go ?? noReask)?.[0] };
  }
  if (go && !thirdOk && !first) {
    // "go ahead" alone, with nothing settled, is a request to act, not a record
    // that the prerequisites are met.
    evidence.push("go clause without a settled clause or no-re-ask clause");
    return { state: "absent", evidence };
  }
  if (thirdOk || (first && !firstOk)) {
    return { state: "reported", evidence };
  }
  return { state: "absent", evidence: evidence.length ? evidence : ["no authorization act in request"] };
}
