import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import type { Lookup, ScanPhoto } from "../types";
import type { ComponentMap, MapOverviewSource } from "../types/componentMap";
const mocks = vi.hoisted(() => ({ read: vi.fn(), get: vi.fn(), cloud: vi.fn() }));
vi.mock("./storage", () => ({ readLookups: mocks.read, getLookup: mocks.get }));
vi.mock("./cloudHistory", () => ({ readCloudLookupForReport: mocks.cloud }));
import { assertMapOverviewGuardCurrent, resolveMapOverview, verifyMapOverviewImage } from "./mapOverviewEvidence";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const image = `data:image/png;base64,${PNG}`;
const bytes = Uint8Array.from(atob(PNG), (part) => part.charCodeAt(0));
const time = "2026-11-05T15:00:00.000Z";
const signed = (file = "original.png", token = "old", owner = "owner", id = "scan") => `https://project.supabase.co/storage/v1/object/sign/scan-images/${owner}/${id}/${file}?token=${token}`;
const photo = (id: string, data = image): ScanPhoto => ({ id, label: "overview", imageBase64: data, capturedAt: time });
function scan(photos?: ScanPhoto[]): Lookup {
  return { id: "scan", createdAt: time, frame: { imageBase64: image, capturedAt: time }, ...(photos ? { photos } : {}),
    provenance: { captureMode: "upload", analysisSource: "ai_detection", savedAt: time }, rating: null, correction: null,
    notes: "", chatHistory: [], scanCategory: "engine", trainingLabel: "Engine", trainingStatus: "raw_unreviewed" };
}
const source = (): MapOverviewSource => ({ sha256: createHash("sha256").update(bytes).digest("hex"), width: 1, height: 1, photoAddedAt: time, scanSavedAt: time });
const map = (photoId = "photo-1"): ComponentMap => ({ version: 3, id: "scan", overview: { lookupId: "scan", photoId, source: source() }, components: [] });
const differentImage = () => { const changed = bytes.slice(); changed[40] ^= 1; return `data:image/png;base64,${btoa(String.fromCharCode(...changed))}`; };
const response = (content = bytes) => new Response(content.slice(), { status: 200, headers: { "Content-Type": "image/png" } });

describe("map overview file binding", () => {
  let local: Lookup[], fetchSpy: ReturnType<typeof vi.fn>, decode: (() => void) | undefined, hungDecode: boolean, width: number, height: number;
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co"); vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", "true");
    vi.stubGlobal("crypto", webcrypto); setActiveAccount("owner"); local = [scan()]; decode = undefined; hungDecode = false; width = 1; height = 1;
    mocks.read.mockImplementation(() => ({ ok: true, value: structuredClone(local) }));
    mocks.get.mockImplementation((id: string, values: Lookup[]) => structuredClone(values.find((value) => value.id === id) ?? null));
    mocks.cloud.mockResolvedValue({ ok: true, value: null });
    fetchSpy = vi.fn(async () => response()); vi.stubGlobal("fetch", fetchSpy);
    // jsdom has no raster decoder. Native browser acceptance must verify real
    // decoding; these tests control its completion/dimensions while hashing real bytes.
    vi.stubGlobal("Image", class {
      naturalWidth = width; naturalHeight = height; onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(value: string) { if (value) { decode?.(); if (!hungDecode) queueMicrotask(() => this.onload?.()); } }
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("binds the actual first saved photo, never the separate frame, secondary image or cutout", async () => {
    const saved = scan([photo("first"), photo("second", differentImage())]);
    saved.frame.imageBase64 = differentImage(); saved.isolatedImageBase64 = differentImage(); local = [saved];
    const verified = await resolveMapOverview(saved, undefined, getAccountScope(), undefined, true);
    expect(verified).toMatchObject({ status: "unchanged", image, source: source(), guard: { lookupId: "scan", photoId: "first" } });
    expect(() => assertMapOverviewGuardCurrent(verified.guard!, map("first"))).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled(); expect(mocks.cloud).not.toHaveBeenCalled();
  });

  it("standalone verification inspects only its supplied source, without device/cloud substitution", async () => {
    local = [scan([photo("other", differentImage())])];
    expect(await verifyMapOverviewImage(scan(), map())).toMatchObject({ status: "unchanged", image, source: source() });
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.cloud).not.toHaveBeenCalled();
    fetchSpy.mockResolvedValue(new Response(null, { status: 403 }));
    const remote = scan(); remote.frame.imageBase64 = signed();
    expect(await verifyMapOverviewImage(remote, map())).toMatchObject({ status: "verification_unavailable" });
    expect(fetchSpy).toHaveBeenCalledTimes(1); expect(mocks.cloud).not.toHaveBeenCalled();
  });

  it("preserves overview verification and guard immutability after a version-4 linked-photo upgrade", async () => {
    const document: ComponentMap = { ...map(), version: 4 };
    const verified = await resolveMapOverview(scan(), document);
    expect(verified).toMatchObject({ status: "unchanged", image, source: source() });
    expect(() => assertMapOverviewGuardCurrent(verified.guard!, document)).not.toThrow();
    expect((await verifyMapOverviewImage(scan(), document)).status).toBe("unchanged");
    expect(() => assertMapOverviewGuardCurrent(verified.guard!, { ...document, overview: { ...document.overview, source: { ...source(), width: 2 } } })).toThrow();
    const invalid = { ...document, overview: { lookupId: "scan", photoId: "photo-1" } };
    expect((await verifyMapOverviewImage(scan(), invalid)).status).toBe("verification_unavailable");
  });

  it.each([1, 2] as const)("loads only a plain current image for legacy v%s without inventing a binding", async (version) => {
    const legacy: ComponentMap = { ...map(), version, overview: { lookupId: "scan", photoId: "photo-1" } };
    const before = JSON.stringify(legacy);
    const resolved = await resolveMapOverview(scan(), legacy);
    expect(resolved).toMatchObject({ status: "legacy_unverified", image });
    expect(resolved.source).toBeUndefined(); expect(resolved.guard).toBeUndefined();
    expect((await verifyMapOverviewImage(scan(), legacy)).status).toBe("legacy_unverified");
    expect(JSON.stringify(legacy)).toBe(before);
  });

  it.each(["bytes", "dimensions", "photo date", "scan date"])("rejects matching IDs with changed %s", async (kind) => {
    const saved = scan();
    if (kind === "bytes") saved.frame.imageBase64 = differentImage();
    if (kind === "dimensions") width = 2;
    if (kind === "photo date") saved.frame.capturedAt = "2026-11-04T15:00:00.000Z";
    if (kind === "scan date") saved.createdAt = "2026-11-04T15:00:00.000Z";
    local = [saved];
    const result = await resolveMapOverview(saved, map());
    expect(result.status).toBe("source_changed"); expect(result.image).toBeUndefined(); expect(result.guard).toBeUndefined();
  });

  it("does not invalidate geometry when labels, AI answers, vehicle details or notes change", async () => {
    const displayed = scan([photo("first")]); local = [structuredClone(displayed)];
    local[0].photos![0].label = "close_up"; local[0].vehicleContext = { make: "Toyota" }; local[0].analysisAttemptId = "new-answer";
    local[0].notes = "Human note"; local[0].result = { partName: "Different candidate" } as Lookup["result"];
    const result = await resolveMapOverview(displayed, map("first"));
    expect(result.status).toBe("unchanged");
    local[0].notes = "Another note"; local[0].result = undefined; local[0].analysisAttemptId = "retry";
    expect(() => assertMapOverviewGuardCurrent(result.guard!, map("first"))).not.toThrow();
  });

  it("canonicalizes equivalent source dates but rejects malformed dates", async () => {
    const saved = scan(); saved.createdAt = "2026-11-05T10:00:00-05:00"; saved.frame.capturedAt = "2026-11-05T15:00:00.000000+00:00"; local = [saved];
    expect(await resolveMapOverview(scan(), map())).toMatchObject({ status: "unchanged", source: source() });
    saved.frame.capturedAt = "2026-02-30T15:00:00Z";
    expect(await verifyMapOverviewImage(saved, map())).toMatchObject({ status: "verification_unavailable" });
  });

  it("refuses missing or duplicate selected photos instead of substituting another original", async () => {
    expect(await verifyMapOverviewImage(scan([]), map())).toMatchObject({ status: "missing_photo" });
    expect(await resolveMapOverview(scan([]), undefined)).toMatchObject({ status: "missing_photo" });
    expect(await verifyMapOverviewImage(scan([photo("other")]), map())).toMatchObject({ status: "missing_photo" });
    expect(await verifyMapOverviewImage(scan([photo("first"), photo("first")]), map("first"))).toMatchObject({ status: "verification_unavailable" });
    expect(await verifyMapOverviewImage({ ...scan(), id: "other" }, map())).toMatchObject({ status: "source_changed" });
    const invalid = map(); invalid.overview.source = undefined;
    expect(await verifyMapOverviewImage(scan(), invalid)).toMatchObject({ status: "verification_unavailable" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a stale displayed original before loading and never falls back after required local deletion", async () => {
    local[0].frame.imageBase64 = differentImage();
    expect(await resolveMapOverview(scan(), undefined)).toMatchObject({ status: "source_changed" });
    local = []; mocks.cloud.mockResolvedValue({ ok: true, value: scan() });
    expect(await resolveMapOverview(scan(), map(), getAccountScope(), undefined, true)).toMatchObject({ status: "missing_photo" });
    expect(mocks.cloud).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(["deletion", "replacement", "first-photo change"])("rejects %s during decoding and retains the old map", async (kind) => {
    const saved = scan([photo("first"), photo("second")]); local = [saved]; const document = map("first"), before = JSON.stringify(document);
    decode = () => {
      if (kind === "deletion") local = [];
      else if (kind === "replacement") local[0].photos![0].imageBase64 = differentImage();
      else local[0].photos!.reverse();
    };
    const result = await resolveMapOverview(saved, document);
    expect(result.status).toBe("source_changed"); expect(result.image).toBeUndefined(); expect(result.guard).toBeUndefined();
    expect(JSON.stringify(document)).toBe(before);
  });

  it("checks device absence before/after cloud-only verification and at the save boundary", async () => {
    local = []; mocks.cloud.mockResolvedValue({ ok: true, value: scan() });
    const result = await resolveMapOverview(scan(), map());
    expect(result).toMatchObject({ status: "unchanged", guard: { deviceSignature: "absent" } });
    expect(() => assertMapOverviewGuardCurrent(result.guard!, map())).not.toThrow();
    local = [scan()]; expect(() => assertMapOverviewGuardCurrent(result.guard!, map())).toThrow();
    local = []; decode = () => { local = [scan()]; };
    expect(await resolveMapOverview(scan(), map())).toMatchObject({ status: "source_changed" });
  });

  it("never treats a failed device read as absent or uses cloud history when disabled", async () => {
    mocks.read.mockReturnValue({ ok: false, message: "unavailable" });
    expect(await resolveMapOverview(scan(), map())).toMatchObject({ status: "verification_unavailable" });
    expect(mocks.cloud).not.toHaveBeenCalled();
    mocks.read.mockReturnValue({ ok: true, value: [] }); vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", "false");
    expect(await resolveMapOverview(scan(), map())).toMatchObject({ status: "verification_unavailable", message: expect.stringContaining("off for this build") });
    expect(mocks.cloud).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refreshes only the same owned object and hashes the returned raster", async () => {
    const saved = scan([photo("first", signed() + "&download=original.png")]); local = [saved];
    const fresh = scan([photo("first", signed("original.png", "fresh") + "&download=original.png")]); fresh.photos![0].label = "close_up";
    mocks.cloud.mockResolvedValue({ ok: true, value: fresh }); fetchSpy.mockResolvedValueOnce(new Response(null, { status: 403 }));
    const result = await resolveMapOverview(saved, map("first"));
    expect(result).toMatchObject({ status: "unchanged", image, source: source() });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    local[0].photos![0].imageBase64 = fresh.photos![0].imageBase64;
    expect(() => assertMapOverviewGuardCurrent(result.guard!, map("first"))).not.toThrow();
  });

  it.each(["replacement.png", "original.png?bad"])("rejects token refresh to a different path %s", async (file) => {
    const saved = scan([photo("first", signed())]); local = [saved];
    mocks.cloud.mockResolvedValue({ ok: true, value: scan([photo("first", signed(file, "fresh"))]) }); fetchSpy.mockResolvedValue(new Response(null, { status: 403 }));
    expect(await resolveMapOverview(saved, map("first"))).toMatchObject({ status: "source_changed" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps non-token options significant during refresh, async checks and synchronous guard checks", async () => {
    const saved = scan([photo("first", signed() + "&download=a")]); local = [saved];
    mocks.cloud.mockResolvedValue({ ok: true, value: scan([photo("first", signed("original.png", "fresh") + "&download=b")]) });
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect(await resolveMapOverview(saved, map("first"))).toMatchObject({ status: "source_changed" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const verified = await resolveMapOverview(saved, map("first"));
    local[0].photos![0].imageBase64 = signed() + "&download=b";
    expect(() => assertMapOverviewGuardCurrent(verified.guard!, map("first"))).toThrow();
  });

  it("rejects transformed, foreign, duplicate-token and arbitrary URLs before network access", async () => {
    for (const data of [signed().replace('/object/sign/', '/render/image/sign/'), signed('original.png', 'old', 'other'), signed('original.png', 'old', 'owner', 'other'),
      signed() + '&token=another', 'https://other.example/original.png?token=x', signed() + '#fragment']) {
      expect(await verifyMapOverviewImage(scan([photo('first', data)]), map('first'))).toMatchObject({ status: 'verification_unavailable' });
    }
    expect(fetchSpy).not.toHaveBeenCalled(); expect(mocks.cloud).not.toHaveBeenCalled();
  });

  it("detects changed remote bytes even at the identical Storage object URL", async () => {
    const saved = scan([photo("first", signed())]); local = [saved];
    const replacement = bytes.slice(); replacement[40] ^= 1; fetchSpy.mockResolvedValue(response(replacement));
    expect(await resolveMapOverview(saved, map("first"))).toMatchObject({ status: "source_changed" });
  });

  it("guards matching source/document, replacement, deletion, account generations and forged guards at save", async () => {
    const result = await resolveMapOverview(scan(), map()), guard = result.guard!;
    expect(() => assertMapOverviewGuardCurrent(guard, { ...map(), overview: { ...map().overview, source: { ...source(), width: 2 } } })).toThrow();
    expect(() => assertMapOverviewGuardCurrent(structuredClone(guard), map())).toThrow();
    local[0].frame.imageBase64 = differentImage(); expect(() => assertMapOverviewGuardCurrent(guard, map())).toThrow();
    local = []; expect(() => assertMapOverviewGuardCurrent(guard, map())).toThrow();
    local = [scan()]; setActiveAccount("other"); expect(() => assertMapOverviewGuardCurrent(guard, map())).toThrow();
    setActiveAccount("owner"); expect(() => assertMapOverviewGuardCurrent(guard, map())).toThrow();
  });

  it("returns no image after account change or cancellation during decoding", async () => {
    const scope = getAccountScope(); decode = () => setActiveAccount("other");
    expect(await resolveMapOverview(scan(), map(), scope)).toMatchObject({ status: "verification_unavailable", message: expect.stringContaining("Account changed") });
    setActiveAccount("owner"); const controller = new AbortController(); decode = () => controller.abort();
    const result = await resolveMapOverview(scan(), map(), getAccountScope(), controller.signal);
    expect(result).toMatchObject({ status: "verification_unavailable", message: expect.stringContaining("canceled") }); expect(result.image).toBeUndefined();
  });

  it("bounds a stalled cloud read or image decode without leaking provider messages", async () => {
    vi.useFakeTimers(); local = []; mocks.cloud.mockReturnValue(new Promise(() => undefined));
    const pending = resolveMapOverview(scan(), map()); await vi.advanceTimersByTimeAsync(20_001);
    expect(await pending).toMatchObject({ status: "verification_unavailable", message: expect.stringContaining("timed out") });
    local = [scan()]; hungDecode = true;
    const hung = resolveMapOverview(scan(), map()); await vi.advanceTimersByTimeAsync(20_001);
    expect(await hung).toMatchObject({ status: "verification_unavailable" });
    local = []; mocks.cloud.mockRejectedValue(new Error('private URL token=SECRET'));
    expect(JSON.stringify(await resolveMapOverview(scan(), map()))).not.toContain('SECRET');
  });
});
