import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveAccount } from "../lib/accountScope";
import { normalizePhotoDraft, readPhotoDraftEnvelope, replacePhotoDraftEnvelopeIfMatches, upgradePhotoDraft, type PhotoDraftEnvelope } from "./photoDraft";

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("./evidenceDb", () => ({ openEvidenceDatabase: mocks.open }));

// Transaction fixture tests the production compare-and-swap path; native IndexedDB
// cross-tab serialization still requires separate browser acceptance.
function databaseFixture() {
  const rows = new Map<string, unknown>();
  let queue = Promise.resolve();
  const database = { close: vi.fn(), transaction: vi.fn(() => {
    let aborted = false;
    const writes = new Map<string, unknown>(), deleted = new Set<string>();
    const tx: { oncomplete: (() => void) | null; onerror: (() => void) | null; onabort: (() => void) | null; abort: () => void; objectStore: () => unknown } = {
      oncomplete: null, onerror: null, onabort: null,
      abort: () => { aborted = true; queueMicrotask(() => tx.onabort?.()); },
      objectStore: () => ({
        get: (key: string) => {
          const request = { result: undefined as unknown, onsuccess: null as (() => void) | null };
          queue = queue.then(() => {
            request.result = structuredClone(rows.get(key)); request.onsuccess?.();
            if (aborted) return;
            deleted.forEach((id) => rows.delete(id)); writes.forEach((value, id) => rows.set(id, value)); tx.oncomplete?.();
          });
          return request;
        },
        put: (value: unknown, key: string) => writes.set(key, structuredClone(value)),
        delete: (key: string) => deleted.add(key),
      }),
    };
    return tx;
  }) };
  return { rows, database };
}

describe("photo relationship draft compare-and-swap", () => {
  let db: ReturnType<typeof databaseFixture>;
  const draft: PhotoDraftEnvelope = { version: 6, vehicleContext: null, photoRelationship: "unknown", photos: [
    { id: "first", label: "other", capturedAt: "2026-11-05T12:00:00Z", imageBase64: "data:image/png;base64,YQ==" },
    { id: "second", label: "other", capturedAt: "2026-11-05T12:00:01Z", imageBase64: "data:image/png;base64,Yg==" },
  ] };
  beforeEach(() => {
    setActiveAccount("relationship-test"); vi.stubGlobal("indexedDB", {});
    db = databaseFixture(); mocks.open.mockReset().mockResolvedValue(db.database);
  });
  afterEach(() => { vi.unstubAllGlobals(); setActiveAccount(null); });

  it.each([2, 3, 4] as const)("upgrades legacy version %s before analysis and prevents old-format writes or discard", async (version) => {
    const common = { photos: draft.photos, target: { mapId: "overview", componentId: "00000000-0000-4000-8000-000000000001", linkAttemptId: "00000000-0000-4000-8000-000000000002", lookupId: "detail" } };
    const comparisonTarget = { version: 1 as const, comparisonId: "00000000-0000-4000-8000-000000000003", lookupId: "detail", subject: "Bracket",
      earlier: { lookupId: "previous", photoId: "first", photoLabel: "overview" as const, photoAddedAt: "2026-11-04T12:00:00Z", scanSavedAt: "2026-11-04T12:00:00Z", observedOn: null, sha256: "a".repeat(64), width: 640, height: 480 } };
    const legacy: PhotoDraftEnvelope = version === 2 ? { version, ...common }
      : version === 3 ? { version, ...common, vehicleContext: { model: "Original car" }, jobId: "job-a" }
        : { version, ...common, vehicleContext: { model: "Original car" }, jobId: "job-a", comparisonTarget };
    const key = "relationship-test:upload";
    db.rows.set(key, structuredClone(legacy));
    expect(await readPhotoDraftEnvelope()).toEqual(legacy);
    expect(await replacePhotoDraftEnvelopeIfMatches(legacy, legacy)).toBe(true);
    const protectedDraft = upgradePhotoDraft(legacy);
    expect(await readPhotoDraftEnvelope()).toEqual(protectedDraft);
    // PR138's version allow-list rejects the stored modern envelope before its
    // old CAS can relabel/delete anything. The new CAS also rejects old snapshots.
    const pr138Normalize = (value: PhotoDraftEnvelope) => [2, 3, 4].includes(value.version) ? normalizePhotoDraft(value) : null;
    expect(pr138Normalize(protectedDraft)).toBeNull();
    expect(await replacePhotoDraftEnvelopeIfMatches(legacy, null)).toBe(false);
    expect(await replacePhotoDraftEnvelopeIfMatches(legacy, { ...legacy, photos: [{ ...legacy.photos[0], label: "close_up" }, legacy.photos[1]] })).toBe(false);
    const declared = { ...protectedDraft, photoRelationship: "independent" as const };
    expect(await replacePhotoDraftEnvelopeIfMatches(protectedDraft, declared)).toBe(true);
    expect(db.rows.get(key)).toEqual(declared);
    expect(await replacePhotoDraftEnvelopeIfMatches(legacy, null)).toBe(false);
    expect(await readPhotoDraftEnvelope()).toEqual(declared);
  });

  it("keeps the winning relationship and original photos after stale edit or discard", async () => {
    expect(await replacePhotoDraftEnvelopeIfMatches(null, draft)).toBe(true);
    const changed = { ...draft, photoRelationship: "independent" as const };
    const [edit, staleDiscard] = await Promise.all([
      replacePhotoDraftEnvelopeIfMatches(draft, changed), replacePhotoDraftEnvelopeIfMatches(draft, null),
    ]);
    expect(edit).toBe(true); expect(staleDiscard).toBe(false);
    expect(await replacePhotoDraftEnvelopeIfMatches(draft, { ...draft, photoRelationship: "same_part_or_area" })).toBe(false);
    expect(await readPhotoDraftEnvelope()).toEqual(changed);
    expect((await readPhotoDraftEnvelope())?.photos).toEqual(draft.photos);
  });

  it("rejects invalid writes and preserves unreadable metadata for recovery", async () => {
    expect(await replacePhotoDraftEnvelopeIfMatches(null, draft)).toBe(true);
    const invalid = { ...draft, photoRelationship: "same_car" } as unknown as PhotoDraftEnvelope;
    await expect(replacePhotoDraftEnvelopeIfMatches(draft, invalid)).rejects.toThrow("previous draft is preserved");
    expect(await readPhotoDraftEnvelope()).toEqual(draft);
    db.rows.set("relationship-test:upload", invalid);
    await expect(readPhotoDraftEnvelope()).rejects.toThrow("kept for recovery");
    expect(await replacePhotoDraftEnvelopeIfMatches(draft, null)).toBe(false);
    expect(db.rows.get("relationship-test:upload")).toEqual(invalid);
  });
});
