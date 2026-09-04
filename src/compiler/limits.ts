import type { ArtifactContext } from "../policy/types.js";

/**
 * Explicit limit: the user has bounded what the assistant may do this turn. This
 * is a request-level property, evaluated once, and it applies to every selected
 * policy that would otherwise oblige a tool call or artifact inspection.
 *
 * Outcomes:
 *  - `limited`: a stated limit (do not modify, only describe, just tell me, the
 *    values are already here) or a request whose object is text the assistant
 *    must produce (a prompt, advice, an explanation) rather than an action.
 *  - `ambiguous`: the request both asks for an action and constrains it in a way
 *    that cannot be resolved from the text ("before you touch the deck ...").
 *  - `none`: no limit found.
 *
 * Fail-safe direction is the opposite of the confirmation predicate's. The harm
 * being avoided is an unwanted action, so `ambiguous` withholds the tool
 * obligation and asks the model to check before acting; only `none` leaves the
 * obligation in place.
 */
export type LimitVerdict = "limited" | "ambiguous" | "none";
export type LimitResult = { verdict: LimitVerdict; evidence: string[] };

const NEGATED_ACTION = /\b(?:do not|don't|dont|never|without)\s+(?:\w+\s+){0,2}(?:use|call|run|touch|modify|change|edit|generate|render|create|save|overwrite|write|send|delete|move|update|apply|execute|open|inspect|look ?up|search|browse)\b/i;
const NOT_NOW = /\b(?:not (?:right )?now|not yet|later|for later|at this point)\b/i;
const ONLY_TEXT = /\b(?:only|just)\s+(?:want|need|give me|tell me|show me|explain|describe|list|say|answer)\b|\b(?:i (?:only|just) (?:want|need))\b|\bthats all i need\b|\bthat's all i need\b|\bnothing else\b|\bin words\b|\bin plain (?:language|english|words)\b/i;
// Only a clause that opens a sentence or follows a boundary is a question; "...,
// which is 10am for me" is a relative clause.
const ADVICE_QUESTION = /(?:^|[.?!;:]\s+|\band\s+|\bbut\s+|\bso\s+|\bthen\s+)(?:what should i (?:watch|look|know|do|check|worry)|what (?:would|could) (?:you|i) (?:change|watch)|what (?:are|is) the (?:risks?|pitfalls?|gotchas?|differences?)|how (?:does|do|would|should)|which (?:one|should)|is it (?:safe|ok|okay|fine) to)\b/i;
const TEXT_DELIVERABLE = /\b(?:write|draft|give|produce)\s+(?:me\s+)?(?:a |an |the )?(?:\w+\s+){0,3}(?:prompt|prompt text|explanation|summary|paragraph|blurb|copy|words|sentence|note|description|advice|checklist)\b/i;
const VALUES_SUPPLIED = /\b(?:values?|numbers?|figures?|table|data) (?:are|is) (?:already )?(?:here|below|above|in (?:the|this) (?:message|request|text))\b|\b(?:i(?:'ve| have)? )?(?:already )?(?:pulled|copied|pasted|extracted)\b.{0,40}\b(?:myself|for you|here|below)\b|\bthis is the complete\b/i;
const BEFORE_ACTION = /\bbefore you (?:touch|edit|change|modify|run|do|send|save|call)\b/i;
const ACTION_REQUEST = /\b(?:go ahead and|please)?\s*(?:edit|modify|change|update|save|overwrite|generate|render|create|send|forward|archive|delete|move|reschedule|reorder|dedupe|clean up|fix|apply|run|draft|put (?:it|this|that) in (?:my )?drafts?|write .{0,40}(?:and )?(?:save|put) it)\b/i;

const CATALOG_VERBS: Record<string, RegExp> = {
  image_generate: /\bgenerat\w*|\brender\w*|\bcreat\w*|\bdraw\w*|\bmake (?:an? )?(?:image|picture|illustration|poster)/i,
  spreadsheet_edit: /\bedit|\bmodif|\bclean|\bdedupe|\bsave|\boverwrite|\bupdate|\bchange/i,
  slides_edit: /\bedit|\breorder|\bmove|\bdelete|\bchange|\bupdate/i,
  image_inspect: /\binspect|\blook at|\bcheck|\banalyz/i,
  pdf_read: /\bread|\bopen|\binspect|\bpull/i,
  web: /\bsearch|\blook (?:it )?up|\bbrowse|\bcheck online|\bverify online/i,
  gmail: /\bsend|\bforward|\barchive|\bdelete|\btrash|\bemail/i,
  calendar: /\bcreate|\bschedule|\breschedule|\bmove|\bcancel|\bdelete/i,
};

export function evaluateExplicitLimit(input: string, context?: ArtifactContext | null): LimitResult {
  const evidence: string[] = [];
  const tools = (context?.toolsAvailable ?? []).map((tool) => tool.toLowerCase());
  const negated = NEGATED_ACTION.exec(input);
  if (negated) evidence.push(`request negates an action: "${negated[0]}"`);
  const notNow = negated && NOT_NOW.test(input.slice(negated.index, negated.index + 80));
  if (notNow) evidence.push("negation is scoped to this turn (not now / later)");
  // "just say X" / "only tell me Y" limits the turn only when nothing else in the
  // request asks for an action on an available tool; inside an action request it
  // constrains wording ("if you mention her, just say she is unavailable").
  const toolActionRequested = tools.some((tool) => CATALOG_VERBS[tool]?.test(input) ?? false) && ACTION_REQUEST.test(input);
  const onlyTextRaw = ONLY_TEXT.exec(input);
  const onlyText = onlyTextRaw && !(toolActionRequested && /^(?:just|only)\s+(?:say|tell|mention)/i.test(onlyTextRaw[0])) ? onlyTextRaw : null;
  if (onlyText) evidence.push(`request limits the deliverable to text: "${onlyText[0]}"`);
  else if (onlyTextRaw) evidence.push(`"${onlyTextRaw[0]}" constrains wording inside an action request`);
  const advice = ADVICE_QUESTION.exec(input);
  if (advice) evidence.push(`request is an advice question: "${advice[0]}"`);
  const deliverableRaw = TEXT_DELIVERABLE.exec(input);
  // A summary or explanation *of an attached artifact* is produced by reading it;
  // the text deliverable does not limit the reader tool.
  const artifactAttached = Boolean(context?.artifactType && context.artifactType !== "unknown") || /\b(?:attached|i attached|the attachment|this file|this pdf|this deck|this sheet)\b/i.test(input);
  const deliverable = deliverableRaw && !artifactAttached ? deliverableRaw : null;
  if (deliverable) evidence.push(`requested deliverable is text: "${deliverable[0]}"`);
  else if (deliverableRaw) evidence.push(`"${deliverableRaw[0]}" is produced from an attached artifact`);
  const supplied = VALUES_SUPPLIED.exec(input);
  if (supplied) evidence.push(`inputs are supplied in the request: "${supplied[0]}"`);
  const before = BEFORE_ACTION.exec(input);
  if (before) evidence.push(`action is conditioned on a prior step: "${before[0]}"`);

  // A negated verb that follows a positive request for a different action on the
  // same tool ("archive it, do not delete it") constrains scope; it is not a limit
  // on the turn. Otherwise a negated verb naming an available tool's action is the
  // clearest limit.
  const scopedNegation = Boolean(negated) && ACTION_REQUEST.test(input.slice(0, negated!.index));
  if (scopedNegation) evidence.push("negation constrains scope of a requested action rather than limiting the turn");
  if (negated && !scopedNegation) {
    for (const tool of tools) {
      const verbs = CATALOG_VERBS[tool];
      if (verbs && verbs.test(negated[0])) {
        return { verdict: "limited", evidence: [...evidence, `negated verb names the ${tool} tool's action`] };
      }
    }
  }
  const limiting = (negated && !scopedNegation) || onlyText || advice || deliverable || supplied;
  if (limiting) {
    // Any positive action request alongside a limit is ambiguous unless the limit
    // clearly scopes the whole turn (only/just text, supplied inputs, negation).
    const action = ACTION_REQUEST.exec(input);
    const strong = Boolean(negated && !scopedNegation) || Boolean(onlyText) || Boolean(supplied);
    if (action && !strong && !deliverable) {
      return { verdict: "ambiguous", evidence: [...evidence, `but the request also asks to act: "${action[0]}"`] };
    }
    return { verdict: "limited", evidence };
  }
  if (before) return { verdict: "ambiguous", evidence };
  return { verdict: "none", evidence: scopedNegation ? evidence : ["no explicit limit on action in request"] };
}

export function limitInstruction(verdict: Exclude<LimitVerdict, "none">, tools: string[]): string {
  const named = tools.length ? [...tools].sort().join(", ") : "any tool";
  if (verdict === "limited") {
    return `The user has limited this turn to a text answer and has not asked for an action, so do not call ${named}. Answer from the information in the request and state plainly anything you cannot verify without the tool.`;
  }
  return `The request both constrains what may be done and could be read as asking for an action. Do not call ${named} on this turn; answer the parts you can, and ask the user to confirm the action and its exact scope before acting.`;
}
