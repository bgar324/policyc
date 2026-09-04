import { z } from "zod";
import { artifactTypeSchema, fieldsComplete, type RequestState } from "./requestState.js";

/**
 * Policy conditions: the intermediate representation of a policy node's control
 * flow. A node's default text and obligations are its conservative branch. A
 * node may also declare `branches`: each names a condition over request state
 * and the text and obligations to emit when the condition holds.
 *
 * Every tested field is tri-state. A condition is `true` only when every clause
 * is decided true, `false` when any clause is decided false, and `unknown` when
 * some clause depends on state the frontend could not decide. Partial
 * evaluation emits a branch only on `true`; `unknown` falls through to the
 * conservative branch, which is what keeps compilation fail-closed regardless
 * of which frontend produced the state.
 */

export const conditionSchema = z.object({
  artifactType: artifactTypeSchema.optional(),
  authorization: z.enum(["present", "reported", "conditional", "absent"]).optional(),
  limit: z.enum(["limited", "ambiguous", "none"]).optional(),
  /** "complete": every required field stated; "incomplete": some missing. */
  fields: z.enum(["complete", "incomplete"]).optional(),
  operationNamed: z.boolean().optional(),
  operationNegated: z.boolean().optional(),
  purpose: z.enum(["sensitive_attribute_read", "identification", "none"]).optional(),
  permittedTask: z.boolean().optional(),
  format: z.enum(["requested", "none"]).optional(),
  deliverable: z.enum(["text", "open", "unresolved"]).optional(),
  externalDisclosure: z.enum(["safe", "confidential_external"]).optional(),
  requestedSlideReorder: z.literal(true).optional(),
  slideTask: z.union([z.literal(true), z.literal("unknown")]).optional(),
}).strict();

export type Condition = z.infer<typeof conditionSchema>;
export type Truth = "true" | "false" | "unknown";

export function evaluateCondition(condition: Condition, state: RequestState): { truth: Truth; evidence: string[] } {
  const evidence: string[] = [];
  let truth: Truth = "true";
  const clause = (name: string, decided: Truth) => {
    evidence.push(`${name}: ${decided}`);
    if (decided === "false") truth = "false";
    else if (decided === "unknown" && truth !== "false") truth = "unknown";
  };
  if (condition.artifactType !== undefined) clause(`artifact type is ${condition.artifactType}`, state.artifactType === condition.artifactType ? "true" : "false");
  if (condition.authorization !== undefined) clause(`authorization is ${condition.authorization}`, state.authorization === condition.authorization ? "true" : "false");
  if (condition.limit !== undefined) clause(`limit is ${condition.limit}`, state.limit === condition.limit ? "true" : "false");
  if (condition.fields !== undefined) {
    const complete = fieldsComplete(state);
    clause(`fields ${condition.fields}`, complete === undefined ? "unknown" : (complete === (condition.fields === "complete") ? "true" : "false"));
  }
  if (condition.operationNamed !== undefined) clause(`operation named is ${condition.operationNamed}`, state.operationNamed === condition.operationNamed ? "true" : "false");
  if (condition.operationNegated !== undefined) clause(`operation negated is ${condition.operationNegated}`, state.operationNegated === condition.operationNegated ? "true" : "false");
  if (condition.purpose !== undefined) clause(`purpose is ${condition.purpose}`, state.purpose === condition.purpose ? "true" : "false");
  if (condition.permittedTask !== undefined) clause(`permitted task is ${condition.permittedTask}`, state.permittedTask === condition.permittedTask ? "true" : "false");
  if (condition.format !== undefined) clause(`format is ${condition.format}`, state.format === condition.format ? "true" : "false");
  if (condition.deliverable !== undefined) {
    clause(`deliverable is ${condition.deliverable}`, state.deliverable === "unresolved" && condition.deliverable !== "unresolved" ? "unknown" : (state.deliverable === condition.deliverable ? "true" : "false"));
  }
  if (condition.externalDisclosure !== undefined) {
    clause(
      `external disclosure is ${condition.externalDisclosure}`,
      state.externalDisclosure === "unknown"
        ? "unknown"
        : (state.externalDisclosure === condition.externalDisclosure ? "true" : "false"),
    );
  }
  if (condition.requestedSlideReorder !== undefined) {
    clause(
      "requested slide reorder is true",
      state.requestedSlideReorder === null
        ? "unknown"
        : (state.requestedSlideReorder === true ? "true" : "false"),
    );
  }
  if (condition.slideTask !== undefined) {
    clause(
      `slide task is ${condition.slideTask}`,
      condition.slideTask === "unknown"
        ? (state.slideTask === null ? "true" : "false")
        : (state.slideTask === null ? "unknown" : (state.slideTask ? "true" : "false")),
    );
  }
  return { truth, evidence };
}
