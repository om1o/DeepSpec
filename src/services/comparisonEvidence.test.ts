import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import type { Lookup, ScanPhoto } from "../types";
const mocks = vi.hoisted(() => ({ lookups: vi.fn(), lookup: vi.fn(), cloud: vi.fn() }));
vi.mock("./storage", () => ({ readLookups: mocks.lookups, getLookup: mocks.lookup }));
vi.mock("./cloudHistory", () => ({ readCloudLookupForReport: mocks.cloud }));
import { comparisonPhotos, comparisonSideForLookup, MAX_COMPARISON_IMAGE_BYTES, resolveComparisonSide } from "./comparisonEvidence";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const image = `data:image/png;base64,${PNG}`;
const bytes = Uint8Array.from(atob(PNG), (part) => part.charCodeAt(0));
const capturedAt = "2026-11-05T15:00:00.000Z";
const signed = (id = "scan", file = "original.png", token = "old", owner = "owner") => `https://project.supabase.co/storage/v1/object/sign/scan-images/${owner}/${id}/${file}?token=${token}`;
function photo(id: string, source = image): ScanPhoto { return { id, label: "overview", imageBase64: source, capturedAt }; }
function scan(id = "scan", photos?: ScanPhoto[]): Lookup {
  return { id, createdAt: capturedAt, frame: { imageBase64: image, capturedAt }, ...(photos ? { photos } : {}),
    provenance: { captureMode: "upload", analysisSource: "ai_detection", savedAt: capturedAt },
    rating: null, correction: null, notes: "private human notes", chatHistory: [], scanCategory: "engine", trainingLabel: "engine", trainingStatus: "raw_unreviewed" };
}
const response = () => new Response(bytes.slice(), { status: 200, headers: { "Content-Type": "image/png" } });

describe("frozen comparison originals", () => {
  let local: Lookup[];
  let fetchSpy: ReturnType<typeof vi.fn>;
  let width: number, height: number, decode: (() => void) | undefined, hungDecode: boolean;
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co"); vi.stubGlobal("crypto", webcrypto);
    setActiveAccount("owner"); local = [scan()]; width = 1; height = 1; hungDecode = false; decode = undefined;
    mocks.lookups.mockImplementation(() => ({ ok: true, value: structuredClone(local) }));
    mocks.lookup.mockImplementation((id: string, values: Lookup[]) => structuredClone(values.find((value) => value.id === id) ?? null));
    mocks.cloud.mockResolvedValue({ ok: true, value: null });
    fetchSpy = vi.fn(async () => response()); vi.stubGlobal("fetch", fetchSpy);
    // jsdom cannot decode images. This controls natural dimensions only; native
    // browser verification exercises its real raster decoder separately.
    vi.stubGlobal("Image", class {
      naturalWidth = width; naturalHeight = height; onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(value: string) { if (value) { decode?.(); if (!hungDecode) queueMicrotask(() => this.onload?.()); } }
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("hashes decoded original bytes and natural dimensions, not a URL or base64 spelling", async () => {
    const embedded = await comparisonSideForLookup(scan(), "photo-1");
    expect(embedded.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(embedded).toMatchObject({ width: 1, height: 1, photoId: "photo-1", observedOn: null, photoAddedAt: capturedAt });
    const remote = scan("scan", [photo("photo-1", signed())]);
    expect(await comparisonSideForLookup(remote, "photo-1")).toEqual(embedded);
    remote.photos![0].imageBase64 = signed("scan", "original.png", "rotated");
    expect(await comparisonSideForLookup(remote, "photo-1")).toEqual(embedded);
    expect(fetchSpy).toHaveBeenCalledWith(signed(), expect.objectContaining({ credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: expect.any(AbortSignal) }));
  });
  it("accepts cloud timestamps with offsets and verifies older equivalent UTC references", async () => {
    const historical = await comparisonSideForLookup(scan(), "photo-1"); local = [];
    const cloud = scan(); cloud.createdAt = "2026-11-05T10:00:00-05:00"; cloud.frame.capturedAt = "2026-11-05T15:00:00.000000+00:00";
    expect(await comparisonSideForLookup(cloud, "photo-1")).toEqual(historical);
    mocks.cloud.mockResolvedValue({ ok: true, value: cloud });
    expect(await resolveComparisonSide({ ...historical, photoAddedAt: "2026-11-05T15:00:00Z", scanSavedAt: "2026-11-05T15:00:00Z" })).toMatchObject({ status: "unchanged", image });
  });
  it("rejects impossible source dates rather than rolling them into a different day", async () => {
    const cloud = scan(); cloud.createdAt = "2026-02-30T15:00:00+00:00";
    await expect(comparisonSideForLookup(cloud, "photo-1")).rejects.toThrow("could not be verified");
    cloud.createdAt = capturedAt; cloud.frame.capturedAt = "2025-02-29T15:00:00Z";
    await expect(comparisonSideForLookup(cloud, "photo-1")).rejects.toThrow("could not be verified");
  });
  it("retains the exact selected photo and safe vehicle context without inventing a capture date", async () => {
    const lookup = scan("scan", [photo("first"), { ...photo("chosen"), label: "marking", capturedAt: "2026-11-04T10:00:00Z" }]);
    lookup.vehicleContext = { make: "Toyota", mileage: "12345", mileageUnit: "km", symptom: "Rattle", notes: "PRIVATE", customerName: "PRIVATE", plate: "PRIVATE" };
    lookup.analysisAttemptId = "analysis.original-v2";
    const side = await comparisonSideForLookup(lookup, "chosen");
    expect(side).toMatchObject({ photoId: "chosen", photoLabel: "marking", photoAddedAt: "2026-11-04T10:00:00.000Z", observedOn: null, analysisAttemptId: "analysis.original-v2", vehicleContext: { mileage: "12345", mileageUnit: "km", symptom: "Rattle" } });
    expect(JSON.stringify(side)).not.toContain("PRIVATE"); expect(side.scanSavedAt).toBe(capturedAt);
  });
  it("supports only photo-1 for legacy originals and never substitutes another group photo", async () => {
    expect(comparisonPhotos(scan()).map((entry) => entry.id)).toEqual(["photo-1"]);
    await expect(comparisonSideForLookup(scan(), "photo-2")).rejects.toThrow("another photo was not substituted");
    const lookup = scan("scan", [photo("chosen"), photo("other")]); local = [lookup];
    const side = await comparisonSideForLookup(lookup, "chosen"); lookup.photos = [photo("other")];
    expect(await resolveComparisonSide(side)).toMatchObject({ status: "missing_photo" }); expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("rejects duplicate IDs rather than selecting the first image", async () => {
    await expect(comparisonSideForLookup(scan("scan", [photo("chosen"), photo("chosen")]), "chosen")).rejects.toThrow("could not be verified");
  });
  it("does not fetch arbitrary, foreign-owner, foreign-scan or malformed storage URLs", async () => {
    for (const source of ["https://attacker.test/private.png", signed("scan", "original.png", "old", "other"), signed("other-scan"), "http://project.supabase.co/storage/v1/object/sign/scan-images/owner/scan/original.png?token=x", signed("scan", "%252e%252e/private.png"), signed() + "#fragment", signed().replace("?token=old", ""), "data:image/svg+xml;base64,PHN2Zy8+"]) {
      await expect(comparisonSideForLookup(scan("scan", [photo("photo-1", source)]), "photo-1")).rejects.toThrow("could not be verified");
    }
    expect(fetchSpy).not.toHaveBeenCalled(); expect(mocks.cloud).not.toHaveBeenCalled();
  });
  it("refreshes an expired authorized path while retaining the chosen ID and local context", async () => {
    const saved = scan("scan", [photo("photo-1", signed())]); saved.vehicleContext = { make: "Toyota" }; local = [saved];
    const historical = await comparisonSideForLookup({ ...saved, photos: [photo("photo-1")] }, "photo-1");
    const cloud = scan("scan", [photo("photo-1", signed("scan", "original.png", "fresh"))]); cloud.vehicleContext = { make: "Old cloud value" };
    mocks.cloud.mockResolvedValue({ ok: true, value: cloud }); fetchSpy.mockResolvedValueOnce(new Response(null, { status: 403 })).mockImplementation(async () => response());
    expect(await resolveComparisonSide(historical)).toMatchObject({ status: "unchanged", image });
    expect(fetchSpy).toHaveBeenLastCalledWith(signed("scan", "original.png", "fresh"), expect.any(Object)); expect(local[0].vehicleContext).toEqual({ make: "Toyota" });
  });
  it("refreshes an expired legacy original whose cloud timestamp uses an equivalent offset", async () => {
    const historical = await comparisonSideForLookup(scan(), "photo-1");
    local = [scan()]; local[0].frame.imageBase64 = signed();
    const cloud = scan(); cloud.createdAt = "2026-11-05T15:00:00+00:00";
    cloud.frame = { capturedAt: "2026-11-05T10:00:00-05:00", imageBase64: signed("scan", "original.png", "fresh") };
    mocks.cloud.mockResolvedValue({ ok: true, value: cloud }); fetchSpy.mockResolvedValueOnce(new Response(null, { status: 403 })).mockImplementation(async () => response());
    expect(await resolveComparisonSide(historical)).toMatchObject({ status: "unchanged", image });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
  it("rejects an expired refresh that points the same photo ID at another object", async () => {
    const historical = await comparisonSideForLookup(scan(), "photo-1"); local = [scan("scan", [photo("photo-1", signed())])];
    fetchSpy.mockResolvedValue(new Response(null, { status: 403 }));
    mocks.cloud.mockResolvedValue({ ok: true, value: scan("scan", [photo("photo-1", signed("scan", "replacement.png", "fresh"))]) });
    expect(await resolveComparisonSide(historical)).toMatchObject({ status: "source_changed" }); expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
  it("resolves a cloud-only owner scan without importing or writing it", async () => {
    const historical = await comparisonSideForLookup(scan(), "photo-1"); local = [];
    mocks.cloud.mockResolvedValue({ ok: true, value: scan("scan", [photo("photo-1", signed())]) });
    expect(await resolveComparisonSide(historical)).toMatchObject({ status: "unchanged", image }); expect(local).toEqual([]);
    mocks.cloud.mockResolvedValue({ ok: true, value: scan("different") });
    expect(await resolveComparisonSide(historical)).toMatchObject({ status: "verification_unavailable" });
  });
  it("detects frozen metadata and vehicle changes before fetching evidence", async () => {
    const historical = await comparisonSideForLookup(scan(), "photo-1");
    for (const lookup of [{ ...scan(), vehicleContext: { make: "Other" } }, { ...scan(), analysisAttemptId: "rerun-2" }, { ...scan(), createdAt: "2026-11-04T00:00:00Z" }, scan("scan", [{ ...photo("photo-1"), label: "marking" }])]) {
      local = [lookup as Lookup]; expect(await resolveComparisonSide(historical)).toMatchObject({ status: "source_changed" });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("detects changed bytes or natural dimensions even when source IDs and dates match", async () => {
    const historical = await comparisonSideForLookup(scan(), "photo-1");
    const changedBytes = bytes.slice(); changedBytes[40] ^= 1;
    local[0].frame.imageBase64 = `data:image/png;base64,${btoa(String.fromCharCode(...changedBytes))}`;
    expect(await resolveComparisonSide(historical)).toMatchObject({ status: "source_changed" });
    local = [scan()]; width = 2; expect(await resolveComparisonSide(historical)).toMatchObject({ status: "source_changed" });
  });
  it("detects local source edits while async decoding is in flight", async () => {
    const historical = await comparisonSideForLookup(scan(), "photo-1");
    decode = () => { local[0].vehicleContext = { model: "Changed during verification" }; };
    expect(await resolveComparisonSide(historical)).toMatchObject({ status: "source_changed" });
  });
  it("ignores private notes and signed-token rotation while checking relevant source context", async () => {
    const historical = await comparisonSideForLookup(scan(), "photo-1"); local = [scan("scan", [photo("photo-1", signed())])];
    decode = () => { local[0].notes = "Edited private note"; local[0].photos![0].imageBase64 = signed("scan", "original.png", "new-token"); };
    expect(await resolveComparisonSide({ ...historical, observedOn: "2026-11-01" })).toMatchObject({ status: "unchanged" });
  });
  it("returns explicit missing evidence and never includes provider URLs or secrets in messages", async () => {
    const historical = await comparisonSideForLookup(scan(), "photo-1"); local = [];
    expect(await resolveComparisonSide(historical)).toMatchObject({ status: "missing_photo" });
    mocks.cloud.mockRejectedValue(new Error("https://private.example?token=SECRET"));
    const result = await resolveComparisonSide(historical); expect(result.status).toBe("verification_unavailable"); expect(JSON.stringify(result)).not.toMatch(/SECRET|private.example/);
    local = [scan("scan", [photo("photo-1", "")])]; expect(await resolveComparisonSide(historical)).toMatchObject({ status: "missing_photo" });
  });
  it("rejects over-limit embedded and streamed originals before claiming verification", async () => {
    const tooLarge = `data:image/png;base64,${"AAAA".repeat(MAX_COMPARISON_IMAGE_BYTES / 3 + 1)}`;
    await expect(comparisonSideForLookup(scan("scan", [photo("photo-1", tooLarge)]), "photo-1")).rejects.toThrow("12 MiB");
    fetchSpy.mockResolvedValue(new Response(new Uint8Array(MAX_COMPARISON_IMAGE_BYTES + 1), { headers: { "Content-Type": "image/png" } }));
    mocks.cloud.mockResolvedValue({ ok: false, error: "Unavailable" });
    await expect(comparisonSideForLookup(scan("scan", [photo("photo-1", signed())]), "photo-1")).rejects.toThrow("could not be verified");
  });
  it("rejects impossible natural dimensions and decode failure", async () => {
    width = 32768; height = 32768; await expect(comparisonSideForLookup(scan(), "photo-1")).rejects.toThrow("could not be verified");
    width = 0; height = 1; await expect(comparisonSideForLookup(scan(), "photo-1")).rejects.toThrow("could not be verified");
    await expect(comparisonSideForLookup(scan("scan", [photo("photo-1", "data:image/png;base64,AAAA")]), "photo-1")).rejects.toThrow("could not be verified");
  });
  it("guards account changes and cancellation without returning an image", async () => {
    const historical = await comparisonSideForLookup(scan(), "photo-1"); const scope = getAccountScope();
    decode = () => setActiveAccount("other"); expect(await resolveComparisonSide(historical, scope)).toMatchObject({ status: "verification_unavailable", message: expect.stringContaining("Account changed") });
    setActiveAccount("owner"); const controller = new AbortController(); controller.abort();
    expect(await resolveComparisonSide(historical, getAccountScope(), controller.signal)).toMatchObject({ status: "verification_unavailable", message: expect.stringContaining("canceled") });
  });
  it("bounds a hung cloud read and a hung decoder", async () => {
    const historical = await comparisonSideForLookup(scan(), "photo-1"); vi.useFakeTimers(); local = []; mocks.cloud.mockReturnValue(new Promise(() => undefined));
    const pending = resolveComparisonSide(historical); await vi.advanceTimersByTimeAsync(20_001); expect(await pending).toMatchObject({ status: "verification_unavailable", message: expect.stringContaining("timed out") });
    local = [scan()]; hungDecode = true;
    const decodePending = resolveComparisonSide(historical); await vi.advanceTimersByTimeAsync(20_001); expect(await decodePending).toMatchObject({ status: "verification_unavailable" });
  });
});
