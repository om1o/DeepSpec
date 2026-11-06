import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import type { Lookup } from "../types";
import { assertObservationAreaGuardCurrent, prepareObservationAreaBinding, verifyObservationAreaBinding } from "./observationAreaEvidence";

const mocks = vi.hoisted(() => ({ get: vi.fn(), side: vi.fn(), resolve: vi.fn() }));
vi.mock("./storage", () => ({ getLookup: mocks.get }));
vi.mock("./comparisonEvidence", () => ({ comparisonPhotos: (lookup: Lookup) => lookup.photos === undefined ? [{ ...lookup.frame, id: "photo-1", label: "overview" }] : lookup.photos,
  comparisonSideForLookup: mocks.side, resolveComparisonSide: mocks.resolve }));
const timestamp = "2026-11-05T12:00:00.000Z";
function fixture(): Lookup {
  const photos = ["overview", "detail"].map((id, index) => ({ id, label: index ? "close_up" as const : "overview" as const,
    capturedAt: timestamp, imageBase64: `data:image/png;base64,${index ? "ZGV0YWls" : "b3ZlcnZpZXc="}` }));
  return { id: "area-scan", createdAt: timestamp, frame: photos[0], photos, photoRelationship: "same_part_or_area", analysisAttemptId: "answer-1",
    result: { partName: "Bracket", confidence: "medium", scanCategory: "engine", candidateMatches: [], whatItDoes: "Supports a component.",
      visibleObservations: [], evidenceRegions: [], concerns: [], safetyTriage: "needs_better_photo", isSafetyCritical: false,
      nextAction: "Review the saved photos.", needsBetterPhoto: true, evidence: [], sourceLinks: [],
      conditionAssessment: { version: 2, observations: [{ id: "edge", text: "The edge is obscured.", photoIds: ["detail"],
        areas: [{ photoId: "detail", rectangle: { x: .2, y: .3, width: .4, height: .1 } }] }], possibleCauses: [], unknowns: ["Remaining thickness."] } },
    rating: null, correction: null, notes: "", scanCategory: "engine", trainingLabel: "unlabeled", trainingStatus: "raw_unreviewed", chatHistory: [],
    provenance: { analysisSource: "ai_detection", captureMode: "upload", savedAt: timestamp } };
}
let saved: Lookup | null;
beforeEach(() => {
  setActiveAccount("area-owner"); saved = fixture(); vi.clearAllMocks(); vi.stubGlobal("crypto", { subtle: webcrypto.subtle });
  mocks.get.mockImplementation(() => saved);
  mocks.side.mockImplementation(async (lookup: Lookup, photoId: string) => ({ lookupId: lookup.id, photoId, photoLabel: "close_up", photoAddedAt: timestamp,
    scanSavedAt: timestamp, observedOn: null, sha256: "a".repeat(64), width: 640, height: 480, vehicleContext: null,
    ...(lookup.analysisAttemptId === undefined ? {} : { analysisAttemptId: lookup.analysisAttemptId }) }));
  mocks.resolve.mockResolvedValue({ status: "unchanged", image: "data:image/png;base64,ZGV0YWls", message: "Exact original." });
});
afterEach(() => { vi.unstubAllGlobals(); setActiveAccount(null); });

describe("observation area source binding", () => {
  it("allows a human area when the valid AI assessment returned an empty area list", async () => {
    saved!.result!.conditionAssessment!.observations[0].areas = [];
    const prepared = await prepareObservationAreaBinding(saved!, "edge", "detail");
    expect(prepared.binding.observation.areas).toEqual([]);
    expect(prepared.image).toBeTruthy();
  });
  it("binds the exact secondary photo, full claim, AI suggestion and answer without modifying it", async () => {
    const before = structuredClone(saved!);
    const prepared = await prepareObservationAreaBinding(saved!, "edge", "detail");
    expect(prepared.binding.observation).toEqual(before.result!.conditionAssessment!.observations[0]);
    expect(prepared.binding.reference.photoId).toBe("detail");
    expect(prepared.binding.analysisSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.side.mock.calls[0][1]).toBe("detail");
    expect(mocks.side.mock.calls[0][3]).toBeInstanceOf(AbortSignal);
    expect(prepared.image).toBeTruthy(); expect(saved).toEqual(before);
    expect(() => assertObservationAreaGuardCurrent(prepared.guard, prepared.binding)).not.toThrow();
  });
  it.each(["missing claim", "uncited photo", "empty photos", "missing scan", "stale display"])("rejects %s before inspecting any original", async (kind) => {
    const displayed = structuredClone(saved!);
    if (kind === "empty photos") saved!.photos = [];
    if (kind === "missing scan") saved = null;
    if (kind === "stale display") saved!.result!.partName = "New part";
    await expect(prepareObservationAreaBinding(displayed, kind === "missing claim" ? "missing" : "edge", kind === "uncited photo" ? "overview" : "detail")).rejects.toThrow();
    expect(mocks.side).not.toHaveBeenCalled();
  });
  it.each(["photo", "answer", "vehicle", "attempt"])("rejects a %s race during original preparation", async (kind) => {
    mocks.side.mockImplementationOnce(async () => {
      if (kind === "photo") saved!.photos![1].imageBase64 = "data:image/png;base64,Y2hhbmdlZA==";
      if (kind === "answer") saved!.result!.whatItDoes = "New answer";
      if (kind === "vehicle") saved!.vehicleContext = { model: "New vehicle" };
      if (kind === "attempt") saved!.analysisAttemptId = "answer-2";
      return {};
    });
    await expect(prepareObservationAreaBinding(saved!, "edge", "detail")).rejects.toThrow("changed");
  });
  it("rejects a different photo returned by the original helper", async () => {
    const prepared = await prepareObservationAreaBinding(saved!, "edge", "detail");
    mocks.side.mockResolvedValueOnce({ ...prepared.binding.reference, photoId: "overview" });
    await expect(prepareObservationAreaBinding(saved!, "edge", "detail")).rejects.toThrow("exact original");
  });
  it("checks the whole answer even without an attempt ID and allows independent human notes", async () => {
    delete saved!.analysisAttemptId;
    const { binding, guard } = await prepareObservationAreaBinding(saved!, "edge", "detail");
    saved!.notes = "Human note"; saved!.rating = "up";
    expect(() => assertObservationAreaGuardCurrent(guard, binding)).not.toThrow();
    saved!.result!.partName = "New answer";
    await expect(verifyObservationAreaBinding(binding)).rejects.toThrow("originating AI");
  });
  it.each(["source_changed", "missing_photo", "verification_unavailable"])("does not overlay when original status is %s", async (status) => {
    const { binding } = await prepareObservationAreaBinding(saved!, "edge", "detail");
    mocks.resolve.mockResolvedValueOnce({ status, message: "Unavailable." });
    await expect(verifyObservationAreaBinding(binding)).rejects.toThrow("draft was kept");
  });
  it("allows a historical correction after AI retry while preserving the old binding and checking its pixels", async () => {
    const { binding } = await prepareObservationAreaBinding(saved!, "edge", "detail"), original = structuredClone(binding);
    saved!.analysisAttemptId = "answer-2"; saved!.result!.conditionAssessment!.observations[0].text = "Changed claim";
    const verified = await verifyObservationAreaBinding(binding, getAccountScope(), undefined, "historical");
    expect(verified.image).toBeTruthy(); expect(binding).toEqual(original);
    expect(mocks.resolve.mock.lastCall![0]).toEqual({ ...binding.reference, analysisAttemptId: "answer-2" });
    expect(verified.guard.binding.analysisAttemptId).toBe("answer-1");
    expect(() => assertObservationAreaGuardCurrent(verified.guard, binding)).not.toThrow();
  });
  it("permits retraction of missing-source history without inventing an image", async () => {
    const { binding } = await prepareObservationAreaBinding(saved!, "edge", "detail"); saved = null; mocks.resolve.mockClear();
    const verified = await verifyObservationAreaBinding(binding, getAccountScope(), undefined, "retraction");
    expect(verified.image).toBeUndefined(); expect(mocks.resolve).not.toHaveBeenCalled();
    expect(() => assertObservationAreaGuardCurrent(verified.guard, binding)).not.toThrow();
    saved = fixture(); expect(() => assertObservationAreaGuardCurrent(verified.guard, binding)).toThrow("changed");
  });
  it("rejects forged/mutated proofs and edited bindings", async () => {
    const { binding, guard } = await prepareObservationAreaBinding(saved!, "edge", "detail");
    expect(() => assertObservationAreaGuardCurrent({ ...guard }, binding)).toThrow("stale");
    binding.observation.text = "Changed";
    expect(() => assertObservationAreaGuardCurrent(guard, binding)).toThrow("stale");
    const prepared = await prepareObservationAreaBinding(saved!, "edge", "detail");
    prepared.guard.binding.analysisSha256 = "b".repeat(64);
    expect(() => assertObservationAreaGuardCurrent(prepared.guard, prepared.binding)).toThrow("stale");
  });
  it("rejects account generation changes and canceled final commits", async () => {
    const scope = getAccountScope(), controller = new AbortController();
    const prepared = await prepareObservationAreaBinding(saved!, "edge", "detail", scope, controller.signal);
    controller.abort(); expect(() => assertObservationAreaGuardCurrent(prepared.guard, prepared.binding, scope)).toThrow("canceled");
    const other = await prepareObservationAreaBinding(saved!, "edge", "detail");
    setActiveAccount("other"); setActiveAccount("area-owner");
    expect(() => assertObservationAreaGuardCurrent(other.guard, other.binding, scope)).toThrow("Account changed");
  });
});
