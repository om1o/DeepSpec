import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import type { ComponentMap, ComponentMapRecord, MapOverviewSource } from "../types/componentMap";
import type { MapOverviewSaveGuard } from "./mapOverviewEvidence";

const mocks = vi.hoisted(() => ({ open: vi.fn(), sourceGuard: vi.fn() }));
vi.mock("./evidenceDb", () => ({ openEvidenceDatabase: mocks.open, COMPONENT_MAP_STORE: "component-maps", EVIDENCE_STORAGE_TIMEOUT_MS: 15_000 }));
vi.mock("./mapOverviewEvidence", () => ({ assertMapOverviewGuardCurrent: mocks.sourceGuard }));
import { createComponentMap, linkComponentMap, readComponentMap, transactComponentMap, updateComponentMap } from "./componentMapStore";

const componentId = "00000000-0000-4000-8000-000000000001";
const linkId = "00000000-0000-4000-8000-000000000002";
const now = "2026-11-05T09:00:00.000Z";
const source = (): MapOverviewSource => ({ sha256: "a".repeat(64), width: 720, height: 420, photoAddedAt: now, scanSavedAt: now });
const document = (): ComponentMap => ({ version: 3, id: "overview", overview: { lookupId: "overview", photoId: "original", source: source() },
  components: [{ id: componentId, label: "Hose", status: "needs_view", notes: "Retain my note", scanGroups: [] }] });
const guard = (): MapOverviewSaveGuard => ({ lookupId: "overview", photoId: "original", source: source(), deviceSignature: "verified-device-source" });
const record = (): ComponentMapRecord => ({ document: document(), localRevision: 1, cloudRevision: null, syncedLocalRevision: 0 });
const key = JSON.stringify(["owner", "overview"]);

// A queued transaction fixture verifies application-level guards. Native IndexedDB
// and localStorage cross-tab timing remain separate browser acceptance checks.
function databaseFixture() {
  const rows = new Map<string, unknown>();
  let queue = Promise.resolve();
  let beforeGet: (() => void) | undefined;
  const database = { close: vi.fn(), transaction: vi.fn((_store: string, mode: string) => {
    let aborted = false;
    const writes = new Map<string, unknown>();
    const tx = { oncomplete: null, onerror: null, onabort: null,
      abort: () => { aborted = true; queueMicrotask(() => tx.onabort?.()); },
      objectStore: () => ({
        get: (storedKey: unknown) => {
          const request = { result: undefined, onsuccess: null } as { result: unknown; onsuccess: (() => void) | null };
          queue = queue.then(() => {
            beforeGet?.();
            if (aborted) return;
            request.result = structuredClone(rows.get(JSON.stringify(storedKey)));
            request.onsuccess?.();
            if (aborted) return;
            if (mode === "readwrite") for (const [entryKey, value] of writes) rows.set(entryKey, value);
            tx.oncomplete?.();
          });
          return request;
        },
        put: (value: unknown, storedKey: unknown) => writes.set(JSON.stringify(storedKey), structuredClone(value)),
      }),
    } as { oncomplete: (() => void) | null; onerror: (() => void) | null; onabort: (() => void) | null; abort: () => void; objectStore: () => unknown };
    return tx;
  }) };
  return { rows, database, beforeGet: (run: () => void) => { beforeGet = run; } };
}

describe("component-map overview binding transactions", () => {
  let db: ReturnType<typeof databaseFixture>;
  beforeEach(() => {
    vi.clearAllMocks(); mocks.sourceGuard.mockReset(); setActiveAccount("owner");
    db = databaseFixture(); mocks.open.mockResolvedValue(db.database); vi.stubGlobal("BroadcastChannel", undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("requires verification for v3 creation and editing without writing unverified data", async () => {
    await expect(createComponentMap(document())).rejects.toThrow(/Verify the saved overview/);
    expect(db.rows.size).toBe(0);
    db.rows.set(key, record());
    const edited = document(); edited.components[0].notes = "Unsaved edit";
    await expect(updateComponentMap("overview", 1, edited)).rejects.toThrow(/Verify the saved overview/);
    expect(db.rows.get(key)).toEqual(record());
  });

  it("checks the guard in the fresh transaction for create and update", async () => {
    const scope = getAccountScope(), proof = guard();
    await createComponentMap(document(), scope, proof);
    expect(mocks.sourceGuard).toHaveBeenLastCalledWith(proof, document(), scope);
    const edited = document(); edited.components[0].notes = "Saved human note";
    await updateComponentMap("overview", 1, edited, scope, proof);
    expect(mocks.sourceGuard).toHaveBeenLastCalledWith(proof, edited, scope);
    expect(mocks.sourceGuard).toHaveBeenCalledTimes(2);
    expect(await readComponentMap("overview")).toMatchObject({ localRevision: 2, document: edited });
  });

  it("retains the record when its source becomes stale before the CAS mutation", async () => {
    db.rows.set(key, record());
    db.beforeGet(() => mocks.sourceGuard.mockImplementation(() => { throw new Error("Saved source changed or was removed"); }));
    const edited = document(); edited.components[0].notes = "Keep this draft";
    await expect(updateComponentMap("overview", 1, edited, getAccountScope(), guard())).rejects.toThrow(/source changed/);
    expect(db.rows.get(key)).toEqual(record());
    expect(edited.components[0].notes).toBe("Keep this draft");
  });

  it("checks the map revision before accepting an earlier editor's verified source", async () => {
    db.rows.set(key, { ...record(), localRevision: 2 });
    await expect(updateComponentMap("overview", 1, document(), getAccountScope(), guard())).rejects.toMatchObject({ code: "stale_revision" });
    expect(mocks.sourceGuard).not.toHaveBeenCalled();
    expect(db.rows.get(key)).toMatchObject({ localRevision: 2 });
  });

  it.each(["binding", "downgrade", "photo"])("centrally rejects %s replacement through generic transaction callers", async (change) => {
    db.rows.set(key, record());
    await expect(transactComponentMap("overview", (current) => {
      const next = structuredClone(current!); next.localRevision += 1;
      if (change === "binding") next.document.overview.source!.sha256 = "b".repeat(64);
      if (change === "downgrade") { next.document.version = 2; delete next.document.overview.source; }
      if (change === "photo") next.document.overview.photoId = "replacement";
      return { record: next, result: next };
    })).rejects.toMatchObject({ code: "invalid_map" });
    expect(db.rows.get(key)).toEqual(record());
  });

  it("retains both readable conflict versions when choosing a different bound source", async () => {
    const current = record(), remote = document(); remote.overview.source!.sha256 = "b".repeat(64);
    current.conflict = { document: remote, revision: 2 }; db.rows.set(key, current);
    expect((await readComponentMap("overview"))?.conflict).toEqual(current.conflict);
    await expect(transactComponentMap("overview", (saved) => {
      const next = { ...saved!, document: saved!.conflict!.document, conflict: undefined, localRevision: 2 };
      return { record: next, result: next };
    })).rejects.toMatchObject({ code: "invalid_map" });
    expect(db.rows.get(key)).toEqual(current);
  });

  it("permits metadata acknowledgement and idempotent links while preserving the immutable source", async () => {
    db.rows.set(key, record());
    await transactComponentMap("overview", (current) => {
      const next = { ...current!, cloudRevision: 1, syncedLocalRevision: 1 };
      return { record: next, result: next };
    });
    const target = { mapId: "overview", componentId, linkAttemptId: linkId, lookupId: "detail" };
    const linked = await linkComponentMap(target, ["photo-1"]);
    expect(linked.document.overview.source).toEqual(source());
    expect(linked.document.components[0].scanGroups).toHaveLength(1);
    expect(await linkComponentMap(target, ["photo-1"])).toEqual(linked);
    expect(mocks.sourceGuard).not.toHaveBeenCalled();
  });

  it.each([1, 2] as const)("keeps legacy version %s notes editable without inventing a source", async (version) => {
    const legacy = { ...document(), version }; delete legacy.overview.source;
    const created = await createComponentMap(legacy); legacy.components[0].notes = "Legacy human note";
    const saved = await updateComponentMap("overview", created.localRevision, legacy);
    expect(saved.document.version).toBe(version); expect(saved.document.overview).not.toHaveProperty("source");
    expect(saved.document.components[0].notes).toBe("Legacy human note"); expect(mocks.sourceGuard).not.toHaveBeenCalled();
  });

  it("does not let create reuse an existing map with a different binding", async () => {
    db.rows.set(key, record()); const different = document(); different.overview.source!.sha256 = "b".repeat(64);
    await expect(createComponentMap(different, getAccountScope(), guard())).rejects.toThrow(/different source evidence/);
    expect(db.rows.get(key)).toEqual(record());
  });

  it("stops account changes before open and again at the mutation boundary", async () => {
    const scope = getAccountScope(); setActiveAccount("other");
    await expect(createComponentMap(document(), scope, guard())).rejects.toMatchObject({ code: "account_changed" });
    expect(mocks.open).not.toHaveBeenCalled();
    setActiveAccount("owner"); db.beforeGet(() => setActiveAccount("other"));
    await expect(createComponentMap(document(), getAccountScope(), guard())).rejects.toMatchObject({ code: "account_changed" });
    expect(db.rows.size).toBe(0); expect(mocks.sourceGuard).not.toHaveBeenCalled();
  });
});
