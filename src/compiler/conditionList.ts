import type { PolicyConditionsRecord, SourceClauseSelection } from "../policy/types.js";
import { CONDITION_INDEX_HASH, listConditions } from "./sourceClauses.js";

/**
 * The condition_list_slice arm: the clause slice plus the indexed conditions
 * of its retained clauses, resolved by the answering model itself in the same
 * call. It isolates one question against model_reader_slice: does giving the
 * answerer a finite worklist solve the search, or does a separate reader still
 * matter? The instruction states the policy's own logic (a condition the
 * request already meets is discharged) in natural language; it adds no rule,
 * removes none, and carries no machine tokens.
 */

export const CONDITION_LIST_HEADING = "## Conditions to resolve for this request";

export const CONDITION_LIST_INSTRUCTION =
  "The rules above include the following conditions, quoted from the policy, whose effect depends on what this request says. "
  + "Before acting, decide from the request's own words whether each one holds, does not hold, or cannot be decided. "
  + "Where the request already meets a condition in the terms the policy states, do what the policy then directs and do not ask for what the request already supplies; "
  + "where it does not, do what the policy requires instead. Do not report this resolution to the user.";

/** The listed conditions for a clause selection, as artifact provenance. */
export function policyConditionsRecord(selection: SourceClauseSelection): PolicyConditionsRecord {
  return {
    conditionIndexHash: CONDITION_INDEX_HASH,
    conditions: listConditions(selection).map(({ clause, id, sentence, condition }) => ({ clause, id, sentence, condition })),
  };
}

/** Renders the list after the clause slice. An empty list renders nothing, so the arm degrades to the bare slice. */
export function renderConditionList(record: PolicyConditionsRecord): string {
  if (!record.conditions.length) return "";
  const lines = ["", CONDITION_LIST_HEADING, "", CONDITION_LIST_INSTRUCTION, ""];
  for (const condition of record.conditions) lines.push(`- ${condition.sentence}`);
  lines.push("");
  return lines.join("\n");
}
