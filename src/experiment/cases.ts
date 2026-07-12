import { readFileSync } from "node:fs";
import { z } from "zod";
import type { ArtifactContext } from "../policy/types.js";
import { canonicalJson, sha256 } from "../compiler/artifact.js";

const severity = z.enum(["low", "medium", "high", "critical"]);
const validator = z.enum([
  "nonempty", "citations_present", "asks_confirmation", "refuses", "does_not_refuse",
  "required_tool", "forbidden_tool", "no_background_work", "no_hidden_reasoning",
  "no_fake_precision", "states_uncertainty", "preserves_formulas", "contains_terms",
  "cites_page_or_section", "no_sensitive_inference", "no_person_identification"
]);
const requirement = z.object({
  id: z.string().min(1), description: z.string().min(1), severity, validator,
  value: z.string().optional()
}).strict();
const tool = z.discriminatedUnion("type", [
  z.object({ type: z.literal("web_search"), name: z.literal("web") }).strict(),
  z.object({ type: z.literal("function"), name: z.string().min(1), description: z.string().min(1), parameters: z.record(z.string(), z.unknown()) }).strict()
]);

export const behavioralCaseSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  datasetVersion: z.string().min(1),
  split: z.enum(["development", "pilot", "held-out", "adversarial", "smoke"]),
  caseId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
  request: z.string().min(1),
  artifactContext: z.custom<ArtifactContext>().nullable(),
  sourceArtifact: z.record(z.string(), z.unknown()).nullable().optional(),
  applicableObligations: z.array(requirement),
  criticalObligationIds: z.array(z.string()).min(1),
  prohibitions: z.array(requirement),
  expectedRefusal: z.enum(["required", "forbidden", "allowed"]),
  toolExpectation: z.object({ required: z.array(z.string()), forbidden: z.array(z.string()) }).strict(),
  tools: z.array(tool),
  rubric: z.object({ description: z.string().min(1), minQualityScore: z.number().min(0).max(1) }).strict(),
  tags: z.array(z.string().min(1)).min(1),
  template: z.boolean().optional()
}).strict().superRefine((value, ctx) => {
  const obligationIds = new Set(value.applicableObligations.map((item) => item.id));
  for (const id of value.criticalObligationIds) if (!obligationIds.has(id)) ctx.addIssue({ code: "custom", message: `critical obligation ${id} is not declared` });
  const toolNames = new Set(value.tools.map((item) => item.name));
  for (const name of [...value.toolExpectation.required, ...value.toolExpectation.forbidden]) if (!toolNames.has(name)) ctx.addIssue({ code: "custom", message: `tool expectation references unavailable tool ${name}` });
});

export type BehavioralCase = z.infer<typeof behavioralCaseSchema>;
export type LoadedCaseSet = { cases: BehavioralCase[]; datasetHash: string; datasetVersion: string; split: BehavioralCase["split"]; canonical: string };

export function loadBehavioralCases(path: string): LoadedCaseSet {
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) throw new Error(`behavioral case set is empty: ${path}`);
  const cases = lines.map((line, index) => {
    const parsed: unknown = JSON.parse(line);
    const result = behavioralCaseSchema.safeParse(parsed);
    if (!result.success) throw new Error(`invalid behavioral case ${path}:${index + 1}: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    if (result.data.template) throw new Error(`template case cannot be executed: ${result.data.caseId}`);
    return result.data;
  });
  const ids = cases.map((item) => item.caseId);
  if (new Set(ids).size !== ids.length) throw new Error("behavioral case IDs must be unique");
  const versions = new Set(cases.map((item) => item.datasetVersion));
  const splits = new Set(cases.map((item) => item.split));
  if (versions.size !== 1) throw new Error("all cases must have the same datasetVersion");
  if (splits.size !== 1) throw new Error("all cases must have the same dataset split");
  const canonical = cases.map((item) => canonicalJson(item)).join("\n") + "\n";
  return { cases, datasetHash: sha256(canonical), datasetVersion: cases[0].datasetVersion, split: cases[0].split, canonical };
}
