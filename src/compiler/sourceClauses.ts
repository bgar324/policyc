import { createHash } from "node:crypto";
import type { ArtifactContext, ArtifactType, Policy, PolicySelection, SourceClauseSelection } from "../policy/types.js";
import { SOURCE_POLICY_SHA256 } from "./sourceSlice.js";

/**
 * Hand-audited clause map over `prompts/synthetic-enterprise-agent.md`.
 *
 * A clause is one prose paragraph of the original source, addressed by the
 * 1-based line it occupies in the pinned file. Every paragraph of every section
 * is listed; the map is exhaustive by construction and the projector refuses a
 * source whose paragraphs do not match it line for line.
 *
 * `scope` is the only thing that can remove a clause, and only when the case
 * context declares the matching dimension exhaustive. A clause with no scope is
 * never removed. A positive selector match or a declared dependency retains a
 * clause but nothing here can be pruned on the strength of a missing match.
 *
 * Boilerplate: 20 sections end with the same nine bullet lines, identical
 * except for the section name each line embeds. Those are deduplicated to one
 * canonical copy per the owner's rule; the provenance lists every subsumed copy.
 */

export type ClauseScope =
  /** Irrelevant when `exhaustive.artifacts` is declared and the artifact type is not one of these. */
  | { artifacts: readonly ArtifactType[] }
  /** Irrelevant when `exhaustive.tools` is declared and none of these tools is available. Only for clauses about using the tool. */
  | { tools: readonly string[] };

export type Clause = {
  id: string;
  section: string;
  line: number;
  /** Structural pruning condition. Absent means the clause is always retained. */
  scope?: ClauseScope;
  /** Clauses whose removal could change when, whether, or how this clause applies. Retained with it. */
  dependsOn?: readonly string[];
  /** Authored policy nodes whose selection is a positive signal for this clause. */
  nodes?: readonly string[];
  /** Why this scope is a trusted structural fact and not a semantic prediction. Required whenever `scope` is set. */
  audit?: string;
};

/**
 * Line 3 describes the file ("a deliberately large synthetic ... prompt used as
 * the full-prompt baseline"; "not the source of truth for v1; YAML policy packs
 * are"). It is metadata about the corpus, not policy, and its YAML claim
 * contradicts the current mission. It stays byte-for-byte in the full-policy
 * control and is never emitted by the clause arm. Recorded here so the
 * exhaustiveness check cannot silently skip it.
 */
const NON_POLICY_LINES: Record<number, string> = { 3: "corpus metadata, not policy" };

const PDF_INSPECTION_NODES = ["pdf_handling", "pdf_mutation", "pdf_specific_claims_cite_pages", "chart_table_extraction_caution", "inspect_visual_pages_or_charts"] as const;

export const CLAUSES: readonly Clause[] = [
  // Universal operating context: no scope, always retained.
  { id: "precedence.order", section: "Policy precedence and operating model", line: 7 },
  { id: "precedence.definitions", section: "Policy precedence and operating model", line: 9 },
  { id: "precedence.context-triggers", section: "Policy precedence and operating model", line: 11 },
  { id: "core.honesty", section: "Core behavior", line: 30 },
  { id: "core.no-false-success", section: "Core behavior", line: 32 },
  { id: "core.uncertainty", section: "Core behavior", line: 34 },
  { id: "hidden.never-reveal", section: "Hidden reasoning", line: 53 },
  { id: "hidden.no-system-dump", section: "Hidden reasoning", line: 55 },
  { id: "hidden.framing-exception", section: "Hidden reasoning", line: 57, dependsOn: ["hidden.never-reveal", "hidden.no-system-dump"] },
  { id: "background.no-claims", section: "Background work and turn completion", line: 76 },
  { id: "background.complete-now", section: "Background work and turn completion", line: 78 },
  { id: "background.no-automation", section: "Background work and turn completion", line: 80, dependsOn: ["background.no-claims"] },

  // Web and current information. Line 101 is retained whenever the web clauses
  // are, and is never pruned on tool absence: it governs what to do when the
  // user says not to browse, and line 421 governs a failed or absent tool.
  { id: "web.definition", section: "Web and current information", line: 99, nodes: ["current_info_definition", "current_info_requires_web", "no_current_facts_from_memory"] },
  { id: "web.verify-first", section: "Web and current information", line: 101, dependsOn: ["web.definition", "citations.when-required", "tools.use-and-failure"], nodes: ["current_info_requires_web", "no_current_facts_from_memory"] },
  { id: "web.source-quality", section: "Web and current information", line: 103, dependsOn: ["web.verify-first"], nodes: ["authoritative_sources_preferred"] },

  // Citations are conditional on web use in the source; nothing structural
  // can establish that a request will not use web, so no scope.
  { id: "citations.when-required", section: "Citations and source quality", line: 122, nodes: ["citations_required", "citation_definition"] },
  { id: "citations.high-stakes", section: "Citations and source quality", line: 124, dependsOn: ["citations.when-required"], nodes: ["authoritative_sources_preferred"] },
  { id: "citations.without-current", section: "Citations and source quality", line: 126, dependsOn: ["citations.when-required", "web.definition"], nodes: ["citations_required"] },

  // Writing applies to supplied text, which any request can carry; no scope.
  { id: "writing.preserve-meaning", section: "Writing and rewriting", line: 145, nodes: ["preserve_user_meaning", "preserve_legal_effect_in_rewrites", "writing_tasks_use_format"] },
  { id: "writing.format-and-browse", section: "Writing and rewriting", line: 147, dependsOn: ["writing.preserve-meaning", "web.definition"], nodes: ["writing_tasks_use_format", "writing_output_format", "do_not_browse_for_simple_rewrites"] },
  { id: "writing.not-an-action", section: "Writing and rewriting", line: 149, dependsOn: ["writing.preserve-meaning", "email.state-changes"], nodes: ["creating_drafts_safer_than_sending", "do_not_browse_for_simple_rewrites"] },

  // Image generation: lines 168 and 172 are about using the image tool and are
  // scoped to it. Line 168 also forbids claiming an image was created without
  // the tool, which matters exactly when the tool is absent, so it keeps no
  // tool scope; only the artifact scope applies.
  { id: "image-gen.require-tool", section: "Image generation", line: 168, scope: { artifacts: ["image", "generated_image"] }, nodes: ["image_generation_requires_tool"], audit: "With artifacts declared exhaustive and no image or generated image in play, no request can be an image-generation or image-edit task. Kept when tools are absent because the clause also forbids claiming creation without the tool." },
  { id: "image-gen.intent", section: "Image generation", line: 170, scope: { artifacts: ["image", "generated_image"] }, dependsOn: ["image-gen.require-tool"], nodes: ["image_generation_requires_tool"], audit: "Applies only to image-generation instructions; same artifact scope as the requiring clause." },
  { id: "image-gen.editing", section: "Image generation", line: 172, scope: { artifacts: ["image", "generated_image"] }, dependsOn: ["image-gen.require-tool"], nodes: ["image_generation_requires_tool"], audit: "Defines image editing as generation; irrelevant without an image artifact." },

  // Image interpretation: scoped to image artifacts. Person-safety wording is
  // also stated universally at line 398, which has no scope, so pruning these
  // on an exhaustive no-image declaration removes no universal duty.
  { id: "image-read.inspect-and-identify", section: "Image interpretation and person safety", line: 191, scope: { artifacts: ["image"] }, dependsOn: ["privacy.private-by-default"], nodes: ["image_interpretation_requires_inspection", "unknown_person_no_identification"], audit: "Speaks only of image description and analysis. The universal no-identification duty at line 398 is unscoped and always retained." },
  { id: "image-read.sensitive-attributes", section: "Image interpretation and person safety", line: 193, scope: { artifacts: ["image"] }, dependsOn: ["privacy.private-by-default"], nodes: ["sensitive_attributes_no_inference"], audit: "Restricts inference from appearance; the universal form at line 398 is always retained." },
  { id: "image-read.multi-feature", section: "Image interpretation and person safety", line: 195, scope: { artifacts: ["image"] }, dependsOn: ["image-read.inspect-and-identify", "numbers.caution"], nodes: ["chart_image_numeric_caution"], audit: "Concerns an image containing a person and a chart." },

  // Numeric extraction: line 218 names domains, not artifacts, and is never
  // pruned. Lines 214 and 216 concern charts and tables, which can appear in
  // pdf, spreadsheet, document, and image artifacts.
  { id: "numbers.caution", section: "Charts, graphs, tables, and numeric extraction", line: 214, scope: { artifacts: ["pdf", "spreadsheet", "document", "image"] }, dependsOn: ["numbers.high-risk-domains", "precedence.definitions"], nodes: ["chart_table_extraction_caution", "chart_image_numeric_caution", "inspect_visual_pages_or_charts", "numeric_accuracy_definition"], audit: "Charts and tables live in these artifact types. Pruned only when artifacts are exhaustive and none of them is present." },
  { id: "numbers.approximate-language", section: "Charts, graphs, tables, and numeric extraction", line: 216, scope: { artifacts: ["pdf", "spreadsheet", "document", "image"] }, dependsOn: ["numbers.caution"], nodes: ["chart_table_extraction_caution", "chart_image_numeric_caution"], audit: "Governs visual estimates from the same artifacts as line 214." },
  { id: "numbers.high-risk-domains", section: "Charts, graphs, tables, and numeric extraction", line: 218, nodes: ["numeric_accuracy_definition"] },

  { id: "pdf.inspect-and-cite", section: "PDFs and documents", line: 237, scope: { artifacts: ["pdf"] }, dependsOn: ["citations.when-required", "precedence.definitions"], nodes: [...PDF_INSPECTION_NODES], audit: "PDF tasks only." },
  { id: "pdf.manifest-activation", section: "PDFs and documents", line: 239, scope: { artifacts: ["pdf"] }, dependsOn: ["pdf.inspect-and-cite", "numbers.caution", "precedence.context-triggers"], nodes: [...PDF_INSPECTION_NODES], audit: "Describes PDF manifests." },
  { id: "pdf.honest-coverage", section: "PDFs and documents", line: 241, scope: { artifacts: ["pdf"] }, dependsOn: ["pdf.inspect-and-cite", "core.no-false-success"], nodes: [...PDF_INSPECTION_NODES], audit: "PDF reading limits; the universal no-false-success duty is always retained." },

  { id: "sheets.inspect-and-preserve", section: "Spreadsheets and structured data", line: 260, scope: { artifacts: ["spreadsheet"] }, dependsOn: ["destructive.definition", "precedence.definitions"], nodes: ["spreadsheet_handling", "preserve_spreadsheet_formulas"], audit: "Spreadsheet work only." },
  { id: "sheets.cleanup", section: "Spreadsheets and structured data", line: 262, scope: { artifacts: ["spreadsheet"] }, dependsOn: ["sheets.inspect-and-preserve"], nodes: ["spreadsheet_handling", "preserve_spreadsheet_formulas"], audit: "Spreadsheet cleanup and conversion only." },
  { id: "sheets.latent-formulas", section: "Spreadsheets and structured data", line: 264, scope: { artifacts: ["spreadsheet"] }, dependsOn: ["sheets.cleanup", "precedence.context-triggers"], nodes: ["preserve_spreadsheet_formulas"], audit: "Spreadsheet context trigger only." },

  // Slides are a document artifact in this context schema.
  { id: "slides.preserve-and-cite", section: "Slides and presentations", line: 283, scope: { artifacts: ["document"] }, dependsOn: ["citations.when-required"], nodes: ["slide_deck_handling"], audit: "Slide tasks; decks arrive as document artifacts." },
  { id: "slides.embedded-rules", section: "Slides and presentations", line: 285, scope: { artifacts: ["document"] }, dependsOn: ["slides.preserve-and-cite", "numbers.caution", "image-read.inspect-and-identify"], nodes: ["slide_deck_handling"], audit: "Embedded charts, tables, and people in slides." },
  { id: "slides.edit-limits", section: "Slides and presentations", line: 287, scope: { artifacts: ["document"] }, dependsOn: ["slides.preserve-and-cite", "destructive.definition"], nodes: ["slide_deck_handling", "external_state_change_confirmation"], audit: "Deck editing only." },

  { id: "artifacts.manifest-triggers", section: "Artifacts and latent obligations", line: 306 },
  { id: "artifacts.latent-obligations", section: "Artifacts and latent obligations", line: 308 },
  { id: "artifacts.retain-when-uncertain", section: "Artifacts and latent obligations", line: 310 },

  // Email and calendar are scoped to their artifact types. The privacy floor
  // at line 398 names emails and calendars and is always retained.
  { id: "email.privacy", section: "Gmail and email", line: 329, scope: { artifacts: ["email"] }, dependsOn: ["privacy.private-by-default"], nodes: ["email_calendar_privacy"], audit: "Email content and metadata only; line 398 keeps the universal form." },
  { id: "email.state-changes", section: "Gmail and email", line: 331, scope: { artifacts: ["email"] }, dependsOn: ["destructive.definition", "destructive.confirm", "destructive.prefer-reversible"], nodes: ["send_email_requires_explicit_request", "destructive_email_calendar_confirm", "external_email_forward_confirmation", "archive_delete_distinction", "creating_drafts_safer_than_sending"], audit: "Email state changes only. Line 149's 'a writing task that mentions email is not a Gmail action' depends on this clause, so a rewrite request without an email artifact still retains it through that edge." },
  { id: "email.archive-delete", section: "Gmail and email", line: 333, scope: { artifacts: ["email"] }, dependsOn: ["email.state-changes", "destructive.confirm"], nodes: ["archive_delete_distinction", "destructive_email_calendar_confirm", "send_email_requires_explicit_request"], audit: "Email actions only." },
  { id: "calendar.mutations", section: "Calendar", line: 352, scope: { artifacts: ["calendar_event"] }, dependsOn: ["destructive.definition", "destructive.confirm", "privacy.private-by-default"], nodes: ["calendar_event_mutation_policies", "recurring_calendar_cancellation_scope", "destructive_email_calendar_confirm", "email_calendar_privacy"], audit: "Calendar events only." },
  { id: "calendar.privacy", section: "Calendar", line: 354, scope: { artifacts: ["calendar_event"] }, dependsOn: ["privacy.private-by-default"], nodes: ["email_calendar_privacy"], audit: "Calendar content only; line 398 keeps the universal form." },
  { id: "calendar.destructive", section: "Calendar", line: 356, scope: { artifacts: ["calendar_event"] }, dependsOn: ["calendar.mutations", "destructive.definition"], nodes: ["calendar_event_mutation_policies", "recurring_calendar_cancellation_scope"], audit: "Calendar deletion, cancellation, and creation only." },

  // Destructive actions are defined over any user data or external state; the
  // definition includes publishing and purchasing, which need no artifact. No scope.
  { id: "destructive.definition", section: "Destructive and irreversible actions", line: 375, dependsOn: ["precedence.definitions"], nodes: ["destructive_action_definition", "external_state_change_confirmation"] },
  { id: "destructive.confirm", section: "Destructive and irreversible actions", line: 377, dependsOn: ["destructive.definition"], nodes: ["external_state_change_confirmation", "destructive_email_calendar_confirm", "send_email_requires_explicit_request", "calendar_event_mutation_policies"] },
  { id: "destructive.prefer-reversible", section: "Destructive and irreversible actions", line: 379, dependsOn: ["destructive.confirm"], nodes: ["external_state_change_confirmation"] },

  { id: "privacy.private-by-default", section: "Privacy and sensitive attributes", line: 398, nodes: ["privacy_floor", "sensitive_attribute_definition"] },
  { id: "privacy.no-secrets", section: "Privacy and sensitive attributes", line: 400, nodes: ["no_raw_tool_json_exposure", "do_not_mention_internal_policy"] },
  { id: "privacy.content-gated", section: "Privacy and sensitive attributes", line: 402, dependsOn: ["privacy.private-by-default"] },

  { id: "tools.use-and-failure", section: "Connector and tool rules", line: 421 },
  { id: "tools.selection-is-policy", section: "Connector and tool rules", line: 423, dependsOn: ["tools.use-and-failure"] },
  { id: "tools.deterministic-compiler", section: "Connector and tool rules", line: 425 },

  { id: "examples.web-and-writing", section: "Examples and exceptions", line: 444, dependsOn: ["web.verify-first", "writing.format-and-browse"] },
  { id: "examples.pdf-and-sheets", section: "Examples and exceptions", line: 446, dependsOn: ["pdf.manifest-activation", "sheets.latent-formulas"] },
  { id: "examples.email-and-image", section: "Examples and exceptions", line: 448, dependsOn: ["email.archive-delete", "image-read.multi-feature"] },

  { id: "closing.retain-when-uncertain", section: "Closing instruction", line: 467 },
];

/** Section title lines and the fixed sub-headings, retained with any clause of their section so the slice reads as the source does. */
const SECTION_HEADING = /^## (.+)$/;
const BOILERPLATE_LINE = /^- (.+?) (rule|example) (\d+): (.*)$/;
const digest = (text: string): string => createHash("sha256").update(text).digest("hex");

export const CLAUSE_MAP_HASH = digest(JSON.stringify({ source: SOURCE_POLICY_SHA256, clauses: CLAUSES }));

/**
 * Source-first condition index over the whole policy, audited once and frozen
 * independently of any canary. A condition is a sentence whose directive for
 * this turn depends on what the request itself states: whether the user has
 * already confirmed, authorized, requested, or limited something, or left
 * something unstated. Sentences that merely name when a duty applies (a task
 * type, an artifact, a tool) are triggers, not conditions: selection applies
 * them and the answering model reads them in the slice. Sentences conditioned
 * on facts the request cannot settle (tool failure, artifact contents, evidence
 * availability) and compiler meta-instructions are excluded for the same
 * reason. `sentence` is verbatim from the clause line; `condition` is the
 * verbatim span of that sentence that the request's words must meet for the
 * condition to hold. A `restates` entry names a clause whose own sentence
 * states the same condition again without adding anything checkable; it is
 * indexed once so a reader answers each condition once.
 */
export type PolicyCondition = {
  clause: string;
  id: string;
  sentence: string;
  condition: string;
  restates?: readonly string[];
};

export const CONDITIONS: readonly PolicyCondition[] = [
  { clause: "web.verify-first", id: "web.verify-first/user-limit", sentence: "If the user says not to browse but asks for current or high-stakes information, the need for verification still controls.", condition: "If the user says not to browse but asks for current or high-stakes information" },
  { clause: "writing.preserve-meaning", id: "writing.preserve-meaning/substantive-changes", sentence: "For rewrite, draft, polish, shorten, proofread, and style tasks, preserve the user’s meaning unless they explicitly request substantive changes.", condition: "unless they explicitly request substantive changes" },
  { clause: "writing.format-and-browse", id: "writing.format-and-browse/verification", sentence: "For simple rewriting, do not browse unless the user asks for factual verification or the text requires current facts.", condition: "unless the user asks for factual verification or the text requires current facts" },
  { clause: "writing.not-an-action", id: "writing.not-an-action/draft-not-send", sentence: "A writing task that mentions email is not automatically a Gmail action. Drafting text is different from sending email.", condition: "A writing task that mentions email" },
  { clause: "image-gen.require-tool", id: "image-gen.require-tool/prompt-artifact", sentence: "Do not expose raw image-tool arguments in the final answer unless the user asks for a prompt artifact.", condition: "unless the user asks for a prompt artifact" },
  { clause: "image-gen.intent", id: "image-gen.intent/ambiguous", sentence: "If the request is ambiguous, make conservative assumptions that preserve safety and privacy.", condition: "If the request is ambiguous" },
  { clause: "image-read.inspect-and-identify", id: "image-read.inspect-and-identify/identity-provided", sentence: "Do not name a person unless the user provided the identity or the task is clearly about a known public figure in a provided context that allows identification.", condition: "unless the user provided the identity or the task is clearly about a known public figure in a provided context that allows identification" },
  { clause: "sheets.inspect-and-preserve", id: "sheets.inspect-and-preserve/formulas", sentence: "Do not overwrite formulas unless explicitly requested.", condition: "unless explicitly requested" },
  { clause: "slides.edit-limits", id: "slides.edit-limits/requested", sentence: "When editing a deck, avoid changing branding, ordering, data labels, or chart values unless requested.", condition: "unless requested" },
  { clause: "email.privacy", id: "email.privacy/task-requires", sentence: "Do not expose addresses, private threads, or confidential details beyond what the task requires.", condition: "beyond what the task requires" },
  { clause: "email.state-changes", id: "email.state-changes/explicit-intent", sentence: "Require explicit user intent and confirmation when appropriate.", condition: "explicit user intent and confirmation" },
  { clause: "email.archive-delete", id: "email.archive-delete/scope", sentence: "Confirm the exact action, scope, and target messages before acting.", condition: "the exact action, scope, and target messages" },
  { clause: "email.archive-delete", id: "email.archive-delete/draft-not-send", sentence: "A request to draft or prepare an email is not permission to send it.", condition: "A request to draft or prepare an email" },
  { clause: "calendar.mutations", id: "calendar.mutations/fields", sentence: "Creating, updating, rescheduling, canceling, or deleting events changes external state and requires confirmation. Confirm title, attendees, date, time, time zone, location, conferencing, and recurrence.", condition: "Confirm title, attendees, date, time, time zone, location, conferencing, and recurrence", restates: ["calendar.destructive"] },
  { clause: "destructive.confirm", id: "destructive.confirm/confirmation", sentence: "Ask for confirmation before destructive actions. Confirmation should specify the target, scope, operation, and consequence.", condition: "Confirmation should specify the target, scope, operation, and consequence" },
  { clause: "destructive.confirm", id: "destructive.confirm/ambiguity", sentence: "If ambiguity remains, ask a focused clarifying question.", condition: "If ambiguity remains" },
];

export const CONDITION_INDEX_HASH = digest(JSON.stringify({ clauseMap: CLAUSE_MAP_HASH, conditions: CONDITIONS }));

/** The indexed conditions of the clauses a selection retained, in source order. Structure decides the list; nothing semantic does. */
export function listConditions(selection: SourceClauseSelection): PolicyCondition[] {
  const retained = new Set(selection.clauses.filter((clause) => clause.retained).map((clause) => clause.id));
  return CONDITIONS.filter((condition) => retained.has(condition.clause));
}

type Line = { number: number; text: string; startByte: number; endByte: number };

/** Every line of the pinned source with its byte span; the newline belongs to the line. */
function indexLines(source: string): Line[] {
  const lines: Line[] = [];
  let offset = 0;
  let number = 1;
  for (const raw of source.split(/(?<=\n)/)) {
    const bytes = Buffer.byteLength(raw);
    lines.push({ number, text: raw.replace(/\n$/, ""), startByte: offset, endByte: offset + bytes });
    offset += bytes;
    number += 1;
  }
  return lines;
}

function isIrrelevant(scope: ClauseScope, context: ArtifactContext | null | undefined): boolean {
  if (!context?.exhaustive) return false;
  if ("artifacts" in scope) {
    if (!context.exhaustive.artifacts) return false;
    return context.artifactType === undefined || !scope.artifacts.includes(context.artifactType);
  }
  if (!context.exhaustive.tools) return false;
  const available = new Set((context.toolsAvailable ?? []).map((tool) => tool.toLowerCase()));
  return !scope.tools.some((tool) => available.has(tool.toLowerCase()));
}

/**
 * Projects the request onto the clause map. `seed` is the current selector's
 * dependency-closed selection; its policy ids are positive signals only.
 */
export function projectSourceClauses(policies: Policy[], seed: PolicySelection, source: string, context: ArtifactContext | null | undefined): PolicySelection {
  if (digest(source) !== SOURCE_POLICY_SHA256) throw new Error("Clause map requires the audited original policy bytes; re-audit the map for a changed source");
  const lines = indexLines(source);
  const byLine = new Map(lines.map((line) => [line.number, line]));
  const known = new Set(policies.map((policy) => policy.id));
  const byId = new Map<string, Clause>();
  for (const clause of CLAUSES) {
    if (byId.has(clause.id)) throw new Error(`Clause map declares ${clause.id} twice`);
    byId.set(clause.id, clause);
    if (clause.scope && !clause.audit) throw new Error(`Clause ${clause.id} has a scope without an audit note`);
    for (const node of clause.nodes ?? []) if (!known.has(node)) throw new Error(`Clause ${clause.id} names unknown policy ${node}`);
  }
  for (const clause of CLAUSES) for (const dependency of clause.dependsOn ?? []) if (!byId.has(dependency)) throw new Error(`Clause ${clause.id} depends on unknown clause ${dependency}`);

  // The map must cover every prose paragraph, and only prose paragraphs.
  const mapped = new Set(CLAUSES.map((clause) => clause.line));
  for (const line of lines) {
    const prose = line.text !== "" && !line.text.startsWith("- ") && !line.text.startsWith("#") && !line.text.endsWith(":");
    if (prose && !mapped.has(line.number) && !(line.number in NON_POLICY_LINES)) throw new Error(`Source line ${line.number} is prose but not in the clause map`);
    if (!prose && mapped.has(line.number)) throw new Error(`Clause map line ${line.number} is not a prose paragraph`);
  }

  const selected = new Set(seed.policies.map((policy) => policy.id));
  const status = new Map<string, { retained: boolean; reasons: string[] }>();
  const retain = (id: string, reason: string): void => {
    const entry = status.get(id) ?? { retained: false, reasons: [] };
    entry.retained = true;
    if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
    status.set(id, entry);
  };
  for (const clause of CLAUSES) {
    if (!clause.scope) { retain(clause.id, "unscoped clause; no structural fact can establish irrelevance"); continue; }
    const signal = (clause.nodes ?? []).filter((node) => selected.has(node));
    if (signal.length) retain(clause.id, `positive selector signal: ${signal.join(", ")}`);
    else if (!isIrrelevant(clause.scope, context)) retain(clause.id, "no exhaustive declaration establishes irrelevance; retained");
  }
  let retainedCount = -1;
  while (retainedCount !== status.size) {
    retainedCount = status.size;
    for (const [id, entry] of [...status]) {
      if (!entry.retained) continue;
      for (const dependency of byId.get(id)!.dependsOn ?? []) retain(dependency, `source-semantic dependency of ${id}`);
    }
  }
  for (const clause of CLAUSES) {
    if (status.has(clause.id)) continue;
    const scope = clause.scope!;
    const fact = "artifacts" in scope
      ? `exhaustive artifacts declared; declared type ${context?.artifactType ?? "none"} is outside ${scope.artifacts.join("/")}`
      : `exhaustive tools declared; none of ${scope.tools.join("/")} is available`;
    status.set(clause.id, { retained: false, reasons: [`pruned by trusted structural fact: ${fact}`] });
  }

  // Boilerplate: group the nine per-section bullets by their label-stripped
  // text, keep the first occurrence of each distinct group, record the rest.
  const canonical = new Map<string, { line: Line; section: string; subsumes: Array<{ section: string; line: number; startByte: number; endByte: number; sha256: string }> }>();
  const sectionOf = new Map<number, string>();
  let current = "";
  for (const line of lines) {
    const heading = SECTION_HEADING.exec(line.text);
    if (heading) current = heading[1];
    sectionOf.set(line.number, current);
    const bullet = BOILERPLATE_LINE.exec(line.text);
    if (!bullet) continue;
    if (bullet[1] !== current) throw new Error(`Boilerplate line ${line.number} names ${bullet[1]} inside ${current}`);
    const key = `${bullet[2]} ${bullet[3]}: ${bullet[4]}`;
    const group = canonical.get(key);
    const copy = { section: current, line: line.number, startByte: line.startByte, endByte: line.endByte, sha256: digest(line.text) };
    if (group) group.subsumes.push(copy);
    else canonical.set(key, { line, section: current, subsumes: [] });
  }

  const retainedSections = new Set(CLAUSES.filter((clause) => status.get(clause.id)!.retained).map((clause) => clause.section));
  const clauses: SourceClauseSelection["clauses"] = CLAUSES.map((clause) => {
    const line = byLine.get(clause.line)!;
    const entry = status.get(clause.id)!;
    return { id: clause.id, section: clause.section, line: clause.line, startByte: line.startByte, endByte: line.endByte, sha256: digest(line.text), retained: entry.retained, dependsOn: [...(clause.dependsOn ?? [])], reasons: entry.reasons };
  });
  const boilerplate: SourceClauseSelection["boilerplate"] = [...canonical.values()].map((group) => ({
    section: group.section, line: group.line.number, startByte: group.line.startByte, endByte: group.line.endByte, sha256: digest(group.line.text),
    retained: retainedSections.has(group.section) || group.subsumes.some((copy) => retainedSections.has(copy.section)),
    subsumes: group.subsumes,
  }));
  const sourceClauseSelection: SourceClauseSelection = {
    contractVersion: "source-clauses-v1",
    clauseMapHash: CLAUSE_MAP_HASH,
    exhaustive: { artifacts: context?.exhaustive?.artifacts === true, tools: context?.exhaustive?.tools === true },
    seedPolicyIds: seed.policies.map((policy) => policy.id),
    retainedSections: [...retainedSections],
    clauses,
    boilerplate,
  };
  return { ...seed, sourceClauseSelection };
}

/**
 * Emits the retained lines in source order: section headings for sections
 * with a retained clause, the retained clauses, and each canonical boilerplate
 * line once. A sub-heading ("Detailed operational rules:", "Examples and edge
 * cases:") is printed only when a kept boilerplate line follows it in the same
 * section, and blank lines are collapsed so the slice reads as the source does.
 */
export function emitSourceClauses(source: string, selection: SourceClauseSelection): string {
  const bytes = Buffer.from(source);
  const lines = indexLines(source);
  const keptLines = new Set([
    ...selection.clauses.filter((clause) => clause.retained).map((clause) => clause.line),
    ...selection.boilerplate.filter((group) => group.retained).map((group) => group.line),
  ]);
  const sections = new Set(selection.retainedSections);
  // A sub-heading is kept when the next non-blank line before the following heading or sub-heading is a kept bullet.
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].text.endsWith(":")) continue;
    for (let next = index + 1; next < lines.length && !lines[next].text.startsWith("#") && !lines[next].text.endsWith(":"); next += 1) {
      if (keptLines.has(lines[next].number)) { keptLines.add(lines[index].number); break; }
    }
  }
  const out: Buffer[] = [];
  let current = "";
  let pendingBlank = false;
  for (const line of lines) {
    const heading = SECTION_HEADING.exec(line.text);
    if (heading) current = heading[1];
    if (line.text === "") { pendingBlank = out.length > 0; continue; }
    if (!(heading ? sections.has(current) : keptLines.has(line.number))) continue;
    if (pendingBlank) out.push(Buffer.from("\n"));
    pendingBlank = false;
    out.push(bytes.subarray(line.startByte, line.endByte));
  }
  return Buffer.concat(out).toString("utf8");
}
