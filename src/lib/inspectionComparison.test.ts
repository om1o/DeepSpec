import { describe, expect, it } from "vitest";
import type { ComparisonSide, InspectionComparison } from "../types/inspectionComparison";
import { comparisonSideMatches, inspectionComparisonStatus, mergeInspectionComparisons, normalizeComparisonCaptureTarget, normalizeComparisonSide, normalizeComparisonTimestamp, normalizeInspectionComparison, normalizeInspectionComparisons, normalizeRequestedEvidenceGuide } from "./inspectionComparison";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const side = (lookupId: string): ComparisonSide => ({ lookupId, photoId: "photo-1", photoLabel: "overview", photoAddedAt: "2026-11-05T00:00:00Z", scanSavedAt: "2026-11-05T00:00:00Z", sha256: "a".repeat(64), width: 2, height: 3, observedOn: null, vehicleContext: null });
const guide = () => ({ version: 1 as const, kind: "photo" as const, request: "Show the mounting face.", purpose: "Check the obscured edge.", photoIds: ["photo-1"] });
describe("requested-evidence capture protocol", () => {
  const target = () => ({ version: 2, comparisonId: id(1), lookupId: "new-scan", earlier: side("earlier"), subject: "Requested evidence photo", requestedEvidence: guide(), analysisSha256: "b".repeat(64) });
  it("round trips the exact request, chosen original and analysis fingerprint without altering history records", () => {
    expect(normalizeComparisonCaptureTarget(JSON.parse(JSON.stringify(target())))).toEqual(target());
    expect(normalizeRequestedEvidenceGuide({ ...guide(), photoIds: [], kind: "marking" })).toEqual({ ...guide(), photoIds: [], kind: "marking" });
    expect(normalizeInspectionComparison({ ...record(), version: 2 })).toBeUndefined();
  });
  it.each([undefined, null, guide()])("rejects guide presence on a version-one target instead of silently stripping %j", (requestedEvidence) => {
    expect(normalizeComparisonCaptureTarget({ version: 1, comparisonId: id(1), lookupId: "new-scan", earlier: side("earlier"), subject: "Bracket", requestedEvidence })).toBeUndefined();
  });
  it.each([
    { requestedEvidence: undefined }, { analysisSha256: "B".repeat(64) }, { analysisSha256: "bad" },
    { requestedEvidence: { ...guide(), photoIds: ["other"] } },
    { requestedEvidence: { ...guide(), analysisAttemptId: "other-attempt" } },
  ])("rejects partial or mismatched target metadata: %j", (change) => {
    expect(normalizeComparisonCaptureTarget({ ...target(), ...change })).toBeUndefined();
  });
  it.each([
    { version: 2 }, { kind: "measurement" }, { kind: "professional_inspection" }, { request: " " }, { purpose: "x".repeat(601) },
    { request: " padded " }, { photoIds: ["photo-1", "photo-1"] }, { photoIds: ["../photo"] }, { photoIds: ["a", "b", "c", "d", "e"] },
    { analysisAttemptId: "../attempt" }, { extra: true },
  ])("rejects malformed guides rather than truncating or weakening them: %j", (change) => {
    expect(normalizeRequestedEvidenceGuide({ ...guide(), ...change })).toBeUndefined();
  });
});
function record(n = 1): InspectionComparison {
  return { version: 1, id: id(n), lookupId: "scan", recordedAt: "2026-11-05T00:00:00Z", subject: "Bracket", earlier: side("earlier"), current: side("scan"), relationship: { sameVehicle: false, component: "unconfirmed", basis: "" }, conditions: { angle: "unknown", lighting: "unknown", surfaceNotes: "" }, observation: { outcome: "not_reviewed", notes: "" }, alignment: { rotation: 0, scale: 1, offsetX: 0, offsetY: 0 } };
}
describe("immutable dated comparisons", () => {
  it("canonicalizes valid source timezone offsets and microseconds while rejecting invented dates", () => {
    for (const source of ["2026-11-05T00:00:00Z", "2026-11-05T00:00:00+00:00", "2026-11-04T19:00:00-05:00", "2026-11-05T01:30:00+01:30", "2026-11-05T00:00:00.000000+00:00"]) expect(normalizeComparisonTimestamp(source)).toBe("2026-11-05T00:00:00.000Z");
    expect(normalizeComparisonTimestamp("2024-02-29T23:59:59.123456+00:00")).toBe("2024-02-29T23:59:59.123Z");
    for (const invalid of ["2025-02-29T00:00:00+00:00", "2026-02-30T00:00:00Z", "0000-01-01T00:00:00Z", "0001-01-01T00:00:00+01:00", "9999-12-31T23:59:59-01:00", "2026-11-05T24:00:00Z", "2026-11-05T00:00:00+24:00", "2026-11-05T00:00:00", "2026-11-05", null]) expect(normalizeComparisonTimestamp(invalid)).toBeUndefined();
  });
  it("compares equivalent source instants without rewriting immutable record timestamp strings", () => {
    const original = record(); const normalized = normalizeInspectionComparison(original)!;
    expect(normalized.recordedAt).toBe(original.recordedAt); expect(normalized.earlier.photoAddedAt).toBe(original.earlier.photoAddedAt);
    expect(comparisonSideMatches(original.earlier, { ...original.earlier, photoAddedAt: "2026-11-05T00:00:00.000Z", scanSavedAt: "2026-11-05T00:00:00.000Z" })).toBe(true);
    expect(comparisonSideMatches(original.earlier, { ...original.earlier, photoAddedAt: "2026-11-05T00:00:00.001Z" })).toBe(false);
  });
  it("preserves exact human text, canonicalizes IDs and excludes private vehicle fields", () => {
    const input = { ...record(), id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", subject: "  Bracket  ", earlier: { ...side("earlier"), sha256: "B".repeat(64), vehicleContext: { make: "Toyota", mileage: "12345", mileageUnit: "km", customer: "PRIVATE", notes: "PRIVATE", plate: "PRIVATE", confirmedFields: { make: { value: "Different", confirmedAt: "2026-11-05T00:00:00Z" } } } } };
    const checked = normalizeInspectionComparison(input)!;
    expect(checked.id).toBe(input.id.toLowerCase()); expect(checked.subject).toBe("  Bracket  "); expect(checked.earlier.sha256).toBe("b".repeat(64));
    expect(checked.earlier.vehicleContext).toMatchObject({ make: "Toyota", mileage: "12345", mileageUnit: "km" });
    expect(JSON.stringify(checked)).not.toContain("PRIVATE"); expect(checked.earlier.vehicleContext?.confirmedFields).toBeUndefined();
  });
  it("requires a real calendar date and preserves unknown versus user-reported dates", () => {
    expect(normalizeComparisonSide({ ...side("earlier"), observedOn: "2024-02-29" })?.observedOn).toBe("2024-02-29");
    for (const observedOn of ["0000-01-01", "2025-02-29", "2026-13-01", "2026-02-30", "", undefined]) expect(normalizeComparisonSide({ ...side("earlier"), observedOn })).toBeUndefined();
    expect(normalizeComparisonSide(side("earlier"))?.observedOn).toBeNull();
    expect(normalizeInspectionComparison({ ...record(), earlier: { ...side("earlier"), observedOn: "2026-11-06" }, current: { ...side("scan"), observedOn: "2026-11-05" } })).toBeUndefined();
    expect(normalizeInspectionComparison({ ...record(), recordedAt: "2026-02-30T00:00:00Z" })).toBeUndefined();
  });
  it("canonicalizes a valid historical vehicle confirmation time without changing its fact", () => {
    const checked = normalizeComparisonSide({ ...side("earlier"), vehicleContext: { make: "Toyota", confirmedFields: { make: { value: "Toyota", confirmedAt: "2026-11-04T19:00:00-05:00" } } } });
    expect(checked?.vehicleContext?.confirmedFields?.make).toEqual({ value: "Toyota", confirmedAt: "2026-11-05T00:00:00.000Z" });
  });
  it.each(["2026-02-30T00:00:00Z", "2025-02-29T00:00:00+00:00", "2026-11-05T24:00:00Z"])("rejects a vehicle confirmation timestamp that JavaScript would roll forward: %s", (confirmedAt) => {
    const earlier = { ...side("earlier"), vehicleContext: { make: "Toyota", confirmedFields: { make: { value: "Toyota", confirmedAt } } } };
    expect(normalizeComparisonSide(earlier)).toBeUndefined();
    expect(normalizeInspectionComparison({ ...record(), earlier })).toBeUndefined();
    expect(earlier.vehicleContext.confirmedFields.make.confirmedAt).toBe(confirmedAt);
  });
  it("never treats a different scan, arbitrary photo, dimension or URL as an original digest", () => {
    for (const bad of [{ lookupId: ".." }, { photoId: "../photo" }, { sha256: "https://example.com/image" }, { width: 0 }, { width: 1.2 }, { width: 32768, height: 32768 }, { photoLabel: "invented" }, { vehicleContext: undefined }]) expect(normalizeComparisonSide({ ...side("scan"), ...bad })).toBeUndefined();
    expect(normalizeInspectionComparison({ ...record(), current: side("different") })).toBeUndefined();
    expect(normalizeInspectionComparison({ ...record(), earlier: side("scan") })).toBeUndefined();
  });
  it("requires explicit same-vehicle and same-part basis before a change conclusion", () => {
    const observation = { outcome: "change_observed" as const, notes: "A darker patch is visible." };
    expect(normalizeInspectionComparison({ ...record(), observation })).toBeUndefined();
    expect(normalizeInspectionComparison({ ...record(), observation, relationship: { sameVehicle: true, component: "replacement_same_location", basis: "Owner reports a replacement" } })).toBeUndefined();
    expect(normalizeInspectionComparison({ ...record(), observation, relationship: { sameVehicle: true, component: "same_part", basis: "Owner confirms same car and bracket" } })?.observation).toEqual(observation);
    expect(normalizeInspectionComparison({ ...record(), observation: { outcome: "inconclusive", notes: "Different lighting" } })).toBeDefined();
    expect(normalizeInspectionComparison({ ...record(), relationship: { sameVehicle: true, component: "same_part", basis: " " } })).toBeUndefined();
  });
  it("matches every frozen source attribute except the human observation date", () => {
    const first = side("scan"); expect(comparisonSideMatches(first, { ...first, observedOn: "2026-11-01" })).toBe(true);
    for (const change of [{ photoId: "photo-2" }, { photoLabel: "detail" }, { photoAddedAt: "2026-11-04T00:00:00Z" }, { scanSavedAt: "2026-11-04T00:00:00Z" }, { sha256: "b".repeat(64) }, { width: 3 }, { vehicleContext: { model: "Other" } }, { analysisAttemptId: "analysis-other" }]) expect(comparisonSideMatches(first, { ...first, ...change } as ComparisonSide)).toBe(false);
  });
  it("retains correction forks and exact retries without choosing a timestamp winner", () => {
    const first = record(), left = { ...record(2), supersedesId: id(1), correctionReason: "First correction" }, right = { ...record(3), supersedesId: id(1), correctionReason: "Independent correction" };
    const local = [first, left], incoming = [first, right]; const merged = mergeInspectionComparisons(local, incoming, "scan");
    expect(merged).toHaveLength(3); expect(local).toEqual([first, left]); expect(incoming).toEqual([first, right]);
    for (const entry of merged) expect(inspectionComparisonStatus(entry, merged)).toBe("conflicting_correction");
    expect(inspectionComparisonStatus(first, [first, left])).toBe("superseded"); expect(inspectionComparisonStatus(left, [first, left])).toBe("current");
    expect(() => mergeInspectionComparisons([first], [{ ...first, subject: "Different" }], "scan")).toThrow("conflicting content");
    expect(normalizeInspectionComparisons([first, first], "scan")).toBeUndefined();
  });
  it("requires correction references to be complete and acyclic in the union", () => {
    const correction = { ...record(2), supersedesId: id(1), correctionReason: "Corrected" };
    expect(normalizeInspectionComparisons([correction], "scan")).toBeUndefined();
    expect(mergeInspectionComparisons([record()], [correction], "scan")).toHaveLength(2);
    expect(() => mergeInspectionComparisons([{ ...record(), supersedesId: id(2), correctionReason: "Cycle" }], [correction], "scan")).toThrow("cycle");
    expect(normalizeInspectionComparison({ ...record(), correctionReason: "No target" })).toBeUndefined();
  });
  it("fails explicit count/UTF-8 limits without trimming evidence or notes", () => {
    expect(normalizeInspectionComparisons(Array.from({ length: 101 }, (_, i) => record(i + 1)), "scan")).toBeUndefined();
    const large = Array.from({ length: 50 }, (_, i) => ({ ...record(i + 1), observation: { outcome: "not_reviewed" as const, notes: "界".repeat(2000) } }));
    expect(normalizeInspectionComparisons(large, "scan")).toBeUndefined();
    expect(normalizeInspectionComparison({ ...record(), subject: "x".repeat(201) })).toBeUndefined();
    expect(normalizeInspectionComparison({ ...record(), alignment: { rotation: 0, scale: Infinity, offsetX: 0, offsetY: 0 } })).toBeUndefined();
  });
  it("reserves a separate target without inventing a current scan or comparison conclusion", () => {
    expect(normalizeComparisonCaptureTarget({ version: 1, comparisonId: id(1), lookupId: "new-scan", earlier: side("earlier"), subject: "Bracket" })).toMatchObject({ lookupId: "new-scan", earlier: { observedOn: null } });
    expect(normalizeComparisonCaptureTarget({ version: 1, comparisonId: id(1), lookupId: "earlier", earlier: side("earlier"), subject: "Bracket" })).toBeUndefined();
  });
});
