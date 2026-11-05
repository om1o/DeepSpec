import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import type { Lookup, ScanPhoto } from "../types";
import type { ComponentMapRecord } from "../types/componentMap";
import type { ServiceRecord } from "../types/serviceRecord";
import { normalizeServiceRecords } from "../lib/serviceRecord";
import { normalizeInspectionComparisons } from "../lib/inspectionComparison";
import type { InspectionComparison, ComparisonSide } from "../types/inspectionComparison";
import { collectInspectionReport, INSPECTION_REPORT_MAX_IMAGE_BYTES, INSPECTION_REPORT_MAX_TOTAL_BYTES } from "./inspectionReport";
import { createHash, webcrypto } from "node:crypto";
import { normalizeDiagnosticBundle } from "../lib/diagnosticAssociation";
import { diagnosticSourceBytes, normalizeDiagnosticDocument } from "../lib/diagnosticReport";
import type { DiagnosticAssociation, DiagnosticBundle, DiagnosticDocument } from "../types/diagnosticReport";

const mocks = vi.hoisted(() => ({ lookups: vi.fn(), lookup: vi.fn(), map: vi.fn(), cloud: vi.fn(), auth: vi.fn(), service: vi.fn(), serviceCloud: vi.fn(), snapshot: vi.fn(), comparisons: vi.fn(), comparisonsCloud: vi.fn(), comparisonSide: vi.fn(), diagnostics: vi.fn(), diagnosticsCloud: vi.fn() }));
vi.mock("./storage", () => ({ readLookups: mocks.lookups, getLookup: mocks.lookup }));
vi.mock("./componentMapStore", () => ({ readComponentMap: mocks.map }));
vi.mock("./cloudHistory", () => ({ readCloudLookupForReport: mocks.cloud }));
vi.mock("./auth", () => ({ getAuthClient: mocks.auth }));
vi.mock("./serviceRecordStore", () => ({ readServiceRecords: mocks.service }));
vi.mock("./serviceRecordCloud", () => ({ readCloudServiceRecords: mocks.serviceCloud }));
vi.mock("./inspectionReportSnapshot", () => ({ readFinalInspectionSnapshot: mocks.snapshot }));
vi.mock("./inspectionComparisonStore", () => ({ readInspectionComparisons: mocks.comparisons }));
vi.mock("./inspectionComparisonCloud", () => ({ readCloudInspectionComparisons: mocks.comparisonsCloud }));
vi.mock("./diagnosticReportStore", () => ({ readDiagnosticBundle: mocks.diagnostics }));
vi.mock("./diagnosticReportCloud", () => ({ readCloudDiagnosticBundle: mocks.diagnosticsCloud }));
vi.mock("./comparisonEvidence", () => ({ comparisonSideForLookup: mocks.comparisonSide, comparisonPhotos: (lookup: Lookup) => lookup.photos?.length ? lookup.photos : [{ ...lookup.frame, id: "photo-1", label: "overview" }] }));
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const image = `data:image/png;base64,${PNG}`;
const bytes = Uint8Array.from(atob(PNG), (part) => part.charCodeAt(0));
const capturedAt = "2026-11-05T15:00:00.000Z";
const emptyDiagnostics = (): DiagnosticBundle => ({ documents: [], associations: [] });
function diagnosticDocument(lookupId = "root", source = "Synthetic unsupported scanner text\r\nNo health conclusion.", id = "40000000-0000-4000-8000-000000000001"): DiagnosticDocument {
  const data = Buffer.from(source, "utf8");
  return normalizeDiagnosticDocument({ version: 1, id, lookupId, importedAt: capturedAt, fileName: "synthetic.txt", mime: "text/plain", encoding: "utf-8", byteLength: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex"), sourceBase64: data.toString("base64") })!;
}
function diagnosticAssociation(document: DiagnosticDocument, photoId = "photo-1"): DiagnosticAssociation {
  return { version: 1, id: "50000000-0000-4000-8000-000000000001", lookupId: document.lookupId, documentId: document.id, sourceSha256: document.sha256,
    recordedAt: capturedAt, subject: "Harness beside bracket", entryIds: [], photos: [comparisonSide(document.lookupId, photoId)], vehicleRelationship: "unconfirmed", basis: "", notes: "Human association only; not a failed-part diagnosis." };
}
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
    vi.stubGlobal("crypto", webcrypto);
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    setActiveAccount("owner"); local = [scan("root")]; map = null; cloudMap = null;
    mocks.lookups.mockImplementation(() => ({ ok: true, value: structuredClone(local) }));
    mocks.lookup.mockImplementation((id: string, values: Lookup[]) => structuredClone(values.find((value) => value.id === id) ?? null));
    mocks.map.mockImplementation(async () => structuredClone(map));
    mocks.cloud.mockResolvedValue({ ok: true, value: null });
    mocks.service.mockResolvedValue([]); mocks.serviceCloud.mockResolvedValue([]);
    mocks.comparisons.mockResolvedValue([]); mocks.comparisonsCloud.mockResolvedValue([]);
    mocks.diagnostics.mockResolvedValue(emptyDiagnostics()); mocks.diagnosticsCloud.mockResolvedValue(emptyDiagnostics());
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
      diagnostics: new Map(await Promise.all(ids.map(async (id) => {
        try { return [id, normalizeDiagnosticBundle(await mocks.diagnostics(id, scope), id) ?? null] as const; }
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

  it("preserves v2 occurrence IDs and AI location provenance in the saved report snapshot", async () => {
    vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", "false");
    map = mapWithLinks(["root", "root"]); map.document.version = 2;
    map.document.components.forEach((component, index) => {
      component.label = "Hose"; component.scanGroups = [];
      component.suggestedLocation = { source: "ai_scene", text: index ? "lower right" : "upper left" };
    });
    const before = structuredClone(map);
    const report = await collectInspectionReport("root");
    expect(report.map).toEqual(before);
    expect(report.map).not.toBe(map);
    expect(JSON.parse(JSON.stringify(report)).map).toEqual(before);
    expect(report.map?.document.components.every((part) => !part.region && part.status === "needs_view" && part.notes === "human map note")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled(); expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("exports device evidence with no cloud lookup, image fetch or false cloud-history verification when disabled", async () => {
    vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", "false");
    mocks.service.mockResolvedValue([measurement()]);
    const before = structuredClone(local), report = await collectInspectionReport("root");
    expect(report.scans[0].frame.imageBase64).toBe(image);
    expect(report.serviceLogs?.[0]).toMatchObject({ records: [measurement()], cloudChecked: false });
    expect(report.comparisonLogs?.[0].cloudChecked).toBe(false);
    expect(report.diagnosticLogs?.[0].cloudChecked).toBe(false);
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.cloud).not.toHaveBeenCalled();
    expect(mocks.serviceCloud).not.toHaveBeenCalled(); expect(mocks.comparisonsCloud).not.toHaveBeenCalled(); expect(mocks.diagnosticsCloud).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled(); expect(local).toEqual(before);
  });

  it("does not fetch or refresh a previously signed photo during a disabled cloud report", async () => {
    vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", "false"); local[0].frame.imageBase64 = signed("root");
    const report = await collectInspectionReport("root");
    expect(report.scans[0].frame.imageBase64).toBe("");
    expect(report.missing.some((issue) => issue.kind === "photo")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled(); expect(mocks.cloud).not.toHaveBeenCalled(); expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("retains exact diagnostic bytes and human associations, deriving unsupported coverage from the original", async () => {
    const document = diagnosticDocument(), record = diagnosticAssociation(document);
    const bundle = { documents: [document], associations: [record] };
    mocks.diagnostics.mockResolvedValue(bundle); mocks.diagnosticsCloud.mockResolvedValue(bundle);
    const before = structuredClone(local); const report = await collectInspectionReport("root");
    expect(report.diagnosticLogs).toHaveLength(1);
    expect(report.diagnosticLogs?.[0]).toMatchObject({ lookupId: "root", bundle, cloudChecked: true,
      parsed: [{ id: document.id, report: { format: "unrecognized", coverage: "unrecognized", controllers: [] } }] });
    expect(diagnosticSourceBytes(report.diagnosticLogs![0].bundle.documents[0])).toEqual(diagnosticSourceBytes(document));
    expect(report.diagnosticLogs![0].bundle).not.toBe(bundle);
    expect(report.diagnosticEvidence).toEqual([{ lookupId: "root", recordId: record.id, photoId: "photo-1", status: "unchanged" }]);
    expect(mocks.diagnosticsCloud).toHaveBeenCalledWith("root", getAccountScope(), expect.any(AbortSignal));
    expect(local).toEqual(before); expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("collects diagnostic originals from missing map-linked scans once and preserves unavailable photo references", async () => {
    map = mapWithLinks(["missing", "missing"]);
    const document = diagnosticDocument("missing"), record = diagnosticAssociation(document, "historic-angle");
    const bundle = { documents: [document], associations: [record] };
    mocks.diagnostics.mockImplementation(async (id) => id === "missing" ? bundle : emptyDiagnostics());
    const report = await collectInspectionReport("root");
    expect(report.scans.map((entry) => entry.id)).toEqual(["root"]);
    expect(report.diagnosticLogs?.filter((entry) => entry.lookupId === "missing")).toHaveLength(1);
    expect(report.diagnosticLogs?.find((entry) => entry.lookupId === "missing")?.bundle).toEqual(bundle);
    expect(report.diagnosticEvidence).toEqual([{ lookupId: "missing", recordId: record.id, photoId: "historic-angle", status: "missing_photo" }]);
    expect(report.missing).toContainEqual(expect.objectContaining({ kind: "diagnostics", lookupId: "missing", photoId: "historic-angle" }));
    expect(mocks.snapshot).toHaveBeenCalledWith("root", ["root", "missing"], getAccountScope());
    expect(mocks.comparisonSide).not.toHaveBeenCalled();
  });

  it("collects diagnostic evidence for references discovered recursively through dated comparisons", async () => {
    const record = comparison(); local.push(scan("previous"));
    mocks.comparisons.mockImplementation(async (id) => id === "root" ? [record] : []);
    const document = diagnosticDocument("previous");
    mocks.diagnostics.mockImplementation(async (id) => id === "previous" ? { documents: [document], associations: [] } : emptyDiagnostics());
    const report = await collectInspectionReport("root");
    expect(report.diagnosticLogs?.map((log) => log.lookupId)).toEqual(["root", "previous"]);
    expect(report.diagnosticLogs?.[1].bundle.documents).toEqual([document]);
    expect(mocks.snapshot).toHaveBeenCalledWith("root", ["root", "previous"], getAccountScope());
  });

  it("distinguishes unreadable device diagnostic history from cloud success without leaking backend failures", async () => {
    mocks.diagnostics.mockRejectedValue(new Error("https://private.example/?token=device-secret"));
    const document = diagnosticDocument(); mocks.diagnosticsCloud.mockResolvedValue({ documents: [document], associations: [] });
    const report = await collectInspectionReport("root");
    expect(report.diagnosticLogs?.[0]).toMatchObject({ cloudChecked: true, bundle: { documents: [document], associations: [] } });
    expect(report.missing).toContainEqual(expect.objectContaining({ kind: "diagnostics", message: expect.stringContaining("Device diagnostic reports could not be read or verified") }));
    expect(JSON.stringify(report)).not.toMatch(/private\.example|device-secret/);
  });

  it("retains verified device originals when cloud diagnostic history cannot be verified or merged", async () => {
    const document = diagnosticDocument(); mocks.diagnostics.mockResolvedValue({ documents: [document], associations: [] });
    mocks.diagnosticsCloud.mockRejectedValue(new Error("https://private.example/?token=cloud-secret"));
    const report = await collectInspectionReport("root");
    expect(report.diagnosticLogs?.[0]).toMatchObject({ cloudChecked: false, bundle: { documents: [document], associations: [] } });
    expect(report.missing).toContainEqual(expect.objectContaining({ kind: "diagnostics", message: expect.stringContaining("Cloud diagnostic evidence could not be verified or combined") }));
    expect(JSON.stringify(report)).not.toMatch(/private\.example|cloud-secret/);
  });

  it("does not label an unreadable diagnostic bucket as a verified empty history", async () => {
    mocks.diagnostics.mockRejectedValue(new Error("Corrupt saved diagnostic bytes"));
    mocks.diagnosticsCloud.mockRejectedValue(new Error("Cloud unavailable"));
    const report = await collectInspectionReport("root");
    expect(report.diagnosticLogs?.[0]).toMatchObject({ cloudChecked: false, bundle: emptyDiagnostics(), parsed: [] });
    expect(report.missing.filter((issue) => issue.kind === "diagnostics")).toHaveLength(2);
    expect(report.missing.some((issue) => issue.message.includes("absence does not mean this vehicle has no codes"))).toBe(true);
  });

  it("independently rejects corrupt source bytes instead of exporting a successful derived parser result", async () => {
    const corrupt = { ...diagnosticDocument(), sha256: "0".repeat(64) };
    mocks.diagnostics.mockResolvedValue({ documents: [corrupt], associations: [] });
    await expect(collectInspectionReport("root")).rejects.toThrow(/fingerprint/);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it.each(["unchanged", "source_changed", "missing_photo", "verification_unavailable"] as const)("records %s for the exact diagnostic photo without substituting its neighboring angle", async (status) => {
    local[0] = scan("root", [photo("other"), photo("chosen")]);
    const document = diagnosticDocument(), record = diagnosticAssociation(document, "chosen");
    mocks.diagnostics.mockResolvedValue({ documents: [document], associations: [record] });
    if (status === "missing_photo") local[0].photos = [photo("other")];
    if (status === "source_changed") mocks.comparisonSide.mockImplementation(async (value: Lookup, id: string) => ({ ...comparisonSide(value.id, id), sha256: "b".repeat(64) }));
    if (status === "verification_unavailable") mocks.comparisonSide.mockRejectedValue(new Error("Private image decode failure"));
    const report = await collectInspectionReport("root");
    expect(report.diagnosticEvidence).toEqual([{ lookupId: "root", recordId: record.id, photoId: "chosen", status }]);
    expect(report.diagnosticLogs?.[0].bundle.associations).toEqual([record]);
    if (status === "missing_photo") expect(mocks.comparisonSide).not.toHaveBeenCalled();
    else {
      expect(mocks.comparisonSide).toHaveBeenCalledWith(expect.objectContaining({ id: "root", photos: [photo("other"), photo("chosen")] }), "chosen", getAccountScope());
      expect(mocks.comparisonSide.mock.calls.every((call) => call[1] === "chosen")).toBe(true);
    }
    expect(report.missing.some((issue) => issue.kind === "diagnostics" && issue.photoId === "chosen")).toBe(status !== "unchanged");
    expect(JSON.stringify(report)).not.toContain("Private image decode failure");
  });

  it.each(["added", "removed", "corrupt", "omitted"] as const)("rejects a final diagnostic bucket that was %s after the initial read", async (kind) => {
    const populated = { documents: [diagnosticDocument()], associations: [] };
    const initial = kind === "added" ? emptyDiagnostics() : populated; mocks.diagnostics.mockResolvedValue(initial);
    mocks.snapshot.mockImplementationOnce(async () => ({ map: null, serviceRecords: new Map([["root", []]]), comparisons: new Map([["root", []]]),
      diagnostics: kind === "omitted" ? new Map() : new Map([["root", kind === "corrupt" ? null : kind === "added" ? populated : emptyDiagnostics()]]) }));
    await expect(collectInspectionReport("root")).rejects.toThrow(/records changed/);
    expect(mocks.lookups).toHaveBeenCalledTimes(1);
  });

  it("rejects a diagnostic bucket that recovers during collection rather than freezing an obsolete missing-history warning", async () => {
    mocks.diagnostics.mockRejectedValueOnce(new Error("Device temporarily unreadable")).mockResolvedValue(emptyDiagnostics());
    await expect(collectInspectionReport("root")).rejects.toThrow(/records changed/);
  });

  it.each(["root", "linked"] as const)("counts %s diagnostic originals against the same aggregate budget as embedded images", async (location) => {
    // Three repeated 10 MiB image fields count as 30 MiB; valid source files add
    // >2 MiB after base64 encoding. Each individual image/document is allowed.
    const large = new Uint8Array(10 * 1024 * 1024); large.set([255, 216, 255]); large.set([255, 217], large.length - 2);
    const data = `data:image/jpeg;base64,${Buffer.from(large).toString("base64")}`;
    local[0] = scan("root", [{ ...photo("one"), imageBase64: data }, { ...photo("two"), imageBase64: data }]); local[0].frame.imageBase64 = data;
    const id = location === "root" ? "root" : "detail";
    if (location === "linked") { map = mapWithLinks([id]); local.push(scan(id, [photo("one"), photo("two")])); }
    const source = `${"x".repeat(4095)}\n`.repeat(256);
    const documents = [diagnosticDocument(id, source), diagnosticDocument(id, source, "40000000-0000-4000-8000-000000000002")];
    expect(documents.every((document) => document.byteLength === 1024 * 1024)).toBe(true);
    expect(large.byteLength * 3).toBeLessThan(INSPECTION_REPORT_MAX_TOTAL_BYTES);
    mocks.diagnostics.mockImplementation(async (lookupId) => lookupId === id ? { documents, associations: [] } : emptyDiagnostics());
    await expect(collectInspectionReport("root")).rejects.toThrow("evidence limit");
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });

  it("stops diagnostic collection immediately when its account changes", async () => {
    mocks.diagnostics.mockImplementation(async () => { setActiveAccount("other-owner"); return { documents: [diagnosticDocument()], associations: [] }; });
    await expect(collectInspectionReport("root")).rejects.toThrow(/Account changed/);
    expect(mocks.diagnosticsCloud).not.toHaveBeenCalled(); expect(mocks.snapshot).not.toHaveBeenCalled();
  });

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
      return { map: null, serviceRecords: new Map([["root", []]]), comparisons: new Map([["root", []]]), diagnostics: new Map([["root", emptyDiagnostics()]]) };
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
      return { map: finalMap, serviceRecords: logs, comparisons: new Map([["root", []], ["missing", []]]), diagnostics: new Map([["root", emptyDiagnostics()], ["missing", emptyDiagnostics()]]) };
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
