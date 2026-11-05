import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import type { ComponentMap, ComponentMapGroupBinding, ComponentMapRecord, MapOverviewSource } from "../types/componentMap";
import type { MapOverviewSaveGuard } from "./mapOverviewEvidence";
import type { LinkedPhotoSaveGuard } from "./linkedPhotoEvidence";

const mocks = vi.hoisted(() => ({ open: vi.fn(), sourceGuard: vi.fn(), linkedGuard: vi.fn() }));
vi.mock("./evidenceDb", () => ({ openEvidenceDatabase: mocks.open, COMPONENT_MAP_STORE: "component-maps", EVIDENCE_STORAGE_TIMEOUT_MS: 15_000 }));
vi.mock("./mapOverviewEvidence", () => ({ assertMapOverviewGuardCurrent: mocks.sourceGuard }));
vi.mock("./linkedPhotoEvidence", () => ({ assertLinkedPhotoGuardCurrent: mocks.linkedGuard }));
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
const binding = (): ComponentMapGroupBinding => ({ version: 1, photoRelationship: "independent", photos: [
  { photoId: "photo-1", label: "close_up", source: source() },
  { photoId: "photo-2", label: "marking", source: { ...source(), sha256: "b".repeat(64) } },
] });
const prepared = () => { const value = binding(); return { binding: value, guard: { lookupId: "detail", binding: value, deviceSignature: "verified-linked-source" } as LinkedPhotoSaveGuard }; };
const target = () => ({ mapId: "overview", componentId, linkAttemptId: linkId, lookupId: "detail" });

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
    vi.clearAllMocks(); mocks.sourceGuard.mockReset(); mocks.linkedGuard.mockReset(); setActiveAccount("owner");
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
    const proof = prepared(); proof.binding.photos = [proof.binding.photos[0]];
    const linked = await linkComponentMap(target, ["photo-1"], getAccountScope(), proof);
    expect(linked.document.overview.source).toEqual(source());
    expect(linked.document.components[0].scanGroups).toHaveLength(1);
    expect(await linkComponentMap(target, ["photo-1"], getAccountScope(), proof)).toEqual(linked);
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

  it("requires proof inside CAS for new and retried bound links while preserving newer notes", async () => {
    const saved = record(); saved.document.components[0].notes = "Newer note from another editor"; saved.localRevision = 3; db.rows.set(key, saved);
    await expect(linkComponentMap(target(), ["photo-1", "photo-2"])).rejects.toThrow(/Verify the saved linked photos/);
    expect(db.rows.get(key)).toEqual(saved);
    const proof = prepared(), scope = getAccountScope();
    const linked = await linkComponentMap(target(), ["photo-1", "photo-2"], scope, proof);
    expect(mocks.linkedGuard).toHaveBeenLastCalledWith(proof.guard, "detail", proof.binding, scope);
    expect(linked).toMatchObject({ localRevision: 4, document: { version: 4, overview: { source: source() }, components: [{ notes: "Newer note from another editor" }] } });
    expect(await linkComponentMap(target(), ["photo-1", "photo-2"], scope, proof)).toEqual(linked);
    expect(mocks.linkedGuard).toHaveBeenCalledTimes(2);
  });

  it("does not accept new bound groups through ordinary create or editor APIs", async () => {
    const injected = document(); injected.version = 4;
    injected.components[0].scanGroups = [{ linkId, lookupId: "detail", photoIds: ["photo-1", "photo-2"], binding: binding() }];
    await expect(createComponentMap(injected, getAccountScope(), guard())).rejects.toThrow(/verified capture-link workflow/);
    expect(db.rows.size).toBe(0); db.rows.set(key, record());
    await expect(updateComponentMap("overview", 1, injected, getAccountScope(), guard())).rejects.toThrow(/verified capture-link workflow/);
    expect(db.rows.get(key)).toEqual(record());
  });

  it("does not commit when linked source changes during transaction preparation", async () => {
    db.rows.set(key, record()); db.beforeGet(() => mocks.linkedGuard.mockImplementation(() => { throw new Error("Linked source changed"); }));
    await expect(linkComponentMap(target(), ["photo-1", "photo-2"], getAccountScope(), prepared())).rejects.toThrow(/Linked source changed/);
    expect(db.rows.get(key)).toEqual(record());
  });

  it("keeps old ID-only retries unbound without requiring or applying today's hash", async () => {
    const saved = record(); saved.document.components[0].scanGroups.push({ linkId, lookupId: "detail", photoIds: ["photo-1", "photo-2"] }); db.rows.set(key, saved);
    expect(await linkComponentMap(target(), ["photo-1", "photo-2"])).toEqual(saved);
    expect(await linkComponentMap(target(), ["photo-1", "photo-2"], getAccountScope(), prepared())).toEqual(saved);
    expect(mocks.linkedGuard).not.toHaveBeenCalled();
  });

  it.each(["remove", "move", "binding", "photo-order", "downgrade"])("protects bound history from generic %s edits and cloud choices", async (change) => {
    db.rows.set(key, record()); const saved = await linkComponentMap(target(), ["photo-1", "photo-2"], getAccountScope(), prepared());
    await expect(transactComponentMap("overview", (current) => {
      const next = structuredClone(current!); next.localRevision += 1; const group = next.document.components[0].scanGroups[0];
      if (change === "remove") next.document.components[0].scanGroups = [];
      if (change === "move") { next.document.components.push({ ...next.document.components[0], id: "00000000-0000-4000-8000-000000000003" }); next.document.components[0].scanGroups = []; }
      if (change === "binding") group.binding!.photos[0].source.sha256 = "b".repeat(64);
      if (change === "photo-order") { group.photoIds.reverse(); group.binding!.photos.reverse(); }
      if (change === "downgrade") { next.document.version = 3; delete group.binding; }
      return { record: next, result: next };
    })).rejects.toThrow();
    expect(db.rows.get(key)).toEqual(saved);
  });

  it("permits reordered lists and ordinary notes while retaining every bound association", async () => {
    db.rows.set(key, record()); await linkComponentMap(target(), ["photo-1", "photo-2"], getAccountScope(), prepared());
    const saved = await transactComponentMap("overview", (current) => {
      const next = structuredClone(current!); next.localRevision += 1;
      next.document.components.unshift({ id: "00000000-0000-4000-8000-000000000003", label: "New component", status: "needs_view", notes: "", scanGroups: [] });
      next.document.components[1].notes = "Revised human note";
      return { record: next, result: next };
    });
    expect(saved.document.components[1].scanGroups[0].binding).toEqual(binding());
    expect(saved.document.components[1].notes).toBe("Revised human note");
  });

  it("rejects ordinary legacy-link retrofit while leaving the original record intact", async () => {
    const saved = record(); saved.document.components[0].scanGroups.push({ linkId, lookupId: "detail", photoIds: ["photo-1", "photo-2"] }); db.rows.set(key, saved);
    await expect(transactComponentMap("overview", (current) => {
      const next = structuredClone(current!); next.document.version = 4; next.localRevision += 1; next.document.components[0].scanGroups[0].binding = binding();
      return { record: next, result: next };
    })).rejects.toMatchObject({ code: "link_conflict" });
    expect(db.rows.get(key)).toEqual(saved);
  });
});
