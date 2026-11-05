import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import type { Lookup, ScanPhoto } from "../types";
import type { ComponentMapGroupBinding, ComponentMapScanGroup, MapOverviewSource } from "../types/componentMap";
const mocks = vi.hoisted(() => ({ read: vi.fn(), get: vi.fn(), cloud: vi.fn() }));
vi.mock("./storage", () => ({ readLookups: mocks.read, getLookup: mocks.get }));
vi.mock("./cloudHistory", () => ({ readCloudLookupForReport: mocks.cloud }));
import { assertLinkedPhotoGuardCurrent, prepareLinkedPhotoBinding, resolveLinkedPhotoGroup, verifyLinkedPhotoGroup } from "./linkedPhotoEvidence";
import { OriginalEvidenceError } from "./originalImageEvidence";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const image = `data:image/png;base64,${PNG}`;
const bytes = Uint8Array.from(atob(PNG), (part) => part.charCodeAt(0));
const time = "2026-11-05T15:00:00.000Z";
const signed = (token = "old", file = "original.png") => `https://project.supabase.co/storage/v1/object/sign/scan-images/owner/scan/${file}?token=${token}`;
const photo = (id: string, data = image): ScanPhoto => ({ id, label: "close_up", imageBase64: data, capturedAt: time });
function scan(values: ScanPhoto[] = [photo("first"), photo("second")]): Lookup {
  return { id: "scan", createdAt: time, frame: { imageBase64: image, capturedAt: time }, photos: values, photoRelationship: "independent",
    provenance: { captureMode: "upload", analysisSource: "ai_detection", savedAt: time }, rating: null, correction: null,
    notes: "", chatHistory: [], scanCategory: "engine", trainingLabel: "Engine", trainingStatus: "raw_unreviewed" };
}
const source = (): MapOverviewSource => ({ sha256: createHash("sha256").update(bytes).digest("hex"), width: 1, height: 1, photoAddedAt: time, scanSavedAt: time });
const binding = (ids = ["first", "second"]): ComponentMapGroupBinding => ({ version: 1, photoRelationship: "independent", photos: ids.map((photoId) => ({ photoId, label: "close_up", source: source() })) });
const group = (): ComponentMapScanGroup => ({ linkId: "00000000-0000-4000-8000-000000000001", lookupId: "scan", photoIds: ["first", "second"], binding: binding() });
const differentImage = () => { const changed = bytes.slice(); changed[40] ^= 1; return `data:image/png;base64,${btoa(String.fromCharCode(...changed))}`; };
const response = () => new Response(bytes.slice(), { status: 200, headers: { "Content-Type": "image/png" } });

describe("linked original evidence", () => {
  let local: Lookup[], fetchSpy: ReturnType<typeof vi.fn>, decode: (() => void) | undefined, width: number, hung: boolean;
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co"); vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", "true");
    vi.stubGlobal("crypto", webcrypto); setActiveAccount("owner"); local = [scan()]; decode = undefined; width = 1; hung = false;
    mocks.read.mockImplementation(() => ({ ok: true, value: structuredClone(local) }));
    mocks.get.mockImplementation((id: string, values: Lookup[]) => structuredClone(values.find((value) => value.id === id) ?? null));
    mocks.cloud.mockResolvedValue({ ok: true, value: null }); fetchSpy = vi.fn(async () => response()); vi.stubGlobal("fetch", fetchSpy);
    // Hash real bytes; native QA covers real raster decoding instead of this jsdom stub.
    vi.stubGlobal("Image", class {
      naturalWidth = width; naturalHeight = 1; onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(value: string) { if (value) { decode?.(); if (!hung) queueMicrotask(() => this.onload?.()); } }
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("prepares every ordered labeled original and relationship, never frame/cutout or AI", async () => {
    const saved = scan(); saved.photos![1].label = "marking"; saved.frame.imageBase64 = differentImage(); saved.isolatedImageBase64 = differentImage(); local = [saved];
    const prepared = await prepareLinkedPhotoBinding(saved, ["first", "second"]);
    expect(prepared.binding).toEqual({ ...binding(), photos: [binding().photos[0], { ...binding().photos[1], label: "marking" }] });
    expect(() => assertLinkedPhotoGuardCurrent(prepared.guard, "scan", prepared.binding)).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled(); expect(mocks.cloud).not.toHaveBeenCalled();
    local[0].notes = "Human note"; local[0].analysisAttemptId = "retry"; local[0].result = undefined;
    expect(() => assertLinkedPhotoGuardCurrent(prepared.guard, "scan", prepared.binding)).not.toThrow();
  });

  it("verifies supplied bytes only and preserves a separate status for a changed or missing photo", async () => {
    const supplied = scan([photo("first"), photo("second", differentImage())]);
    const result = await verifyLinkedPhotoGroup(supplied, group());
    expect(result.photos.map((row) => row.status)).toEqual(["unchanged", "source_changed"]);
    expect(result.photos[0].image).toBe(image); expect(result.photos[1].image).toBeUndefined();
    const missing = await verifyLinkedPhotoGroup(scan([photo("second")]), group());
    expect(missing.photos.map((row) => [row.photoId, row.status])).toEqual([["first", "missing_photo"], ["second", "unchanged"]]);
    expect(missing.photos[0]).toMatchObject({ label: "close_up", source: source() });
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.cloud).not.toHaveBeenCalled();
  });

  it("resolution retains successful sibling slots when one original is missing", async () => {
    local = [scan([photo("second")])];
    expect((await resolveLinkedPhotoGroup(group())).photos.map((row) => row.status)).toEqual(["missing_photo", "unchanged"]);
    expect(mocks.cloud).not.toHaveBeenCalled();
  });

  it("keeps historical labels and relationship without treating later metadata as changed pixels", async () => {
    const saved = scan(); saved.photos![0].label = "mounting"; saved.photoRelationship = "same_part_or_area";
    const result = await verifyLinkedPhotoGroup(saved, group());
    expect(result.photoRelationship).toBe("independent");
    expect(result.photos).toEqual(expect.arrayContaining([expect.objectContaining({ photoId: "first", label: "close_up", status: "unchanged", currentMetadataChanged: true })]));
    expect(result.photos[1].currentMetadataChanged).toBe(true);
    saved.photos![0].imageBase64 = differentImage();
    expect((await verifyLinkedPhotoGroup(saved, group())).photos[0]).toMatchObject({ status: "source_changed", label: "close_up", currentMetadataChanged: true });
  });

  it("never invents a legacy binding or relationship, while retaining ordered unannotated images", async () => {
    const legacy = group(); delete legacy.binding;
    const result = await verifyLinkedPhotoGroup(scan(), legacy);
    expect(result).toMatchObject({ legacy: true, photoRelationship: "unknown" });
    expect(result.photos.map((row) => row.status)).toEqual(["legacy_unverified", "legacy_unverified"]);
    expect(result.photos.every((row) => row.image === image && !row.source && !row.label)).toBe(true);
    expect(legacy.binding).toBeUndefined();
  });

  it.each(["reorder", "photo date", "scan date", "dimensions"])("rejects changed %s with unchanged photo IDs", async (kind) => {
    const saved = scan(); if (kind === "reorder") saved.photos!.reverse();
    if (kind === "photo date") saved.photos!.forEach((item) => { item.capturedAt = "2026-11-04T15:00:00.000Z"; });
    if (kind === "scan date") saved.createdAt = "2026-11-04T15:00:00.000Z";
    if (kind === "dimensions") width = 2;
    expect((await verifyLinkedPhotoGroup(saved, group())).photos.map((row) => row.status)).toEqual(["source_changed", "source_changed"]);
  });

  it("rejects an invalid binding or relationship without hashing a partial group", async () => {
    const invalid = group(); invalid.binding!.photos[1].source.sha256 = "not-a-hash";
    expect((await verifyLinkedPhotoGroup(scan(), invalid)).photos.every((row) => row.status === "verification_unavailable" && !row.image)).toBe(true);
    const saved = scan(); saved.photoRelationship = "same_car" as Lookup["photoRelationship"];
    await expect(prepareLinkedPhotoBinding(saved, group().photoIds)).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("distinguishes explicit empty photos from an absent legacy photo array", async () => {
    expect((await verifyLinkedPhotoGroup(scan([]), group())).photos.every((row) => row.status === "missing_photo")).toBe(true);
    const legacy = scan(); delete legacy.photos; delete legacy.photoRelationship; local = [legacy];
    const prepared = await prepareLinkedPhotoBinding(legacy, ["photo-1"]);
    expect(prepared.binding).toMatchObject({ photoRelationship: "unknown", photos: [{ photoId: "photo-1", label: "overview" }] });
  });

  it.each(["replace", "delete", "label", "relationship", "reorder"])("rejects %s during preparation without issuing a guard", async (kind) => {
    const displayed = scan(); local = [structuredClone(displayed)];
    decode = () => {
      if (kind === "delete") local = [];
      else if (kind === "replace") local[0].photos![0].imageBase64 = differentImage();
      else if (kind === "label") local[0].photos![0].label = "other";
      else if (kind === "relationship") local[0].photoRelationship = "unknown";
      else local[0].photos = [...displayed.photos!].reverse();
    };
    await expect(prepareLinkedPhotoBinding(displayed, group().photoIds)).rejects.toThrow();
  });

  it("rejects stale display, source replacement, cloned/mutated guards and a new account generation", async () => {
    const saved = scan(); local[0].photos![0].imageBase64 = differentImage();
    await expect(prepareLinkedPhotoBinding(saved, group().photoIds)).rejects.toThrow(); local = [saved];
    const prepared = await prepareLinkedPhotoBinding(saved, group().photoIds);
    expect(() => assertLinkedPhotoGuardCurrent(structuredClone(prepared.guard), "scan", prepared.binding)).toThrow();
    expect(() => assertLinkedPhotoGuardCurrent(prepared.guard, "other-scan", prepared.binding)).toThrow();
    prepared.guard.binding.photos[0].label = "other";
    expect(() => assertLinkedPhotoGuardCurrent(prepared.guard, "scan", prepared.binding)).toThrow();
    const next = await prepareLinkedPhotoBinding(saved, group().photoIds);
    local[0].photos![1].imageBase64 = differentImage(); expect(() => assertLinkedPhotoGuardCurrent(next.guard, "scan", next.binding)).toThrow();
    local = [saved]; setActiveAccount("other"); setActiveAccount("owner");
    expect(() => assertLinkedPhotoGuardCurrent(next.guard, "scan", next.binding)).toThrow();
  });

  it("does not use cloud after required local deletion, failed device reads or disabled cloud", async () => {
    local = []; mocks.cloud.mockResolvedValue({ ok: true, value: scan() });
    expect((await resolveLinkedPhotoGroup(group(), getAccountScope(), undefined, true)).photos[0].status).toBe("missing_photo");
    await expect(prepareLinkedPhotoBinding(scan(), group().photoIds)).rejects.toThrow(); expect(mocks.cloud).not.toHaveBeenCalled();
    mocks.read.mockReturnValue({ ok: false, message: "unavailable" });
    expect((await resolveLinkedPhotoGroup(group())).photos[0].status).toBe("verification_unavailable");
    mocks.read.mockReturnValue({ ok: true, value: [] }); vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", "false");
    expect((await resolveLinkedPhotoGroup(group())).photos[0].status).toBe("verification_unavailable"); expect(mocks.cloud).not.toHaveBeenCalled();
  });

  it("rereads cloud metadata and checks absent-to-present device races after verification", async () => {
    local = []; mocks.cloud.mockResolvedValue({ ok: true, value: scan() });
    expect((await resolveLinkedPhotoGroup(group())).photos.every((row) => row.status === "unchanged")).toBe(true);
    expect(mocks.cloud).toHaveBeenCalledTimes(2);
    mocks.cloud.mockReset().mockResolvedValueOnce({ ok: true, value: scan() }).mockImplementationOnce(async () => { local = [scan()]; return { ok: true, value: scan() }; });
    expect((await resolveLinkedPhotoGroup(group())).photos.every((row) => row.status === "source_changed" && !row.image)).toBe(true);
  });

  it("renews only the same owned object and rejects non-token/path changes", async () => {
    const saved = scan([photo("first", signed())]); local = [saved];
    const single = { ...group(), photoIds: ["first"], binding: binding(["first"]) };
    mocks.cloud.mockResolvedValue({ ok: true, value: scan([photo("first", signed("fresh"))]) });
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect((await resolveLinkedPhotoGroup(single)).photos[0]).toMatchObject({ status: "unchanged", image });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const url of [signed("fresh", "replacement.png"), signed("fresh") + "&download=changed"]) {
      mocks.cloud.mockResolvedValue({ ok: true, value: scan([photo("first", url)]) }); fetchSpy.mockResolvedValueOnce(new Response(null, { status: 403 }));
      expect((await resolveLinkedPhotoGroup(single)).photos[0].status).toBe("source_changed");
    }
  });

  it("suppresses all images after cancellation or an account switch", async () => {
    const scope = getAccountScope(); decode = () => setActiveAccount("other");
    expect((await verifyLinkedPhotoGroup(scan(), group(), scope)).photos.every((row) => row.status === "verification_unavailable" && !row.image)).toBe(true);
    setActiveAccount("owner"); const controller = new AbortController(); decode = () => controller.abort();
    expect((await verifyLinkedPhotoGroup(scan(), group(), getAccountScope(), controller.signal)).photos.every((row) => !row.image)).toBe(true);
  });

  it("aborts a stalled decoder at the 20-second deadline without issuing a binding or guard", async () => {
    vi.useFakeTimers();
    let started!: () => void;
    const decodingStarted = new Promise<void>((resolve) => { started = resolve; });
    const sources: string[] = [];
    const decoder = { naturalWidth: 1, naturalHeight: 1, onload: null as (() => void) | null, onerror: null as (() => void) | null,
      set src(value: string) { sources.push(value); if (value) started(); } };
    vi.stubGlobal("Image", class { constructor() { return decoder; } });
    let settled = false;
    // Handle the rejection immediately, rather than leaving a rejecting assertion
    // promise unobserved while Vitest advances the timer/microtask queue.
    const completed = prepareLinkedPhotoBinding(scan(), group().photoIds).then(
      (value) => { settled = true; return { ok: true as const, value }; },
      (error: unknown) => { settled = true; return { ok: false as const, error }; },
    );
    await decodingStarted;
    expect(sources).toEqual([image]);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(settled).toBe(false);
    expect(sources).toEqual([image]);
    await vi.advanceTimersByTimeAsync(1);
    const result = await completed;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("A stalled decoder must not issue a binding or guard.");
    // The deadline aborts first: the decoder's sanitized abort rejection can win
    // Promise.race over the deadline's own error. Verify the boundary, not wording.
    expect(result.error).toBeInstanceOf(OriginalEvidenceError);
    expect(result.error).toMatchObject({ status: "verification_unavailable" });
    expect(sources).toEqual([image, ""]);
    expect(decoder.onload).toBeNull();
    expect(decoder.onerror).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
