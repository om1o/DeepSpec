import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPONENT_MAP_STORE, COMPARISON_DRAFT_STORE, DIAGNOSTIC_REPORT_STORE, DIAGNOSTIC_DRAFT_STORE, VEHICLE_REFERENCE_STORE, INSPECTION_COMPARISON_STORE, EVIDENCE_DATABASE_NAME, EVIDENCE_DATABASE_VERSION, EVIDENCE_STORAGE_TIMEOUT_MS, openEvidenceDatabase, PHOTO_DRAFT_STORE, SERVICE_RECORD_STORE, SERVICE_RECORD_DRAFT_STORE } from "./evidenceDb";

// These tests exercise connection/upgrade lifecycle only. Atomic storage semantics
// require the separate native IndexedDB browser checks, not this request stub.
function opening(existingStores: string[] = []) {
  const stores = new Set(existingStores);
  const database = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: vi.fn((name: string) => { stores.add(name); }),
    close: vi.fn(),
    onversionchange: null,
  } as unknown as IDBDatabase;
  const abort = vi.fn();
  const request = { result: database, transaction: { abort } } as unknown as IDBOpenDBRequest;
  const open = vi.fn(() => request);
  vi.stubGlobal("indexedDB", { open });
  return { request, database, stores, open, abort };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("shared evidence database opener", () => {
  it("upgrades version 1 without recreating or deleting the existing photo-draft store", async () => {
    const { request, database, open, stores } = opening([PHOTO_DRAFT_STORE]);
    const pending = openEvidenceDatabase();
    request.onupgradeneeded?.call(request, new Event("upgradeneeded") as IDBVersionChangeEvent);
    request.onsuccess?.call(request, new Event("success"));
    expect(await pending).toBe(database);
    expect(open).toHaveBeenCalledWith(EVIDENCE_DATABASE_NAME, EVIDENCE_DATABASE_VERSION);
    expect(database.createObjectStore).toHaveBeenCalledTimes(8);
    expect([...stores].sort()).toEqual([COMPONENT_MAP_STORE, PHOTO_DRAFT_STORE, SERVICE_RECORD_STORE, SERVICE_RECORD_DRAFT_STORE, INSPECTION_COMPARISON_STORE, COMPARISON_DRAFT_STORE, DIAGNOSTIC_REPORT_STORE, DIAGNOSTIC_DRAFT_STORE, VEHICLE_REFERENCE_STORE].sort());
    database.onversionchange?.call(database, new Event("versionchange") as IDBVersionChangeEvent);
    expect(database.close).toHaveBeenCalledTimes(1);
  });

  it("adds service records and atomic drafts when upgrading a version-two database", async () => {
    const { request, database, stores } = opening([PHOTO_DRAFT_STORE, COMPONENT_MAP_STORE]);
    const pending = openEvidenceDatabase();
    request.onupgradeneeded?.call(request, new Event("upgradeneeded") as IDBVersionChangeEvent);
    request.onsuccess?.call(request, new Event("success"));
    expect(await pending).toBe(database);
    expect(database.createObjectStore).toHaveBeenCalledTimes(7);
    expect(database.createObjectStore).toHaveBeenCalledWith(SERVICE_RECORD_STORE);
    expect(database.createObjectStore).toHaveBeenCalledWith(SERVICE_RECORD_DRAFT_STORE);
    expect(stores.size).toBe(9);
    database.close();
  });

  it("adds drafts and comparisons without recreating version-three histories", async () => {
    const { request, database, stores } = opening([PHOTO_DRAFT_STORE, COMPONENT_MAP_STORE, SERVICE_RECORD_STORE]);
    const pending = openEvidenceDatabase();
    request.onupgradeneeded?.call(request, new Event("upgradeneeded") as IDBVersionChangeEvent);
    request.onsuccess?.call(request, new Event("success"));
    expect(await pending).toBe(database);
    expect(database.createObjectStore).toHaveBeenCalledTimes(6);
    expect(database.createObjectStore).toHaveBeenCalledWith(SERVICE_RECORD_DRAFT_STORE);
    expect(stores.size).toBe(9); database.close();
  });

  it("adds later evidence stores without recreating version-four drafts and histories", async () => {
    const { request, database, stores } = opening([PHOTO_DRAFT_STORE, COMPONENT_MAP_STORE, SERVICE_RECORD_STORE, SERVICE_RECORD_DRAFT_STORE]);
    const pending = openEvidenceDatabase();
    request.onupgradeneeded?.call(request, new Event("upgradeneeded") as IDBVersionChangeEvent);
    request.onsuccess?.call(request, new Event("success"));
    expect(await pending).toBe(database); expect(database.createObjectStore).toHaveBeenCalledTimes(5);
    expect(database.createObjectStore).toHaveBeenCalledWith(INSPECTION_COMPARISON_STORE);
    expect(database.createObjectStore).toHaveBeenCalledWith(COMPARISON_DRAFT_STORE);
    expect(stores.size).toBe(9); database.close();
  });

  it("adds diagnostic and vehicle-reference stores while preserving every version-five history/draft store", async () => {
    const prior = [PHOTO_DRAFT_STORE, COMPONENT_MAP_STORE, SERVICE_RECORD_STORE, SERVICE_RECORD_DRAFT_STORE, INSPECTION_COMPARISON_STORE, COMPARISON_DRAFT_STORE];
    const { request, database, stores } = opening(prior);
    const pending = openEvidenceDatabase();
    request.onupgradeneeded?.call(request, new Event("upgradeneeded") as IDBVersionChangeEvent);
    request.onsuccess?.call(request, new Event("success"));
    expect(await pending).toBe(database); expect(EVIDENCE_DATABASE_VERSION).toBe(7);
    expect(database.createObjectStore).toHaveBeenCalledTimes(3);
    expect(database.createObjectStore).toHaveBeenCalledWith(DIAGNOSTIC_REPORT_STORE);
    expect(database.createObjectStore).toHaveBeenCalledWith(DIAGNOSTIC_DRAFT_STORE);
    for (const store of prior) expect(database.createObjectStore).not.toHaveBeenCalledWith(store);
    expect(stores.size).toBe(9); database.close();
  });

  it("adds only vehicle references when upgrading version six without recreating existing evidence", async () => {
    const prior = [PHOTO_DRAFT_STORE, COMPONENT_MAP_STORE, SERVICE_RECORD_STORE, SERVICE_RECORD_DRAFT_STORE, INSPECTION_COMPARISON_STORE, COMPARISON_DRAFT_STORE, DIAGNOSTIC_REPORT_STORE, DIAGNOSTIC_DRAFT_STORE];
    const { request, database, stores } = opening(prior);
    const pending = openEvidenceDatabase();
    request.onupgradeneeded?.call(request, new Event("upgradeneeded") as IDBVersionChangeEvent);
    request.onsuccess?.call(request, new Event("success"));
    expect(await pending).toBe(database); expect(EVIDENCE_DATABASE_VERSION).toBe(7);
    expect(database.createObjectStore).toHaveBeenCalledTimes(1);
    expect(database.createObjectStore).toHaveBeenCalledWith(VEHICLE_REFERENCE_STORE);
    for (const store of prior) expect(database.createObjectStore).not.toHaveBeenCalledWith(store);
    expect(stores.size).toBe(9); database.close();
  });

  it("creates all stores for a new account-independent database schema", async () => {
    const { request, stores } = opening();
    const pending = openEvidenceDatabase();
    request.onupgradeneeded?.call(request, new Event("upgradeneeded") as IDBVersionChangeEvent);
    request.onsuccess?.call(request, new Event("success"));
    const database = await pending;
    expect(stores.has(PHOTO_DRAFT_STORE)).toBe(true);
    expect(stores.has(COMPONENT_MAP_STORE)).toBe(true);
    expect(stores.has(SERVICE_RECORD_STORE)).toBe(true);
    expect(stores.has(SERVICE_RECORD_DRAFT_STORE)).toBe(true);
    expect(stores.has(INSPECTION_COMPARISON_STORE)).toBe(true);
    expect(stores.has(COMPARISON_DRAFT_STORE)).toBe(true);
    expect(stores.has(DIAGNOSTIC_REPORT_STORE)).toBe(true);
    expect(stores.has(DIAGNOSTIC_DRAFT_STORE)).toBe(true);
    expect(stores.has(VEHICLE_REFERENCE_STORE)).toBe(true);
    database.close();
  });

  it("rejects a blocked open and aborts a late upgrade instead of changing storage after failure", async () => {
    const { request, database, abort } = opening([PHOTO_DRAFT_STORE]);
    const assertion = expect(openEvidenceDatabase()).rejects.toThrow(/Another DeepSpec tab/);
    request.onblocked?.call(request, new Event("blocked") as IDBVersionChangeEvent);
    await assertion;
    request.onupgradeneeded?.call(request, new Event("upgradeneeded") as IDBVersionChangeEvent);
    expect(abort).toHaveBeenCalledTimes(1);
    expect(database.createObjectStore).not.toHaveBeenCalled();
    request.onsuccess?.call(request, new Event("success"));
    expect(database.close).toHaveBeenCalledTimes(1);
  });

  it("times out an unresolved open and closes a connection arriving after the caller failed", async () => {
    vi.useFakeTimers();
    const { request, database } = opening();
    const assertion = expect(openEvidenceDatabase()).rejects.toThrow(/stalled/);
    await vi.advanceTimersByTimeAsync(EVIDENCE_STORAGE_TIMEOUT_MS);
    await assertion;
    request.onsuccess?.call(request, new Event("success"));
    expect(database.close).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable IndexedDB without pretending evidence was saved", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(openEvidenceDatabase()).rejects.toThrow(/cannot save inspection evidence/);
  });
});
