import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import type { ServiceRecord } from "../types/serviceRecord";
const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("./evidenceDb", () => ({ openEvidenceDatabase: mocks.open, SERVICE_RECORD_STORE: "service-records", EVIDENCE_STORAGE_TIMEOUT_MS: 15_000 }));
import { appendServiceRecord, importServiceRecords, readServiceRecords, SERVICE_RECORDS_CHANGED, subscribeServiceRecords } from "./serviceRecordStore";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function record(n = 1): ServiceRecord {
  return { version: 1, id: id(n), lookupId: "scan", recordedAt: "2026-11-05T00:00:00Z", occurredOn: null,
    recordedBy: "Pat", basis: "personally_performed", subject: "Bracket", photoIds: ["photo-1"], notes: "Saved evidence",
    kind: "measurement", quantity: "Thickness", reading: "3.00", unit: "mm", method: "Caliper", instrument: "Hand caliper", conditions: "Cold", noReadingReason: "" };
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

describe("immutable device human records", () => {
  let db: ReturnType<typeof databaseFixture>;
  beforeEach(() => { vi.clearAllMocks(); setActiveAccount("owner"); db = databaseFixture(); mocks.open.mockResolvedValue(db.database); vi.stubGlobal("BroadcastChannel", undefined); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("reads an absent history without creating or dropping a record", async () => {
    expect(await readServiceRecords("scan")).toEqual([]); expect(db.rows.size).toBe(0);
    expect(db.database.transaction).toHaveBeenCalledWith("service-records", "readonly");
  });
  it("unions simultaneous appends inside fresh transactions and isolates the owner key", async () => {
    await Promise.all([appendServiceRecord(record(1)), appendServiceRecord(record(2))]);
    expect((await readServiceRecords("scan")).map((entry) => entry.id)).toEqual([id(1),id(2)]);
    setActiveAccount("other"); expect(await readServiceRecords("scan")).toEqual([]);
    expect(db.rows.has(JSON.stringify(["owner","scan"]))).toBe(true);
  });
  it("allows exact retry but rejects replacement of an immutable ID", async () => {
    await appendServiceRecord(record());
    expect(await appendServiceRecord(record())).toHaveLength(1);
    await expect(appendServiceRecord({ ...record(), notes: "different" })).rejects.toThrow("conflicting content");
    expect((await readServiceRecords("scan"))[0].notes).toBe("Saved evidence");
  });
  it("rejects a stale correction while allowing its exact retry and preserving imported forks", async () => {
    const correction = { ...record(2), supersedesId: id(1), correctionReason: "Read instrument again" };
    const fork = { ...record(3), supersedesId: id(1), correctionReason: "Independent correction" };
    await appendServiceRecord(record()); await appendServiceRecord(correction);
    await expect(appendServiceRecord(fork)).rejects.toThrow("already corrected");
    expect(await appendServiceRecord(correction)).toHaveLength(2);
    expect(await importServiceRecords("scan", [record(),fork])).toHaveLength(3);
  });
  it("merges remote history without losing an entry appended while the read was in flight", async () => {
    const remote = [record(1)]; await appendServiceRecord(record(2));
    expect((await importServiceRecords("scan", remote)).map((entry) => entry.id)).toEqual([id(1),id(2)]);
    expect(remote).toEqual([record(1)]);
  });
  it("rejects corrupt storage and foreign/missing references without overwriting recovery data", async () => {
    const key = JSON.stringify(["owner","scan"]); db.rows.set(key, null);
    await expect(appendServiceRecord(record())).rejects.toThrow("invalid or incomplete"); expect(db.rows.get(key)).toBeNull();
    db.rows.delete(key);
    await expect(importServiceRecords("scan", [{ ...record(), lookupId: "other" }])).rejects.toThrow("different saved scan");
    await expect(appendServiceRecord({ ...record(2), supersedesId: id(1), correctionReason: "Missing previous" })).rejects.toThrow("missing references");
    expect(db.rows.size).toBe(0);
  });
  it("stops an old account before opening and after the database await", async () => {
    const scope = getAccountScope(); setActiveAccount("other");
    await expect(appendServiceRecord(record(), scope)).rejects.toThrow("Account changed"); expect(mocks.open).not.toHaveBeenCalled();
    setActiveAccount("owner"); mocks.open.mockImplementation(async () => { setActiveAccount("other"); return db.database; });
    await expect(appendServiceRecord(record())).rejects.toThrow("Account changed"); expect(db.rows.size).toBe(0);
  });
  it("guards account changes inside the transaction before writing", async () => {
    db.beforeGet(() => setActiveAccount("other"));
    await expect(appendServiceRecord(record())).rejects.toThrow("Account changed"); expect(db.rows.size).toBe(0);
  });
  it("keeps the previous history after storage failure and bounded transaction timeout", async () => {
    await appendServiceRecord(record()); db.setFailPut();
    await expect(appendServiceRecord(record(2))).rejects.toThrow();
    expect(await readServiceRecords("scan")).toHaveLength(1);
    vi.useFakeTimers(); db.setHang();
    const pending = expect(appendServiceRecord(record(3))).rejects.toThrow("stalled");
    await vi.advanceTimersByTimeAsync(15_001); await pending;
    expect((db.rows.get(JSON.stringify(["owner","scan"])) as ServiceRecord[])).toHaveLength(1);
  });
  it("notifies only the captured account and stops after unsubscribe", async () => {
    const listener = vi.fn(); const stop = subscribeServiceRecords(listener);
    await appendServiceRecord(record()); expect(listener).toHaveBeenCalledWith("scan"); listener.mockClear();
    window.dispatchEvent(new CustomEvent(SERVICE_RECORDS_CHANGED,{ detail:{owner:"other",lookupId:"scan"} })); expect(listener).not.toHaveBeenCalled();
    stop(); await appendServiceRecord(record(2)); expect(listener).not.toHaveBeenCalled();
  });
});
