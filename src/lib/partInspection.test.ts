import { emptyPartInspection, normalizePartInspection } from "./partInspection";

const record = { ...emptyPartInspection, inspectorName: "Pat", inspectedAt: "2026-09-20T12:00:00.000Z" };

describe("human inspection validation", () => {
  it("keeps untested and uninspected defaults without inferred AI claims", () => {
    expect(normalizePartInspection(record)).toEqual(record);
    expect(normalizePartInspection(undefined)).toBeUndefined();
  });
  it.each([
    { inspectedAt: "bad date" }, { inspectorName: " " }, { visibleCondition: "working" },
    { functionalStatus: "certified" }, { confirmedPartName: "Alternator" }, { partNumber: "123" },
    { visibleCondition: "visible_damage" }, { functionalStatus: "passed" }, { visibleNotes: null },
  ])("rejects malformed or unsupported claims %j", (patch) => {
    expect(normalizePartInspection({ ...record, ...patch })).toBeUndefined();
  });
  it("retains recorded test evidence separately from appearance", () => {
    expect(normalizePartInspection({ ...record, visibleCondition: "no_visible_damage", functionalStatus: "failed", functionalNotes: "Bench test: no output" }))
      .toMatchObject({ visibleCondition: "no_visible_damage", functionalStatus: "failed", functionalNotes: "Bench test: no output" });
  });
});
