import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import type { InspectionComparison } from "../types/inspectionComparison";
const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("./evidenceDb", () => ({ openEvidenceDatabase: mocks.open, INSPECTION_COMPARISON_STORE: "inspection-comparisons", EVIDENCE_STORAGE_TIMEOUT_MS: 15_000 }));
import { appendInspectionComparison, importInspectionComparisons, readInspectionComparisons, INSPECTION_COMPARISONS_CHANGED, subscribeInspectionComparisons } from "./inspectionComparisonStore";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function record(n = 1): InspectionComparison {
  const side = (lookupId: string) => ({ lookupId, photoId: "photo-1", photoLabel: "overview" as const, photoAddedAt: "2026-11-05T00:00:00Z", scanSavedAt: "2026-11-05T00:00:00Z", sha256: "a".repeat(64), width: 1, height: 1, observedOn: null, vehicleContext: null });
  return { version: 1, id: id(n), lookupId: "scan", recordedAt: "2026-11-05T00:00:00Z", subject: "Bracket", earlier: side("earlier"), current: side("scan"), relationship: { sameVehicle: false, component: "unconfirmed", basis: "" }, conditions: { angle: "unknown", lighting: "unknown", surfaceNotes: "" }, observation: { outcome: "not_reviewed", notes: "" }, alignment: { rotation: 0, scale: 1, offsetX: 0, offsetY: 0 } };
}

// Request/transaction sequencing fixture. Real cross-tab atomicity also requires
// the native IndexedDB check; this fixture verifies application guards and unions.
function databaseFixture() {
  const rows = new Map<string, unknown>();
  let queue = Promise.resolve();
  let failPut = false, hang = false;
  let beforeGet: (() => void) | undefined;
  const database = { close: vi.fn(), transaction: vi.fn((_store: string, mode: string) => {
    let aborted = false;
    const writes = new Map<string, unknown>();
    const tx = { oncomplete: null, onerror: null, onabort: null,
      abort: () => { aborted = true; queueMicrotask(() => tx.onabort?.()); },
      objectStore: () => ({
        get: (key: unknown) => {
          const request = { result: undefined, onsuccess: null } as { result: unknown; onsuccess: (() => void) | null };
          queue = queue.then(async () => {
            if (hang) return;
            beforeGet?.();
            if (aborted) return;
            request.result = structuredClone(rows.get(JSON.stringify(key)));
            request.onsuccess?.();
            if (aborted) return;
            if (mode === "readwrite") for (const [storedKey,value] of writes) rows.set(storedKey,value);
            tx.oncomplete?.();
          });
          return request;
        },
        put: (value: unknown, key: unknown) => {
          if (failPut) throw new Error("Device quota exceeded");
          writes.set(JSON.stringify(key), structuredClone(value));
        },
      }),
    } as { oncomplete: (() => void) | null; onerror: (() => void) | null; onabort: (() => void) | null; abort: () => void; objectStore: () => unknown };
    return tx;
  }) };
  return { rows, database, setFailPut: () => { failPut = true; }, setHang: () => { hang = true; }, beforeGet: (run: () => void) => { beforeGet = run; } };
}

describe("immutable device dated comparisons", () => {
  let db: ReturnType<typeof databaseFixture>;
  beforeEach(() => { vi.clearAllMocks(); setActiveAccount("owner"); db = databaseFixture(); mocks.open.mockResolvedValue(db.database); vi.stubGlobal("BroadcastChannel", undefined); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("reads an absent history without creating or dropping a record", async () => {
    expect(await readInspectionComparisons("scan")).toEqual([]); expect(db.rows.size).toBe(0);
    expect(db.database.transaction).toHaveBeenCalledWith("inspection-comparisons", "readonly");
  });
  it("unions simultaneous appends inside fresh transactions and isolates the owner key", async () => {
    await Promise.all([appendInspectionComparison(record(1)), appendInspectionComparison(record(2))]);
    expect((await readInspectionComparisons("scan")).map((entry) => entry.id)).toEqual([id(1),id(2)]);
    setActiveAccount("other"); expect(await readInspectionComparisons("scan")).toEqual([]);
    expect(db.rows.has(JSON.stringify(["owner","scan"]))).toBe(true);
  });
  it("allows exact retry but rejects replacement of an immutable ID", async () => {
    await appendInspectionComparison(record());
    expect(await appendInspectionComparison(record())).toHaveLength(1);
    await expect(appendInspectionComparison({ ...record(), subject: "different" })).rejects.toThrow("conflicting content");
    expect((await readInspectionComparisons("scan"))[0].subject).toBe("Bracket");
  });
  it("rejects a stale correction while allowing its exact retry and preserving imported forks", async () => {
    const correction = { ...record(2), supersedesId: id(1), correctionReason: "Read instrument again" };
    const fork = { ...record(3), supersedesId: id(1), correctionReason: "Independent correction" };
    await appendInspectionComparison(record()); await appendInspectionComparison(correction);
    await expect(appendInspectionComparison(fork)).rejects.toThrow("already corrected");
    expect(await appendInspectionComparison(correction)).toHaveLength(2);
    expect(await importInspectionComparisons("scan", [record(),fork])).toHaveLength(3);
  });
  it("merges remote history without losing an entry appended while the read was in flight", async () => {
    const remote = [record(1)]; await appendInspectionComparison(record(2));
    expect((await importInspectionComparisons("scan", remote)).map((entry) => entry.id)).toEqual([id(1),id(2)]);
    expect(remote).toEqual([record(1)]);
  });
  it("rejects corrupt storage and foreign/missing references without overwriting recovery data", async () => {
    const key = JSON.stringify(["owner","scan"]); db.rows.set(key, null);
    await expect(appendInspectionComparison(record())).rejects.toThrow("invalid or incomplete"); expect(db.rows.get(key)).toBeNull();
    db.rows.delete(key);
    await expect(importInspectionComparisons("scan", [{ ...record(), lookupId: "other" }])).rejects.toThrow("different scan");
    await expect(appendInspectionComparison({ ...record(2), supersedesId: id(1), correctionReason: "Missing previous" })).rejects.toThrow("missing correction references");
    expect(db.rows.size).toBe(0);
  });
  it("stops an old account before opening and after the database await", async () => {
    const scope = getAccountScope(); setActiveAccount("other");
    await expect(appendInspectionComparison(record(), scope)).rejects.toThrow("Account changed"); expect(mocks.open).not.toHaveBeenCalled();
    setActiveAccount("owner"); mocks.open.mockImplementation(async () => { setActiveAccount("other"); return db.database; });
    await expect(appendInspectionComparison(record())).rejects.toThrow("Account changed"); expect(db.rows.size).toBe(0);
  });
  it("guards account changes inside the transaction before writing", async () => {
    db.beforeGet(() => setActiveAccount("other"));
    await expect(appendInspectionComparison(record())).rejects.toThrow("Account changed"); expect(db.rows.size).toBe(0);
  });
  it.each(["append", "retry"])("checks capture context inside the transaction for %s", async (operation) => {
    await appendInspectionComparison(record());
    let sourceJob = "original-job";
    const assertContextCurrent = vi.fn(() => { if (sourceJob !== "original-job") throw new Error("Source job changed"); });
    db.beforeGet(() => { sourceJob = "other-job"; });
    await expect(appendInspectionComparison(record(operation === "append" ? 2 : 1), getAccountScope(), assertContextCurrent)).rejects.toThrow("Source job changed");
    expect(assertContextCurrent).toHaveBeenCalledOnce();
    expect(db.rows.get(JSON.stringify(["owner", "scan"]))).toEqual([record()]);
  });
  it("keeps the previous history after storage failure and bounded transaction timeout", async () => {
    await appendInspectionComparison(record()); db.setFailPut();
    await expect(appendInspectionComparison(record(2))).rejects.toThrow();
    expect(await readInspectionComparisons("scan")).toHaveLength(1);
    vi.useFakeTimers(); db.setHang();
    const pending = expect(appendInspectionComparison(record(3))).rejects.toThrow("stalled");
    await vi.advanceTimersByTimeAsync(15_001); await pending;
    expect((db.rows.get(JSON.stringify(["owner","scan"])) as InspectionComparison[])).toHaveLength(1);
  });
  it("notifies only the captured account and stops after unsubscribe", async () => {
    const listener = vi.fn(); const stop = subscribeInspectionComparisons(listener);
    await appendInspectionComparison(record()); expect(listener).toHaveBeenCalledWith("scan"); listener.mockClear();
    window.dispatchEvent(new CustomEvent(INSPECTION_COMPARISONS_CHANGED,{ detail:{owner:"other",lookupId:"scan"} })); expect(listener).not.toHaveBeenCalled();
    stop(); await appendInspectionComparison(record(2)); expect(listener).not.toHaveBeenCalled();
  });
});
