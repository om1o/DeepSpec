import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import type { Lookup, ScanPhoto } from "../types";
import type { ComponentMapRecord } from "../types/componentMap";
import type { ServiceRecord } from "../types/serviceRecord";
import { normalizeServiceRecords } from "../lib/serviceRecord";
import { normalizeInspectionComparisons } from "../lib/inspectionComparison";
import type { InspectionComparison, ComparisonSide } from "../types/inspectionComparison";
import { collectInspectionReport, INSPECTION_REPORT_MAX_IMAGE_BYTES, INSPECTION_REPORT_MAX_TOTAL_BYTES } from "./inspectionReport";

const mocks = vi.hoisted(() => ({ lookups: vi.fn(), lookup: vi.fn(), map: vi.fn(), cloud: vi.fn(), auth: vi.fn(), service: vi.fn(), serviceCloud: vi.fn(), snapshot: vi.fn(), comparisons: vi.fn(), comparisonsCloud: vi.fn(), comparisonSide: vi.fn() }));
vi.mock("./storage", () => ({ readLookups: mocks.lookups, getLookup: mocks.lookup }));
vi.mock("./componentMapStore", () => ({ readComponentMap: mocks.map }));
vi.mock("./cloudHistory", () => ({ readCloudLookupForReport: mocks.cloud }));
vi.mock("./auth", () => ({ getAuthClient: mocks.auth }));
vi.mock("./serviceRecordStore", () => ({ readServiceRecords: mocks.service }));
vi.mock("./serviceRecordCloud", () => ({ readCloudServiceRecords: mocks.serviceCloud }));
vi.mock("./inspectionReportSnapshot", () => ({ readFinalInspectionSnapshot: mocks.snapshot }));
vi.mock("./inspectionComparisonStore", () => ({ readInspectionComparisons: mocks.comparisons }));
vi.mock("./inspectionComparisonCloud", () => ({ readCloudInspectionComparisons: mocks.comparisonsCloud }));
vi.mock("./comparisonEvidence", () => ({ comparisonSideForLookup: mocks.comparisonSide, comparisonPhotos: (lookup: Lookup) => lookup.photos?.length ? lookup.photos : [{ ...lookup.frame, id: "photo-1", label: "overview" }] }));
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const image = `data:image/png;base64,${PNG}`;
const bytes = Uint8Array.from(atob(PNG), (part) => part.charCodeAt(0));
const capturedAt = "2026-11-05T15:00:00.000Z";
function comparisonSide(lookupId: string, photoId = "photo-1"): ComparisonSide {
  return { lookupId, photoId, photoLabel: "overview", photoAddedAt: capturedAt, scanSavedAt: capturedAt, sha256: "a".repeat(64), width: 1, height: 1, observedOn: null, vehicleContext: null };
}
function comparison(lookupId = "root", earlier = "previous"): InspectionComparison {
  return { version: 1, id: "30000000-0000-4000-8000-000000000001", lookupId, recordedAt: capturedAt, subject: "Bracket", earlier: comparisonSide(earlier), current: comparisonSide(lookupId),
    relationship: { sameVehicle: false, component: "unconfirmed", basis: "" }, conditions: { angle: "unknown", lighting: "unknown", surfaceNotes: "" },
    observation: { outcome: "not_reviewed", notes: "" }, alignment: { rotation: 0, scale: 1, offsetX: 0, offsetY: 0 } };
}
function measurement(): ServiceRecord {
  return { version: 1, id: "20000000-0000-4000-8000-000000000001", lookupId: "root", recordedAt: capturedAt, occurredOn: "2026-11-04",
    recordedBy: "PRIVATE_RECORDER", basis: "personally_performed", subject: "Lower bracket edge", photoIds: ["photo-1"], notes: "Measure again with the specified method",
    kind: "measurement", quantity: "Thickness", reading: "2.00", unit: "mm", method: "Caliper", instrument: "Unknown calibration", conditions: "Dry", noReadingReason: "" };
}
const box = { x: .1, y: .2, width: .3, height: .4, confidence: .8 };
const signed = (id: string, file = "original.png", token = "old") => `https://project.supabase.co/storage/v1/object/sign/scan-images/owner/${id}/${file}?token=${token}`;
function scan(id: string, photos?: ScanPhoto[]): Lookup {
  return { id, createdAt: capturedAt, frame: { imageBase64: image, capturedAt }, ...(photos ? { photos } : {}),
    provenance: { captureMode: "upload", analysisSource: "ai_detection", savedAt: capturedAt },
    rating: null, correction: null, notes: "saved human notes", chatHistory: [], scanCategory: "engine", trainingLabel: "engine", trainingStatus: "raw_unreviewed" };
}
function photo(id: string): ScanPhoto { return { id, label: "overview", imageBase64: image, capturedAt }; }
function mapWithLinks(ids = ["detail", "detail"]): ComponentMapRecord {
  return { document: { version: 1, id: "root", overview: { lookupId: "root", photoId: "photo-1" }, components: ids.map((lookupId, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, label: `Component ${index + 1}`, status: "needs_view", notes: "human map note",
    scanGroups: [{ linkId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, lookupId, photoIds: ["one", "two"] }],
  })) }, localRevision: 1, cloudRevision: null, syncedLocalRevision: 0 };
}
const rasterResponse = () => new Response(bytes.slice(), { status: 200, headers: { "Content-Type": "image/png" } });

describe("saved inspection report collection", () => {
  let local: Lookup[];
  let map: ComponentMapRecord | null;
  let cloudMap: unknown;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let query: { select: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; abortSignal: ReturnType<typeof vi.fn>; maybeSingle: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    setActiveAccount("owner"); local = [scan("root")]; map = null; cloudMap = null;
    mocks.lookups.mockImplementation(() => ({ ok: true, value: structuredClone(local) }));
    mocks.lookup.mockImplementation((id: string, values: Lookup[]) => structuredClone(values.find((value) => value.id === id) ?? null));
    mocks.map.mockImplementation(async () => structuredClone(map));
    mocks.cloud.mockResolvedValue({ ok: true, value: null });
    mocks.service.mockResolvedValue([]); mocks.serviceCloud.mockResolvedValue([]);
    mocks.comparisons.mockResolvedValue([]); mocks.comparisonsCloud.mockResolvedValue([]);
    mocks.comparisonSide.mockImplementation(async (lookup: Lookup, photoId: string) => comparisonSide(lookup.id, photoId));
    // Collector fixture only. The real single-transaction implementation has its
    // own request/transaction tests and is exercised by native report export.
    mocks.snapshot.mockImplementation(async (root: string, ids: string[], scope: ReturnType<typeof getAccountScope>) => ({
      map: await mocks.map(root, scope),
      serviceRecords: new Map(await Promise.all(ids.map(async (id) => {
        try { return [id, normalizeServiceRecords(await mocks.service(id, scope), id) ?? null] as const; }
        catch { return [id, null] as const; }
      }))),
      comparisons: new Map(await Promise.all(ids.map(async (id) => {
        try { return [id, normalizeInspectionComparisons(await mocks.comparisons(id, scope), id) ?? null] as const; }
        catch { return [id, null] as const; }
      }))),
    }));
    query = { select: vi.fn(), eq: vi.fn(), abortSignal: vi.fn(), maybeSingle: vi.fn(async () => ({ data: cloudMap, error: null })) };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.abortSignal.mockReturnValue(query);
    mocks.auth.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } }, error: null }) }, from: vi.fn(() => query) });
    fetchSpy = vi.fn(async () => rasterResponse()); vi.stubGlobal("fetch", fetchSpy);
    // jsdom has no raster decoder. Native UI verification uses the real browser decoder.
    vi.stubGlobal("Image", class {
      naturalWidth = 1; naturalHeight = 1; onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("follows comparison photo references and verifies the embedded frozen originals", async () => {
    local.push(scan("previous", [photo("other"), photo("chosen")]));
    const record = comparison(); record.earlier.photoId = "chosen";
    mocks.comparisons.mockImplementation(async (id) => id === "root" ? [record] : []);
    const report = await collectInspectionReport("root");
    expect(report.scans.map((entry) => entry.id)).toEqual(["root", "previous"]);
    expect(report.comparisonEvidence).toEqual(["earlier", "current"].map((side) => ({ lookupId: "root", recordId: record.id, side, status: "unchanged" })));
    expect(mocks.comparisonSide.mock.calls.find((call) => call[0].id === "previous")?.[1]).toBe("chosen");
    expect(report.comparisonLogs?.[0].records).toEqual([record]);
  });

  it("keeps comparison history when its reference scan is missing without substituting another photo", async () => {
    const record = comparison(); mocks.comparisons.mockImplementation(async (id) => id === "root" ? [record] : []);
    const report = await collectInspectionReport("root");
    expect(report.comparisonLogs?.[0].records).toEqual([record]);
    expect(report.comparisonEvidence?.find((item) => item.side === "earlier")?.status).toBe("missing_photo");
    expect(mocks.comparisonSide).toHaveBeenCalledTimes(1);
  });

  it("marks a changed comparison source instead of passing it off as the saved original", async () => {
    local.push(scan("previous")); const record = comparison();
    mocks.comparisons.mockImplementation(async (id) => id === "root" ? [record] : []);
    mocks.comparisonSide.mockImplementation(async (lookup: Lookup, photoId: string) => ({ ...comparisonSide(lookup.id, photoId), ...(lookup.id === "previous" ? { sha256: "b".repeat(64) } : {}) }));
    const report = await collectInspectionReport("root");
    expect(report.comparisonEvidence?.find((item) => item.side === "earlier")?.status).toBe("source_changed");
    expect(report.missing.some((issue) => issue.kind === "comparisons" && issue.message.includes("differs"))).toBe(true);
  });

  it("rejects a comparison history change during report preparation", async () => {
    const record = comparison();
    mocks.comparisons.mockResolvedValueOnce([]).mockResolvedValue([record]);
    await expect(collectInspectionReport("root")).rejects.toThrow("changed while preparing");
  });

  it("includes immutable device and cloud human history without importing or changing a scan", async () => {
    const first = measurement();
    const correction = { ...first, id: "20000000-0000-4000-8000-000000000002", recordedAt: "2026-11-05T16:00:00.000Z", supersedesId: first.id, correctionReason: "Reading transcribed incorrectly", reading: "2.10" };
    mocks.service.mockResolvedValue([first]); mocks.serviceCloud.mockResolvedValue([first, correction]);
    const before = structuredClone(local);
    const report = await collectInspectionReport("root");
    expect(report.serviceLogs).toEqual([{ lookupId: "root", records: [first, correction], cloudChecked: true }]);
    expect(mocks.service).toHaveBeenCalledTimes(2);
    expect(mocks.serviceCloud).toHaveBeenCalledWith("root", getAccountScope(), expect.any(AbortSignal));
    expect(local).toEqual(before); expect(report.serviceLogs![0].records[0]).not.toBe(first);
  });

  it("keeps available human records and declares failed cloud reads without exposing backend text", async () => {
    mocks.service.mockResolvedValue([measurement()]); mocks.serviceCloud.mockRejectedValue(new Error("https://private.example/token?secret=hidden"));
    const report = await collectInspectionReport("root");
    expect(report.serviceLogs?.[0]).toMatchObject({ cloudChecked: false, records: [measurement()] });
    expect(report.missing).toContainEqual(expect.objectContaining({ kind: "service_records", message: expect.stringContaining("Cloud human-service history") }));
    expect(JSON.stringify(report)).not.toContain("private.example");
  });

  it("does not silently normalize an unreadable device log to an empty history", async () => {
    mocks.service.mockResolvedValue([{ ...measurement(), version: 9 }]);
    const report = await collectInspectionReport("root");
    expect(report.missing).toContainEqual(expect.objectContaining({ kind: "service_records", message: expect.stringContaining("could not be read") }));
  });

  it("retains human evidence references when a photo has disappeared", async () => {
    const record = { ...measurement(), photoIds: ["removed-original"] };
    mocks.service.mockResolvedValue([record]);
    const report = await collectInspectionReport("root");
    expect(report.serviceLogs?.[0].records[0].photoIds).toEqual(["removed-original"]);
    expect(report.missing).toContainEqual(expect.objectContaining({ kind: "photo", photoId: "removed-original", message: expect.stringContaining("human-service entry") }));
  });

  it("rejects a snapshot if the human history changes during collection", async () => {
    mocks.service.mockResolvedValueOnce([]).mockResolvedValue([measurement()]);
    await expect(collectInspectionReport("root")).rejects.toThrow(/records changed/);
  });

  it("collects retained device and cloud history even when a map-linked scan is unavailable", async () => {
    map = mapWithLinks(["missing", "missing"]);
    const first = { ...measurement(), lookupId: "missing", photoIds: ["historic-angle"] };
    const corrected = { ...first, id: "20000000-0000-4000-8000-000000000002", supersedesId: first.id, correctionReason: "Transcription correction", reading: "2.10" };
    mocks.service.mockImplementation(async (id) => id === "missing" ? [first] : []);
    mocks.serviceCloud.mockImplementation(async (id) => id === "missing" ? [first, corrected] : []);
    const report = await collectInspectionReport("root");
    expect(report.scans.map((entry) => entry.id)).toEqual(["root"]);
    expect(report.serviceLogs).toContainEqual({ lookupId: "missing", records: [first, corrected], cloudChecked: true });
    expect(report.serviceLogs?.filter((log) => log.lookupId === "missing")).toHaveLength(1);
    expect(report.missing).toContainEqual(expect.objectContaining({ kind: "photo", lookupId: "missing", photoId: "historic-angle" }));
    expect(mocks.snapshot).toHaveBeenCalledWith("root", ["root", "missing"], getAccountScope());
    expect(mocks.serviceCloud).toHaveBeenCalledWith("missing", getAccountScope(), expect.any(AbortSignal));
  });

  it("checks lookup changes after the final IDB snapshot settles rather than before awaiting it", async () => {
    mocks.snapshot.mockImplementationOnce(async () => {
      await Promise.resolve();
      local[0].notes = "Edited while the final IDB snapshot was pending";
      return { map: null, serviceRecords: new Map([["root", []]]), comparisons: new Map([["root", []]]) };
    });
    await expect(collectInspectionReport("root")).rejects.toThrow(/records changed/);
    expect(mocks.lookups).toHaveBeenCalledTimes(2);
  });

  it.each(["map", "first-history", "missing-scan-history"])("rejects a %s mutation in the final joint snapshot", async (kind) => {
    map = mapWithLinks(["missing"]);
    mocks.snapshot.mockImplementationOnce(async () => {
      const finalMap = structuredClone(map!);
      const logs = new Map<string, ServiceRecord[] | null>([["root", []], ["missing", []]]);
      if (kind === "map") finalMap.localRevision += 1;
      else { const id = kind === "first-history" ? "root" : "missing"; logs.set(id, [{ ...measurement(), lookupId: id }]); }
      return { map: finalMap, serviceRecords: logs, comparisons: new Map([["root", []], ["missing", []]]) };
    });
    await expect(collectInspectionReport("root")).rejects.toThrow(/records changed/);
  });

  it("preserves cloud history with an explicit missing-device warning when device data remains unreadable", async () => {
    mocks.service.mockResolvedValue(null);
    mocks.serviceCloud.mockResolvedValue([measurement()]);
    const report = await collectInspectionReport("root");
    expect(report.serviceLogs?.[0]).toEqual({ lookupId: "root", records: [measurement()], cloudChecked: true });
    expect(report.missing).toContainEqual(expect.objectContaining({ kind: "service_records", message: expect.stringContaining("on this device could not be read") }));
  });

  it("rejects a late human history read after switching accounts", async () => {
    mocks.service.mockImplementation(async () => { setActiveAccount("other-owner"); return [measurement()]; });
    await expect(collectInspectionReport("root")).rejects.toThrow(/Account changed/);
    expect(mocks.serviceCloud).not.toHaveBeenCalled();
  });

  it("collects every saved photo group and preserves repeated component associations without duplicating scans", async () => {
    local.push(scan("detail", [photo("one"), photo("two")])); map = mapWithLinks();
    const report = await collectInspectionReport("root");
    expect(report.scans.map((value) => value.id)).toEqual(["root", "detail"]);
    expect(report.scans[1].photos?.map((value) => value.id)).toEqual(["one", "two"]);
    expect(report.map?.document.components).toHaveLength(2);
    expect(report.missing).toEqual([]);
    expect(report.embeddedBytes).toBe(bytes.byteLength * 4);
    expect(fetchSpy).not.toHaveBeenCalled(); expect(mocks.cloud).not.toHaveBeenCalled(); expect(mocks.auth).not.toHaveBeenCalled();
    expect(report.scans[0]).not.toBe(local[0]);
  });

  it("reports missing scan and photo references instead of substituting another scan or dropping associations", async () => {
    map = mapWithLinks(["missing", "detail"]); local.push(scan("detail", [photo("one")]));
    const report = await collectInspectionReport("root");
    expect(report.map?.document.components).toHaveLength(2);
    expect(report.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "lookup", lookupId: "missing" }),
      expect.objectContaining({ kind: "photo", lookupId: "missing", photoId: "one" }),
      expect.objectContaining({ kind: "photo", lookupId: "detail", photoId: "two" }),
    ]));
  });

  it("reads cloud-only map/scans through owner-filtered APIs without importing or syncing them", async () => {
    const remoteMap = mapWithLinks(["detail"]);
    cloudMap = { map_id: "root", document_json: remoteMap.document, revision: 3 };
    mocks.cloud.mockResolvedValue({ ok: true, value: scan("detail", [photo("one"), photo("two")]) });
    const report = await collectInspectionReport("root");
    expect(report.map).toMatchObject({ cloudRevision: 3, localRevision: 1, syncedLocalRevision: 1 });
    expect(report.scans).toHaveLength(2);
    expect(query.eq).toHaveBeenCalledWith("user_id", "owner");
    expect(map).toBeNull(); expect(local).toHaveLength(1);
  });

  it("loads the saved root from cloud when absent locally", async () => {
    local = []; mocks.cloud.mockResolvedValue({ ok: true, value: scan("root") });
    expect((await collectInspectionReport("root")).scans[0].id).toBe("root");
    expect(local).toEqual([]);
  });

  it.each(["root", "linked"])("keeps cloud-only %s metadata and associations when one image is unavailable", async (kind) => {
    const id = kind === "root" ? "root" : "detail";
    if (kind === "root") local = [];
    else map = mapWithLinks([id]);
    const remote = scan(id, [photo("one"), { ...photo("two"), imageBase64: "" }]);
    remote.correction = "Human corrected identity";
    remote.result = { partName: "Bracket", confidence: "low", scanCategory: "engine", candidateMatches: [], whatItDoes: "Supports the assembly",
      visibleObservations: ["A marked edge is visible"], evidenceRegions: [], concerns: [], safetyTriage: "can_help", isSafetyCritical: false,
      nextAction: "Inspect the reverse", needsBetterPhoto: false, evidence: [], sourceLinks: [],
      conditionAssessment: { version: 1, observations: [{ id: "edge", text: "A marked edge is visible", photoIds: ["two"] }], possibleCauses: [], unknowns: ["Hidden condition"] } };
    remote.focusBox = box; remote.isolatedImageBase64 = "";
    remote.isolatedObjects = [{ name: "Missing mask", category: "engine", primary: true, focusBox: box, isolatedImageBase64: "" },
      { name: "Cleared crop", category: "engine", primary: false, focusBox: box, focusMode: "crop", correctedAt: capturedAt, isolatedImageBase64: "" }];
    mocks.cloud.mockResolvedValue({ ok: true, value: remote, unavailableImages: [{ kind: "photo", photoId: "two" }, { kind: "cutout" }, { kind: "cutout", selectionName: "Missing mask" }] });
    const report = await collectInspectionReport("root");
    const saved = report.scans.find((value) => value.id === id)!;
    expect(saved.correction).toBe(remote.correction); expect(saved.photos?.map((value) => value.id)).toEqual(["one", "two"]);
    expect(saved.result?.conditionAssessment).toEqual(remote.result.conditionAssessment);
    expect(saved.photos?.[0].imageBase64).toBe(image); expect(saved.photos?.[1].imageBase64).toBe("");
    expect(report.missing).toContainEqual(expect.objectContaining({ kind: "photo", lookupId: id, photoId: "two" }));
    expect(report.missing.filter((issue) => issue.kind === "cutout")).toHaveLength(2);
    expect(report.missing.some((issue) => issue.selectionName === "Cleared crop")).toBe(false);
    if (kind === "linked") expect(report.map?.document.components[0].scanGroups[0].photoIds).toEqual(["one", "two"]);
  });

  it.each([
    "https://foreign.example/pixel.png", signed("other-scan"), signed("root").replace("/owner/", "/someone-else/"),
    signed("root").replace("https:", "http:"), signed("root").replace("/object/sign/", "/object/public/"),
    signed("root").replace("original.png", "%252e%252e/secret"), "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:image/png;base64,aGVsbG8=",
  ])("rejects an untrusted or malformed image without fetching it: %s", async (source) => {
    local[0].frame.imageBase64 = source;
    const report = await collectInspectionReport("root");
    expect(report.scans[0].frame.imageBase64).toBe("");
    expect(report.missing).toContainEqual(expect.objectContaining({ kind: "photo", lookupId: "root" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(report.missing)).not.toContain("https:");
  });

  it("refreshes expired originals and cutouts while preserving local edits and cleared corrections", async () => {
    local[0].frame.imageBase64 = signed("root"); local[0].focusBox = box; local[0].focusMode = "mask";
    local[0].isolatedImageBase64 = signed("root", "mask.png");
    local[0].isolatedObjects = [
      { name: "Saved mask", category: "engine", primary: true, focusBox: box, focusMode: "mask", isolatedImageBase64: signed("root", "object.png") },
      { name: "Corrected crop", category: "engine", primary: false, focusBox: { ...box, x: .3 }, focusMode: "crop", correctedAt: capturedAt, isolatedImageBase64: "" },
    ];
    const remote = structuredClone(local[0]); remote.notes = "older cloud notes"; remote.frame.imageBase64 = signed("root", "original.png", "fresh");
    remote.isolatedImageBase64 = signed("root", "mask.png", "fresh"); remote.isolatedObjects![0].isolatedImageBase64 = signed("root", "object.png", "fresh");
    remote.isolatedObjects![1].isolatedImageBase64 = signed("root", "old-crop.png", "fresh");
    remote.isolatedObjects!.reverse(); mocks.cloud.mockResolvedValue({ ok: true, value: remote });
    const report = await collectInspectionReport("root");
    expect(report.missing).toEqual([]); expect(report.scans[0].notes).toBe("saved human notes");
    expect(report.scans[0].isolatedImageBase64).toBe(image);
    expect(report.scans[0].isolatedObjects![0].isolatedImageBase64).toBe(image);
    expect(report.scans[0].isolatedObjects![1]).toEqual(local[0].isolatedObjects[1]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    for (const [url, options] of fetchSpy.mock.calls) {
      expect(url).toContain("token=fresh"); expect(options).toMatchObject({ credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" });
    }
  });

  it("refreshes the same originals when cloud timestamps use equivalent UTC offsets", async () => {
    local[0] = scan("root", [{ ...photo("one"), imageBase64: signed("root", "group.png") }]);
    local[0].frame.imageBase64 = signed("root");
    const remote = structuredClone(local[0]);
    remote.frame = { imageBase64: signed("root", "original.png", "fresh"), capturedAt: "2026-11-05T15:00:00+00:00" };
    remote.photos![0] = { ...remote.photos![0], imageBase64: signed("root", "group.png", "fresh"), capturedAt: "2026-11-05T10:00:00-05:00" };
    mocks.cloud.mockResolvedValue({ ok: true, value: remote });
    const report = await collectInspectionReport("root");
    expect(report.missing).toEqual([]);
    expect(report.scans[0].frame.imageBase64).toBe(image);
    expect(report.scans[0].photos![0].imageBase64).toBe(image);
    expect(report.scans[0].photos![0].capturedAt).toBe(capturedAt);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const [url] of fetchSpy.mock.calls) expect(url).toContain("token=fresh");
  });

  it.each(["path", "capturedAt", "invalidTime", "photoId", "geometry"] as const)("does not refresh mismatched %s metadata into reviewed evidence", async (kind) => {
    const photos = [{ ...photo("one"), imageBase64: signed("root", "group.png") }]; local[0] = scan("root", photos);
    local[0].focusBox = box; local[0].isolatedImageBase64 = signed("root", "mask.png");
    const remote = structuredClone(local[0]); remote.photos![0].imageBase64 = signed("root", "group.png", "fresh"); remote.isolatedImageBase64 = signed("root", "mask.png", "fresh");
    if (kind === "path") remote.photos![0].imageBase64 = signed("root", "different.png", "fresh");
    if (kind === "capturedAt") remote.photos![0].capturedAt = "2026-11-06T00:00:00.000Z";
    if (kind === "invalidTime") local[0].photos![0].capturedAt = remote.photos![0].capturedAt = "2026-02-30T15:00:00+00:00";
    if (kind === "photoId") remote.photos![0].id = "different";
    if (kind === "geometry") remote.focusBox = { ...box, x: .2 };
    mocks.cloud.mockResolvedValue({ ok: true, value: remote });
    const report = await collectInspectionReport("root");
    expect(report.missing.some((issue) => issue.kind === (kind === "geometry" ? "cutout" : "photo"))).toBe(true);
    expect(report.scans[0].focusBox).toEqual(box);
    expect(report.scans[0].photos![0].id).toBe("one");
  });

  it("redacts backend failures and records unavailable assets with empty image fields", async () => {
    local[0].frame.imageBase64 = signed("root");
    mocks.cloud.mockResolvedValue({ ok: false, message: "https://private.example/?token=secret-backend" });
    query.maybeSingle.mockResolvedValue({ error: { message: "secret-backend" }, data: null });
    const report = await collectInspectionReport("root");
    expect(report.scans[0].frame.imageBase64).toBe(""); expect(report.missing).toHaveLength(2);
    expect(JSON.stringify(report.missing)).not.toMatch(/https:|secret-backend|token=/);
  });

  it("reports a raster decoder failure even when a payload has an allowed MIME and signature", async () => {
    vi.stubGlobal("Image", class {
      onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(value: string) { if (value) queueMicrotask(() => this.onerror?.()); }
    });
    const report = await collectInspectionReport("root");
    expect(report.scans[0].frame.imageBase64).toBe("");
    expect(report.missing).toContainEqual(expect.objectContaining({ kind: "photo", lookupId: "root" }));
    expect(report.embeddedBytes).toBe(0);
  });

  it("hard-fails excessive declared or streamed image sizes", async () => {
    local[0].frame.imageBase64 = signed("root");
    const remote = structuredClone(local[0]); remote.frame.imageBase64 = signed("root", "original.png", "fresh"); mocks.cloud.mockResolvedValue({ ok: true, value: remote });
    fetchSpy.mockResolvedValueOnce(new Response(bytes.slice(), { headers: { "Content-Type": "image/png", "Content-Length": String(INSPECTION_REPORT_MAX_IMAGE_BYTES + 1) } }));
    await expect(collectInspectionReport("root")).rejects.toThrow("evidence limit");
    fetchSpy.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(INSPECTION_REPORT_MAX_IMAGE_BYTES + 1)); controller.close(); } }), { headers: { "Content-Type": "image/png" } }));
    await expect(collectInspectionReport("root")).rejects.toThrow("evidence limit");
  });

  it("hard-fails an oversized inline image and an aggregate snapshot rather than returning partial evidence", async () => {
    local[0].frame.imageBase64 = `data:image/jpeg;base64,${"A".repeat(Math.ceil((INSPECTION_REPORT_MAX_IMAGE_BYTES + 1) / 3) * 4)}`;
    await expect(collectInspectionReport("root")).rejects.toThrow("evidence limit");
    const large = new Uint8Array(11 * 1024 * 1024); large.set([255,216,255]); large.set([255,217], large.length - 2);
    const data = `data:image/jpeg;base64,${Buffer.from(large).toString("base64")}`;
    local[0] = scan("root", [{ ...photo("one"), imageBase64: data }, { ...photo("two"), imageBase64: data }]); local[0].frame.imageBase64 = data;
    expect(large.byteLength * 3).toBeGreaterThan(INSPECTION_REPORT_MAX_TOTAL_BYTES);
    await expect(collectInspectionReport("root")).rejects.toThrow("evidence limit");
  });

  it("hard-fails more than 250 referenced scans before fetching linked evidence", async () => {
    map = mapWithLinks(Array.from({ length: 250 }, (_, index) => `scan-${index}`));
    await expect(collectInspectionReport("root")).rejects.toThrow("evidence limit");
    expect(mocks.cloud).not.toHaveBeenCalled();
  });

  it.each(["lookup", "map", "new-local"])("rejects %s changes during asynchronous collection", async (kind) => {
    local[0].frame.imageBase64 = signed("root"); const remote = structuredClone(local[0]); remote.frame.imageBase64 = signed("root", "original.png", "fresh");
    if (kind === "new-local") local = [];
    mocks.cloud.mockImplementation(async () => {
      if (kind === "lookup") local[0].notes = "newer notes";
      if (kind === "map") map = mapWithLinks([]);
      if (kind === "new-local") local = [scan("root")];
      return { ok: true, value: remote };
    });
    await expect(collectInspectionReport("root")).rejects.toThrow("changed while preparing");
  });

  it("rejects account changes and cancellation without returning another account's report", async () => {
    local[0].frame.imageBase64 = signed("root"); const scope = getAccountScope();
    mocks.cloud.mockImplementation(async () => { setActiveAccount("other"); return { ok: true, value: scan("root") }; });
    await expect(collectInspectionReport("root", {}, scope)).rejects.toThrow("Account changed"); expect(fetchSpy).not.toHaveBeenCalled();
    setActiveAccount("owner"); const controller = new AbortController();
    mocks.cloud.mockImplementation(async () => { controller.abort(); return { ok: true, value: scan("root") }; });
    await expect(collectInspectionReport("root", { signal: controller.signal })).rejects.toThrow("canceled"); expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("bounds a hanging read and ignores its eventual response", async () => {
    vi.useFakeTimers(); local[0].frame.imageBase64 = signed("root");
    let complete!: (value: unknown) => void; mocks.cloud.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const pending = collectInspectionReport("root"); await vi.advanceTimersByTimeAsync(20_001);
    const report = await pending; expect(report.missing).toContainEqual(expect.objectContaining({ kind: "photo" }));
    complete({ ok: true, value: scan("root") }); await vi.advanceTimersByTimeAsync(1);
    expect(fetchSpy).not.toHaveBeenCalled(); expect(report.scans[0].frame.imageBase64).toBe("");
  });

  it("cancels a stalled image stream at its deadline and does not include its partial bytes", async () => {
    vi.useFakeTimers(); local[0].frame.imageBase64 = signed("root");
    const remote = structuredClone(local[0]); remote.frame.imageBase64 = signed("root", "original.png", "fresh");
    mocks.cloud.mockResolvedValue({ ok: true, value: remote });
    const cancel = vi.fn();
    fetchSpy.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes); }, cancel }), { headers: { "Content-Type": "image/png" } }));
    const pending = collectInspectionReport("root"); await vi.advanceTimersByTimeAsync(20_001);
    const report = await pending;
    expect(cancel).toHaveBeenCalled(); expect(report.scans[0].frame.imageBase64).toBe(""); expect(report.embeddedBytes).toBe(0);
    expect(report.missing).toContainEqual(expect.objectContaining({ kind: "photo" }));
  });

  it("bounds a stalled browser decoder and reports the unavailable image", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Image", class { src = ""; onload = null; onerror = null; });
    const pending = collectInspectionReport("root"); await vi.advanceTimersByTimeAsync(20_001);
    const report = await pending;
    expect(report.embeddedBytes).toBe(0); expect(report.scans[0].frame.imageBase64).toBe("");
    expect(report.missing).toContainEqual(expect.objectContaining({ kind: "photo" }));
  });

  it("keeps a conflicted device map explicit without combining the alternative cloud links", async () => {
    map = mapWithLinks([]); map.conflict = { document: mapWithLinks(["cloud-alternative"]).document, revision: 2 };
    const report = await collectInspectionReport("root");
    expect(report.map?.document.components).toEqual([]); expect(report.map?.conflict).toBeDefined();
    expect(report.missing).toContainEqual(expect.objectContaining({ kind: "map", message: expect.stringContaining("unresolved cloud conflict") }));
    expect(mocks.cloud).not.toHaveBeenCalled();
  });
});
