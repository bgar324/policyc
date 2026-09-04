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
  // Inspection is read use. It yields to user-imposed no-tool limits and to a
  // purpose the policy refuses to serve, but not to an unrelated confirmation.
  inspect_artifact: ["text_limit", "unresolved_limit", "forbidden_purpose"],
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
export function maskFor(obligation: Obligation, active: ReadonlySet<Mask>, mandated: boolean, state: RequestState): Mask | undefined {
  const masks: readonly Mask[] = obligation.type === "call_tool"
    ? ["text_limit", "unresolved_limit", ...(callEffect(obligation, state) === "act" ? ["ask" as const] : [])]
    : (YIELDS_TO[obligation.type] ?? []);
  for (const mask of masks) {
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
 * Classifies the effect of a concrete connector call. Unknown connectors fail
 * toward acting use so a policy-origin confirmation withholds them.
 */
export function callEffect(obligation: Obligation, state: Pick<RequestState, "operation">): "read" | "act" {
  if (obligation.type !== "call_tool" || !obligation.value) return "act";
  const tool = obligation.value.toLowerCase();
  if (["web", "pdf_read", "file_inspect", "image_inspect", "gmail_read", "calendar_read", "spreadsheet_inspect", "slides_inspect"].includes(tool)) return "read";
  if (["gmail", "calendar", "pdf_edit", "file_write", "image_generate"].includes(tool)) return "act";
  if (["spreadsheet_edit", "slides_edit"].includes(tool)) {
    return ["summarize", "extract", "analyze", "describe"].includes(state.operation ?? "") ? "read" : "act";
  }
  return "act";
}
