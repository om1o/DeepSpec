import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import type { Lookup } from "../types";
import type { ComparisonSide } from "../types/inspectionComparison";
import { assertRequestedMeasurementCurrent, prepareRequestedMeasurement, requestedMeasurementGuideForLookup, verifyRequestedMeasurement } from "./requestedMeasurement";

const mocks = vi.hoisted(() => ({ get: vi.fn(), side: vi.fn(), resolve: vi.fn() }));
vi.mock("./storage", () => ({ getLookup: mocks.get }));
vi.mock("./comparisonEvidence", () => ({ comparisonSideForLookup: mocks.side, resolveComparisonSide: mocks.resolve }));
const timestamp = "2026-11-05T12:00:00.000Z";
function fixture(): Lookup {
  const photos = ["overview", "detail"].map((id, index) => ({ id, label: index ? "close_up" as const : "overview" as const,
    capturedAt: timestamp, imageBase64: `data:image/png;base64,${index ? "ZGV0YWls" : "b3ZlcnZpZXc="}` }));
  return { id: "saved-scan", createdAt: timestamp, frame: photos[0], photos, photoRelationship: "same_part_or_area", analysisAttemptId: "answer-1",
    vehicleContext: { model: "Saved car" }, result: { partName: "Bracket", confidence: "medium", scanCategory: "engine", candidateMatches: [], whatItDoes: "Supports a component.",
      visibleObservations: [], evidenceRegions: [], concerns: [], safetyTriage: "needs_better_photo", isSafetyCritical: false,
      nextAction: "Review the saved photos.", needsBetterPhoto: true, evidence: [], sourceLinks: [],
      conditionAssessment: { version: 1, observations: [{ id: "edge", text: "The edge is obscured.", photoIds: ["detail"] }], possibleCauses: [], unknowns: ["Remaining thickness."],
        nextEvidence: { kind: "measurement", request: "Record a thickness reading if one is available.", purpose: "Document a human measurement, not an image estimate.", photoIds: ["detail", "overview"] } } },
    rating: null, correction: null, notes: "", scanCategory: "engine", trainingLabel: "unlabeled", trainingStatus: "raw_unreviewed", chatHistory: [],
    provenance: { analysisSource: "ai_detection", captureMode: "upload", savedAt: timestamp } };
}
let saved: Lookup | null;
function side(lookup: Lookup, photoId: string): ComparisonSide {
  const photo = lookup.photos!.find((entry) => entry.id === photoId)!;
  return { lookupId: lookup.id, photoId, photoLabel: photo.label, photoAddedAt: photo.capturedAt, scanSavedAt: lookup.createdAt,
    observedOn: null, sha256: (photoId === "detail" ? "a" : "b").repeat(64), width: 640, height: 480, vehicleContext: lookup.vehicleContext ?? null,
    ...(lookup.analysisAttemptId === undefined ? {} : { analysisAttemptId: lookup.analysisAttemptId }) };
}
beforeEach(() => {
  setActiveAccount("measurement-owner"); saved = fixture(); vi.clearAllMocks();
  vi.stubGlobal("crypto", { subtle: webcrypto.subtle });
  mocks.get.mockImplementation(() => saved);
  mocks.side.mockImplementation(async (lookup: Lookup, photoId: string) => side(lookup, photoId));
  mocks.resolve.mockResolvedValue({ status: "unchanged", message: "Bound original." });
});
afterEach(() => { vi.unstubAllGlobals(); setActiveAccount(null); });

describe("requested measurement provenance", () => {
  it("binds every cited original in request order and fingerprints the full saved analysis", async () => {
    const before = structuredClone(saved!), displayed = structuredClone(saved!);
    const receipt = await prepareRequestedMeasurement(displayed);
    expect(receipt.guide).toEqual(requestedMeasurementGuideForLookup(before));
    expect(receipt.analysisSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.references.map((entry) => entry.photoId)).toEqual(["detail", "overview"]);
    expect(mocks.side.mock.calls.map((args) => args[1])).toEqual(["detail", "overview"]);
    expect(mocks.side.mock.calls.every((args) => args[3] instanceof AbortSignal)).toBe(true);
    displayed.result!.conditionAssessment!.nextEvidence!.request = "Edited display";
    expect(receipt.guide.request).toBe(before.result!.conditionAssessment!.nextEvidence!.request);
    expect(saved).toEqual(before);
  });
  it("records no original binding when the request has no citations", async () => {
    delete saved!.result!.conditionAssessment!.nextEvidence!.photoIds;
    const receipt = await prepareRequestedMeasurement(saved!);
    expect(receipt.guide.photoIds).toEqual([]); expect(receipt.references).toEqual([]);
    expect(mocks.side).not.toHaveBeenCalled();
    await expect(verifyRequestedMeasurement(saved!.id, receipt)).resolves.toMatchObject({ lookupId: saved!.id });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("never invents a legacy original for an explicitly empty photo group", async () => {
    saved!.photos = [];
    saved!.result!.conditionAssessment!.observations = [];
    delete saved!.result!.conditionAssessment!.nextEvidence!.photoIds;
    await expect(prepareRequestedMeasurement(saved!)).rejects.toThrow("valid measurement request");
    expect(mocks.side).not.toHaveBeenCalled();
  });
  it.each(["photo", "marking", "professional_inspection"] as const)("does not turn a %s request into a measurement", async (kind) => {
    saved!.result!.conditionAssessment!.nextEvidence!.kind = kind;
    expect(requestedMeasurementGuideForLookup(saved!)).toBeNull();
    await expect(prepareRequestedMeasurement(saved!)).rejects.toThrow("valid measurement request");
    expect(mocks.side).not.toHaveBeenCalled();
  });
  it("rejects unavailable citations rather than binding a substitute", async () => {
    saved!.result!.conditionAssessment!.nextEvidence!.photoIds = ["missing"];
    await expect(prepareRequestedMeasurement(saved!)).rejects.toThrow("valid measurement request");
    expect(mocks.side).not.toHaveBeenCalled();
  });
  it("requires a device-saved source", async () => {
    const displayed = saved!; saved = null;
    await expect(prepareRequestedMeasurement(displayed)).rejects.toThrow("Save or restore");
  });
  it("rejects a stale displayed result even if the request strings are unchanged", async () => {
    const displayed = structuredClone(saved!); saved!.result!.partName = "New answer";
    await expect(prepareRequestedMeasurement(displayed)).rejects.toThrow("out of date");
    expect(mocks.side).not.toHaveBeenCalled();
  });
  it.each(["answer", "photo", "attempt", "relationship", "vehicle"])("blocks a %s change during preparation", async (kind) => {
    mocks.side.mockImplementationOnce(async (lookup: Lookup, photoId: string) => {
      if (kind === "answer") saved!.result!.whatItDoes = "Changed answer";
      if (kind === "photo") saved!.photos![0].imageBase64 = "data:image/png;base64,Y2hhbmdlZA==";
      if (kind === "attempt") saved!.analysisAttemptId = "answer-2";
      if (kind === "relationship") saved!.photoRelationship = "independent";
      if (kind === "vehicle") saved!.vehicleContext = { model: "Other car" };
      return side(lookup, photoId);
    });
    await expect(prepareRequestedMeasurement(saved!)).rejects.toThrow("changed");
    expect(mocks.side).toHaveBeenCalledTimes(1);
  });
  it("rejects a helper returning the wrong original", async () => {
    mocks.side.mockImplementationOnce(async (lookup: Lookup) => side(lookup, "overview"));
    await expect(prepareRequestedMeasurement(saved!)).rejects.toThrow("bound to its cited originals");
  });
  it("allows independent human notes and ratings to change", async () => {
    const receipt = await prepareRequestedMeasurement(saved!);
    mocks.resolve.mockImplementation(async () => { saved!.notes = "Human note"; saved!.rating = "up"; return { status: "unchanged" }; });
    const guard = await verifyRequestedMeasurement(saved!.id, receipt);
    saved!.correction = "Human correction";
    expect(() => assertRequestedMeasurementCurrent(guard)).not.toThrow();
  });
  it("fingerprints replacement answers even without attempt IDs", async () => {
    delete saved!.analysisAttemptId;
    const receipt = await prepareRequestedMeasurement(saved!);
    saved!.result!.whatItDoes = "Different full answer";
    await expect(verifyRequestedMeasurement(saved!.id, receipt)).rejects.toThrow("originating AI result changed");
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("accepts equivalent key ordering and checks every saved analysis value", async () => {
    const receipt = await prepareRequestedMeasurement(saved!);
    saved!.result = Object.fromEntries(Object.entries(saved!.result!).reverse()) as Lookup["result"];
    const guard = await verifyRequestedMeasurement(saved!.id, receipt);
    expect(() => assertRequestedMeasurementCurrent(guard)).not.toThrow();
    saved!.result!.concerns = ["Additional concern"];
    await expect(verifyRequestedMeasurement(saved!.id, receipt)).rejects.toThrow("originating AI result changed");
  });
  it.each(["source_changed", "missing_photo", "verification_unavailable"])("preserves the draft if a cited original is %s", async (status) => {
    const receipt = await prepareRequestedMeasurement(saved!);
    mocks.resolve.mockResolvedValueOnce({ status, message: "Original not verified." });
    await expect(verifyRequestedMeasurement(saved!.id, receipt)).rejects.toThrow("draft was kept");
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
  });
  it("rejects a result change during resumed original verification", async () => {
    const receipt = await prepareRequestedMeasurement(saved!);
    mocks.resolve.mockImplementationOnce(async () => { saved!.result!.partName = "New result"; return { status: "unchanged" }; });
    await expect(verifyRequestedMeasurement(saved!.id, receipt)).rejects.toThrow("changed");
  });
  it("rejects forged, edited and stale guards at final mutation", async () => {
    const receipt = await prepareRequestedMeasurement(saved!);
    const guard = await verifyRequestedMeasurement(saved!.id, receipt);
    expect(() => assertRequestedMeasurementCurrent({ ...guard })).toThrow("stale or unavailable");
    receipt.guide.purpose = "Changed receipt";
    expect(() => assertRequestedMeasurementCurrent(guard)).toThrow("stale or unavailable");
    const second = await verifyRequestedMeasurement(saved!.id, await prepareRequestedMeasurement(saved!));
    second.receipt.analysisSha256 = "f".repeat(64);
    expect(() => assertRequestedMeasurementCurrent(second)).toThrow("stale or unavailable");
    const third = await verifyRequestedMeasurement(saved!.id, await prepareRequestedMeasurement(saved!));
    saved!.photos![0].capturedAt = "2026-11-05T13:00:00.000Z";
    expect(() => assertRequestedMeasurementCurrent(third)).toThrow("changed");
  });
  it("retains historical receipts for corrections without claiming the old answer or originals still match", async () => {
    const receipt = await prepareRequestedMeasurement(saved!), before = structuredClone(receipt);
    delete saved!.result; saved!.photos = [];
    const guard = await verifyRequestedMeasurement(saved!.id, receipt, getAccountScope(), undefined, true);
    expect(guard.receipt).toEqual(before); expect(mocks.resolve).not.toHaveBeenCalled();
    expect(() => assertRequestedMeasurementCurrent(guard)).not.toThrow();
    saved!.vehicleContext = { model: "Changed after check" };
    expect(() => assertRequestedMeasurementCurrent(guard)).toThrow("changed");
  });
  it("still checks owner lookup, account generation, and immutable receipt on a historical correction", async () => {
    const receipt = await prepareRequestedMeasurement(saved!);
    await expect(verifyRequestedMeasurement("other-scan", receipt, getAccountScope(), undefined, true)).rejects.toThrow("invalid");
    const scope = getAccountScope(), guard = await verifyRequestedMeasurement(saved!.id, receipt, scope, undefined, true);
    setActiveAccount("other"); setActiveAccount("measurement-owner");
    expect(() => assertRequestedMeasurementCurrent(guard, scope)).toThrow("Account changed");
  });
  it("stops canceled preparation and cancels the final write after an issued verification", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(prepareRequestedMeasurement(saved!, getAccountScope(), controller.signal)).rejects.toThrow("canceled");
    const controller2 = new AbortController(), receipt = await prepareRequestedMeasurement(saved!);
    const guard = await verifyRequestedMeasurement(saved!.id, receipt, getAccountScope(), controller2.signal);
    controller2.abort(); expect(() => assertRequestedMeasurementCurrent(guard)).toThrow("canceled");
  });
  it("bounds a stuck original verification and propagates cancellation to its inspection", async () => {
    let signal: AbortSignal | undefined;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    mocks.side.mockImplementationOnce((_lookup, _id, _scope, pendingSignal: AbortSignal) => { signal = pendingSignal; started(); return new Promise(() => undefined); });
    const controller = new AbortController(), preparation = prepareRequestedMeasurement(saved!, getAccountScope(), controller.signal);
    const rejected = expect(preparation).rejects.toThrow("canceled");
    await ready; controller.abort(); await rejected;
    expect(signal?.aborted).toBe(true);
  });
});
