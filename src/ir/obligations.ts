import type { Obligation, ObligationType } from "../policy/types.js";
import type { RequestState } from "./requestState.js";

/**
 * The obligation algebra. Precedence between what a request allows and what a
 * node obliges is not written per node and not written as conditionals in the
 * evaluator; it is declared here, once, per obligation type, and applied by one
 * masking loop.
 *
 * A mask is a fact that withholds obligations of the types that yield to it.
 * Masks of `user` origin come from the request state (the user bounded the
 * turn). Masks of `policy` origin come from the resolved program itself (the
 * program asks for confirmation first) or from a purpose the source policy
 * refuses to serve. A node declared `mandated` in the policy pack keeps its
 * obligations under user-origin masks: the source policy outranks the user's
 * stated limit for that node. Nothing is exempt from policy-origin masks.
 */

export type Mask = "text_limit" | "unresolved_limit" | "ask" | "forbidden_purpose";

export const MASK_ORIGIN: Record<Mask, "user" | "policy"> = {
  text_limit: "user",
  unresolved_limit: "user",
  ask: "policy",
  forbidden_purpose: "policy",
};

/** Which masks each obligation type yields to. Types absent here yield to nothing. */
export const YIELDS_TO: Partial<Record<ObligationType, readonly Mask[]>> = {
  // A tool call is an act; the user's stated limit withholds it.
  call_tool: ["text_limit", "unresolved_limit"],
  // Inspection is a tool call on synthetic connectors; it also yields to asking
  // first (ask outranks act) and to a purpose the policy refuses to serve
  // (declining outranks inspecting for that purpose).
  inspect_artifact: ["text_limit", "unresolved_limit", "ask", "forbidden_purpose"],
};

/** Masks that hold for this request state alone. `ask` is decided by the resolved program, not here. */
export function stateMasks(state: RequestState): Set<Mask> {
  const masks = new Set<Mask>();
  if (state.deliverable === "text") masks.add("text_limit");
  if (state.deliverable === "unresolved") masks.add("unresolved_limit");
  if (state.purpose !== "none" && !state.permittedTask) masks.add("forbidden_purpose");
  return masks;
}

/** The mask, if any, that withholds this obligation for a node. */
export function maskFor(obligation: Obligation, active: ReadonlySet<Mask>, mandated: boolean): Mask | undefined {
  for (const mask of YIELDS_TO[obligation.type] ?? []) {
    if (!active.has(mask)) continue;
    if (mandated && MASK_ORIGIN[mask] === "user") continue;
    return mask;
  }
  return undefined;
}

export function isToolBound(obligation: Obligation): boolean {
  return obligation.type === "call_tool" || obligation.type === "inspect_artifact";
}

/**
 * What calling a tool does, by the synthetic connectors' naming convention:
 * `web` and names ending in `_read`, `_inspect`, or `_search` only read; every
 * other tool alters user data or external state, which is the source prompt's
 * definition of a destructive action. Only acting tools wait behind an ask.
 */
export function toolEffect(tool: string): "read" | "act" {
  return tool === "web" || /_(?:read|inspect|search)$/.test(tool) ? "read" : "act";
}
