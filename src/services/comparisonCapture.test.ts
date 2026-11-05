import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import type { Lookup } from "../types";
import type { ComparisonCaptureTarget, ComparisonSide, InspectionComparison } from "../types/inspectionComparison";
import { completeComparisonCapture, verifyComparisonCaptureReference } from "./comparisonCapture";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), side: vi.fn(), read: vi.fn(), append: vi.fn(), lookup: vi.fn() }));
vi.mock("./comparisonEvidence", () => ({ resolveComparisonSide: mocks.resolve, comparisonSideForLookup: mocks.side,
  comparisonPhotos: (lookup: Lookup) => lookup.photos?.length ? lookup.photos : [{ ...lookup.frame, id: "photo-1", label: "overview" }] }));
vi.mock("./inspectionComparisonStore", () => ({ readInspectionComparisons: mocks.read, appendInspectionComparison: mocks.append }));
vi.mock("./storage", () => ({ getLookup: mocks.lookup }));

const timestamp = "2026-11-05T12:00:00.000Z";
const earlier: ComparisonSide = { lookupId: "earlier", photoId: "original", photoLabel: "overview", photoAddedAt: timestamp,
  scanSavedAt: timestamp, sha256: "a".repeat(64), width: 640, height: 360, observedOn: "2026-11-04", vehicleContext: { model: "Saved car" } };
const target: ComparisonCaptureTarget = { version: 1, comparisonId: "00000000-0000-4000-8000-000000000001", lookupId: "follow-up", earlier, subject: "Bracket stain" };
const saved: Lookup = { id: target.lookupId, createdAt: timestamp, frame: { imageBase64: "data:image/png;base64,bmV3", capturedAt: timestamp },
  photos: [{ id: "new-first", label: "overview", imageBase64: "data:image/png;base64,bmV3", capturedAt: timestamp }, { id: "new-second", label: "close_up", imageBase64: "data:image/png;base64,c2Vjb25k", capturedAt: timestamp }],
  vehicleContext: earlier.vehicleContext!, analysisAttemptId: "failed-analysis", errorCode: "provider_error", errorMessage: "Saved evidence without an AI result",
  rating: null, correction: null, notes: "", scanCategory: "engine", trainingLabel: "unlabeled", trainingStatus: "raw_unreviewed", chatHistory: [],
  provenance: { analysisSource: "ai_detection", captureMode: "camera", savedAt: timestamp } };
const current: ComparisonSide = { ...earlier, lookupId: saved.id, photoId: "new-first", observedOn: null, sha256: "b".repeat(64), analysisAttemptId: "failed-analysis" };
let records: InspectionComparison[];

beforeEach(() => {
  setActiveAccount("capture-owner"); records = []; vi.clearAllMocks();
  mocks.resolve.mockReset().mockResolvedValue({ status: "unchanged", image: "data:image/png;base64,cmVm", message: "Verified" });
  mocks.side.mockReset().mockResolvedValue(current);
  mocks.lookup.mockReset().mockImplementation(() => structuredClone(saved));
  mocks.read.mockReset().mockImplementation(async () => structuredClone(records));
  mocks.append.mockReset().mockImplementation(async (record: InspectionComparison) => { records.push(structuredClone(record)); return structuredClone(records); });
});

describe("durable repeat-capture completion", () => {
  it("links the first saved original even after AI failure, without inventing review or observation dates", async () => {
    const before = JSON.stringify(saved);
    const record = await completeComparisonCapture(target, saved);
    expect(mocks.side).toHaveBeenCalledWith(saved, "new-first", expect.objectContaining({ userId: "capture-owner" }));
    expect(record).toMatchObject({ id: target.comparisonId, recordedAt: saved.createdAt, earlier, current,
      relationship: { sameVehicle: false, component: "unconfirmed", basis: "" }, conditions: { angle: "unknown", lighting: "unknown", surfaceNotes: "" },
      observation: { outcome: "not_reviewed", notes: "" }, alignment: { rotation: 0, scale: 1, offsetX: 0, offsetY: 0 } });
    expect(JSON.stringify(saved)).toBe(before);
  });
  it("retries the same immutable ID without an extra entry or changing its stable timestamp", async () => {
    const first = await completeComparisonCapture(target, saved);
    mocks.resolve.mockResolvedValue({ status: "missing_photo", message: "Earlier original removed after the committed comparison." });
    expect(await completeComparisonCapture(structuredClone(target), structuredClone(saved))).toEqual(first);
    expect(mocks.append).toHaveBeenCalledTimes(1);
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(1);
  });
  it("canonicalizes a restored cloud timestamp and retries its equivalent UTC timestamp idempotently", async () => {
    const restored = { ...saved, createdAt: "2026-11-05T12:00:00+00:00" };
    mocks.lookup.mockReturnValue(restored);
    const first = await completeComparisonCapture(target, restored);
    expect(first.recordedAt).toBe(timestamp);
    expect(restored.createdAt).toBe("2026-11-05T12:00:00+00:00");
    mocks.lookup.mockReturnValue(saved);
    expect(await completeComparisonCapture(target, saved)).toEqual(first);
    expect(mocks.append).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(1);
  });
  it("preserves existing history when its saved and source timestamps have equivalent precision", async () => {
    await completeComparisonCapture(target, saved);
    records[0] = { ...records[0], recordedAt: "2026-11-05T12:00:00Z",
      earlier: { ...records[0].earlier, photoAddedAt: "2026-11-05T12:00:00Z" },
      current: { ...records[0].current, scanSavedAt: "2026-11-05T12:00:00Z" } };
    const before = structuredClone(records[0]);
    const restored = { ...saved, createdAt: "2026-11-05T12:00:00+00:00" };
    mocks.lookup.mockReturnValue(restored);
    expect(await completeComparisonCapture(target, restored)).toEqual(before);
    expect(records[0]).toEqual(before);
    expect(mocks.append).toHaveBeenCalledTimes(1);
  });
  it("still rejects a changed human observation date when retry timestamps are equivalent", async () => {
    await completeComparisonCapture(target, saved);
    records[0] = { ...records[0], recordedAt: "2026-11-05T12:00:00Z", earlier: { ...records[0].earlier, observedOn: "2026-11-03" } };
    await expect(completeComparisonCapture(target, saved)).rejects.toThrow("different evidence or details");
    expect(mocks.append).toHaveBeenCalledTimes(1);
  });
  it.each(["2026-02-30T12:00:00+00:00", "2026-11-05T25:00:00+00:00", "not-a-date"])("rejects impossible saved timestamps without appending: %s", async (createdAt) => {
    const invalid = { ...saved, createdAt };
    mocks.lookup.mockReturnValue(invalid);
    await expect(completeComparisonCapture(target, invalid)).rejects.toThrow("saved scan timestamp is invalid");
    expect(mocks.side).not.toHaveBeenCalled();
    expect(mocks.append).not.toHaveBeenCalled();
  });
  it("refuses an ID collision with different historical references or initial details", async () => {
    await completeComparisonCapture(target, saved);
    records[0] = { ...records[0], subject: "Other evidence" };
    await expect(completeComparisonCapture(target, saved)).rejects.toThrow("different evidence or details");
    expect(mocks.append).toHaveBeenCalledTimes(1);
    expect(records[0].subject).toBe("Other evidence");
  });
  it.each(["missing_photo", "source_changed", "verification_unavailable"])("keeps completion pending when the earlier reference is %s", async (status) => {
    mocks.resolve.mockResolvedValue({ status, message: "Original verification failed." });
    await expect(completeComparisonCapture(target, saved)).rejects.toThrow("earlier original could not be verified");
    expect(mocks.append).not.toHaveBeenCalled();
  });
  it("rejects a different reserved scan and a saved original changed during verification", async () => {
    await expect(completeComparisonCapture(target, { ...saved, id: "other" })).rejects.toThrow("does not match");
    mocks.side.mockImplementationOnce(async () => {
      mocks.lookup.mockReturnValue({ ...saved, photos: [{ ...saved.photos![0], imageBase64: "data:image/png;base64,Y2hhbmdlZA==" }] });
      return current;
    });
    await expect(completeComparisonCapture(target, saved)).rejects.toThrow("follow-up evidence changed");
    expect(mocks.append).not.toHaveBeenCalled();
  });
  it("stops after an account switch rather than appending to another owner's history", async () => {
    const scope = getAccountScope();
    mocks.resolve.mockImplementationOnce(async () => { setActiveAccount("other-owner"); return { status: "unchanged", message: "Verified" }; });
    await expect(completeComparisonCapture(target, saved, scope)).rejects.toThrow("Account changed");
    expect(mocks.append).not.toHaveBeenCalled();
  });
  it("does not acknowledge a canceled verification or failed comparison write", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(verifyComparisonCaptureReference(target, getAccountScope(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    mocks.append.mockRejectedValueOnce(new Error("Storage interrupted"));
    await expect(completeComparisonCapture(target, saved)).rejects.toThrow("Storage interrupted");
  });
});
