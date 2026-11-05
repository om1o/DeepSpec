import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import { readFinalInspectionSnapshot } from "./inspectionReportSnapshot";
import type { ComponentMapRecord } from "../types/componentMap";
import type { ServiceRecord } from "../types/serviceRecord";

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("./evidenceDb", () => ({ openEvidenceDatabase: mocks.open, COMPONENT_MAP_STORE: "component-maps", SERVICE_RECORD_STORE: "service-records", INSPECTION_COMPARISON_STORE: "inspection-comparisons", EVIDENCE_STORAGE_TIMEOUT_MS: 15_000 }));
const map: ComponentMapRecord = { document: { version: 1, id: "root", overview: { lookupId: "root", photoId: "photo-1" }, components: [] }, localRevision: 1, cloudRevision: null, syncedLocalRevision: 0 };
const record = (lookupId = "root"): ServiceRecord => ({ version: 1, id: "20000000-0000-4000-8000-000000000001", lookupId, recordedAt: "2026-11-05T12:00:00Z", occurredOn: null, recordedBy: "Recorder", basis: "personally_performed", subject: "Hose", photoIds: [], notes: "Record remains without image", kind: "repair", action: "Inspect clamps", status: "planned", parts: "" });

// This sequencing fixture exposes every requested store/key and allows writes to
// be staged while read callbacks run. Browser IndexedDB supplies the actual
// isolation guarantee; native report QA exercises that implementation separately.
function fixture() {
  const rows = new Map<string, unknown>();
  const key = (store: string, id: string, owner = "owner") => JSON.stringify([store, owner, id]);
  const requests: { store: string; key: string; result: unknown; onsuccess: (() => void) | null }[] = [];
  let snapshot = new Map<string, unknown>(); let aborted = false;
  const tx = { oncomplete: null as (() => void) | null, onerror: null as (() => void) | null, onabort: null as (() => void) | null,
    abort: vi.fn(() => { aborted = true; queueMicrotask(() => tx.onabort?.()); }),
    objectStore: vi.fn((store: string) => ({ get: (pair: string[]) => {
      const request = { store, key: JSON.stringify([store, ...pair]), result: undefined as unknown, onsuccess: null as (() => void) | null };
      requests.push(request); return request;
    } })),
  };
  const database = { close: vi.fn(), transaction: vi.fn(() => { snapshot = structuredClone(rows); return tx; }) };
  const drain = (between?: (index: number) => void) => {
    for (let index = 0; index < requests.length; index += 1) {
      if (aborted) return;
      const request = requests[index]; request.result = structuredClone(snapshot.get(request.key)); request.onsuccess?.(); between?.(index);
    }
    if (!aborted) tx.oncomplete?.();
  };
  return { rows, key, database, requests, tx, drain };
}

beforeEach(() => { vi.clearAllMocks(); setActiveAccount("owner"); });
afterEach(() => vi.useRealTimers());

it("queues map and every history get in one readonly transaction before processing any result", async () => {
  const db = fixture(); mocks.open.mockResolvedValue(db.database);
  db.rows.set(db.key("component-maps", "root"), map); db.rows.set(db.key("service-records", "missing"), [record("missing")]);
  const pending = readFinalInspectionSnapshot("root", ["root", "missing", "missing"]);
  await Promise.resolve();
  expect(db.database.transaction).toHaveBeenCalledExactlyOnceWith(["component-maps", "service-records", "inspection-comparisons"], "readonly");
  expect(db.requests.map((request) => request.key)).toEqual([db.key("component-maps", "root"), db.key("service-records", "root"), db.key("service-records", "missing"), db.key("inspection-comparisons", "root"), db.key("inspection-comparisons", "missing")]);
  db.drain(); const result = await pending;
  expect(result.map).toEqual(map); expect(result.serviceRecords.get("root")).toEqual([]);
  expect(result.serviceRecords.get("missing")).toEqual([record("missing")]); expect(db.database.close).toHaveBeenCalledOnce();
  expect(result.comparisons.get("root")).toEqual([]); expect(result.comparisons.get("missing")).toEqual([]);
});

it("returns one transaction snapshot when map and an earlier history are edited during later callbacks", async () => {
  const db = fixture(); mocks.open.mockResolvedValue(db.database);
  db.rows.set(db.key("component-maps", "root"), map); db.rows.set(db.key("service-records", "root"), [record()]);
  const pending = readFinalInspectionSnapshot("root", ["root", "detail"]); await Promise.resolve();
  db.drain((index) => { if (index === 1) { db.rows.set(db.key("component-maps", "root"), { ...map, localRevision: 2 }); db.rows.set(db.key("service-records", "root"), []); } });
  const result = await pending;
  expect(result.map?.localRevision).toBe(1); expect(result.serviceRecords.get("root")).toEqual([record()]);
  expect(db.database.transaction).toHaveBeenCalledTimes(1);
});

it("distinguishes corrupt service history from an absent empty history", async () => {
  const db = fixture(); mocks.open.mockResolvedValue(db.database);
  db.rows.set(db.key("service-records", "corrupt"), null);
  db.rows.set(db.key("inspection-comparisons", "corrupt"), null);
  const pending = readFinalInspectionSnapshot("root", ["corrupt", "absent"]); await Promise.resolve(); db.drain();
  const result = await pending; expect(result.map).toBeNull();
  expect(result.serviceRecords.get("corrupt")).toBeNull(); expect(result.serviceRecords.get("absent")).toEqual([]);
  expect(result.comparisons.get("corrupt")).toBeNull(); expect(result.comparisons.get("absent")).toEqual([]);
});

it("rejects corrupt map data and closes the connection", async () => {
  const db = fixture(); mocks.open.mockResolvedValue(db.database); db.rows.set(db.key("component-maps", "root"), null);
  const pending = expect(readFinalInspectionSnapshot("root", ["root"])).rejects.toThrow("component map");
  await Promise.resolve(); db.drain(); await pending;
  expect(db.tx.abort).toHaveBeenCalledOnce(); expect(db.database.close).toHaveBeenCalledOnce();
});

it("guards owner changes before open and during the final transaction", async () => {
  const scope = getAccountScope(); setActiveAccount("other");
  await expect(readFinalInspectionSnapshot("root", ["root"], scope)).rejects.toThrow("Account changed"); expect(mocks.open).not.toHaveBeenCalled();
  setActiveAccount("owner"); const db = fixture(); mocks.open.mockResolvedValue(db.database);
  const pending = expect(readFinalInspectionSnapshot("root", ["root"])).rejects.toThrow("Account changed");
  await Promise.resolve(); db.drain((index) => { if (index === 0) setActiveAccount("other"); }); await pending;
  expect(db.database.close).toHaveBeenCalledOnce();
});

it("aborts a stalled transaction within the storage deadline", async () => {
  vi.useFakeTimers(); const db = fixture(); mocks.open.mockResolvedValue(db.database);
  const pending = expect(readFinalInspectionSnapshot("root", ["root"])).rejects.toThrow("stalled");
  await vi.advanceTimersByTimeAsync(15_001); await pending;
  expect(db.tx.abort).toHaveBeenCalledOnce(); expect(db.database.close).toHaveBeenCalledOnce();
});
