import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import { linkComponentMapDocument } from "../lib/componentMap";
import type { Lookup } from "../types";
import type { ComponentCaptureTarget, ComponentMapRecord } from "../types/componentMap";
const mocks = vi.hoisted(() => ({ read: vi.fn(), get: vi.fn(), readMap: vi.fn(), link: vi.fn(), cloud: vi.fn() }));
vi.mock("./storage", () => ({ readLookups: mocks.read, getLookup: mocks.get }));
vi.mock("./cloudHistory", () => ({ readCloudLookupForReport: mocks.cloud }));
vi.mock("./componentMapStore", () => ({ readComponentMap: mocks.readMap, linkComponentMap: mocks.link }));
import { completeComponentCapture } from "./componentCaptureCompletion";
import { assertLinkedPhotoGuardCurrent, type LinkedPhotoSaveGuard } from "./linkedPhotoEvidence";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const image = `data:image/png;base64,${PNG}`, time = "2026-11-05T15:00:00.000Z";
const target: ComponentCaptureTarget = { mapId: "overview", componentId: "00000000-0000-4000-8000-000000000001", linkAttemptId: "00000000-0000-4000-8000-000000000002", lookupId: "scan" };
const source = { sha256: createHash("sha256").update(Buffer.from(PNG, "base64")).digest("hex"), width: 1, height: 1, photoAddedAt: time, scanSavedAt: time };
function scan(): Lookup {
  return { id: "scan", createdAt: time, frame: { imageBase64: image, capturedAt: time }, photoRelationship: "independent",
    photos: [{ id: "first", label: "close_up", imageBase64: image, capturedAt: time }, { id: "second", label: "marking", imageBase64: image, capturedAt: time }],
    errorMessage: "Original analysis failed", provenance: { captureMode: "upload", analysisSource: "ai_detection", savedAt: time }, rating: null, correction: null,
    notes: "", chatHistory: [], scanCategory: "engine", trainingLabel: "Engine", trainingStatus: "raw_unreviewed", vehicleContext: { model: "Saved car" } };
}
function record(): ComponentMapRecord {
  return { localRevision: 1, cloudRevision: null, syncedLocalRevision: 0, document: { version: 3, id: "overview", overview: { lookupId: "overview", photoId: "overview-photo", source },
    components: [{ id: target.componentId, label: "Alternator", status: "needs_view", notes: "Human note", scanGroups: [] }] } };
}

describe("recoverable component capture completion", () => {
  let local: Lookup[], map: ComponentMapRecord, afterCommit: (() => void) | undefined;
  beforeEach(() => {
    vi.clearAllMocks(); setActiveAccount("owner"); vi.stubGlobal("crypto", webcrypto); local = [scan()]; map = record(); afterCommit = undefined;
    mocks.read.mockImplementation(() => ({ ok: true, value: structuredClone(local) }));
    mocks.get.mockImplementation((id: string, values: Lookup[]) => structuredClone(values.find((value) => value.id === id) ?? null));
    mocks.readMap.mockImplementation(async () => structuredClone(map)); mocks.cloud.mockResolvedValue({ ok: true, value: null });
    mocks.link.mockImplementation(async (capture, ids, scope, prepared) => {
      const document = linkComponentMapDocument(map.document, capture, ids, prepared?.binding);
      if (prepared) assertLinkedPhotoGuardCurrent(prepared.guard, capture.lookupId, prepared.binding, scope);
      if (JSON.stringify(document) !== JSON.stringify(map.document)) map = { ...map, document, localRevision: map.localRevision + 1 };
      afterCommit?.(); return structuredClone(map);
    });
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
    vi.stubGlobal("Image", class {
      naturalWidth = 1; naturalHeight = 1; onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("links a saved AI failure once with every original and recovers the exact attempt without analysis", async () => {
    const saved = scan(); const before = structuredClone(saved);
    const first = await completeComponentCapture(target, saved);
    expect(first.document.version).toBe(4);
    expect(first.document.components[0]).toMatchObject({ status: "needs_view", notes: "Human note", scanGroups: [{ lookupId: "scan", photoIds: ["first", "second"],
      binding: { version: 1, photoRelationship: "independent", photos: [{ photoId: "first", label: "close_up", source }, { photoId: "second", label: "marking", source }] } }] });
    const second = await completeComponentCapture(target, saved);
    expect(second).toEqual(first); expect(saved).toEqual(before); expect(local[0].errorMessage).toBe("Original analysis failed");
    expect(local[0].result).toBeUndefined(); expect(fetch).not.toHaveBeenCalled();
  });

  it.each([1, 2] as const)("retains new legacy-v%s links as ID-only without inventing overview or group hashes", async (version) => {
    map.document.version = version; delete map.document.overview.source;
    const completed = await completeComponentCapture(target, scan());
    expect(completed.document.version).toBe(version);
    expect(completed.document.components[0].scanGroups[0].binding).toBeUndefined();
    expect(mocks.link.mock.calls[0][3]).toBeUndefined();
  });

  it("keeps an existing ID-only attempt unbound after its surrounding map has upgraded", async () => {
    map.document.version = 4; map.document.components[0].scanGroups.push({ linkId: target.linkAttemptId, lookupId: "scan", photoIds: ["first", "second"] });
    const before = structuredClone(map);
    expect(await completeComponentCapture(target, scan())).toEqual(before);
    expect(mocks.link.mock.calls[0][3]).toBeUndefined();
  });

  it("does not replace an existing bound attempt with different photo bytes or label history", async () => {
    await completeComponentCapture(target, scan()); const committed = structuredClone(map); mocks.link.mockClear();
    const edited = scan(); edited.photos![0].label = "other"; local = [edited];
    await expect(completeComponentCapture(target, edited)).rejects.toThrow(/different source evidence/);
    expect(map).toEqual(committed); expect(mocks.link).not.toHaveBeenCalled();
  });

  it.each(["delete", "relationship", "vehicle", "account", "cancel"])("keeps the committed link but rejects retirement after %s at commit", async (kind) => {
    const saved = scan(), controller = new AbortController(), scope = getAccountScope();
    afterCommit = () => {
      if (kind === "delete") local = [];
      else if (kind === "relationship") local[0].photoRelationship = "unknown";
      else if (kind === "vehicle") local[0].vehicleContext = { model: "Different car" };
      else if (kind === "account") setActiveAccount("other");
      else controller.abort();
    };
    await expect(completeComponentCapture(target, saved, scope, controller.signal)).rejects.toThrow();
    expect(map.document.components[0].scanGroups).toHaveLength(1);
    expect(map.document.components[0].scanGroups[0].binding?.photos).toHaveLength(2);
  });

  it("rejects source/target/missing-component errors before mutation", async () => {
    local = []; await expect(completeComponentCapture(target, scan())).rejects.toThrow(/changed/); expect(mocks.link).not.toHaveBeenCalled();
    local = [scan()]; await expect(completeComponentCapture({ ...target, lookupId: "other" }, scan())).rejects.toThrow(/does not match/);
    map.document.components = []; await expect(completeComponentCapture(target, scan())).rejects.toThrow(/removed/);
    expect(mocks.link).not.toHaveBeenCalled();
  });

  it("retains recovery after a failed write and rejects a false acknowledgement", async () => {
    mocks.link.mockRejectedValueOnce(new Error("Storage interrupted"));
    await expect(completeComponentCapture(target, scan())).rejects.toThrow("Storage interrupted");
    expect(map.document.components[0].scanGroups).toHaveLength(0);
    const done = await completeComponentCapture(target, scan()); expect(done.document.components[0].scanGroups).toHaveLength(1);
    mocks.link.mockResolvedValueOnce(record());
    await expect(completeComponentCapture(target, scan())).rejects.toThrow(/not confirmed saved/);
    expect(map.document.components[0].scanGroups).toHaveLength(1);
  });

  it("passes the issued guard unchanged into the store and uses the original account scope", async () => {
    const scope = getAccountScope(); await completeComponentCapture(target, scan(), scope);
    const prepared = mocks.link.mock.calls[0][3] as { guard: LinkedPhotoSaveGuard };
    expect(mocks.link.mock.calls[0][2]).toBe(scope);
    expect(() => assertLinkedPhotoGuardCurrent(prepared.guard, "scan", prepared.guard.binding, scope)).not.toThrow();
  });
});
