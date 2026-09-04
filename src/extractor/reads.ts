import { readFileSync } from "node:fs";
import { z } from "zod";
import { loadPolicies } from "../policy/loader.js";
import { defaultFrontend } from "../compiler/evaluate.js";
import { compileRegressionCase, loadRegressions, regressionContractViolations } from "../eval/regressionContract.js";
import { parsePersistedReads, persistedFrontend } from "../ir/persistedFrontend.js";
import type { Frontend } from "../ir/requestState.js";
import { extractorContract } from "./contract.js";

/**
 * Measurement of a reads file, the one thing an extractor is for.
 *
 *  score: the blind paraphrase fixtures carry an expected authorization or
 *         limit read; report how many the persisted frontend matches, next to
 *         the deterministic frontend on the same fixtures, and any read in the
 *         unsafe direction (present on a non-present case; limited on a case
 *         that asks for the tool). Exit 1 on an unsafe read.
 *  check: compile every case in a set under the persisted frontend and report
 *         regression-contract violations. Exit 1 on any.
 */
export function runReadsCommand(argv: string[]): void {
  const [action, ...rest] = argv;
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new Error(`reads ${action ?? ""}: expected --flag value pairs`);
    values.set(flag, value);
  }
  const aggregateOnly = values.get("--aggregate-only") === "true";
  const readsPath = values.get("--reads");
  if (!readsPath) throw new Error("reads requires --reads <file>");
  const persisted = parsePersistedReads(JSON.parse(readFileSync(readsPath, "utf8")), extractorContract().readContractSha256);
  if (action === "score") {
    const fixtures = values.get("--fixtures");
    if (!fixtures) throw new Error("reads score requires --fixtures <file>");
    const result = scoreFixtures(fixtures, (id) => persistedFrontend(persisted, id));
    const baseline = scoreFixtures(fixtures, () => defaultFrontend);
    for (const group of Object.keys(result.groups)) {
      console.log(`${group}: ${persisted.frontendId} ${result.groups[group].matched}/${result.groups[group].total}; deterministic ${baseline.groups[group].matched}/${baseline.groups[group].total}`);
    }
    console.log(`total: ${persisted.frontendId} ${result.matched}/${result.total}; deterministic ${baseline.matched}/${baseline.total}`);
    if (aggregateOnly) {
      console.log(`unread=${result.unread.length} misses=${result.misses.length} unsafe=${result.unsafe.length}`);
    } else {
      console.log(`unread fixtures: ${result.unread.length ? result.unread.join(", ") : "none"}`);
      for (const miss of result.misses) console.log(`miss: ${miss}`);
      for (const line of result.unsafe) console.log(`UNSAFE: ${line}`);
    }
    if (result.unsafe.length) process.exitCode = 1;
    return;
  }
  if (action === "check") {
    const cases = values.get("--cases");
    if (!cases) throw new Error("reads check requires --cases <file>");
    const policies = loadPolicies();
    let failures = 0;
    let total = 0;
    for (const item of loadRegressions(cases)) {
      total += 1;
      const { selection, prompt } = compileRegressionCase(policies, item, persistedFrontend(persisted, item.caseId));
      const violations = regressionContractViolations(item, selection, prompt);
      const state = selection.requestState!;
      const summary = `authorization=${state.authorization} limit=${state.limit} format=${state.format}${state.evidence[0]?.startsWith("no persisted read") ? " (no read)" : ""}`;
      if (violations.length) {
        failures += 1;
        if (!aggregateOnly) console.log(`FAIL ${item.caseId} [${item.tags.filter((tag) => tag.startsWith("class-")).join(",")}] ${summary}: ${violations.join("; ")}`);
      } else if (!aggregateOnly) {
        console.log(`ok   ${item.caseId} [${item.tags.filter((tag) => tag.startsWith("class-")).join(",")}] ${summary}`);
      }
    }
    console.log(`${failures}/${total} failing cases under ${persisted.frontendId}`);
    if (failures) process.exitCode = 1;
    return;
  }
  throw new Error("reads requires an action: score or check");
}

const fixtureSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().min(1),
    kind: z.literal("authorization"),
    expect: z.enum(["present", "reported", "conditional", "absent"]),
    text: z.string().min(1),
  }).strict(),
  z.object({
    id: z.string().min(1),
    kind: z.literal("limit"),
    expect: z.enum(["limited", "none"]),
    text: z.string().min(1),
    tools: z.array(z.string().min(1)),
  }).strict(),
]);
type Fixture = z.infer<typeof fixtureSchema>;
type Score = { total: number; matched: number; groups: Record<string, { total: number; matched: number }>; misses: string[]; unsafe: string[]; unread: string[] };

export function parseFixtures(raw: string): Fixture[] {
  return raw.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return fixtureSchema.parse(JSON.parse(line));
    } catch (error) {
      throw new Error(`invalid extractor fixture on line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

export function scoreFixtures(path: string, frontendFor: (id: string) => Frontend): Score {
  const fixtures = parseFixtures(readFileSync(path, "utf8"));
  const score: Score = { total: fixtures.length, matched: 0, groups: {}, misses: [], unsafe: [], unread: [] };
  for (const item of fixtures) {
    const state = frontendFor(item.id)(item.text, { toolsAvailable: item.kind === "limit" ? item.tools : [] });
    const group = `${item.kind}, expect ${item.expect}`;
    score.groups[group] ??= { total: 0, matched: 0 };
    score.groups[group].total += 1;
    if (state.evidence[0]?.startsWith("no persisted read")) {
      // The conservative fallback is not a read; it never counts as a match.
      score.unread.push(item.id);
      score.misses.push(`${item.id}: unread (expected ${item.expect})`);
      continue;
    }
    let matched: boolean;
    if (item.kind === "authorization") {
      matched = state.authorization === item.expect;
      if (state.authorization === "present" && item.expect !== "present") score.unsafe.push(`${item.id}: read present on a ${item.expect} case`);
    } else {
      matched = item.expect === "none" ? state.limit === "none" : state.limit !== "none";
      if (item.expect === "none" && state.limit === "limited") score.unsafe.push(`${item.id}: limited a request that asks for the tool`);
    }
    if (matched) { score.matched += 1; score.groups[group].matched += 1; }
    else score.misses.push(`${item.id}: expected ${item.expect}, read ${item.kind === "authorization" ? state.authorization : state.limit}`);
  }
  return score;
}
