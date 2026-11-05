import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, isAccountScopeCurrent, setActiveAccount } from "../lib/accountScope";
import { MAX_DIAGNOSTIC_BUNDLE_BYTES, diagnosticAssociationStatus, mergeDiagnosticBundles } from "../lib/diagnosticAssociation";
import type { DiagnosticAssociation, DiagnosticBundle, DiagnosticDocument } from "../types/diagnosticReport";

const mocks = vi.hoisted(() => ({ client: vi.fn(), import: vi.fn() }));
vi.mock("./auth", () => ({ getAuthClient: mocks.client }));
// Exercise the real normalizer, source hash, parser and entry-membership checks.
// Only persistence is substituted; its IDB concurrency tests live separately.
vi.mock("./diagnosticReportStore", async (original) => ({ ...await original<typeof import("./diagnosticReportStore")>(), importDiagnosticBundle: mocks.import }));
import { verifyDiagnosticBundle } from "./diagnosticReportStore";
import { readCloudDiagnosticBundle, syncDiagnosticReports } from "./diagnosticReportCloud";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const date = "2026-11-05T10:00:00.000Z";
// Synthetic structure, never copied vendor evidence.
const source = ["Thursday,05,November,2026,10:00:00:00001", "VCDS -- Synthetic report", "VCDS Version: 22.4.0.1", "Chassis Type: TEST", "Scan: 01",
  "Address 01: Synthetic module", "1 Fault Found:", "12345 - Synthetic reported condition", "          U1234 00 [032] - Synthetic detail", "             Freeze Frame:", "                    RPM: 0 /min", "End---------------", ""].join("\n");
function document(n = 1, text = source): DiagnosticDocument {
  return { version: 1, id: id(n), lookupId: "scan", importedAt: date, fileName: "synthetic.txt", mime: "text/plain", byteLength: Buffer.byteLength(text),
    sha256: createHash("sha256").update(text).digest("hex"), encoding: "utf-8", sourceBase64: Buffer.from(text).toString("base64") };
}
function association(n = 10): DiagnosticAssociation {
  return { version: 1, id: id(n), lookupId: "scan", documentId: id(1), sourceSha256: document().sha256, recordedAt: date, subject: "Photographed connector", entryIds: ["controller-6", "fault-8", "frame-10", "reading-11"],
    photos: [{ lookupId: "scan", photoId: "photo-1", photoLabel: "overview", photoAddedAt: date, scanSavedAt: date, sha256: "b".repeat(64), width: 40, height: 30, observedOn: null, vehicleContext: null }],
    vehicleRelationship: "unconfirmed", basis: "", notes: "User association, not a confirmed cause" };
}
type Row = { user_id: string; id: string; lookup_id: string; kind: "document" | "association"; record_json: DiagnosticDocument | DiagnosticAssociation };
type Response = { data: unknown; error: { code: string; message?: string } | null };
type QueryInfo = { table: string; filters: Map<string, unknown>; after?: string; limit: number; signal?: AbortSignal; payload?: Row };
const row = (record: DiagnosticDocument | DiagnosticAssociation): Row => ({ user_id: "owner", id: record.id, lookup_id: record.lookupId, kind: "sourceBase64" in record ? "document" : "association", record_json: record });
const empty = (): DiagnosticBundle => ({ documents: [], associations: [] });

describe("verified immutable diagnostic cloud sync", () => {
  let local: DiagnosticBundle, remote: Row[], requests: QueryInfo[];
  let parentExists: boolean, pages: number;
  let user: { id: string; email_confirmed_at?: string; phone_confirmed_at?: string; is_anonymous?: boolean } | null;
  let getUser: ReturnType<typeof vi.fn>, insert: ReturnType<typeof vi.fn>;
  let readOverride: ((query: QueryInfo) => Response | Promise<Response>) | undefined;
  let parentOverride: (() => Response | Promise<Response>) | undefined;
  let duplicateOverride: (() => Response | Promise<Response>) | undefined;
  let insertOverride: ((value: Row) => Response | Promise<Response>) | undefined;

  beforeEach(() => {
    vi.resetAllMocks(); vi.stubGlobal("crypto", webcrypto); setActiveAccount("owner");
    local = { documents: [document()], associations: [] }; remote = []; requests = []; parentExists = true; pages = 0;
    readOverride = undefined; parentOverride = undefined; duplicateOverride = undefined; insertOverride = undefined;
    user = { id: "owner", email_confirmed_at: date };
    getUser = vi.fn(async () => ({ data: { user }, error: null }));
    insert = vi.fn(async (value: Row): Promise<Response> => {
      if (insertOverride) return insertOverride(value);
      if (remote.some((entry) => entry.user_id === value.user_id && entry.id === value.id)) return { data: null, error: { code: "23505" } };
      remote.push(structuredClone(value)); return { data: structuredClone(value), error: null };
    });
    const query = (table: string, payload?: Row) => {
      const info: QueryInfo = { table, filters: new Map(), limit: 1000, payload };
      const run = async (): Promise<Response> => {
        requests.push({ ...info, filters: new Map(info.filters) });
        if (payload) return insert(payload);
        if (table === "scan_lookups") return parentOverride ? parentOverride() : { data: parentExists ? { user_id: "owner", local_id: "scan" } : null, error: null };
        if (info.filters.has("id")) return duplicateOverride ? duplicateOverride() : { data: structuredClone(remote.find((entry) => entry.user_id === info.filters.get("user_id") && entry.id === info.filters.get("id")) ?? null), error: null };
        pages += 1;
        if (readOverride) return readOverride(info);
        return { data: structuredClone(remote.filter((entry) => entry.user_id === info.filters.get("user_id") && entry.lookup_id === info.filters.get("lookup_id") && (!info.after || entry.id > info.after))
          .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, info.limit)), error: null };
      };
      const chain = {
        select: () => chain,
        eq: (key: string, value: unknown) => { info.filters.set(key, value); return chain; },
        gt: (_key: string, value: string) => { info.after = value; return chain; },
        order: () => chain,
        limit: (limit: number) => { info.limit = limit; return chain; },
        abortSignal: (signal: AbortSignal) => { info.signal = signal; return chain; },
        maybeSingle: run,
        then: (resolve: (value: Response) => unknown, reject: (reason: unknown) => unknown) => run().then(resolve, reject),
      };
      return chain;
    };
    mocks.client.mockResolvedValue({ auth: { getUser }, from: (table: string) => ({ select: () => query(table), insert: (value: Row) => query(table, value) }) });
    mocks.import.mockImplementation(async (lookupId, incoming, scope) => {
      if (!isAccountScopeCurrent(scope)) throw new Error("Account changed");
      const verified = await verifyDiagnosticBundle(mergeDiagnosticBundles(local, incoming, lookupId), lookupId);
      if (!isAccountScopeCurrent(scope)) throw new Error("Account changed");
      // Model the store's fresh-bucket union, never a replacement acknowledgement.
      local = mergeDiagnosticBundles(local, verified, lookupId); return structuredClone(local);
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("reads and verifies every owner page without importing or uploading", async () => {
    remote = [row(document()), ...Array.from({ length: 6 }, (_, index) => row(association(index + 10))),
      { ...row(document(2)), user_id: "other" }, { ...row(document(3)), lookup_id: "other-scan" }];
    const result = await readCloudDiagnosticBundle("scan");
    expect(result.documents).toEqual([document()]); expect(result.associations).toHaveLength(6); expect(pages).toBe(2);
    for (const request of requests) {
      expect(request.filters.get("user_id")).toBe("owner"); expect(request.filters.get("lookup_id")).toBe("scan");
      expect(request.limit).toBe(4); expect(request.signal).toBeInstanceOf(AbortSignal);
    }
    expect(requests[1].after).toBe(id(12)); expect(mocks.import).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
  });
  it("reads the terminating empty page for an exact multiple and accepts an empty history", async () => {
    remote = [row(document()), row(association()), row(association(11)), row(association(12))];
    expect((await readCloudDiagnosticBundle("scan")).associations).toHaveLength(3); expect(pages).toBe(2);
    remote = []; expect(await readCloudDiagnosticBundle("scan")).toEqual(empty()); expect(mocks.import).not.toHaveBeenCalled();
  });
  it.each(["oversized page", "duplicate", "descending", "non-array"])("rejects %s responses rather than returning a prefix", async (kind) => {
    const one = row(document());
    readOverride = () => ({ data: kind === "oversized page" ? Array.from({ length: 5 }, () => one) : kind === "duplicate" ? [one, one] : kind === "descending" ? [row(document(2)), one] : null, error: null });
    await expect(readCloudDiagnosticBundle("scan")).rejects.toThrow("invalid"); expect(mocks.import).not.toHaveBeenCalled();
  });
  it("rejects a page that repeats the previous cursor without looping", async () => {
    readOverride = () => ({ data: [1, 2, 3, 4].map((n) => row(document(n))), error: null });
    await expect(readCloudDiagnosticBundle("scan")).rejects.toThrow("invalid"); expect(pages).toBe(2);
  });
  it("stops when the ninth document or 101st association exceeds its independent bound", async () => {
    remote = Array.from({ length: 9 }, (_, index) => row(document(index + 1)));
    await expect(readCloudDiagnosticBundle("scan")).rejects.toThrow("limits"); expect(pages).toBe(3);
    pages = 0; remote = [row(document()), ...Array.from({ length: 101 }, (_, index) => row(association(index + 10)))];
    await expect(readCloudDiagnosticBundle("scan")).rejects.toThrow("limits"); expect(pages).toBe(26); expect(mocks.import).not.toHaveBeenCalled();
  });
  it("enforces aggregate UTF-8 bytes even when individual documents and association counts fit", async () => {
    const largeText = `${"x".repeat(2047)}\n`.repeat(1024);
    const documents = Array.from({ length: 8 }, (_, index) => document(index + 1, largeText));
    const associations = Array.from({ length: 100 }, (_, index): DiagnosticAssociation => ({ ...association(index + 10), sourceSha256: documents[0].sha256, entryIds: [],
      subject: "測".repeat(200), basis: "測".repeat(1000), notes: "測".repeat(4000),
      photos: Array.from({ length: 4 }, (_, photo) => ({ ...association().photos[0], photoId: `photo-${photo + 1}`, vehicleContext: {
        vin: "SYNTHETICVIN000001", year: "2026", make: "測".repeat(120), model: "測".repeat(120), engine: "測".repeat(120), mileage: "測".repeat(120), mileageUnit: "km",
        symptom: "測".repeat(500), modifications: { status: "modified", details: "測".repeat(600) },
      } })),
    }));
    remote = [...documents.map(row), ...associations.map(row)];
    expect(remote.reduce((bytes, entry) => bytes + Buffer.byteLength(JSON.stringify(entry.record_json)), 0)).toBeGreaterThan(MAX_DIAGNOSTIC_BUNDLE_BYTES);
    await expect(readCloudDiagnosticBundle("scan")).rejects.toThrow("limits"); expect(mocks.import).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
  }, 20_000);
  it.each(["owner", "lookup", "id", "kind", "record lookup", "source size"])("rejects forged %s metadata", async (kind) => {
    const value = row(document());
    if (kind === "owner") value.user_id = "other";
    if (kind === "lookup") value.lookup_id = "other";
    if (kind === "id") value.id = id(2);
    if (kind === "kind") value.kind = "association";
    if (kind === "record lookup") value.record_json = { ...document(), lookupId: "other" };
    if (kind === "source size") value.record_json = { ...document(), byteLength: 2 * 1024 * 1024 + 1 };
    readOverride = () => ({ data: [value], error: null });
    await expect(readCloudDiagnosticBundle("scan")).rejects.toThrow("invalid"); expect(mocks.import).not.toHaveBeenCalled();
  });
  it("recomputes source SHA and refuses a same-length byte mutation before any import or write", async () => {
    const changed = { ...document(), sourceBase64: Buffer.from(source.replace("Synthetic report", "Synthetix report")).toString("base64") };
    remote = [row(changed)]; const before = structuredClone(local);
    await expect(syncDiagnosticReports("scan")).rejects.toThrow("fingerprint");
    expect(local).toEqual(before); expect(mocks.import).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
  });
  it("does not upload corrupted local source bytes after a valid empty remote read", async () => {
    local.documents[0].sourceBase64 = Buffer.from(source.replace("Synthetic report", "Synthetix report")).toString("base64");
    const before = structuredClone(local);
    await expect(syncDiagnosticReports("scan")).rejects.toThrow("fingerprint"); expect(local).toEqual(before); expect(insert).not.toHaveBeenCalled();
  });
  it("checks parsed entry membership and all document/correction references", async () => {
    remote = [row(document()), row({ ...association(), entryIds: ["fault-19999"] })];
    await expect(readCloudDiagnosticBundle("scan")).rejects.toThrow("absent from its exact original");
    remote = [row(association())]; await expect(readCloudDiagnosticBundle("scan")).rejects.toThrow("verified");
    remote = [row(document()), row({ ...association(), supersedesId: id(11), correctionReason: "Missing prior" })];
    await expect(readCloudDiagnosticBundle("scan")).rejects.toThrow("verified"); expect(mocks.import).not.toHaveBeenCalled();
  });
  it("retains unsupported textual originals without inventing parsed associations", async () => {
    local = { documents: [document(1, "Synthetic unknown scanner format")], associations: [] };
    expect(await syncDiagnosticReports("scan")).toMatchObject({ synced: 1 });
    expect((await readCloudDiagnosticBundle("scan")).documents[0].sourceBase64).toBe(local.documents[0].sourceBase64);
  });
  it("uploads original, prior association and correction in dependency order despite reversed dates", async () => {
    const prior = association(20), correction = { ...association(10), recordedAt: "2026-11-04T00:00:00Z", supersedesId: prior.id, correctionReason: "Corrected human association" };
    local = { documents: [document()], associations: [correction, prior] };
    expect(await syncDiagnosticReports("scan")).toMatchObject({ synced: 3 });
    expect(insert.mock.calls.map(([value]) => value.id)).toEqual([id(1), id(20), id(10)]);
    const parent = requests.find((entry) => entry.table === "scan_lookups")!;
    expect(parent.filters.get("user_id")).toBe("owner"); expect(parent.filters.get("local_id")).toBe("scan");
  });
  it.each(["missing", "foreign", "different scan"])("requires the exact owned cloud parent (%s) without uploading photos", async (kind) => {
    parentOverride = () => ({ data: kind === "missing" ? null : { user_id: kind === "foreign" ? "other" : "owner", local_id: kind === "different scan" ? "other" : "scan" }, error: null });
    await expect(syncDiagnosticReports("scan")).rejects.toThrow("Save this scan to the cloud");
    expect(insert).not.toHaveBeenCalled(); expect(local.documents).toEqual([document()]);
    expect(requests.every((entry) => ["diagnostic_reports", "scan_lookups"].includes(entry.table))).toBe(true);
  });
  it("does not require a parent write when the exact snapshot is already cloud-confirmed", async () => {
    remote = [row(document())]; parentExists = false;
    expect(await syncDiagnosticReports("scan")).toMatchObject({ synced: 0, message: expect.stringContaining("Cloud confirmed 1 original") });
    expect(insert).not.toHaveBeenCalled(); expect(requests.some((entry) => entry.table === "scan_lookups")).toBe(false);
  });
  it("accepts concurrent duplicate insertion only after reading exact immutable content", async () => {
    insertOverride = (value) => { remote.push(structuredClone(value)); return { data: null, error: { code: "23505" } }; };
    expect(await syncDiagnosticReports("scan")).toMatchObject({ synced: 1 });
    expect(requests.some((entry) => entry.filters.get("id") === id(1) && entry.filters.get("user_id") === "owner")).toBe(true);
  });
  it.each(["duplicate", "acknowledgement"])("rejects changed immutable %s content without overwriting either version", async (kind) => {
    insertOverride = (value) => {
      const changed = { ...value, record_json: { ...document(), fileName: "different.txt" } }; remote.push(changed);
      return kind === "duplicate" ? { data: null, error: { code: "23505" } } : { data: changed, error: null };
    };
    await expect(syncDiagnosticReports("scan")).rejects.toThrow("conflicting content");
    expect(local.documents[0].fileName).toBe("synthetic.txt"); expect((remote[0].record_json as DiagnosticDocument).fileName).toBe("different.txt");
  });
  it("rejects duplicate acknowledgements from another owner or scan", async () => {
    insertOverride = () => ({ data: null, error: { code: "23505" } });
    duplicateOverride = () => ({ data: { ...row(document()), user_id: "other" }, error: null });
    await expect(syncDiagnosticReports("scan")).rejects.toThrow("invalid");
    duplicateOverride = () => ({ data: { ...row(document()), lookup_id: "other" }, error: null });
    await expect(syncDiagnosticReports("scan")).rejects.toThrow("invalid"); expect(local.documents).toEqual([document()]);
  });
  it("rejects a conflicting initial remote ID before inserting anything", async () => {
    remote = [row({ ...document(), fileName: "other-original.txt" })];
    await expect(syncDiagnosticReports("scan")).rejects.toThrow("conflicting content"); expect(insert).not.toHaveBeenCalled(); expect(local.documents).toEqual([document()]);
  });
  it("preserves both correction forks without choosing a timestamp winner", async () => {
    const left = { ...association(11), supersedesId: id(10), correctionReason: "Local correction" }, right = { ...association(12), supersedesId: id(10), correctionReason: "Other device correction" };
    local.associations = [association(), left]; remote = [row(document()), row(association()), row(right)];
    expect(await syncDiagnosticReports("scan")).toMatchObject({ synced: 1 });
    expect(local.associations).toHaveLength(3); expect(remote).toHaveLength(4);
    expect(local.associations.map((entry) => diagnosticAssociationStatus(entry, local.associations))).toEqual(["conflicting_correction", "conflicting_correction", "conflicting_correction"]);
  });
  it("preserves a concurrent local append and does not claim it was uploaded", async () => {
    insertOverride = (value) => { local = mergeDiagnosticBundles(local, { documents: [document(2)], associations: [association()] }, "scan"); remote.push(structuredClone(value)); return { data: value, error: null }; };
    const result = await syncDiagnosticReports("scan");
    expect(local.documents).toHaveLength(2); expect(local.associations).toHaveLength(1); expect(remote).toHaveLength(1);
    expect(result).toMatchObject({ synced: 1, message: expect.stringContaining("1 original report(s) and 0 human association(s)") }); expect(result.message).toContain("Later device changes require another sync");
  });
  it("retains all local evidence after partial acceptance and retries only missing IDs", async () => {
    local.associations = [association()]; const before = structuredClone(local);
    insertOverride = (value) => { if (value.kind === "association") return { data: null, error: { code: "NETWORK", message: "private transport detail" } }; remote.push(structuredClone(value)); return { data: value, error: null }; };
    await expect(syncDiagnosticReports("scan")).rejects.toThrow("could not be read or saved"); expect(local).toEqual(before); expect(remote).toHaveLength(1);
    insertOverride = undefined;
    expect(await syncDiagnosticReports("scan")).toMatchObject({ synced: 1 });
    expect(insert.mock.calls.map(([value]) => value.id)).toEqual([id(1), id(10), id(10)]); expect(remote).toHaveLength(2); expect(local).toEqual(before);
  });
  it("does not report success if the final confirmation omits an accepted snapshot entry", async () => {
    readOverride = () => ({ data: [], error: null });
    await expect(syncDiagnosticReports("scan")).rejects.toThrow("not fully confirmed"); expect(local.documents).toEqual([document()]); expect(remote).toHaveLength(1);
  });
  it.each(["missing", "mismatch", "anonymous", "unverified", "auth error"])("requires verified owner authentication (%s)", async (kind) => {
    if (kind === "missing") user = null;
    if (kind === "mismatch") user!.id = "other";
    if (kind === "anonymous") user!.is_anonymous = true;
    if (kind === "unverified") delete user!.email_confirmed_at;
    if (kind === "auth error") getUser.mockResolvedValue({ data: { user }, error: { message: "private URL" } });
    await expect(syncDiagnosticReports("scan")).rejects.toThrow("verified account"); expect(requests).toHaveLength(0); expect(mocks.import).not.toHaveBeenCalled();
  });
  it("supports a verified phone owner but rejects signed-out/stale generations before auth", async () => {
    user = { id: "owner", phone_confirmed_at: date }; expect(await readCloudDiagnosticBundle("scan")).toEqual(empty());
    const scope = getAccountScope(); setActiveAccount(null); mocks.client.mockClear();
    await expect(readCloudDiagnosticBundle("scan")).rejects.toThrow("Account changed");
    setActiveAccount("owner"); await expect(readCloudDiagnosticBundle("scan", scope)).rejects.toThrow("Account changed"); expect(mocks.client).not.toHaveBeenCalled();
  });
  it("rejects invalid scan identifiers and unavailable configuration without touching storage", async () => {
    await expect(readCloudDiagnosticBundle("../scan")).rejects.toThrow("valid saved scan"); expect(mocks.client).not.toHaveBeenCalled();
    mocks.client.mockResolvedValue(null); await expect(syncDiagnosticReports("scan")).rejects.toThrow("not configured"); expect(mocks.import).not.toHaveBeenCalled();
  });
  it("ignores a cloud page after account change, including leaving and returning to the same account", async () => {
    const scope = getAccountScope();
    readOverride = () => { setActiveAccount("other"); setActiveAccount("owner"); return { data: [row(document())], error: null }; };
    await expect(readCloudDiagnosticBundle("scan", scope)).rejects.toThrow("Account changed"); expect(mocks.import).not.toHaveBeenCalled();
  });
  it("stops after an in-flight accepted insert if the account changes", async () => {
    insertOverride = (value) => { remote.push(structuredClone(value)); setActiveAccount("other"); return { data: value, error: null }; };
    await expect(syncDiagnosticReports("scan")).rejects.toThrow("Account changed"); expect(remote).toHaveLength(1); expect(mocks.import).toHaveBeenCalledTimes(1);
    expect(local.documents).toEqual([document()]);
  });
  it("cancels read-only requests before and during transport without importing late data", async () => {
    const aborted = new AbortController(); aborted.abort(); await expect(readCloudDiagnosticBundle("scan", getAccountScope(), aborted.signal)).rejects.toThrow("canceled"); expect(requests).toHaveLength(0);
    const controller = new AbortController(); let release!: (value: Response) => void, started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    readOverride = () => { started(); return new Promise<Response>((resolve) => { release = resolve; }); };
    const pending = expect(readCloudDiagnosticBundle("scan", getAccountScope(), controller.signal)).rejects.toThrow("canceled");
    await entered; controller.abort(); await pending;
    expect(requests.at(-1)!.signal!.aborted).toBe(true); release({ data: [row(document())], error: null }); await Promise.resolve();
    expect(mocks.import).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
  });
  it.each(["client", "auth", "page"])("bounds a hung %s operation without starting writes", async (kind) => {
    vi.useFakeTimers();
    if (kind === "client") mocks.client.mockReturnValue(new Promise(() => undefined));
    if (kind === "auth") getUser.mockReturnValue(new Promise(() => undefined));
    if (kind === "page") readOverride = () => new Promise(() => undefined);
    const pending = expect(syncDiagnosticReports("scan")).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(20_001); await pending;
    expect(mocks.import).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled(); expect(local.documents).toEqual([document()]);
  });
  it("reconciles an uncertain accepted insert after timeout without replacing or duplicating evidence", async () => {
    vi.useFakeTimers(); let started!: () => void;
    const entered = new Promise<void>((resolve) => { started = resolve; });
    insertOverride = (value) => { remote.push(structuredClone(value)); started(); return new Promise(() => undefined); };
    const pending = expect(syncDiagnosticReports("scan")).rejects.toThrow("retry to check what was accepted");
    await entered; await vi.advanceTimersByTimeAsync(20_001); await pending;
    expect(remote).toHaveLength(1); expect(local.documents).toEqual([document()]);
    vi.useRealTimers(); insertOverride = undefined;
    expect(await syncDiagnosticReports("scan")).toMatchObject({ synced: 0 }); expect(insert).toHaveBeenCalledTimes(1);
  });
  it.each(["client", "auth", "page", "insert"])("sanitizes rejected %s promises instead of leaking backend details", async (kind) => {
    const secretError = new Error("private transport URL with credential canary");
    if (kind === "client") mocks.client.mockRejectedValue(secretError);
    if (kind === "auth") getUser.mockRejectedValue(secretError);
    if (kind === "page") readOverride = () => { throw secretError; };
    if (kind === "insert") insertOverride = () => { throw secretError; };
    const result = syncDiagnosticReports("scan");
    await expect(result).rejects.toThrow("could not be read or saved"); await expect(result).rejects.not.toThrow("canary");
    expect(local.documents).toEqual([document()]);
  });
  it("explains missing schema and missing parent failures without exposing provider error text", async () => {
    readOverride = () => ({ data: null, error: { code: "42P01", message: "private schema details" } });
    await expect(readCloudDiagnosticBundle("scan")).rejects.toThrow("database migration");
    readOverride = undefined; insertOverride = () => ({ data: null, error: { code: "23503", message: "private parent details" } });
    await expect(syncDiagnosticReports("scan")).rejects.toThrow("Save this scan to the cloud"); expect(local.documents).toEqual([document()]);
  });
});
