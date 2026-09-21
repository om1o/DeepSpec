import { describe, expect, it } from "vitest";
import { summarizeIntakePilot } from "./summarize-intake-pilot.mjs";

const record = (id, workflow = "deepspec", changes = {}) => ({
  id, physicalPartId: id, batch: "batch-1", workflow, outcome: "completed",
  identity: "correct", accepted: true, reference: "Reviewer checked stamped label against catalog",
  activeSeconds: 120, functionalTestSeconds: 30, elapsedSeconds: 150, captureAttempts: 1,
  ...changes,
});

describe("intake pilot summary", () => {
  it("does not invent measurements for an empty template", () => {
    expect(summarizeIntakePilot({ studyId: "pilot", records: [] })).toMatchObject({ status: "no_observations", observations: 0, batches: [] });
  });
  it("includes abandoned and unverified cases in denominators without counting them as correct", () => {
    const summary = summarizeIntakePilot({ studyId: "pilot", records: [record("a"), record("b", "deepspec", { outcome: "abandoned", identity: "unresolved", accepted: false, activeSeconds: 60, elapsedSeconds: 90, captureAttempts: 2 }), record("c", "deepspec", { identity: "unverified", reference: "", accepted: true })] });
    expect(summary.batches[0].deepspec).toMatchObject({ attempted: 3, completed: 2, abandoned: 1, correct: 1, unresolved: 1, unverified: 1, acceptedUnverified: 1, retakes: 1, totalActiveSeconds: 300, totalFunctionalTestSeconds: 90 });
    expect(summary.batches[0].medianActiveReductionPercent).toBeNull();
  });
  it("keeps batches separate and includes functional testing in active time", () => {
    const summary = summarizeIntakePilot({ studyId: "pilot", records: [record("a", "manual", { activeSeconds: 240, elapsedSeconds: 300 }), record("b"), record("c", "manual", { batch: "batch-2" })] });
    expect(summary.batches).toHaveLength(2);
    expect(summary.batches[0].medianActiveReductionPercent).toBe(50);
    expect(summary.batches[0].deepspec.medianActiveSeconds).toBe(120);
    expect(summary.batches[1].medianActiveReductionPercent).toBeNull();
  });
  it("counts wrong accepted identities separately from rejected errors", () => {
    const summary = summarizeIntakePilot({ studyId: "pilot", records: [record("a", "deepspec", { identity: "wrong" }), record("b", "deepspec", { identity: "wrong", accepted: false })] });
    expect(summary.batches[0].deepspec).toMatchObject({ wrong: 2, wrongAccepted: 1 });
  });
  it("retains untimed attempts without treating missing timing as zero", () => {
    const summary = summarizeIntakePilot({ studyId: "pilot", records: [
      record("manual", "manual", { activeSeconds: 240, elapsedSeconds: 300 }),
      record("measured"),
      record("interrupted", "deepspec", { outcome: "abandoned", identity: "unresolved", accepted: false,
        activeSeconds: null, functionalTestSeconds: null, elapsedSeconds: null, timingMissingReason: "Stopwatch interrupted", captureAttempts: 2 }),
    ] });
    expect(summary.observations).toBe(3);
    expect(summary.batches[0].deepspec).toMatchObject({ attempted: 2, abandoned: 1, unresolved: 1,
      timedObservations: 1, missingTiming: 1, medianActiveSeconds: 120, totalActiveSeconds: 120, retakes: 1 });
    expect(summary.batches[0].medianActiveReductionPercent).toBeNull();
  });
  it("reports absent timing totals as null when every attempt is untimed", () => {
    const summary = summarizeIntakePilot({ studyId: "pilot", records: [record("a", "manual", {
      activeSeconds: null, functionalTestSeconds: null, elapsedSeconds: null, timingMissingReason: "Recording unavailable",
    })] });
    expect(summary.batches[0].manual).toMatchObject({ attempted: 1, timedObservations: 0, missingTiming: 1,
      medianActiveSeconds: null, medianElapsedSeconds: null, totalActiveSeconds: null, totalFunctionalTestSeconds: null });
  });
  it("withholds the comparison when the manual arm is missing timing and retains wrong acceptances", () => {
    const summary = summarizeIntakePilot({ studyId: "pilot", records: [record("a", "manual", {
      activeSeconds: null, functionalTestSeconds: null, elapsedSeconds: null,
      timingMissingReason: "Timer failed", identity: "wrong",
    }), record("b", "manual"), record("c")] });
    expect(summary.batches[0].manual).toMatchObject({ attempted: 2, missingTiming: 1, wrongAccepted: 1 });
    expect(summary.batches[0].medianActiveReductionPercent).toBeNull();
  });
  it.each([undefined, "", "   "])("requires a reason for absent timing: %j", (timingMissingReason) => {
    expect(() => summarizeIntakePilot({ studyId: "pilot", records: [record("a", "manual", {
      activeSeconds: null, functionalTestSeconds: null, elapsedSeconds: null, timingMissingReason,
    })] })).toThrow(/reason/i);
  });
  it.each([
    { activeSeconds: -1 }, { activeSeconds: null }, { activeSeconds: "120" },
    { activeSeconds: null, elapsedSeconds: null, timingMissingReason: "Partial timing" },
    { elapsedSeconds: 119 }, { functionalTestSeconds: 121 }, { captureAttempts: 1.5 },
    { identity: "correct", reference: "" }, { accepted: "yes" }, { workflow: "other" },
  ])("rejects invalid or unsupported measurements: %j", (changes) => {
    expect(() => summarizeIntakePilot({ studyId: "pilot", records: [record("a", "deepspec", changes)] })).toThrow();
  });
  it("rejects repeated physical parts across arms and batches", () => {
    expect(() => summarizeIntakePilot({ studyId: "pilot", records: [record("a"), record("b", "manual", { physicalPartId: "a", batch: "batch-2" })] })).toThrow(/physical part/i);
  });
});
