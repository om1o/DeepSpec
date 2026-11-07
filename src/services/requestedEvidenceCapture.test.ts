import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import type { Lookup } from "../types";
import type { ComparisonSide } from "../types/inspectionComparison";
import { assertRequestedEvidenceCaptureCurrent, prepareRequestedEvidenceCapture, requestedEvidenceGuideForLookup, verifyRequestedEvidenceCaptureReference } from "./requestedEvidenceCapture";

const mocks = vi.hoisted(() => ({ get: vi.fn(), side: vi.fn(), resolve: vi.fn() }));
vi.mock("./storage", () => ({ getLookup: mocks.get }));
vi.mock("./comparisonEvidence", () => ({ comparisonSideForLookup: mocks.side, resolveComparisonSide: mocks.resolve,
  comparisonPhotos: (lookup: Lookup) => lookup.photos?.length ? lookup.photos : [{ ...lookup.frame, id: "photo-1", label: "overview" }] }));

const timestamp = "2026-11-05T12:00:00.000Z";
function fixture(): Lookup {
  const photos = ["overview", "detail"].map((id, index) => ({ id, label: index ? "close_up" as const : "overview" as const,
    capturedAt: timestamp, imageBase64: `data:image/png;base64,${index ? "ZGV0YWls" : "b3ZlcnZpZXc="}` }));
  return { id: "earlier", createdAt: timestamp, frame: photos[0], photos, photoRelationship: "same_part_or_area", analysisAttemptId: "answer-1",
    vehicleContext: { model: "Saved car" }, result: { partName: "Bracket", confidence: "medium", scanCategory: "engine", candidateMatches: [], whatItDoes: "Supports a component.",
      visibleObservations: [], evidenceRegions: [], concerns: [], safetyTriage: "needs_better_photo", isSafetyCritical: false,
      nextAction: "Review the saved photos.", needsBetterPhoto: true, evidence: [], sourceLinks: [],
      conditionAssessment: { version: 1, observations: [{ id: "edge", text: "The edge is obscured.", photoIds: ["detail"] }], possibleCauses: [], unknowns: ["The hidden face."],
        nextEvidence: { kind: "photo", request: "Show the reverse mounting face.", purpose: "Check whether the edge continues behind it.", photoIds: ["detail"] } } },
    rating: null, correction: null, notes: "", scanCategory: "engine", trainingLabel: "unlabeled", trainingStatus: "raw_unreviewed", chatHistory: [],
    provenance: { analysisSource: "ai_detection", captureMode: "upload", savedAt: timestamp } };
}
let saved: Lookup | null;
function guide(lookup = saved!) { const value = requestedEvidenceGuideForLookup(lookup); if (!value) throw new Error("Fixture request missing"); return value; }
function side(lookup: Lookup, photoId: string): ComparisonSide {
  const photo = lookup.photos?.find((entry) => entry.id === photoId) ?? { ...lookup.frame, id: "photo-1", label: "overview" as const };
  return { lookupId: lookup.id, photoId, photoLabel: photo.label, photoAddedAt: photo.capturedAt, scanSavedAt: lookup.createdAt,
    observedOn: null, sha256: "a".repeat(64), width: 640, height: 480, vehicleContext: lookup.vehicleContext ?? null, analysisAttemptId: lookup.analysisAttemptId };
}
beforeEach(() => {
  setActiveAccount("requested-owner"); saved = fixture(); vi.clearAllMocks();
  let nextId = 0;
  vi.stubGlobal("crypto", { subtle: webcrypto.subtle, randomUUID: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}` });
  mocks.get.mockReset().mockImplementation(() => saved && structuredClone(saved));
  mocks.side.mockReset().mockImplementation(async (lookup: Lookup, photoId: string) => side(lookup, photoId));
  mocks.resolve.mockReset().mockResolvedValue({ status: "unchanged", message: "Original verified by the separate image service." });
});
afterEach(() => { setActiveAccount(null); vi.unstubAllGlobals(); });

describe("requested-photo preparation and resume", () => {
  it("freezes the exact request, source context and distinct destination IDs without modifying the original", async () => {
    const displayed = structuredClone(saved!), request = guide(displayed), before = structuredClone(saved);
    const target = await prepareRequestedEvidenceCapture(displayed, request, "detail");
    expect(target).toMatchObject({ version: 2, subject: "Requested evidence photo", requestedEvidence: request,
      earlier: { lookupId: "earlier", photoId: "detail", vehicleContext: { model: "Saved car" }, analysisAttemptId: "answer-1" } });
    expect(target.analysisSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(target.lookupId).not.toBe(target.earlier.lookupId); expect(target.lookupId).not.toBe(target.comparisonId);
    request.request = "Changed after preparation"; displayed.result!.partName = "Other";
    expect(target.requestedEvidence.request).toBe(before!.result!.conditionAssessment!.nextEvidence!.request);
    expect(saved).toEqual(before);
  });
  it.each(["measurement", "professional_inspection"] as const)("does not turn %s into a camera task", (kind) => {
    saved!.result!.conditionAssessment!.nextEvidence!.kind = kind;
    expect(requestedEvidenceGuideForLookup(saved!)).toBeNull();
  });
  it.each(["empty", "duplicate", "unavailable cite", "missing result"])("rejects %s rather than inventing a legacy original", async (kind) => {
    const request = guide();
    if (kind === "empty") saved!.photos = [];
    if (kind === "duplicate") saved!.photos = [saved!.photos![0], saved!.photos![0]];
    if (kind === "unavailable cite") saved!.result!.conditionAssessment!.nextEvidence!.photoIds = ["absent"];
    if (kind === "missing result") delete saved!.result;
    expect(requestedEvidenceGuideForLookup(saved!)).toBeNull();
    await expect(prepareRequestedEvidenceCapture(saved!, request, "detail")).rejects.toThrow();
    expect(mocks.side).not.toHaveBeenCalled();
  });
  it("requires an explicit cited reference and allows any real original only when no cites were supplied", async () => {
    await expect(prepareRequestedEvidenceCapture(saved!, guide(), "overview")).rejects.toThrow("cited saved originals");
    await expect(prepareRequestedEvidenceCapture(saved!, guide(), "")).rejects.toThrow("cited saved originals");
    delete saved!.result!.conditionAssessment!.nextEvidence!.photoIds;
    const target = await prepareRequestedEvidenceCapture(saved!, guide(), "overview");
    expect(target.requestedEvidence.photoIds).toEqual([]); expect(target.earlier.photoId).toBe("overview");
  });
  it("requires a device-saved source instead of trusting an unavailable or cloud-only displayed record", async () => {
    const displayed = saved!; saved = null;
    await expect(prepareRequestedEvidenceCapture(displayed, guide(displayed), "detail")).rejects.toThrow("Save or restore");
    expect(mocks.side).not.toHaveBeenCalled();
  });
  it("rejects a stale displayed answer even when its requested-photo strings are unchanged", async () => {
    const displayed = structuredClone(saved!); saved!.result!.partName = "A replaced answer";
    await expect(prepareRequestedEvidenceCapture(displayed, guide(displayed), "detail")).rejects.toThrow("out of date");
  });
  it.each(["result", "source", "attempt", "relationship", "job reassignment", "job removal", "organization reassignment", "organization removal"])("blocks a %s change during original verification", async (kind) => {
    saved!.jobId = "source-job"; saved!.orgId = "source-org";
    mocks.side.mockImplementationOnce(async (lookup: Lookup, photoId: string) => {
      if (kind === "result") saved!.result!.whatItDoes = "Replacement answer";
      if (kind === "source") saved!.photos![1].imageBase64 = "data:image/png;base64,Y2hhbmdlZA==";
      if (kind === "attempt") saved!.analysisAttemptId = "answer-2";
      if (kind === "relationship") saved!.photoRelationship = "independent";
      if (kind === "job reassignment") saved!.jobId = "other-job";
      if (kind === "job removal") delete saved!.jobId;
      if (kind === "organization reassignment") saved!.orgId = "other-org";
      if (kind === "organization removal") delete saved!.orgId;
      return side(lookup, photoId);
    });
    await expect(prepareRequestedEvidenceCapture(saved!, guide(), "detail")).rejects.toThrow("changed");
  });
  it.each([
    ["jobId", "other-job"], ["jobId", undefined], ["orgId", "other-org"], ["orgId", undefined],
  ] as const)("blocks source %s changing to %s during resume and after guard issuance", async (field, value) => {
    saved!.jobId = "source-job"; saved!.orgId = "source-org";
    const original = structuredClone(saved!);
    const target = await prepareRequestedEvidenceCapture(saved!, guide(), "detail");
    mocks.resolve.mockImplementationOnce(async () => {
      if (value === undefined) delete saved![field]; else saved![field] = value;
      return { status: "unchanged" };
    });
    await expect(verifyRequestedEvidenceCaptureReference(target)).rejects.toThrow("changed");
    saved = original;
    const proof = await verifyRequestedEvidenceCaptureReference(target);
    if (value === undefined) delete saved[field]; else saved[field] = value;
    expect(() => assertRequestedEvidenceCaptureCurrent(proof, target)).toThrow("changed");
  });
  it("allows mechanic notes and ratings to change without invalidating the saved AI request", async () => {
    mocks.side.mockImplementationOnce(async (lookup: Lookup, photoId: string) => {
      saved!.notes = "Technician note added during verification"; saved!.rating = "up";
      return side(lookup, photoId);
    });
    const target = await prepareRequestedEvidenceCapture(saved!, guide(), "detail");
    const proof = await verifyRequestedEvidenceCaptureReference(target);
    saved!.notes = "Another human note"; saved!.correction = "Human correction";
    expect(() => assertRequestedEvidenceCaptureCurrent(proof, target)).not.toThrow();
  });
  it("detects replacement of an answer without an attempt ID even if the guide is identical", async () => {
    delete saved!.analysisAttemptId;
    const target = await prepareRequestedEvidenceCapture(saved!, guide(), "detail");
    saved!.result!.whatItDoes = "Different analysis with the same request";
    await expect(verifyRequestedEvidenceCaptureReference(target)).rejects.toThrow("originating AI result changed");
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("accepts equivalent object key order but checks every array/result value", async () => {
    const target = await prepareRequestedEvidenceCapture(saved!, guide(), "detail");
    saved!.result = Object.fromEntries(Object.entries(saved!.result!).reverse()) as Lookup["result"];
    await expect(verifyRequestedEvidenceCaptureReference(target)).resolves.toMatchObject({ lookupId: "earlier" });
    saved!.result!.concerns = ["New concern"];
    await expect(verifyRequestedEvidenceCaptureReference(target)).rejects.toThrow("originating AI result changed");
  });
  it("rejects forged or stale guards at final mutation and keeps human edits independent", async () => {
    const target = await prepareRequestedEvidenceCapture(saved!, guide(), "detail");
    const proof = await verifyRequestedEvidenceCaptureReference(target);
    expect(() => assertRequestedEvidenceCaptureCurrent({ ...proof }, target)).toThrow("stale or unavailable");
    expect(() => assertRequestedEvidenceCaptureCurrent(proof, { ...target, lookupId: "another-destination" })).toThrow("stale or unavailable");
    saved!.result!.partName = "Changed after verification";
    expect(() => assertRequestedEvidenceCaptureCurrent(proof, target)).toThrow("changed");
  });
  it.each(["source_changed", "missing_photo", "verification_unavailable"])("preserves a pending request when the original is %s", async (status) => {
    const target = await prepareRequestedEvidenceCapture(saved!, guide(), "detail");
    mocks.resolve.mockResolvedValue({ status, message: "No original proof." });
    await expect(verifyRequestedEvidenceCaptureReference(target)).rejects.toThrow("draft was kept");
  });
  it("does not issue a guard when the result changes while resumed source verification is pending", async () => {
    const target = await prepareRequestedEvidenceCapture(saved!, guide(), "detail");
    mocks.resolve.mockImplementationOnce(async () => { saved!.result!.partName = "New answer"; return { status: "unchanged" }; });
    await expect(verifyRequestedEvidenceCaptureReference(target)).rejects.toThrow("changed");
  });
  it("stops account switches, same-account generation changes and canceled preparation", async () => {
    const scope = getAccountScope(), displayed = structuredClone(saved!);
    mocks.side.mockImplementationOnce(async (lookup: Lookup, photoId: string) => { setActiveAccount("other"); setActiveAccount("requested-owner"); return side(lookup, photoId); });
    await expect(prepareRequestedEvidenceCapture(displayed, guide(displayed), "detail", scope)).rejects.toThrow("Account changed");
    const controller = new AbortController(); controller.abort();
    await expect(prepareRequestedEvidenceCapture(saved!, guide(), "detail", getAccountScope(), controller.signal)).rejects.toThrow("canceled");
  });
});
