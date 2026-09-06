import { createHash } from "node:crypto";
import type { Policy, PolicySelection, SourceSelection } from "../policy/types.js";

// This topical map is audited against one source, not inferred from YAML prose.
// It does not claim that the authored nodes encode every rule in a section.
export const SOURCE_POLICY_SHA256 = "961150058da20550d6004e52bdbd9a35954028d182883b3a4fcf19ff71ec803a";
const PREAMBLE = "Preamble";
const PRECEDENCE = "Policy precedence and operating model";
const CORE = "Core behavior";
const HIDDEN = "Hidden reasoning";
const BACKGROUND = "Background work and turn completion";
const WEB = "Web and current information";
const CITATIONS = "Citations and source quality";
const WRITING = "Writing and rewriting";
const GENERATION = "Image generation";
const IMAGES = "Image interpretation and person safety";
const NUMBERS = "Charts, graphs, tables, and numeric extraction";
const PDF = "PDFs and documents";
const SHEETS = "Spreadsheets and structured data";
const SLIDES = "Slides and presentations";
const ARTIFACTS = "Artifacts and latent obligations";
const EMAIL = "Gmail and email";
const CALENDAR = "Calendar";
const DESTRUCTIVE = "Destructive and irreversible actions";
const PRIVACY = "Privacy and sensitive attributes";
const TOOLS = "Connector and tool rules";
const EXAMPLES = "Examples and exceptions";
const CLOSING = "Closing instruction";

const NODE_SECTIONS: Record<string, readonly string[]> = {
  universal_honesty: [CORE],
  no_hidden_reasoning_reveal: [HIDDEN],
  no_background_work_claims: [BACKGROUND],
  asynchronous_work_request: [BACKGROUND],
  do_not_mention_internal_policy: [HIDDEN],
  do_not_invent_facts: [CORE],
  no_raw_tool_json_exposure: [TOOLS, PRIVACY],
  privacy_floor: [PRIVACY],
  policy_bypass_refusal: [PRECEDENCE, HIDDEN],
  destructive_action_definition: [DESTRUCTIVE],
  external_state_change_confirmation: [DESTRUCTIVE],
  citation_definition: [CITATIONS],
  // Inspection is defined locally by the already-selected artifact rule.
  // Its shared context must not fan out to every unrelated artifact domain.
  artifact_inspection_definition: [ARTIFACTS, TOOLS],
  sensitive_attribute_definition: [IMAGES, PRIVACY],
  numeric_accuracy_definition: [NUMBERS],
  writing_output_format: [WRITING],
  current_info_definition: [WEB],
  pdf_handling: [PDF],
  pdf_mutation: [PDF, DESTRUCTIVE],
  pdf_specific_claims_cite_pages: [PDF, CITATIONS],
  spreadsheet_handling: [SHEETS],
  slide_deck_handling: [SLIDES],
  preserve_spreadsheet_formulas: [SHEETS],
  chart_table_extraction_caution: [NUMBERS],
  inspect_visual_pages_or_charts: [PDF, NUMBERS],
  image_generation_requires_tool: [GENERATION],
  image_interpretation_requires_inspection: [IMAGES],
  unknown_person_no_identification: [IMAGES],
  sensitive_attributes_no_inference: [IMAGES, PRIVACY],
  chart_image_numeric_caution: [IMAGES, NUMBERS],
  destructive_email_calendar_confirm: [EMAIL, CALENDAR, DESTRUCTIVE],
  send_email_requires_explicit_request: [EMAIL],
  external_email_forward_confirmation: [EMAIL, PRIVACY, DESTRUCTIVE],
  creating_drafts_safer_than_sending: [EMAIL, WRITING],
  email_calendar_privacy: [EMAIL, CALENDAR, PRIVACY],
  archive_delete_distinction: [EMAIL, DESTRUCTIVE],
  calendar_event_mutation_policies: [CALENDAR, DESTRUCTIVE],
  recurring_calendar_cancellation_scope: [CALENDAR],
  current_info_requires_web: [WEB],
  citations_required: [CITATIONS],
  authoritative_sources_preferred: [WEB, CITATIONS],
  no_current_facts_from_memory: [WEB],
  writing_tasks_use_format: [WRITING],
  do_not_browse_for_simple_rewrites: [WRITING, WEB],
  preserve_user_meaning: [WRITING],
  preserve_legal_effect_in_rewrites: [WRITING],
};

// Always carry source-only context and the original integrity kernel. These
// same bytes also accompany both authored arms; universal emitter prose is not
// treated as a replacement for original precedence or exceptions.
const CONTEXT_SECTIONS = [PREAMBLE, PRECEDENCE, CORE, HIDDEN, BACKGROUND, ARTIFACTS, PRIVACY, TOOLS, EXAMPLES, CLOSING];
const SECTION_DEPENDENCIES: Record<string, readonly string[]> = {
  [WEB]: [CITATIONS],
  [CITATIONS]: [WEB],
  [WRITING]: [WEB, EMAIL],
  [IMAGES]: [NUMBERS, PRIVACY],
  [PDF]: [NUMBERS, CITATIONS],
  [SHEETS]: [NUMBERS],
  [SLIDES]: [NUMBERS, IMAGES, CITATIONS],
  [EMAIL]: [DESTRUCTIVE, PRIVACY],
  [CALENDAR]: [DESTRUCTIVE, PRIVACY],
};
const digest = (text: string): string => createHash("sha256").update(text).digest("hex");
const SOURCE_MAP_HASH = digest(JSON.stringify({ source: SOURCE_POLICY_SHA256, nodes: NODE_SECTIONS, context: CONTEXT_SECTIONS, dependencies: SECTION_DEPENDENCIES }));

/** Project the closed selector set one way; extra source clauses never select nodes. */
export function projectSourceSelection(policies: Policy[], seed: PolicySelection, source: string): PolicySelection {
  if (digest(source) !== SOURCE_POLICY_SHA256) throw new Error("Source section map requires the audited original policy bytes; re-audit the map for a changed source");
  const unmapped = policies.filter((policy) => !Object.hasOwn(NODE_SECTIONS, policy.id));
  if (unmapped.length) throw new Error(`Source section map is missing policies: ${unmapped.map((policy) => policy.id).join(", ")}`);

  const starts = [{ heading: PREAMBLE, offset: 0 }, ...Array.from(source.matchAll(/^## (.+)\r?$/gm), (match) => ({ heading: match[1], offset: match.index }))];
  let byteOffset = 0;
  const sections: SourceSelection["sections"] = starts.map((start, index) => {
    const end = starts[index + 1]?.offset ?? source.length;
    const text = source.slice(start.offset, end);
    const startByte = byteOffset;
    byteOffset += Buffer.byteLength(text);
    return {
      heading: start.heading,
      startByte,
      endByte: byteOffset,
      sha256: digest(text),
      policyIds: policies.filter((policy) => NODE_SECTIONS[policy.id].includes(start.heading)).map((policy) => policy.id).sort(),
      retained: false,
      context: CONTEXT_SECTIONS.includes(start.heading),
      reasons: [],
    };
  });
  const byHeading = new Map(sections.map((section) => [section.heading, section]));
  const retain = (heading: string, reason: string): void => {
    const section = byHeading.get(heading);
    if (!section) throw new Error(`Audited source section is missing: ${heading}`);
    section.retained = true;
    if (!section.reasons.includes(reason)) section.reasons.push(reason);
  };
  for (const section of sections) {
    if (section.context) retain(section.heading, "original integrity kernel or source-only operating context");
    else if (!section.policyIds.length) {
      section.context = true;
      retain(section.heading, "unmapped source retained; exclusion not established");
    }
  }
  for (const policy of seed.policies) {
    for (const heading of NODE_SECTIONS[policy.id]) retain(heading, `current-selector seed: ${policy.id}`);
  }
  // A frontend fallback or an undecided applicability fact is not exclusion
  // evidence. Do not guess which other domains the incomplete read missed.
  if (!seed.requestState || [seed.requestState.currentInformation, seed.requestState.deferredWork, seed.requestState.slideTask].includes(null)) {
    for (const section of sections) retain(section.heading, "unresolved applicability; exclusion not established");
  }

  let retainedCount = -1;
  while (retainedCount !== sections.filter((section) => section.retained).length) {
    retainedCount = sections.filter((section) => section.retained).length;
    for (const section of sections.filter((item) => item.retained)) {
      for (const dependency of SECTION_DEPENDENCIES[section.heading] ?? []) retain(dependency, `source context dependency: ${section.heading}`);
    }
  }
  for (const section of sections) {
    if (!section.retained) section.reasons.push("no mapped node or dependency in shared selection; existing-selector semantic prediction, not proven irrelevance");
  }
  const sourceSelection: SourceSelection = {
    contractVersion: "source-sections-v1",
    selectionBasis: "current-selector-prediction",
    sourceMapHash: SOURCE_MAP_HASH,
    seedPolicyIds: seed.policies.map((policy) => policy.id),
    sections,
  };
  return { ...seed, sourceSelection };
}

/** No trimming, paraphrasing, condition evaluation, or generated policy text. */
export function emitSourceSections(source: string, selection: SourceSelection, contextOnly = false): string {
  const bytes = Buffer.from(source);
  return selection.sections.filter((section) => section.retained && (!contextOnly || section.context))
    .map((section) => bytes.subarray(section.startByte, section.endByte).toString("utf8")).join("");
}
