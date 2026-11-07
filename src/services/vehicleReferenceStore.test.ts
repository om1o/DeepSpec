import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import { normalizeVehicleIdentityReference } from "../lib/vehicleReference";
import { VEHICLE_REFERENCE_ADAPTER_VERSION, VEHICLE_REFERENCE_SOURCE_URL, type VehicleIdentityReference } from "../types/vehicleReference";
const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("./evidenceDb", () => ({ openEvidenceDatabase: mocks.open, VEHICLE_REFERENCE_STORE: "vehicle-references", EVIDENCE_STORAGE_TIMEOUT_MS: 15_000 }));
import { appendVehicleReference, readVehicleReferences, MAX_VEHICLE_REFERENCES_PER_VIN, MAX_VEHICLE_REFERENCE_BUCKET_BYTES } from "./vehicleReferenceStore";

const VIN = "1HGCM82633A004352", OTHER_VIN = "1HGCM82633A004353";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function reference(n = 1, vin = VIN): VehicleIdentityReference {
  return { version: 1, id: id(n), provider: "nhtsa-vpic", adapterVersion: VEHICLE_REFERENCE_ADAPTER_VERSION,
    retrievedAt: "2026-11-05T12:00:00.000Z", sourceUrl: VEHICLE_REFERENCE_SOURCE_URL, query: { vin, modelYear: 2003 },
    facts: { year: "2003", make: "HONDA", model: "Accord", cylinders: "6" },
    decode: { codes: ["0"], messages: ["Provider identity only; installed equipment remains unconfirmed.\nReview the original VIN."] } };
}
const ownerKey = (vin = VIN) => JSON.stringify(["owner", vin]);

// Request sequencing checks the application transaction guards. Native cross-tab
// IndexedDB serialization requires a separate browser acceptance check.
function databaseFixture() {
  const rows = new Map<string, unknown>(); let queue = Promise.resolve();
  const options = { hang: false, failPut: false, beforeGet: undefined as (() => void) | undefined, afterCommit: undefined as (() => void) | undefined, afterComplete: undefined as (() => void) | undefined };
  const put = vi.fn();
  const database = { close: vi.fn(), transaction: vi.fn((_store: string, mode: string) => {
    let aborted = false; const writes = new Map<string, unknown>();
    const tx: { oncomplete: (() => void) | null; onerror: (() => void) | null; onabort: (() => void) | null; abort: () => void; objectStore: () => unknown } = {
      oncomplete: null, onerror: null, onabort: null,
      abort: () => { aborted = true; queueMicrotask(() => tx.onabort?.()); },
      objectStore: () => ({
        get: (key: unknown) => {
          const request = { result: undefined as unknown, onsuccess: null as (() => void) | null };
          queue = queue.then(() => {
            if (options.hang || aborted) return;
            options.beforeGet?.(); request.result = structuredClone(rows.get(JSON.stringify(key))); request.onsuccess?.();
            if (aborted) return;
            if (mode === "readwrite") writes.forEach((value, storedKey) => rows.set(storedKey, value));
            options.afterCommit?.(); tx.oncomplete?.(); options.afterComplete?.();
          });
          return request;
        },
        put: (value: unknown, key: unknown) => {
          put(value, key); if (options.failPut) throw new Error("Device quota exceeded");
          writes.set(JSON.stringify(key), structuredClone(value));
        },
      }),
    }; return tx;
  }) }; return { rows, options, database, put };
}

describe("device-only immutable vehicle identity references", () => {
  let db: ReturnType<typeof databaseFixture>;
  beforeEach(() => { vi.resetAllMocks(); setActiveAccount("owner"); db = databaseFixture(); mocks.open.mockResolvedValue(db.database); });
  afterEach(() => vi.useRealTimers());

  it("reads absent history without creating a bucket and canonicalizes only the read VIN", async () => {
    expect(await readVehicleReferences(`  ${VIN.toLowerCase()}  `)).toEqual([]);
    expect(db.rows.size).toBe(0); expect(db.put).not.toHaveBeenCalled();
    expect(db.database.transaction).toHaveBeenCalledWith("vehicle-references", "readonly");
    const saved = await appendVehicleReference(reference());
    expect(saved).toEqual(reference()); expect(db.rows.has(ownerKey())).toBe(true);
    expect(await readVehicleReferences(VIN.toLowerCase())).toEqual([reference()]);
  });
  it("isolates both account and VIN buckets without writing vehicle profiles or confirmation claims", async () => {
    await appendVehicleReference(reference()); await appendVehicleReference(reference(2, OTHER_VIN));
    expect((await readVehicleReferences(VIN)).map((value) => value.id)).toEqual([id(1)]);
    expect((await readVehicleReferences(OTHER_VIN)).map((value) => value.id)).toEqual([id(2)]);
    setActiveAccount("other"); expect(await readVehicleReferences(VIN)).toEqual([]);
    await appendVehicleReference(reference(3)); expect(db.rows.size).toBe(3);
    expect([...db.rows.keys()].sort()).toEqual([ownerKey(), ownerKey(OTHER_VIN), JSON.stringify(["other", VIN])].sort());
    expect(JSON.stringify(db.rows.get(ownerKey()))).not.toContain("confirmedFields");
  });
  it("retains exact meaningful provider strings, partial facts and decode warnings", async () => {
    const value = { ...reference(), facts: { model: "Ambiguous model / trim" }, decode: { codes: ["5", "14"], messages: [" Check digit not verified.\n\tManufacturer data incomplete. "] } };
    expect(await appendVehicleReference(value)).toEqual(value);
    expect(await readVehicleReferences(VIN)).toEqual([value]);
  });
  it("returns newest retrieval first with deterministic UUID tie ordering", async () => {
    const older = { ...reference(3), retrievedAt: "2026-11-01T12:00:00Z" };
    await appendVehicleReference(reference(2)); await appendVehicleReference(older); await appendVehicleReference(reference(1));
    expect((await readVehicleReferences(VIN)).map((value) => value.id)).toEqual([id(1), id(2), id(3)]);
  });
  it("merges simultaneous appends from the transaction's fresh history", async () => {
    const saved = await Promise.all([appendVehicleReference(reference(1)), appendVehicleReference(reference(2)), appendVehicleReference(reference(3))]);
    expect(saved.map((value) => value.id)).toEqual([id(1), id(2), id(3)]);
    expect((await readVehicleReferences(VIN)).map((value) => value.id)).toEqual([id(1), id(2), id(3)]);
  });
  it("accepts exact same-ID retry without a write and refuses changed payload", async () => {
    await appendVehicleReference(reference()); db.put.mockClear();
    expect(await appendVehicleReference(reference())).toEqual(reference()); expect(db.put).not.toHaveBeenCalled();
    await expect(appendVehicleReference({ ...reference(), facts: { model: "Changed result" } })).rejects.toThrow("conflicting content");
    await expect(appendVehicleReference({ ...reference(), query: { vin: VIN, modelYear: 2004 } })).rejects.toThrow("conflicting content");
    expect(await readVehicleReferences(VIN)).toEqual([reference()]);
  });
  it("cannot bypass immutable UUID identity by changing its letter case", async () => {
    const value = { ...reference(), id: "aaaaaaaa-0000-4000-8000-000000000001" };
    await appendVehicleReference(value);
    await expect(appendVehicleReference({ ...value, id: value.id.toUpperCase(), facts: { model: "Different payload" } })).rejects.toThrow("conflicting content");
    expect(await readVehicleReferences(VIN)).toEqual([value]);
  });
  it("does not silently evict at twenty entries and still acknowledges an exact retry", async () => {
    expect(MAX_VEHICLE_REFERENCES_PER_VIN).toBe(20);
    for (let n = 1; n <= 20; n++) await appendVehicleReference(reference(n));
    const before = structuredClone(db.rows.get(ownerKey()));
    await expect(appendVehicleReference(reference(21))).rejects.toThrow("20 saved references");
    expect(await appendVehicleReference(reference(1))).toEqual(reference(1));
    expect(db.rows.get(ownerKey())).toEqual(before); expect(await readVehicleReferences(VIN)).toHaveLength(20);
  });
  it("enforces the UTF-8 128KiB aggregate cap without truncation or eviction", async () => {
    expect(MAX_VEHICLE_REFERENCE_BUCKET_BYTES).toBe(128 * 1024);
    let accepted = 0, blocked: Error | undefined;
    for (let n = 1; n <= 20; n++) {
      const value = { ...reference(n), decode: { codes: ["5"], messages: ["界".repeat(2000), "界".repeat(2000), "界".repeat(2000)] } };
      expect(normalizeVehicleIdentityReference(value)).not.toBeNull();
      try { await appendVehicleReference(value); accepted++; } catch (error) { blocked = error as Error; break; }
    }
    expect(accepted).toBeGreaterThan(0); expect(accepted).toBeLessThan(20); expect(blocked?.message).toContain("128 KiB");
    const retained = await readVehicleReferences(VIN); expect(retained).toHaveLength(accepted);
    expect(new TextEncoder().encode(JSON.stringify(retained)).byteLength).toBeLessThanOrEqual(128 * 1024);
    expect(retained.every((value) => value.decode.messages[0] === "界".repeat(2000))).toBe(true);
  });
  it.each([null, {}, [reference(), reference()], [reference(1, OTHER_VIN)], [{ ...reference(), version: "1" }]])("refuses a corrupt or mismatched bucket and preserves its raw value: %j", async (raw) => {
    db.rows.set(ownerKey(), structuredClone(raw));
    await expect(readVehicleReferences(VIN)).rejects.toThrow("preserved");
    await expect(appendVehicleReference(reference(2))).rejects.toThrow("preserved");
    expect(db.rows.get(ownerKey())).toEqual(raw); expect(db.put).not.toHaveBeenCalled();
  });
  it("validates references and VINs before opening the database", async () => {
    await expect(readVehicleReferences("partial")).rejects.toThrow("valid VIN");
    await expect(appendVehicleReference({ ...reference(), retrievedAt: "2026-02-30T12:00:00Z" })).rejects.toThrow("not saved");
    await expect(appendVehicleReference({ ...reference(), query: { vin: VIN.toLowerCase() } })).rejects.toThrow("not saved");
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("freezes the submitted reference before awaiting storage and returns detached snapshots", async () => {
    const value = reference(); mocks.open.mockImplementationOnce(async () => { value.facts.model = "Caller changed while waiting"; return db.database; });
    const saved = await appendVehicleReference(value); expect(saved.facts.model).toBe("Accord"); saved.facts.model = "Caller changed response";
    const read = await readVehicleReferences(VIN); expect(read[0].facts.model).toBe("Accord"); read[0].decode.messages[0] = "Changed response";
    expect((await readVehicleReferences(VIN))[0].decode.messages).toEqual(reference().decode.messages);
  });
  it("blocks stale scopes before opening and after an asynchronous database open", async () => {
    const scope = getAccountScope(); setActiveAccount("other");
    await expect(appendVehicleReference(reference(), scope)).rejects.toThrow("Account changed");
    await expect(readVehicleReferences(VIN, scope)).rejects.toThrow("Account changed"); expect(mocks.open).not.toHaveBeenCalled();
    setActiveAccount("owner"); await expect(readVehicleReferences(VIN, scope)).rejects.toThrow("Account changed");
    mocks.open.mockImplementationOnce(async () => { setActiveAccount("other"); return db.database; });
    await expect(appendVehicleReference(reference())).rejects.toThrow("Account changed"); expect(db.rows.size).toBe(0); expect(db.database.close).toHaveBeenCalled();
  });
  it("rejects account changes before writing and before acknowledging a committed owner record", async () => {
    db.options.beforeGet = () => setActiveAccount("other");
    await expect(appendVehicleReference(reference())).rejects.toThrow("Account changed"); expect(db.rows.size).toBe(0);
    setActiveAccount("owner"); db.options.beforeGet = undefined; db.options.afterCommit = () => setActiveAccount("other");
    await expect(appendVehicleReference(reference())).rejects.toThrow("Account changed");
    expect(db.rows.get(ownerKey())).toEqual([reference()]); expect(db.rows.has(JSON.stringify(["other", VIN]))).toBe(false);
  });
  it("rechecks scope after the transaction promise resolves before returning private history", async () => {
    await appendVehicleReference(reference());
    db.options.afterComplete = () => setActiveAccount("other");
    await expect(readVehicleReferences(VIN)).rejects.toThrow("Account changed");
    expect(db.rows.get(ownerKey())).toEqual([reference()]);
  });
  it("preserves previous history after quota failure or a bounded storage timeout", async () => {
    await appendVehicleReference(reference()); db.options.failPut = true;
    await expect(appendVehicleReference(reference(2))).rejects.toThrow("quota"); expect(await readVehicleReferences(VIN)).toEqual([reference()]);
    vi.useFakeTimers(); db.options.hang = true;
    const pending = expect(appendVehicleReference(reference(3))).rejects.toThrow("stalled"); await vi.advanceTimersByTimeAsync(15_001); await pending;
    expect(db.rows.get(ownerKey())).toEqual([reference()]); expect(db.database.close).toHaveBeenCalled();
  });
  it("propagates blocked storage and refuses signed-out access without returning an empty history", async () => {
    mocks.open.mockRejectedValueOnce(new Error("Another tab blocks the database"));
    await expect(readVehicleReferences(VIN)).rejects.toThrow("blocks");
    mocks.open.mockClear(); setActiveAccount(null);
    await expect(readVehicleReferences(VIN)).rejects.toThrow("Account changed"); expect(mocks.open).not.toHaveBeenCalled();
  });
});
