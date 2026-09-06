import { createHash } from "node:crypto";
import { ACTION_WORDS } from "../ir/deterministicFrontend.js";
import type { ArtifactContext, OperationTrigger, SourceClauseSelection, SourceEvidenceBinding } from "../policy/types.js";
import { CLAUSE_MAP_HASH } from "./sourceClauses.js";

/**
 * Evidence binding for the source clause slice.
 *
 * A clause that states a condition declares the evidence roles the condition
 * turns on. A role names a kind of statement a request might contain, in the
 * source policy's own terms, and a topical vocabulary that locates candidate
 * sentences. The reader quotes every sentence that touches a role, verbatim,
 * and binds each quote to the proposed action whose sentence it shares or
 * follows. It never decides whether the quoted statement satisfies anything.
 *
 * The vocabularies are deliberately about the topic of a role, not about its
 * satisfaction. The classifier this replaces (`readAuthorization`) matched the
 * forms of a valid confirmation and missed "I have read the final wording
 * below and it is exactly what I want"; this reader quotes that sentence
 * because it is about review and wanting, and leaves the judgment to the model.
 */

export type EvidenceRole = {
  id: string;
  /** What the source asks for, in words a reader can quote back beside the evidence. */
  requirement: string;
  /** Source line the requirement paraphrases nothing from; it is cited so the frame can point at the clause. */
  line: number;
  /** Topic words. A sentence containing any of them is quoted for this role. */
  topic: RegExp;
};

const ROLES: Record<string, EvidenceRole> = {
  authorization: {
    id: "authorization",
    requirement: "the user's own statement of intent and confirmation for the action",
    line: 331,
    topic: /\b(?:confirm\w*|authoriz\w*|approv\w*|sign(?:ed|s)?[- ]off|consent\w*|clear(?:ed|ance)|review(?:ed|s)?|checked|read (?:it|this|the|through)|looked (?:it|this|them) over|go ahead|proceed|send (?:it|this|them|now)|do it|exactly what i want|as[- ]is|final(?:ized)?|ready to (?:go|send)|now\b|no need to (?:ask|check|confirm)|don'?t (?:ask|check|confirm)|without asking|okay to|ok to|fine with|permission|green ?light|cleared|approved)\b/i,
  },
  target: {
    id: "target",
    requirement: "the exact target: which messages, thread, event, file, page, or record",
    line: 377,
    topic: /\b(?:thread|email|message|event|meeting|series|file|page|record|slide|sheet|row|column|cell|recipient|attachment|subject|titled|named|called|from|about|dated|every|all|entire|whole|only|one)\b|[\w.+-]+@[\w-]+\.[\w.-]+|['"‘“][^'"’”]{2,}['"’”]/i,
  },
  scope: {
    id: "scope",
    requirement: "the scope: what is included and what is not, and whether the action is one occurrence or a series",
    line: 377,
    topic: /\b(?:attachments?|exhibits?|included?|including|excluding|except|only|entire|whole|all|every|no (?:files?|attachments?)|one occurrence|this instance|the series|all future|scope|as well)\b/i,
  },
  consequence: {
    id: "consequence",
    requirement: "the consequence: who will see the result, whether it leaves the organization, and whether it can be undone",
    line: 377,
    topic: /\b(?:external|outside|vendor|contractor|counsel|confidential|privileged|private|client|customer|public|irreversible|permanent(?:ly)?|cannot be undone|leaves? the (?:company|org\w*)|third[- ]party|partner|legal|sensitive)\b|@(?!(?:example\.com))[\w-]+\.[\w.-]+/i,
  },
  operation: {
    id: "operation",
    requirement: "the operation named, as the user names it",
    line: 377,
    topic: /\b(?:send|forward|delete|archive|trash|cancel|reschedule|move|create|schedule|update|edit|overwrite|publish|save|remove|purge|clear out|get rid of|reply)\b/i,
  },
  limit: {
    id: "limit",
    requirement: "any limit the user places on tools or lookups this turn",
    line: 101,
    topic: /\b(?:do not (?:look|browse|search|use|call)|don'?t (?:look|browse|search|use|call)|without (?:looking|browsing|searching|checking)|no (?:web|browsing|lookup|tools?)|offline|from memory|just tell me|only tell me)\b/i,
  },
  format: {
    id: "format",
    requirement: "the shape of the answer the user asked for",
    line: 147,
    topic: /\b(?:only the|just the|return only|give me only|no (?:preamble|intro|notes|commentary|explanation|list|headings|bullets)|nothing else|paragraph only|as[- ]is|verbatim|in (?:one|a single) (?:line|sentence|paragraph))\b/i,
  },
  verification: {
    id: "verification",
    requirement: "whether the user asked for factual verification or the text needs current facts",
    line: 147,
    topic: /\b(?:verify|fact[- ]check|check (?:the|these|those) (?:facts?|figures?|numbers?)|current|latest|today|as of|up[- ]to[- ]date|cite|source)\b/i,
  },
};

/**
 * Which roles each conditional clause declares, and which proposed-action
 * operations the clause governs. A clause binds evidence only for actions in
 * its operation set; `any` governs every action. A clause absent here binds
 * nothing. This is the map's declaration, audited against the source line.
 */
export const CLAUSE_ROLES: Record<string, { roles: readonly string[]; operations: readonly OperationTrigger[] | "any" }> = {
  "email.state-changes": { roles: ["authorization", "target", "scope", "consequence"], operations: ["send", "forward", "delete", "archive", "update"] },
  "email.archive-delete": { roles: ["target", "scope"], operations: ["delete", "archive"] },
  "email.privacy": { roles: ["consequence"], operations: ["send", "forward"] },
  "calendar.mutations": { roles: ["authorization", "target", "scope"], operations: ["create", "update", "reschedule", "delete"] },
  "destructive.confirm": { roles: ["authorization", "target", "scope", "consequence"], operations: ["send", "forward", "delete", "archive", "update", "create", "reschedule"] },
  "web.verify-first": { roles: ["limit", "verification"], operations: "any" },
  "citations.when-required": { roles: ["verification"], operations: "any" },
  "writing.format-and-browse": { roles: ["format", "verification"], operations: ["rewrite", "draft", "edit"] },
  "sheets.inspect-and-preserve": { roles: ["target", "scope"], operations: ["edit", "update", "delete"] },
  "slides.edit-limits": { roles: ["target", "scope"], operations: ["edit", "update", "delete"] },
};

const digest = (text: string): string => createHash("sha256").update(text).digest("hex");
export const EVIDENCE_CONTRACT_HASH = digest(JSON.stringify({ clauseMap: CLAUSE_MAP_HASH, roles: Object.fromEntries(Object.entries(ROLES).map(([id, role]) => [id, { requirement: role.requirement, line: role.line, topic: role.topic.source }])), clauseRoles: CLAUSE_ROLES }));

type Sentence = { index: number; text: string; start: number; end: number };

/**
 * Sentence split on terminal punctuation followed by whitespace. A period
 * inside an email address, a quoted string, or a decimal does not end a
 * sentence, so a recipient or quoted body stays in one citable span.
 */
function sentences(request: string): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  let quote: string | undefined;
  const closers: Record<string, string> = { "'": "'", '"': '"', "‘": "’", "“": "”" };
  for (let index = 0; index < request.length; index += 1) {
    const char = request[index];
    if (quote) { if (char === quote) quote = undefined; continue; }
    if (char in closers && (index === 0 || /[\s(:,]/.test(request[index - 1]))) { quote = closers[char]; continue; }
    if (!".!?".includes(char)) continue;
    const next = request[index + 1];
    if (next !== undefined && !/\s/.test(next)) continue;
    const text = request.slice(start, index + 1).trim();
    if (text) out.push({ index: out.length, text, start, end: index + 1 });
    start = index + 1;
  }
  const tail = request.slice(start).trim();
  if (tail) out.push({ index: out.length, text: tail, start, end: request.length });
  return out;
}

/**
 * Proposed actions: every operation verb the request names, in order, bound to
 * the sentence it appears in. The declared context operation is always the
 * first action even when the request does not spell it out.
 */
function proposedActions(request: string, context: ArtifactContext | null | undefined, split: Sentence[]): SourceEvidenceBinding["actions"] {
  const actions: SourceEvidenceBinding["actions"] = [];
  const seen = new Set<string>();
  const add = (operation: OperationTrigger, sentence: number, phrase: string) => {
    const key = `${operation}:${sentence}`;
    if (seen.has(key)) return;
    seen.add(key);
    actions.push({ id: `a${actions.length + 1}`, operation, sentence, phrase });
  };
  for (const [pattern, operation] of ACTION_WORDS) {
    for (const match of request.matchAll(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`))) {
      const sentence = split.find((item) => match.index >= item.start && match.index < item.end);
      if (sentence) add(operation, sentence.index, match[0]);
    }
  }
  actions.sort((a, b) => a.sentence - b.sentence || a.id.localeCompare(b.id));
  actions.forEach((action, position) => { action.id = `a${position + 1}`; });
  if (context?.operation && !actions.some((action) => action.operation === context.operation)) {
    actions.unshift({ id: "a0", operation: context.operation, sentence: -1, phrase: `(declared operation: ${context.operation})` });
  }
  return actions;
}

/**
 * Binds verbatim evidence to the retained clauses, per proposed action. Pure
 * retrieval: every quote is a whole sentence of the request, cited by index
 * and offsets, tagged with the roles it touches. Nothing here says whether a
 * quote satisfies anything. A clause with no proposed action in its operation
 * set binds nothing, so an email send does not drag in calendar evidence.
 */
export function bindSourceEvidence(request: string, context: ArtifactContext | null | undefined, selection: SourceClauseSelection): SourceEvidenceBinding {
  const split = sentences(request);
  const actions = proposedActions(request, context, split);
  const bindings: SourceEvidenceBinding["bindings"] = [];
  for (const clause of selection.clauses) {
    if (!clause.retained) continue;
    const declared = CLAUSE_ROLES[clause.id];
    if (!declared) continue;
    const governed = actions.filter((action) => declared.operations === "any" || declared.operations.includes(action.operation));
    for (const action of governed) {
      const quotes: SourceEvidenceBinding["bindings"][number]["quotes"] = [];
      for (const sentence of split) {
        const roles = declared.roles.filter((roleId) => ROLES[roleId].topic.test(sentence.text));
        if (roles.length) quotes.push({ sentence: sentence.index, start: sentence.start, end: sentence.end, text: sentence.text, roles });
      }
      // A clause that governs every action is bound only when the request says something on its points; the clause itself is already in the slice.
      if (declared.operations === "any" && !quotes.length) continue;
      bindings.push({ clause: clause.id, action: action.id, roles: declared.roles.map((roleId) => ({ id: roleId, requirement: ROLES[roleId].requirement })), quotes });
    }
  }
  return { contractVersion: "source-evidence-v1", evidenceContractHash: EVIDENCE_CONTRACT_HASH, request: { sha256: digest(request), sentences: split.length }, actions, bindings };
}

/**
 * Two frames. Both print the clause line, the roles, and the quotes; neither
 * tells the model to ask, act, or refuse.
 *
 *  - `bare`: clause, then "Request states:" with the quotes. Nothing else.
 *  - `apply`: the same, followed by one neutral sentence.
 */
export function renderEvidence(binding: SourceEvidenceBinding, selection: SourceClauseSelection, source: string, frame: "bare" | "apply"): string {
  if (!binding.bindings.length) return "";
  const sourceLines = source.split("\n");
  const lineOf = new Map(selection.clauses.map((clause) => [clause.id, sourceLines[clause.line - 1]]));
  const byClause = new Map<string, SourceEvidenceBinding["bindings"]>();
  for (const item of binding.bindings) byClause.set(item.clause, [...(byClause.get(item.clause) ?? []), item]);
  const lines: string[] = ["## Evidence bound to the retained policy", ""];
  if (binding.actions.length) {
    lines.push("Proposed actions in the request:");
    for (const action of binding.actions) lines.push(`- ${action.id}: ${action.operation}${action.sentence >= 0 ? ` (sentence ${action.sentence + 1}: "${action.phrase}")` : ` ${action.phrase}`}`);
    lines.push("");
  }
  for (const [clauseId, items] of byClause) {
    lines.push(`Policy (${clauseId}): ${lineOf.get(clauseId) ?? ""}`);
    lines.push(`- Requires: ${items[0].roles.map((role) => role.requirement).join("; ")}.`);
    for (const item of items) {
      const action = binding.actions.find((entry) => entry.id === item.action);
      lines.push(`- For ${item.action} (${action?.operation ?? "?"}), the request states:`);
      if (!item.quotes.length) { lines.push("  (no sentence on these points)"); continue; }
      for (const quote of item.quotes) lines.push(`  [${quote.roles.join(", ")}] sentence ${quote.sentence + 1}: "${quote.text}"`);
    }
    lines.push("");
  }
  if (frame === "apply") lines.push("Apply the policy above to the request as stated.", "");
  return lines.join("\n");
}
