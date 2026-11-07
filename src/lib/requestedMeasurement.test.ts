import { describe, expect, it } from "vitest";
import type { RequestedMeasurementReceipt } from "../types/requestedMeasurement";
import { normalizeRequestedMeasurementGuide, normalizeRequestedMeasurementReceipt } from "./requestedMeasurement";

const time = "2026-11-05T12:00:00.000Z";
const receipt = (): RequestedMeasurementReceipt => ({ version: 1,
  guide: { version: 1, kind: "measurement", request: "Record the reading and unit", purpose: "Document the missing measurement", photoIds: ["original-a", "original-b"], analysisAttemptId: "attempt-1" },
  analysisSha256: "a".repeat(64),
  references: ["original-a", "original-b"].map((photoId) => ({ lookupId: "saved-scan", photoId, photoLabel: "close_up", photoAddedAt: time, scanSavedAt: time,
    sha256: "b".repeat(64), width: 32, height: 24, observedOn: null, vehicleContext: null, analysisAttemptId: "attempt-1" })),
});

describe("historical requested measurement receipts", () => {
  it("preserves every cited original in order with a defensive copy", () => {
    const raw = receipt(), checked = normalizeRequestedMeasurementReceipt(raw, "saved-scan");
    expect(checked).toEqual(raw); expect(checked?.guide).not.toBe(raw.guide); expect(checked?.references[0]).not.toBe(raw.references[0]);
    raw.references[0].sha256 = "c".repeat(64); expect(checked?.references[0].sha256).toBe("b".repeat(64));
  });
  it("supports an explicitly uncited request without inventing an original", () => {
    const raw = receipt(); raw.guide.photoIds = []; raw.references = [];
    expect(normalizeRequestedMeasurementReceipt(raw, "saved-scan")).toEqual(raw);
    expect(normalizeRequestedMeasurementReceipt({ ...raw, references: receipt().references })).toBeUndefined();
  });
  it.each([
    { version: 2 }, { kind: "photo" }, { request: " " }, { request: " leading space" }, { purpose: "trailing " },
    { request: "x".repeat(601) }, { purpose: "😀".repeat(301) }, { photoIds: ["a", "a"] }, { photoIds: ["a", "b", "c", "d", "e"] },
    { photoIds: ["../photo"] }, { analysisAttemptId: ".." }, { arbitrary: "private field" },
  ])("rejects malformed or altered guide structure: %j", (patch) => {
    expect(normalizeRequestedMeasurementGuide({ ...receipt().guide, ...patch })).toBeUndefined();
  });
  it("uses the same 600 UTF-16 text bound as saved next evidence", () => {
    expect(normalizeRequestedMeasurementGuide({ ...receipt().guide, request: "😀".repeat(300) })).toBeDefined();
  });
  it("rejects missing, duplicated, reordered, foreign and differently attributed originals", () => {
    const raw = receipt();
    for (const references of [raw.references.slice(0, 1), [...raw.references, raw.references[0]], [...raw.references].reverse(),
      [raw.references[0], { ...raw.references[1], photoId: "original-a" }],
      [raw.references[0], { ...raw.references[1], lookupId: "other-scan" }],
      [raw.references[0], { ...raw.references[1], analysisAttemptId: "other-attempt" }]]) {
      expect(normalizeRequestedMeasurementReceipt({ ...raw, references })).toBeUndefined();
    }
    expect(normalizeRequestedMeasurementReceipt(raw, "other-scan")).toBeUndefined();
  });
  it("rejects invalid source pixels, dates and unknown receipt/reference keys", () => {
    const raw = receipt();
    for (const patch of [{ width: 0 }, { width: 32769 }, { width: 32768, height: 32768 }, { height: 1.1 }, { sha256: "bad" },
      { photoAddedAt: "2026-02-30T12:00:00Z" }, { observedOn: "2026-02-30" }, { extra: "must not vanish" }]) {
      expect(normalizeRequestedMeasurementReceipt({ ...raw, references: [{ ...raw.references[0], ...patch }, raw.references[1]] })).toBeUndefined();
    }
    expect(normalizeRequestedMeasurementReceipt({ ...raw, extra: "private" })).toBeUndefined();
    expect(normalizeRequestedMeasurementReceipt({ ...raw, analysisSha256: "A".repeat(64) })).toBeUndefined();
  });
});
