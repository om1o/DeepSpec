import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import type { ComponentMap, ComponentMapRecord } from "../types/componentMap";
import type { Lookup } from "../types";
import { getAccountScope, isAccountScopeCurrent, setActiveAccount } from "../lib/accountScope";
import { normalizeComponentMapRecord } from "../lib/componentMap";

const mocks = vi.hoisted(() => ({ client: vi.fn(), read: vi.fn(), transaction: vi.fn(), lookup: vi.fn(), cloudLookup: vi.fn(), syncLookup: vi.fn() }));
vi.mock("./auth", () => ({ getAuthClient: mocks.client }));
vi.mock("./componentMapStore", () => ({ readComponentMap: mocks.read, transactComponentMap: mocks.transaction }));
vi.mock("./storage", () => ({ getLookup: mocks.lookup }));
vi.mock("./cloudHistory", () => ({ readCloudLookup: mocks.cloudLookup }));
vi.mock("./cloudSync", () => ({ syncLookupToCloud: mocks.syncLookup }));
import { loadComponentMapFromCloud, readComponentMapLookup, resolveComponentMapCloudConflict, syncComponentMapToCloud } from "./componentMapCloud";

const componentId = "11111111-1111-4111-8111-111111111111";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const OTHER_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bKkAAAAASUVORK5CYII=";
const boundImage = `data:image/png;base64,${PNG}`;
const boundSource = { sha256: createHash("sha256").update(Buffer.from(PNG, "base64")).digest("hex"), width: 1, height: 1,
  photoAddedAt: "2026-11-05T00:00:00.000Z", scanSavedAt: "2026-11-05T00:00:00.000Z" };
function document(notes = "device notes"): ComponentMap {
  return { version: 1, id: "overview", overview: { lookupId: "overview", photoId: "photo-1" }, components: [
    { id: componentId, label: "Alternator", status: "needs_view", notes, scanGroups: [] },
  ] };
}
function record(): ComponentMapRecord {
  return { document: document(), localRevision: 1, cloudRevision: null, syncedLocalRevision: 0 };
}
function lookup(id = "overview"): Lookup {
  return { id, createdAt: "2026-11-05T00:00:00Z", frame: { imageBase64: "data:image/jpeg;base64,AA==", capturedAt: "2026-11-05T00:00:00Z" },
    result: null, rating: null, correction: null, notes: "", chatHistory: [] } as unknown as Lookup;
}

describe("component-map cloud concurrency and evidence", () => {
  let current: ComponentMapRecord | null;
  let remote: { data: unknown; error: { code: string } | null };
  let write: ReturnType<typeof vi.fn>;
  let insert: ReturnType<typeof vi.fn>;
  let update: ReturnType<typeof vi.fn>;
  let filters: Array<[string, unknown]>;
  let remoteRead: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("crypto", webcrypto);
    vi.stubGlobal("Image", class {
      naturalWidth = 1; naturalHeight = 1; onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
    });
    setActiveAccount("owner");
    current = record();
    remote = { data: null, error: null };
    filters = [];
    write = vi.fn().mockResolvedValue({ data: { revision: 1 }, error: null });
    remoteRead = vi.fn(async () => remote);
    const query = (run: ReturnType<typeof vi.fn>) => {
      const chain = { eq: (column: string, value: unknown) => { filters.push([column, value]); return chain; }, select: () => chain, abortSignal: () => chain, maybeSingle: run };
      return chain;
    };
    insert = vi.fn(() => query(write));
    update = vi.fn(() => query(write));
    mocks.client.mockResolvedValue({
      auth: { getSession: async () => ({ error: null, data: { session: { user: { id: "owner", email_confirmed_at: "confirmed" } } } }) },
      from: (table: string) => { expect(table).toBe("component_maps"); return { select: () => query(remoteRead), insert, update }; },
    });
    mocks.read.mockImplementation(async () => structuredClone(current));
    mocks.transaction.mockImplementation(async (_mapId, mutate, scope) => {
      if (!isAccountScopeCurrent(scope)) throw new Error("Account changed");
      const next = mutate(structuredClone(current));
      if (next.record) {
        const normalized = normalizeComponentMapRecord(next.record);
        if (!normalized || (current && normalized.document.overview.photoId !== current.document.overview.photoId)) throw new Error("Invalid map record");
        current = normalized;
      }
      return next.result;
    });
    mocks.lookup.mockImplementation((id) => lookup(id));
    mocks.cloudLookup.mockImplementation(async (id) => ({ ok: true, value: lookup(id) }));
    mocks.syncLookup.mockResolvedValue({ ok: true, message: "saved" });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  function bindOverview() {
    current!.document.version = 3;
    current!.document.overview.source = { ...boundSource };
    const source = lookup(); source.frame.imageBase64 = boundImage;
    mocks.lookup.mockReturnValue(source);
    mocks.cloudLookup.mockResolvedValue({ ok: true, value: structuredClone(source) });
    return source;
  }

  it("writes a v3 map only after its actual cloud overview bytes match the immutable binding", async () => {
    bindOverview();
    const before = structuredClone(current!.document);
    expect(await syncComponentMapToCloud("overview", 1)).toMatchObject({ ok: true });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ document_json: before }));
    expect(current!.document).toEqual(before);
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.syncLookup).not.toHaveBeenCalled();
  });

  it.each(["changed bytes", "changed timestamp", "changed dimensions"])("does not bless %s in the cloud using a matching stale device overview", async (change) => {
    const source = bindOverview(), remote = structuredClone(source), before = structuredClone(current!.document);
    if (change === "changed bytes") remote.frame.imageBase64 = `data:image/png;base64,${OTHER_PNG}`;
    if (change === "changed timestamp") remote.frame.capturedAt = "2026-11-06T00:00:00.000Z";
    if (change === "changed dimensions") current!.document.overview.source!.width = 2;
    mocks.cloudLookup.mockResolvedValue({ ok: true, value: remote });
    expect(await syncComponentMapToCloud("overview", 1)).toMatchObject({ ok: false, message: expect.stringContaining("cloud overview image could not be verified") });
    expect(insert).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled(); expect(mocks.syncLookup).not.toHaveBeenCalled();
    expect(current?.syncAttempt).toBeUndefined(); expect(current?.cloudRevision).toBeNull();
    expect(current?.document.components).toEqual(before.components);
    expect(source.frame.imageBase64).toBe(boundImage);
  });

  it("verifies cloud bytes after a required scan upload instead of trusting its local input", async () => {
    const source = bindOverview(), remote = structuredClone(source);
    remote.frame.imageBase64 = `data:image/png;base64,${OTHER_PNG}`;
    mocks.cloudLookup.mockReset().mockResolvedValueOnce({ ok: true, value: null }).mockResolvedValueOnce({ ok: true, value: remote });
    expect(await syncComponentMapToCloud("overview", 1)).toMatchObject({ ok: false });
    expect(mocks.syncLookup).toHaveBeenCalledWith(source);
    expect(insert).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled(); expect(current?.syncAttempt).toBeUndefined();
  });

  it("rejects changed bytes fetched from the actual signed cloud object even when local bytes and IDs match", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    const source = bindOverview(), remote = structuredClone(source);
    remote.frame.imageBase64 = "https://project.supabase.co/storage/v1/object/sign/scan-images/owner/overview/original.png?token=fixture";
    mocks.cloudLookup.mockResolvedValue({ ok: true, value: remote });
    const fetch = vi.fn(async () => new Response(Uint8Array.from(Buffer.from(OTHER_PNG, "base64")), { status: 200, headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetch);
    expect(await syncComponentMapToCloud("overview", 1)).toMatchObject({ ok: false });
    expect(fetch).toHaveBeenCalledWith(remote.frame.imageBase64, expect.objectContaining({ credentials: "omit", redirect: "error", cache: "no-store" }));
    expect(mocks.lookup).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
    expect(current?.document.overview.source).toEqual(boundSource); expect(current?.syncAttempt).toBeUndefined();
  });

  it("retains the v3 device map when its exact overview photo is missing", async () => {
    bindOverview(); mocks.lookup.mockReturnValue(null);
    mocks.cloudLookup.mockResolvedValue({ ok: true, value: { ...lookup(), photos: [{ id: "another-photo", label: "overview", capturedAt: boundSource.photoAddedAt, imageBase64: boundImage }] } });
    expect(await syncComponentMapToCloud("overview", 1)).toMatchObject({ ok: false });
    expect(insert).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled(); expect(mocks.syncLookup).not.toHaveBeenCalled();
    expect(current?.document.overview.photoId).toBe("photo-1"); expect(current?.syncAttempt).toBeUndefined();
  });

  it("does not write after an account change during overview image decoding", async () => {
    bindOverview();
    vi.stubGlobal("Image", class {
      naturalWidth = 1; naturalHeight = 1; onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(value: string) { if (value) queueMicrotask(() => { setActiveAccount("other-owner"); this.onload?.(); }); }
    });
    expect(await syncComponentMapToCloud("overview", 1)).toMatchObject({ ok: false });
    expect(insert).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
    expect(current?.document.overview.source).toEqual(boundSource);
  });

  it("inserts without an observed revision and acknowledges the exact local version", async () => {
    expect(await syncComponentMapToCloud("overview", 1)).toMatchObject({ ok: true });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "owner", map_id: "overview", revision: 1 }));
    expect(update).not.toHaveBeenCalled();
    expect(current).toMatchObject({ cloudRevision: 1, localRevision: 1, syncedLocalRevision: 1 });
    expect(current?.syncAttempt).toBeUndefined();
    expect(current?.document.components[0].status).toBe("needs_view");
  });

  it("sends v2 occurrence IDs and location provenance intact and imports them without merging names", async () => {
    current!.document.version = 2;
    current!.document.components[0].label = "Hose";
    current!.document.components[0].suggestedLocation = { source: "ai_scene", text: "upper left" };
    current!.document.components.push({ ...current!.document.components[0], id: "22222222-2222-4222-8222-222222222222", suggestedLocation: { source: "ai_scene", text: "lower right" } });
    const expected = structuredClone(current!.document);
    expect(await syncComponentMapToCloud("overview", 1)).toMatchObject({ ok: true });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ document_json: expected }));
    expect(current!.document).toEqual(expected);
    current = null;
    remote = { data: { map_id: "overview", document_json: expected, revision: 3 }, error: null };
    expect(await loadComponentMapFromCloud("overview")).toMatchObject({ ok: true, value: { document: expected, cloudRevision: 3 } });
    expect(current!.document).toEqual(expected);
  });

  it("CAS-filters the independent map revision and preserves notes edited while saving", async () => {
    current = { ...record(), cloudRevision: 4, syncedLocalRevision: 1 };
    write.mockImplementation(async () => {
      current = { ...current!, document: document("newer tab notes"), localRevision: 2 };
      return { data: { revision: 5 }, error: null };
    });
    expect(await syncComponentMapToCloud("overview", 1)).toMatchObject({ ok: true, message: expect.stringContaining("Newer device edits") });
    expect(filters).toEqual(expect.arrayContaining([["user_id", "owner"], ["map_id", "overview"], ["revision", 4]]));
    expect(current).toMatchObject({ cloudRevision: 5, localRevision: 2, syncedLocalRevision: 1 });
    expect(current?.document.components[0].notes).toBe("newer tab notes");
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a stale local UI and an active cross-tab claim before uploading evidence", async () => {
    expect(await syncComponentMapToCloud("overview", 0)).toMatchObject({ ok: false });
    current!.syncAttempt = { id: componentId, localRevision: 1, startedAt: new Date().toISOString() };
    expect(await syncComponentMapToCloud("overview", 1)).toMatchObject({ ok: false, message: expect.stringContaining("still in progress") });
    expect(mocks.cloudLookup).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("preserves both documents on a cloud conflict and requires a fresh explicit resolution", async () => {
    write.mockResolvedValue({ data: null, error: { code: "23505" } });
    remote = { data: { map_id: "overview", document_json: document("other device notes"), revision: 8 }, error: null };
    expect(await syncComponentMapToCloud("overview", 1)).toMatchObject({ ok: false, message: expect.stringContaining("Both versions") });
    expect(current?.document.components[0].notes).toBe("device notes");
    expect(current?.conflict?.document.components[0].notes).toBe("other device notes");
    expect(current?.localRevision).toBe(2);
    expect(await resolveComponentMapCloudConflict("overview", 1, "cloud")).toMatchObject({ ok: false });
    expect(await resolveComponentMapCloudConflict("overview", 2, "local")).toMatchObject({ ok: true });
    expect(current).toMatchObject({ cloudRevision: 8, localRevision: 3, syncedLocalRevision: 0 });
    expect(current?.document.components[0].notes).toBe("device notes");
    expect(current?.conflict).toBeUndefined();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("adopts only the explicitly reviewed cloud document without sending a write", async () => {
    current!.conflict = { document: document("reviewed cloud"), revision: 3 };
    expect(await resolveComponentMapCloudConflict("overview", 1, "cloud")).toMatchObject({ ok: true });
    expect(current).toMatchObject({ localRevision: 2, syncedLocalRevision: 2, cloudRevision: 3 });
    expect(current?.document.components[0].notes).toBe("reviewed cloud");
    expect(write).not.toHaveBeenCalled();
  });

  it("uploads a missing referenced scan before inserting its map", async () => {
    mocks.cloudLookup.mockResolvedValueOnce({ ok: true, value: null });
    await syncComponentMapToCloud("overview", 1);
    expect(mocks.syncLookup).toHaveBeenCalledWith(expect.objectContaining({ id: "overview" }));
    expect(mocks.cloudLookup).toHaveBeenCalledTimes(2);
    expect(mocks.syncLookup.mock.invocationCallOrder[0]).toBeLessThan(insert.mock.invocationCallOrder[0]);
  });

  it("blocks a map with an unavailable original photo ID without silently dropping the link", async () => {
    current!.document.components[0].scanGroups = [{ linkId: componentId, lookupId: "detail", photoIds: ["photo-1", "photo-2"] }];
    expect(await syncComponentMapToCloud("overview", 1)).toMatchObject({ ok: false, message: expect.stringContaining("detail") });
    expect(insert).not.toHaveBeenCalled();
    expect(mocks.syncLookup).not.toHaveBeenCalled();
    expect(current?.document.components[0].scanGroups[0].photoIds).toEqual(["photo-1", "photo-2"]);
  });

  it("reports cloud evidence failure instead of claiming the map reached the cloud", async () => {
    mocks.cloudLookup.mockResolvedValue({ ok: false, message: "Photo unavailable" });
    expect(await syncComponentMapToCloud("overview", 1)).toMatchObject({ ok: false, message: expect.stringContaining("Photo unavailable") });
    expect(insert).not.toHaveBeenCalled();
    expect(current?.syncedLocalRevision).toBe(0);
    expect(current?.syncAttempt).toBeUndefined();
  });

  it("does not acknowledge into a different account after the cloud write returns", async () => {
    const scope = getAccountScope();
    write.mockImplementation(async () => { setActiveAccount("other-owner"); return { data: { revision: 1 }, error: null }; });
    expect(await syncComponentMapToCloud("overview", 1, scope)).toMatchObject({ ok: false, message: expect.stringContaining("Account changed") });
    expect(current?.cloudRevision).toBeNull();
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("does not let a late acknowledgement replace a newer attempt", async () => {
    write.mockImplementation(async () => {
      current!.syncAttempt = { id: componentId, localRevision: 1, startedAt: new Date().toISOString() };
      return { data: { revision: 1 }, error: null };
    });
    expect(await syncComponentMapToCloud("overview", 1)).toMatchObject({ ok: false });
    expect(current?.cloudRevision).toBeNull();
    expect(current?.syncAttempt?.id).toBe(componentId);
  });

  it("bounds a stalled write and preserves the unacknowledged device revision", async () => {
    vi.useFakeTimers();
    try {
      write.mockImplementation(() => new Promise(() => {}));
      const pending = syncComponentMapToCloud("overview", 1);
      await vi.advanceTimersByTimeAsync(20_001);
      expect(await pending).toMatchObject({ ok: false, message: expect.stringContaining("timed out") });
      expect(current?.cloudRevision).toBeNull();
      expect(current?.syncedLocalRevision).toBe(0);
      expect(current?.syncAttempt).toBeUndefined();
    } finally { vi.useRealTimers(); }
  });

  it("bounds a stalled referenced-photo read, clears its claim and ignores a late result", async () => {
    vi.useFakeTimers();
    try {
      let finishRead!: (result: { ok: true; value: Lookup }) => void;
      mocks.cloudLookup.mockImplementation(() => new Promise((resolve) => { finishRead = resolve; }));
      const pending = syncComponentMapToCloud("overview", 1);
      await vi.advanceTimersByTimeAsync(20_001);
      expect(await pending).toMatchObject({ ok: false, message: expect.stringContaining("timed out") });
      expect(current?.cloudRevision).toBeNull();
      expect(current?.syncAttempt).toBeUndefined();
      expect(insert).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      finishRead({ ok: true, value: lookup() });
      await vi.advanceTimersByTimeAsync(1);
      expect(insert).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(mocks.syncLookup).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("bounds a stalled session read without claiming the map or starting a write", async () => {
    vi.useFakeTimers();
    try {
      const client = await mocks.client();
      let finishSession!: (result: unknown) => void;
      client.auth.getSession = vi.fn(() => new Promise((resolve) => { finishSession = resolve; }));
      const pending = syncComponentMapToCloud("overview", 1);
      await vi.advanceTimersByTimeAsync(20_001);
      expect(await pending).toMatchObject({ ok: false, message: expect.stringContaining("timed out") });
      expect(current?.syncAttempt).toBeUndefined();
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.cloudLookup).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      finishSession({ error: null, data: { session: { user: { id: "owner", email_confirmed_at: "confirmed" } } } });
      await vi.advanceTimersByTimeAsync(1);
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("imports only if no device map appeared during the remote read", async () => {
    current = null;
    remoteRead.mockImplementation(async () => {
      current = record();
      return { data: { map_id: "overview", document_json: document("remote"), revision: 2 }, error: null };
    });
    expect(await loadComponentMapFromCloud("overview")).toMatchObject({ ok: true });
    expect(current?.document.components[0].notes).toBe("device notes");
    expect(current?.cloudRevision).toBeNull();
  });

  it("imports a valid missing map and surfaces a missing migration", async () => {
    current = null;
    remote = { data: { map_id: "overview", document_json: document("remote"), revision: 2 }, error: null };
    expect(await loadComponentMapFromCloud("overview")).toMatchObject({ ok: true, value: { localRevision: 1, cloudRevision: 2, syncedLocalRevision: 1 } });
    current = null;
    remote = { data: null, error: { code: "PGRST205" } };
    expect(await loadComponentMapFromCloud("overview")).toMatchObject({ ok: false, message: expect.stringContaining("migration") });
    expect(current).toBeNull();
  });

  it("rejects incomplete cloud documents without partially importing components", async () => {
    current = null;
    remote = { data: { map_id: "overview", document_json: { ...document(), components: [document().components[0], { id: "broken" }] }, revision: 2 }, error: null };
    expect(await loadComponentMapFromCloud("overview")).toMatchObject({ ok: false });
    expect(current).toBeNull();
  });

  it("does not overwrite current device work just to reload a cloud map", async () => {
    expect(await loadComponentMapFromCloud("overview")).toMatchObject({ ok: true });
    expect(remoteRead).not.toHaveBeenCalled();
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("refreshes expiring original URLs while preserving human notes and rejects another photo path", async () => {
    const local = lookup();
    local.notes = "new device notes";
    local.frame.imageBase64 = "https://example.supabase.co/storage/v1/object/sign/scan-images/owner/overview/photo.jpg?token=old";
    const cloud = structuredClone(local);
    cloud.notes = "older cloud notes";
    cloud.frame.imageBase64 = local.frame.imageBase64.replace("token=old", "token=fresh");
    mocks.lookup.mockReturnValue(local);
    mocks.cloudLookup.mockResolvedValue({ ok: true, value: cloud });
    expect(await readComponentMapLookup("overview")).toMatchObject({ ok: true, value: { notes: "new device notes", frame: { imageBase64: cloud.frame.imageBase64 } } });
    cloud.frame.imageBase64 = cloud.frame.imageBase64.replace("photo.jpg", "different.jpg");
    expect(await readComponentMapLookup("overview")).toMatchObject({ ok: false, message: expect.stringContaining("references changed") });
    expect(local.frame.imageBase64).toContain("token=old");
  });

  it("resolves linked scans locally first and discards a stale-account cloud read", async () => {
    expect(await readComponentMapLookup("overview")).toMatchObject({ ok: true, value: { id: "overview" } });
    expect(mocks.cloudLookup).not.toHaveBeenCalled();
    mocks.lookup.mockReturnValue(null);
    mocks.cloudLookup.mockImplementation(async () => { setActiveAccount("other-owner"); return { ok: true, value: lookup() }; });
    expect(await readComponentMapLookup("overview")).toMatchObject({ ok: false, message: expect.stringContaining("Account changed") });
  });
});
