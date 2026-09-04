import { z } from "zod";
import type { ArtifactContext } from "../policy/types.js";

/**
 * Request state: the intermediate representation of one request. It is built
 * once by a frontend, recorded in the compiled artifact, and read by every
 * policy condition during partial evaluation. Nothing downstream of this object
 * looks at the raw request text again.
 *
 * Every field is a fact about the request that a policy condition might test.
 * Unknown is a real value: a condition that tests an unknown field is undecided
 * and the policy's conservative branch is emitted. That is what keeps partial
 * evaluation fail-closed.
 */

export const authorizationStateSchema = z.enum(["present", "reported", "conditional", "absent"]);
export const limitStateSchema = z.enum(["limited", "ambiguous", "none"]);
export const deliverableSchema = z.enum(["text", "open", "unresolved"]);
export const purposeSchema = z.enum(["sensitive_attribute_read", "identification", "none"]);

export const requestStateSchema = z.object({
  /** The operation the artifact context declares, when it declares one. */
  operation: z.string().optional(),
  artifactType: z.string().optional(),
  /** Whether the user has authorized the operation in their own voice. */
  authorization: authorizationStateSchema,
  /** Whether the user has bounded this turn to a text answer. */
  limit: limitStateSchema,
  /**
   * What the user allows this turn: `text` when they bounded it to a text
   * answer; `open` when nothing bounds it, or an ambiguous bound is resolved by
   * the request proving the declared action (see `resolveDeliverable`);
   * `unresolved` when the bound is ambiguous and nothing resolves it.
   */
  deliverable: deliverableSchema,
  /** A purpose the source policy forbids serving regardless of tool. */
  purpose: purposeSchema,
  /**
   * Whether the request also asks for a task the policy permits. A forbidden
   * purpose alone withholds inspection; a forbidden purpose beside a permitted
   * task does not, because the permitted task still needs the artifact read.
   * False when `purpose` is none, or when the frontend cannot tell.
   */
  permittedTask: z.boolean(),
  /** Fields the source policy requires for the operation, and whether each is stated. */
  fields: z.record(z.string(), z.boolean()),
  /** Whether the request names the declared operation at all ("move", "send it"). */
  operationNamed: z.boolean(),
  /** Whether the request negates the declared operation itself ("archive them, not delete"). */
  operationNegated: z.boolean(),
  /** Tools listed as available to the model on this turn; absent when the context declares none. */
  toolsAvailable: z.array(z.string()).optional(),
  /** Which frontend produced this state, so an artifact trace names its source. */
  frontend: z.string().min(1),
  /** Human-readable justification for every non-default reading. */
  evidence: z.array(z.string()),
}).strict();

export type RequestState = z.infer<typeof requestStateSchema>;
export type AuthorizationState = z.infer<typeof authorizationStateSchema>;
export type LimitState = z.infer<typeof limitStateSchema>;

/** A frontend turns a request and its context into request state. */
export type Frontend = (input: string, context: ArtifactContext | null | undefined) => RequestState;

/** True when every field the policy requires is stated. Undefined when no rule exists for the operation. */
export function fieldsComplete(state: Pick<RequestState, "fields">): boolean | undefined {
  const names = Object.keys(state.fields);
  if (names.length === 0) return undefined;
  return names.every((name) => state.fields[name]);
}

/**
 * The request proves the declared action when the user authorized it in their
 * own voice, named it without negating it, and stated every field the policy
 * requires. This is the same fact a confirmation node's `already_authorized`
 * branch tests; it is defined once here so the deliverable and the branches
 * cannot disagree.
 */
export function provesAction(state: Pick<RequestState, "authorization" | "operationNamed" | "operationNegated" | "fields">): boolean {
  return state.authorization === "present" && state.operationNamed && !state.operationNegated && fieldsComplete(state) === true;
}

export function resolveDeliverable(limit: LimitState, proved: boolean): RequestState["deliverable"] {
  if (limit === "limited") return "text";
  if (limit === "none" || proved) return "open";
  return "unresolved";
}

/**
 * Wraps a frontend so a thrown error or an invalid shape becomes the most
 * conservative state: authorization absent, limit ambiguous, no fields, with
 * the failure recorded. Anything that arrives as JSON (a persisted extractor
 * output) must pass through `requestStateSchema.parse` before reaching here.
 */
export function guardedFrontend(frontend: Frontend, name: string): Frontend {
  return (input, context) => {
    let raw: unknown;
    try {
      raw = frontend(input, context);
    } catch (error) {
      return conservativeState(context, name, `${name} frontend failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const parsed = requestStateSchema.safeParse(raw);
    if (!parsed.success) {
      return conservativeState(context, name, `${name} frontend returned an invalid state: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
    }
    return { ...parsed.data, toolsAvailable: parsed.data.toolsAvailable?.map((tool) => tool.toLowerCase()) };
  };
}

export function conservativeState(context: ArtifactContext | null | undefined, frontend: string, reason: string): RequestState {
  return {
    operation: context?.operation,
    artifactType: context?.artifactType,
    authorization: "absent",
    limit: "ambiguous",
    deliverable: "unresolved",
    purpose: "none",
    permittedTask: false,
    fields: {},
    operationNamed: false,
    operationNegated: false,
    toolsAvailable: context?.toolsAvailable?.map((tool) => tool.toLowerCase()),
    frontend,
    evidence: [reason],
  };
}
