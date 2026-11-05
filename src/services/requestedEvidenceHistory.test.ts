import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import type { RequestedInspectionComparison } from "../types/inspectionComparison";
const mocks = vi.hoisted(() => ({ open: vi.fn(), bound: vi.fn((lower, upper) => ({ lower, upper })) }));
vi.mock("./evidenceDb", () => ({ openEvidenceDatabase: mocks.open, INSPECTION_COMPARISON_STORE: "comparisons", EVIDENCE_STORAGE_TIMEOUT_MS: 15_000 }));
import { readRequestedEvidenceHistory, REQUESTED_HISTORY_MAX_BUCKETS, REQUESTED_HISTORY_MAX_RECORDS } from "./requestedEvidenceHistory";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function record(n = 1, lookupId = "follow-up", origin = "origin"): RequestedInspectionComparison {
  const side = (lookupId: string) => ({ lookupId, photoId: "photo", photoLabel: "marking" as const, photoAddedAt: "2026-11-05T00:00:00Z", scanSavedAt: "2026-11-05T00:00:00Z", sha256: "a".repeat(64), width: 8, height: 6, observedOn: null, vehicleContext: null });
  return { version: 2, id: id(n), lookupId, recordedAt: "2026-11-05T00:00:00Z", subject: "Requested photo", earlier: side(origin), current: side(lookupId),
    relationship: { sameVehicle: false, component: "unconfirmed", basis: "" }, conditions: { angle: "unknown", lighting: "unknown", surfaceNotes: "" }, observation: { outcome: "not_reviewed", notes: "" },
    alignment: { rotation: 0, scale: 1, offsetX: 0, offsetY: 0 }, requestedEvidence: { version: 1, kind: "marking", request: "Photograph the marking", purpose: "Read its identifier", photoIds: ["photo"] }, analysisSha256: "b".repeat(64) };
}

// Cursor lifecycle fixture verifies our bounds/guards. Native IndexedDB QA is
// separate evidence for actual compound-key range and transaction behavior.
function fixture() {
  const rows: { key: unknown[]; value: unknown }[] = [];
  let beforeRead: (() => void) | undefined, hang = false, readError = false, completionError = false;
  let completed = false;
  const database = { close: vi.fn(), transaction: vi.fn(() => {
    let aborted = false;
    const tx = { oncomplete: null as null | (() => void), onabort: null as null | (() => void), onerror: null as null | (() => void),
      abort: () => { aborted = true; queueMicrotask(() => tx.onabort?.()); },
      objectStore: () => ({ openCursor: (range: { lower: unknown[] }) => {
        let index = 0;
        const matching = rows.filter((row) => row.key[0] === range.lower[0]);
        const request = { result: null as null | { key: unknown[]; value: unknown; continue: () => void }, onsuccess: null as null | (() => void), onerror: null as null | (() => void) };
        const step = () => queueMicrotask(() => {
          if (aborted || hang) return;
          beforeRead?.();
          if (readError) { request.onerror?.(); return; }
          const row = matching[index++]; let continued = false;
          request.result = row ? { key: row.key, value: structuredClone(row.value), continue: () => { continued = true; step(); } } : null;
          request.onsuccess?.();
          if (!continued && !aborted) queueMicrotask(() => { completed = true; if (completionError) tx.onerror?.(); else tx.oncomplete?.(); });
        });
        step(); return request;
      } }),
    }; return tx;
  }) };
  return { rows, database, beforeRead: (callback: () => void) => { beforeRead = callback; }, hang: () => { hang = true; }, failRead: () => { readError = true; }, failCompletion: () => { completionError = true; }, completed: () => completed };
}

describe("requested-photo reverse device history", () => {
  let db: ReturnType<typeof fixture>;
  beforeEach(() => { vi.clearAllMocks(); setActiveAccount("owner"); db = fixture(); mocks.open.mockResolvedValue(db.database); vi.stubGlobal("IDBKeyRange", { bound: mocks.bound }); });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("returns checked empty only after a completed read-only transaction", async () => {
    expect(await readRequestedEvidenceHistory("origin")).toEqual({ records: [], complete: true, scannedBuckets: 0 });
    expect(db.completed()).toBe(true); expect(db.database.transaction).toHaveBeenCalledWith("comparisons", "readonly");
    expect(mocks.bound).toHaveBeenCalledWith(["owner"], ["owner", []]); expect(db.database.close).toHaveBeenCalledOnce();
  });
  it("finds retained follow-ups without loading scans and isolates owner/origin/version", async () => {
    const ordinary = { ...record(4), version: 1, requestedEvidence: undefined, analysisSha256: undefined };
    delete ordinary.requestedEvidence; delete ordinary.analysisSha256;
    db.rows.push({ key: ["owner", "follow-up"], value: [record(), record(2, "follow-up", "unrelated"), ordinary] },
      { key: ["other", "follow-up"], value: [record(3)] });
    const result = await readRequestedEvidenceHistory("origin");
    expect(result.records).toEqual([record()]); expect(result.complete).toBe(true); expect(result.scannedBuckets).toBe(1);
  });
  it("keeps separate captures and immutable correction history in deterministic order", async () => {
    db.rows.push({ key: ["owner", "z-follow"], value: [record(3, "z-follow")] },
      { key: ["owner", "a-follow"], value: [record(2, "a-follow"), { ...record(4, "a-follow"), supersedesId: id(2), correctionReason: "Date corrected" }] });
    expect((await readRequestedEvidenceHistory("origin")).records.map((item) => item.id)).toEqual([id(2), id(4), id(3)]);
  });
  it("marks unreadable owner buckets incomplete while retaining readable receipts", async () => {
    db.rows.push({ key: ["owner", "broken"], value: null }, { key: ["owner", "follow-up"], value: [record()] });
    const result = await readRequestedEvidenceHistory("origin");
    expect(result.records).toEqual([record()]); expect(result.complete).toBe(false); expect(result.reason).toMatch(/could not be read/);
    expect(db.rows[0].value).toBeNull();
  });
  it("does not turn invalid keys or oversized buckets into checked empty", async () => {
    db.rows.push({ key: ["owner", ".."], value: [] }, { key: ["owner", "huge"], value: "x".repeat(262145) });
    expect(await readRequestedEvidenceHistory("origin")).toMatchObject({ complete: false, records: [], scannedBuckets: 2 });
  });
  it("allows exactly the bucket budget but makes an extra bucket explicitly incomplete", async () => {
    for (let i = 0; i < REQUESTED_HISTORY_MAX_BUCKETS; i++) db.rows.push({ key: ["owner", `scan-${i}`], value: [] });
    expect((await readRequestedEvidenceHistory("origin")).complete).toBe(true);
    db.rows.push({ key: ["owner", "follow-up"], value: [record()] });
    expect(await readRequestedEvidenceHistory("origin")).toMatchObject({ complete: false, records: [], scannedBuckets: REQUESTED_HISTORY_MAX_BUCKETS, reason: expect.stringMatching(/limit/) });
  });
  it("does not partially truncate a correction bucket at the record bound", async () => {
    for (let i = 0; i < 3; i++) db.rows.push({ key: ["owner", `scan-${i}`], value: Array.from({ length: 80 }, (_, n) => record(i * 80 + n, `scan-${i}`)) });
    const result = await readRequestedEvidenceHistory("origin");
    expect(result.complete).toBe(false); expect(result.records).toHaveLength(160); expect(result.records.length).toBeLessThan(REQUESTED_HISTORY_MAX_RECORDS); expect(result.reason).toMatch(/limit/);
  });
  it("stops at the aggregate byte budget even when each bucket is valid", async () => {
    for (let i = 0; i < 100; i++) db.rows.push({ key: ["owner", `scan-${i}`], value: Array.from({ length: 20 }, (_, n) => ({ ...record(i * 20 + n, `scan-${i}`, "unrelated"), conditions: { angle: "unknown", lighting: "unknown", surfaceNotes: "x".repeat(2000) }, observation: { outcome: "not_reviewed", notes: "y".repeat(2000) }, relationship: { sameVehicle: false, component: "unconfirmed", basis: "z".repeat(1000) } })) });
    expect(await readRequestedEvidenceHistory("origin")).toMatchObject({ complete: false, reason: expect.stringMatching(/limit/), records: [] });
  });
  it("rejects missing/stale accounts before any access, including same-user generation changes", async () => {
    const old = getAccountScope(); setActiveAccount("other"); setActiveAccount("owner");
    await expect(readRequestedEvidenceHistory("origin", old)).rejects.toThrow("Account changed");
    setActiveAccount(null); await expect(readRequestedEvidenceHistory("origin")).rejects.toThrow("Account changed"); expect(mocks.open).not.toHaveBeenCalled();
  });
  it("rejects invalid origins and account changes across open or cursor callbacks", async () => {
    await expect(readRequestedEvidenceHistory("..")).rejects.toThrow("invalid"); expect(mocks.open).not.toHaveBeenCalled();
    mocks.open.mockImplementationOnce(async () => { setActiveAccount("other"); return db.database; });
    await expect(readRequestedEvidenceHistory("origin")).rejects.toThrow("Account changed");
    setActiveAccount("owner"); db.beforeRead(() => setActiveAccount("other"));
    await expect(readRequestedEvidenceHistory("origin")).rejects.toThrow("Account changed");
  });
  it("rejects read and transaction failure instead of reporting zero follow-ups", async () => {
    db.failRead(); await expect(readRequestedEvidenceHistory("origin")).rejects.toThrow("could not be read");
    db = fixture(); mocks.open.mockResolvedValue(db.database); db.failCompletion();
    await expect(readRequestedEvidenceHistory("origin")).rejects.toThrow("could not be read");
  });
  it("bounds stalled storage without changing retained data", async () => {
    vi.useFakeTimers(); db.hang(); db.rows.push({ key: ["owner", "follow-up"], value: [record()] });
    const pending = expect(readRequestedEvidenceHistory("origin")).rejects.toThrow("stalled");
    await vi.advanceTimersByTimeAsync(15_001); await pending; expect(db.rows[0].value).toEqual([record()]);
  });
});
