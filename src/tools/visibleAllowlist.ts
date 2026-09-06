import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "../compiler/artifact.js";
import { loadBehavioralCases, type BehavioralCase } from "../experiment/cases.js";

export const CORPUS_DIR = "eval/behavioral";

/**
 * The explicit visible development allowlist, pinned to the bytes it had when
 * the 388 checkpoint comparisons were first recorded. Held-out and held-back
 * files are absent by construction; tools that take this list read no other
 * corpus file.
 */
export const VISIBLE_ALLOWLIST: Array<{ file: string; sha256: string }> = [
  { file: "smoke-v1.jsonl", sha256: "718224d52952edb5f99d0fdb67eaab3f9ef0222c820072922d58262818fc4b83" },
  { file: "development-v1.jsonl", sha256: "abacb5d0bf58f2ff98659baeba1788c7cb317739c3df7b36475e08b23df5db15" },
  { file: "pilot-v1.jsonl", sha256: "145b6265e802fff274fc3d999fe8e8f406328eac200b23c797fcead52cb65898" },
  { file: "pilot-v2.jsonl", sha256: "40069075ed37238fd04441fb04e91e852ab0bb0343be438bbe70465a9d6d45d9" },
  { file: "compiler-v0.4-regression-smoke-v1.jsonl", sha256: "195d359f8586adbb49bc42cc8c9c4e9aace274f4b1b00fa8130dfe321982f0d6" },
  { file: "compiler-v0.6-regression-v1.jsonl", sha256: "b0769147fefa627d7fc1e2bb4ed19bc9c701cd3e934a5c9c3c8ac9621583aa63" },
  { file: "compiler-v0.7-regressions.jsonl", sha256: "73bb05de0ff30a878aae952c1cf5ce66a1f541677211725f440ca43566c01e80" },
  { file: "compiler-v0.8-regressions.jsonl", sha256: "01be468a5345f274c3f2e6499211ddad5653ac12abf6feaf5faa62dc6de97ccc" },
  { file: "compiler-v0.9-regressions.jsonl", sha256: "30276a7737c41b23a00de3b07f3455769e67c86373a724d6c7d96a89a00774a0" },
  { file: "compiler-v0.10-regressions.jsonl", sha256: "e2e78b89a6a58d9c2a2f341b77174bb201291690b62ea58a7079e5143860eb9e" }
];

export const EXPECTED_VISIBLE_CASES = 97;

export type VisibleCase = { file: string; item: BehavioralCase };
export type VisibleCorpus = {
  cases: VisibleCase[];
  files: Array<{ file: string; sha256: string; cases: number; datasetVersion: string; datasetHash: string }>;
};

/** Loads the allowlist from `root`, refusing changed bytes, duplicate ids, or a count other than 97. */
export function loadVisibleCorpus(root: string): VisibleCorpus {
  const cases: VisibleCase[] = [];
  const files: VisibleCorpus["files"] = [];
  const seen = new Set<string>();
  for (const entry of VISIBLE_ALLOWLIST) {
    const path = join(root, CORPUS_DIR, entry.file);
    const hash = sha256(readFileSync(path, "utf8"));
    assert(hash === entry.sha256, `allowlist mismatch: ${CORPUS_DIR}/${entry.file} is ${hash}, expected ${entry.sha256}`);
    const set = loadBehavioralCases(path);
    for (const item of set.cases) {
      assert(!seen.has(item.caseId), `allowlist mismatch: duplicate case id ${item.caseId}`);
      seen.add(item.caseId);
      cases.push({ file: entry.file, item });
    }
    files.push({ file: entry.file, sha256: hash, cases: set.cases.length, datasetVersion: set.datasetVersion, datasetHash: set.datasetHash });
  }
  assert(cases.length === EXPECTED_VISIBLE_CASES, `allowlist mismatch: ${cases.length} distinct cases, expected ${EXPECTED_VISIBLE_CASES}`);
  return { cases, files };
}
