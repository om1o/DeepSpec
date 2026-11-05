import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
const mocks = vi.hoisted(() => ({ open: vi.fn(), read: vi.fn(), get: vi.fn() }));
vi.mock("./evidenceDb", async (importOriginal) => ({ ...(await importOriginal<typeof import("./evidenceDb")>()), openEvidenceDatabase: mocks.open }));
vi.mock("./storage", () => ({ readLookups: mocks.read, getLookup: mocks.get }));
vi.mock("./componentMapStore", () => ({ readComponentMap: vi.fn(), linkComponentMap: vi.fn() }));
vi.mock("./cloudHistory", () => ({ readCloudLookupForReport: vi.fn() }));
import { hasPhotoDraftComparison, hasPhotoDraftContext, normalizePhotoDraft, photoDraftsMatch, replacePhotoDraftEnvelopeIfMatches, upgradePhotoDraft, type PhotoDraftEnvelope } from "./photoDraft";
import { assertComponentCaptureCurrent } from "./componentCaptureCompletion";
import type { Lookup, ScanPhoto } from "../types";
import type { ComparisonCaptureTarget } from "../types/inspectionComparison";

const photos: ScanPhoto[] = [{ id: "overview", label: "overview", capturedAt: "2026-11-05T00:00:00Z", imageBase64: "data:image/jpeg;base64,cGhvdG8=" }];
const draft: PhotoDraftEnvelope = { version: 2, photos, target: { mapId: "bay", componentId: "00000000-0000-4000-8000-000000000001", linkAttemptId: "00000000-0000-4000-8000-000000000002", lookupId: "detail" } };
const comparisonTarget: ComparisonCaptureTarget = { version: 1, comparisonId: "00000000-0000-4000-8000-000000000004", lookupId: "detail", subject: "Bracket stain",
  earlier: { lookupId: "earlier", photoId: "source", photoLabel: "overview", photoAddedAt: "2026-11-04T00:00:00Z", scanSavedAt: "2026-11-04T00:00:00Z",
    observedOn: null, sha256: "a".repeat(64), width: 640, height: 360, vehicleContext: { model: "Original car" } } };

describe("photo draft envelopes", () => {
  it("preserves a requested-photo guide only in version eight, including its analysis fingerprint", () => {
    const requested: Extract<ComparisonCaptureTarget, { version: 2 }> = { ...comparisonTarget, version: 2, analysisSha256: "b".repeat(64),
      requestedEvidence: { version: 1, kind: "photo", request: "Show the edge.", purpose: "Check the hidden face.", photoIds: ["source"] } };
    const next: PhotoDraftEnvelope = { version: 8, photos, photoRelationship: "unknown", vehicleContext: null, comparisonTarget: requested };
    expect(normalizePhotoDraft(JSON.parse(JSON.stringify(next)))).toEqual(next);
    expect(upgradePhotoDraft(next)).toEqual(next);
    expect(hasPhotoDraftContext(next)).toBe(true); expect(hasPhotoDraftComparison(next)).toBe(true);
    expect(normalizePhotoDraft({ ...next, version: 7 })).toBeNull();
    expect(normalizePhotoDraft({ ...next, comparisonTarget })).toBeNull();
    expect(photoDraftsMatch(next, { ...next, comparisonTarget: { ...requested, requestedEvidence: { ...requested.requestedEvidence, purpose: "Different reason." } } })).toBe(false);
    expect(photoDraftsMatch(next, { ...next, comparisonTarget: { ...requested, analysisSha256: "c".repeat(64) } })).toBe(false);
  });
  it.each(["same_part_or_area", "independent", "unknown"] as const)("preserves explicit %s relationships through draft serialization", (photoRelationship) => {
    const related = { ...upgradePhotoDraft(draft), photoRelationship };
    expect(normalizePhotoDraft(JSON.parse(JSON.stringify(related)))).toEqual(related);
    expect(photoDraftsMatch(related, structuredClone(related))).toBe(true);
  });
  it("upgrades legacy unknown semantics without allowing a legacy writer to match the newer format", () => {
    const modern = upgradePhotoDraft(draft);
    expect(modern).toEqual({ ...draft, version: 5, photoRelationship: "unknown" });
    expect(photoDraftsMatch(draft, modern)).toBe(false);
    expect(photoDraftsMatch(modern, { ...modern, photoRelationship: "same_part_or_area" })).toBe(false);
    expect(photoDraftsMatch({ ...modern, photoRelationship: "same_part_or_area" }, { ...modern, photoRelationship: "independent" })).toBe(false);
  });
  it.each([null, "same_car", "", 1, {}])("rejects explicit invalid relationships without accepting a stale match: %j", (photoRelationship) => {
    const invalid = { ...upgradePhotoDraft(draft), photoRelationship } as unknown as PhotoDraftEnvelope;
    expect(normalizePhotoDraft(invalid)).toBeNull();
    expect(photoDraftsMatch(invalid, invalid)).toBe(false);
    expect(invalid.photos).toEqual(photos);
  });
  it("requires relationship metadata in modern versions and refuses it in the legacy protocol", () => {
    expect(normalizePhotoDraft({ ...draft, photoRelationship: "independent" })).toBeNull();
    expect(normalizePhotoDraft({ version: 5, photos })).toBeNull();
    expect(normalizePhotoDraft({ version: 6, photos, vehicleContext: null })).toBeNull();
    expect(normalizePhotoDraft({ version: 7, photos, vehicleContext: null, comparisonTarget })).toBeNull();
    expect(() => upgradePhotoDraft({ ...draft, photoRelationship: "independent" } as unknown as PhotoDraftEnvelope)).toThrow("originals were preserved");
  });
  it("upgrades context and comparison drafts without losing vehicle, job or reserved targets", () => {
    const context: PhotoDraftEnvelope = { ...draft, vehicleContext: { model: "Original car" }, jobId: "job-a", version: 3 };
    const modernContext = upgradePhotoDraft(context);
    expect(modernContext).toEqual({ ...context, version: 6, photoRelationship: "unknown" });
    expect(hasPhotoDraftContext(modernContext)).toBe(true);
    expect(hasPhotoDraftComparison(modernContext)).toBe(false);
    const repeat: PhotoDraftEnvelope = { ...context, version: 4, comparisonTarget };
    const modernRepeat = upgradePhotoDraft(repeat);
    expect(modernRepeat).toEqual({ ...repeat, version: 7, photoRelationship: "unknown" });
    expect(hasPhotoDraftContext(modernRepeat)).toBe(true);
    expect(hasPhotoDraftComparison(modernRepeat)).toBe(true);
    if (modernRepeat.version !== 7) throw new Error("Expected preserved legacy comparison");
    expect(photoDraftsMatch(modernRepeat, { ...modernRepeat, jobId: "other" })).toBe(false);
    expect(photoDraftsMatch(modernRepeat, { ...modernRepeat, vehicleContext: { model: "Other car" } })).toBe(false);
    expect(photoDraftsMatch(modernRepeat, { ...modernRepeat, comparisonTarget: { ...comparisonTarget, comparisonId: "00000000-0000-4000-8000-000000000009" } })).toBe(false);
  });
  it("reads older photo arrays without assigning them to a component", () => {
    expect(normalizePhotoDraft(photos)).toEqual({ version: 2, photos });
  });
  it("preserves a valid component target with all photos", () => {
    expect(normalizePhotoDraft(draft)).toEqual(draft);
  });
  it("rejects invalid target metadata rather than falling back to unrelated photos", () => {
    expect(normalizePhotoDraft({ ...draft, target: { ...draft.target, componentId: "invalid" } })).toBeNull();
    expect(normalizePhotoDraft({ ...draft, target: null })).toBeNull();
  });
  it("does not consider identical photos with a different component or link to be the same draft", () => {
    expect(photoDraftsMatch(draft, { version: 2, photos })).toBe(false);
    expect(photoDraftsMatch(draft, { ...draft, target: { ...draft.target!, lookupId: "other-scan" } })).toBe(false);
    expect(photoDraftsMatch(draft, { ...draft, target: { ...draft.target!, componentId: "00000000-0000-4000-8000-000000000003" } })).toBe(false);
    expect(photoDraftsMatch(draft, structuredClone(draft))).toBe(true);
  });
  it("rejects partial, duplicate or oversized groups as a whole", () => {
    expect(normalizePhotoDraft({ ...draft, photos: [photos[0], photos[0]] })).toBeNull();
    expect(normalizePhotoDraft({ ...draft, photos: [] })).toBeNull();
    expect(normalizePhotoDraft({ ...draft, photos: Array.from({ length: 5 }, (_, index) => ({ ...photos[0], id: `photo-${index}` })) })).toBeNull();
  });
  it("retains a version-three vehicle snapshot and job when reading or relabeling", () => {
    const snapshot: PhotoDraftEnvelope = { version: 3, photos, vehicleContext: { year: "2015", make: "Honda", mileage: "120000", mileageUnit: "mi" }, jobId: "job-a" };
    expect(normalizePhotoDraft(snapshot)).toEqual(snapshot);
    expect(normalizePhotoDraft({ ...snapshot, photos: [{ ...photos[0], label: "close_up" }] })).toMatchObject({ vehicleContext: snapshot.vehicleContext, jobId: "job-a" });
  });
  it("keeps old clients and another vehicle or job from changing identical photos", () => {
    const snapshot: PhotoDraftEnvelope = { version: 3, photos, vehicleContext: { model: "Civic" }, jobId: "job-a" };
    expect(photoDraftsMatch(snapshot, { version: 2, photos })).toBe(false);
    expect(photoDraftsMatch(snapshot, { ...snapshot, vehicleContext: { model: "Accord" } })).toBe(false);
    expect(photoDraftsMatch(snapshot, { ...snapshot, jobId: "job-b" })).toBe(false);
    expect(photoDraftsMatch(snapshot, structuredClone(snapshot))).toBe(true);
  });
  it("requires an explicit no-vehicle snapshot and refuses broken new metadata", () => {
    expect(normalizePhotoDraft({ version: 3, photos, vehicleContext: null })).toEqual({ version: 3, photos, vehicleContext: null });
    expect(normalizePhotoDraft({ version: 3, photos })).toBeNull();
    expect(normalizePhotoDraft({ version: 3, photos, vehicleContext: "other car" })).toBeNull();
    expect(normalizePhotoDraft({ version: 3, photos, vehicleContext: null, jobId: "wrong/job" })).toBeNull();
  });
  it("retains the complete repeat-capture target, frozen car/job and compatible component target in version four", () => {
    const repeat: PhotoDraftEnvelope = { version: 4, photos, target: draft.target, comparisonTarget, vehicleContext: { model: "Original car" }, jobId: "job-a" };
    expect(normalizePhotoDraft(JSON.parse(JSON.stringify(repeat)))).toEqual(repeat);
    expect(normalizePhotoDraft({ ...repeat, photos: [{ ...photos[0], label: "close_up" }] })).toMatchObject({ comparisonTarget, target: draft.target, vehicleContext: repeat.vehicleContext, jobId: "job-a" });
  });
  it("rejects conflicting reserved IDs, partial reference metadata and unsupported older repeat envelopes", () => {
    const repeat = { version: 4, photos, comparisonTarget, vehicleContext: null };
    expect(normalizePhotoDraft({ ...repeat, target: { ...draft.target, lookupId: "different" } })).toBeNull();
    expect(normalizePhotoDraft({ ...repeat, comparisonTarget: { ...comparisonTarget, earlier: { ...comparisonTarget.earlier, sha256: "missing" } } })).toBeNull();
    expect(normalizePhotoDraft({ ...repeat, comparisonTarget: undefined })).toBeNull();
    expect(normalizePhotoDraft({ ...repeat, vehicleContext: undefined })).toBeNull();
    expect(normalizePhotoDraft({ ...repeat, version: 3 })).toBeNull();
    expect(normalizePhotoDraft({ ...repeat, version: 2 })).toBeNull();
  });
  it("does not let unchanged photo bytes authorize replacing or retiring a different comparison draft", () => {
    const repeat: PhotoDraftEnvelope = { version: 4, photos, comparisonTarget, vehicleContext: null };
    expect(photoDraftsMatch(repeat, { version: 3, photos, vehicleContext: null })).toBe(false);
    expect(photoDraftsMatch(repeat, { ...repeat, comparisonTarget: { ...comparisonTarget, comparisonId: "00000000-0000-4000-8000-000000000005" } })).toBe(false);
    expect(photoDraftsMatch(repeat, { ...repeat, comparisonTarget: { ...comparisonTarget, lookupId: "other" } })).toBe(false);
    expect(photoDraftsMatch(repeat, { ...repeat, comparisonTarget: { ...comparisonTarget, earlier: { ...comparisonTarget.earlier, sha256: "b".repeat(64) } } })).toBe(false);
    expect(photoDraftsMatch(repeat, { ...repeat, comparisonTarget: { ...comparisonTarget, earlier: { ...comparisonTarget.earlier, observedOn: "2026-11-03" } } })).toBe(false);
    expect(photoDraftsMatch(repeat, { ...repeat, vehicleContext: { model: "Other car" } })).toBe(false);
    expect(photoDraftsMatch(repeat, { ...repeat, jobId: "another-job" })).toBe(false);
    expect(photoDraftsMatch(repeat, structuredClone(repeat))).toBe(true);
  });
});

describe("queued photo-draft mutation guards", () => {
  let stored: PhotoDraftEnvelope | undefined, release: (() => void) | undefined, saved: Lookup, local: Lookup | null;
  let deletes: ReturnType<typeof vi.fn>, writes: ReturnType<typeof vi.fn>, abort: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks(); setActiveAccount("owner"); vi.stubGlobal("indexedDB", {}); release = undefined;
    stored = upgradePhotoDraft(draft);
    saved = { id: "detail", createdAt: "2026-11-05T00:00:00Z", frame: photos[0], photos: structuredClone(photos), photoRelationship: "unknown",
      notes: "", correction: null, rating: null, chatHistory: [], scanCategory: "engine", trainingLabel: "", trainingStatus: "raw_unreviewed",
      vehicleContext: { model: "Original car" }, jobId: "job-a", provenance: { captureMode: "upload", analysisSource: "ai_detection", savedAt: "2026-11-05T00:00:00Z" } };
    local = structuredClone(saved);
    mocks.read.mockImplementation(() => ({ ok: true, value: local ? [structuredClone(local)] : [] }));
    mocks.get.mockImplementation((id: string, values: Lookup[]) => values.find((entry) => entry.id === id) ?? null);
    // Controlled IDB request boundary: mutations remain staged until oncomplete;
    // an abort discards them. Native acceptance separately exercises real IDB.
    mocks.open.mockImplementation(async () => ({ close: vi.fn(), transaction: () => {
      let aborted = false, staged: PhotoDraftEnvelope | undefined;
      const request = { result: undefined as unknown, onsuccess: null as (() => void) | null };
      const transaction = { oncomplete: null as (() => void) | null, onabort: null as (() => void) | null, onerror: null as (() => void) | null,
        abort: () => {}, objectStore: () => ({}) };
      abort = vi.fn(() => { aborted = true; queueMicrotask(() => transaction.onabort?.()); }); transaction.abort = abort;
      deletes = vi.fn(() => { staged = undefined; }); writes = vi.fn((value: PhotoDraftEnvelope) => { staged = structuredClone(value); });
      transaction.objectStore = () => ({ transaction, delete: deletes, put: writes, get: () => {
        release = () => { request.result = structuredClone(stored); staged = structuredClone(stored); request.onsuccess?.();
          if (!aborted) { stored = staged; transaction.oncomplete?.(); } };
        return request;
      } });
      return transaction;
    } }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it.each(["photo", "date", "relationship", "vehicle", "job", "delete", "cancel"])("preserves the matching draft if %s changes while its read is queued", async (kind) => {
    const snapshot = structuredClone(saved), before = structuredClone(stored), controller = new AbortController(), scope = getAccountScope();
    const pending = replacePhotoDraftEnvelopeIfMatches(before!, null, scope, "upload", () => assertComponentCaptureCurrent(snapshot, scope, controller.signal));
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    if (kind === "photo") local!.photos![0].imageBase64 = "data:image/jpeg;base64,bmV3";
    else if (kind === "date") local!.photos![0].capturedAt = "2026-11-04T00:00:00Z";
    else if (kind === "relationship") local!.photoRelationship = "independent";
    else if (kind === "vehicle") local!.vehicleContext = { model: "Another car" };
    else if (kind === "job") local!.jobId = "job-b";
    else if (kind === "delete") local = null;
    else controller.abort();
    release!(); await rejected;
    expect(abort).toHaveBeenCalledOnce(); expect(deletes).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled(); expect(stored).toEqual(before);
  });

  it("skips a stale retirement guard and leaves a newer draft intact", async () => {
    const before = structuredClone(stored), guard = vi.fn(() => { throw new Error("Must not run for a stale draft"); });
    const pending = replacePhotoDraftEnvelopeIfMatches(before!, null, getAccountScope(), "upload", guard);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    stored = { ...before!, target: { ...before!.target!, linkAttemptId: "00000000-0000-4000-8000-000000000099" } };
    const newer = structuredClone(stored); release!();
    expect(await pending).toBe(false); expect(guard).not.toHaveBeenCalled(); expect(deletes).not.toHaveBeenCalled(); expect(stored).toEqual(newer);
  });

  it("checks immediately before deletion and retires only unchanged saved evidence", async () => {
    const scope = getAccountScope(), guard = vi.fn(() => { expect(deletes).not.toHaveBeenCalled(); assertComponentCaptureCurrent(saved, scope); });
    const pending = replacePhotoDraftEnvelopeIfMatches(stored!, null, scope, "upload", guard);
    await vi.waitFor(() => expect(release).toBeTypeOf("function")); release!();
    expect(await pending).toBe(true); expect(guard).toHaveBeenCalledOnce(); expect(deletes).toHaveBeenCalledWith("owner:upload"); expect(stored).toBeUndefined();
  });

  it("also aborts a matching replacement when its synchronous guard fails", async () => {
    const before = structuredClone(stored), next = { ...before!, photos: [{ ...photos[0], label: "close_up" as const }] };
    const pending = replacePhotoDraftEnvelopeIfMatches(before!, next, getAccountScope(), "upload", () => { throw new Error("Evidence changed before write"); });
    const rejected = expect(pending).rejects.toThrow("Evidence changed before write");
    await vi.waitFor(() => expect(release).toBeTypeOf("function")); release!(); await rejected;
    expect(writes).not.toHaveBeenCalled(); expect(stored).toEqual(before);
  });
});
