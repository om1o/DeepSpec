import { describe, expect, it } from "vitest";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { scoreComparison } from "./eval-selected-part-comparison.mjs";

const run = (overrides = {}) => ({
  status: "answered",
  topChoice: "Alternator",
  confidence: "medium",
  exactPartNumber: null,
  nextPhotoRequest: null,
  nextPhotoUseful: null,
  elapsedSeconds: 8,
  retakes: 0,
  ...overrides,
});

const comparison = (overrides = {}) => ({
  version: 1,
  frozenAt: "2026-11-25T12:00:00.000Z",
  deepspecCommit: "b6ce549f",
  deepspecModel: "test-provider",
  chatgptModel: "test-product",
  cases: [{
    id: "case-1",
    physicalPartId: "part-1",
    photoSha256: "a".repeat(64),
    selectedTarget: "Alternator below the belt",
    selectedBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    vehicleContext: "No vehicle details supplied",
    question: "What is the selected part?",
    reference: "Reviewer checked the component label",
    acceptedNames: ["Alternator"],
    verifiedPartNumbers: ["ALT-123"],
    runs: { deepspec: run(), chatgpt: run() },
  }],
  ...overrides,
});

describe("selected-part product comparison", () => {
  it("scores only the displayed top choice, never a candidate or evidence mention", () => {
    const input = comparison({
      cases: [{ ...comparison().cases[0], runs: {
        deepspec: run({ topChoice: "Starter", confidence: "high", alternatives: ["Alternator"] }),
        chatgpt: run({ topChoice: "alternator", confidence: "high" }),
      } }],
    });

    const summary = scoreComparison(input);
    expect(summary.deepspec).toMatchObject({ attempted: 1, correct: 0, wrong: 1, confidentWrong: 1, topChoiceAccuracy: 0 });
    expect(summary.chatgpt).toMatchObject({ attempted: 1, correct: 1, wrong: 0, topChoiceAccuracy: 1 });
    expect(summary.paired).toEqual({ bothCorrect: 0, deepspecOnlyCorrect: 0, chatgptOnlyCorrect: 1, neitherCorrect: 0 });
  });

  it("keeps abstentions and provider failures in the denominator", () => {
    const first = comparison().cases[0];
    const summary = scoreComparison(comparison({ cases: [
      { ...first, runs: { deepspec: run({ status: "abstained", topChoice: null, nextPhotoRequest: "Read the label", nextPhotoUseful: true }), chatgpt: run() } },
      { ...first, id: "case-2", physicalPartId: "part-2", photoSha256: "b".repeat(64), runs: { deepspec: run({ status: "error", topChoice: null, confidence: "unstated", elapsedSeconds: null }), chatgpt: run() } },
    ] }));

    expect(summary.deepspec).toMatchObject({ attempted: 2, answered: 0, correct: 0, abstained: 1, errors: 1, usefulNextPhoto: 1, timed: 1, missingTiming: 1, topChoiceAccuracy: 0 });
    expect(summary.chatgpt).toMatchObject({ attempted: 2, correct: 2, topChoiceAccuracy: 1 });
    expect(summary.timing).toEqual({ pairedTimedCases: 1, missingPairs: 1, medianDeepSpecMinusChatGPTSeconds: null });
    expect(summary.deepspec.medianElapsedSeconds).toBeNull();
    expect(summary.chatgpt.medianElapsedSeconds).toBeNull();
  });

  it("separates verified exact IDs from unsupported claims", () => {
    const first = comparison().cases[0];
    const summary = scoreComparison(comparison({ cases: [
      { ...first, runs: { deepspec: run({ exactPartNumber: "ALT-123" }), chatgpt: run({ exactPartNumber: "WRONG" }) } },
      { ...first, id: "case-2", physicalPartId: "part-2", photoSha256: "b".repeat(64), verifiedPartNumbers: [], runs: { deepspec: run({ exactPartNumber: "GUESS" }), chatgpt: run() } },
    ] }));

    expect(summary.deepspec).toMatchObject({ exactIdEligible: 1, exactIdClaimed: 1, exactIdCorrect: 1, unverifiedExactIdClaims: 1, exactIdPrecision: 1, exactIdCoverage: 1 });
    expect(summary.chatgpt).toMatchObject({ exactIdEligible: 1, exactIdClaimed: 1, exactIdCorrect: 0, exactIdPrecision: 0, exactIdCoverage: 0 });
  });

  it("rejects missing paired runs, repeated physical parts, and absent ground truth", () => {
    const first = comparison().cases[0];
    expect(() => scoreComparison(comparison({ cases: [] }))).toThrow(/at least one reviewed case/i);
    expect(() => scoreComparison(comparison({ cases: [{ ...first, runs: { deepspec: run() } }] }))).toThrow(/chatgpt/i);
    expect(() => scoreComparison(comparison({ cases: [first, { ...first, id: "case-2" }] }))).toThrow(/physicalPartId/i);
    expect(() => scoreComparison(comparison({ cases: [{ ...first, reference: "" }] }))).toThrow(/reference/i);
    expect(() => scoreComparison(comparison({ cases: [{ ...first, selectedBox: { x: 0.9, y: 0.2, width: 0.3, height: 0.4 } }] }))).toThrow(/selectedBox/i);
    expect(() => scoreComparison(comparison({ cases: [{ ...first, acceptedNames: ["---"] }] }))).toThrow(/acceptedNames/i);
    expect(() => scoreComparison(comparison({ cases: [{ ...first, runs: { ...first.runs, deepspec: run({ topChoice: "..." }) } }] }))).toThrow(/topChoice/i);
    expect(() => scoreComparison(comparison({ cases: [{ ...first, verifiedPartNumbers: ["---"] }] }))).toThrow(/verifiedPartNumbers/i);
    expect(() => scoreComparison(comparison({ cases: [{ ...first, runs: { ...first.runs, deepspec: run({ exactPartNumber: "---" }) } }] }))).toThrow(/exactPartNumber/i);
    expect(() => scoreComparison(comparison({ cases: [{ ...first, question: "" }] }))).toThrow(/question/i);
  });

  it("runs the CLI on a reviewed-case file and fails closed on an empty file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deepspec-comparison-"));
    const path = join(directory, "cases.json");
    try {
      await writeFile(path, JSON.stringify(comparison()));
      const command = join(process.cwd(), "scripts", "eval-selected-part-comparison.mjs");
      const valid = spawnSync(process.execPath, [command, path], { encoding: "utf8" });
      expect(valid.status).toBe(0);
      expect(JSON.parse(valid.stdout)).toMatchObject({ attemptedCases: 1, deepspec: { correct: 1 }, chatgpt: { correct: 1 } });

      await writeFile(path, JSON.stringify(comparison({ cases: [] })));
      const empty = spawnSync(process.execPath, [command, path], { encoding: "utf8" });
      expect(empty.status).toBe(1);
      expect(empty.stderr).toMatch(/at least one reviewed case/i);
    } finally {
      await rm(path, { force: true });
      await rmdir(directory);
    }
  });
});
