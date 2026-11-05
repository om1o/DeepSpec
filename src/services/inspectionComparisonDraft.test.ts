import { webcrypto } from "node:crypto";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import { changeComparisonPair, correctionComparisonDraft, newComparisonDraft, parseComparisonDraft, readComparisonDraft, writeComparisonDraft } from "./inspectionComparisonDraft";
import type { InspectionComparison } from "../types/inspectionComparison";

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("./evidenceDb", () => ({ openEvidenceDatabase: mocks.open, COMPARISON_DRAFT_STORE: "comparison-drafts", EVIDENCE_STORAGE_TIMEOUT_MS: 15_000 }));

// Request fixture proves guarded CAS and abort handling. Actual cross-tab IDB
// serialization is a separate native-browser acceptance requirement.
function databaseFixture() {
  const rows = new Map<string, unknown>(); let queue = Promise.resolve();
  const options = { hang: false, failPut: false, beforeGet: undefined as (() => void) | undefined };
  const database = { close: vi.fn(), transaction: vi.fn(() => {
    let aborted = false; const writes = new Map<string, unknown>(); const deleted = new Set<string>();
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
            deleted.forEach((id) => rows.delete(id)); writes.forEach((value, id) => rows.set(id, value)); tx.oncomplete?.();
          }); return request;
        },
        put: (value: unknown, key: unknown) => { if (options.failPut) throw new DOMException("Full", "QuotaExceededError"); writes.set(JSON.stringify(key), structuredClone(value)); },
        delete: (key: unknown) => deleted.add(JSON.stringify(key)),
      }),
    }; return tx;
  }) }; return { rows, database, options };
}
let db: ReturnType<typeof databaseFixture>;
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal("crypto", webcrypto); setActiveAccount("owner"); db = databaseFixture(); mocks.open.mockResolvedValue(db.database); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("retains incomplete exact text and rejects concurrent creation, stale edit and stale discard", async () => {
  const scope = getAccountScope(); const first = newComparisonDraft("scan-current", "photo:2.a"); first.record.subject = "  Rust patch  ";
  const other = newComparisonDraft("scan-current", "photo:2.a");
  const [left, right] = await Promise.all([writeComparisonDraft(scope, "scan-current", null, first), writeComparisonDraft(scope, "scan-current", null, other)]);
  expect(left.ok).toBe(true); expect(right).toMatchObject({ ok: false, message: expect.stringContaining("Another tab") });
  if (!left.ok) throw new Error("Expected first CAS winner");
  const edited = structuredClone(first); edited.record.observation.notes = " Exact\n unfinished notes ";
  const [edit, discard] = await Promise.all([writeComparisonDraft(scope, "scan-current", left.raw, edited), writeComparisonDraft(scope, "scan-current", left.raw, null)]);
  expect(edit.ok).toBe(true); expect(discard.ok).toBe(false);
  expect((await readComparisonDraft(scope, "scan-current")).draft).toEqual(edited);
  expect(db.database.transaction).toHaveBeenCalledWith("comparison-drafts", "readwrite");
});

it("preserves corrupt recovery until an exact explicit discard", async () => {
  const scope = getAccountScope(); db.rows.set(JSON.stringify([scope.userId, "scan"]), "{broken");
  expect(await readComparisonDraft(scope, "scan")).toMatchObject({ ok: true, raw: "{broken", draft: null });
  expect((await writeComparisonDraft(scope, "scan", null, newComparisonDraft("scan", "photo-1"))).ok).toBe(false);
  expect(await writeComparisonDraft(scope, "scan", "{broken", null)).toEqual({ ok: true, raw: null });
  expect((await readComparisonDraft(scope, "scan")).raw).toBeNull();
});

it("blocks old account generations before opening and during a transaction", async () => {
  const scope = getAccountScope(); const draft = newComparisonDraft("scan", "photo-1");
  setActiveAccount("other"); expect((await writeComparisonDraft(scope, "scan", null, draft)).ok).toBe(false); expect(mocks.open).not.toHaveBeenCalled();
  setActiveAccount("owner"); expect((await readComparisonDraft(scope, "scan")).ok).toBe(false);
  const fresh = getAccountScope(); db.options.beforeGet = () => setActiveAccount("other");
  expect((await writeComparisonDraft(fresh, "scan", null, draft)).ok).toBe(false); expect(db.rows.size).toBe(0);
});

it("keeps the previous recovery on quota failure and a stalled transaction", async () => {
  const scope = getAccountScope(); const draft = newComparisonDraft("scan", "photo-1"); await writeComparisonDraft(scope, "scan", null, draft);
  const raw = JSON.stringify(draft); const edit = structuredClone(draft); edit.record.subject = "Unsaved edit";
  db.options.failPut = true; expect((await writeComparisonDraft(scope, "scan", raw, edit)).ok).toBe(false);
  expect((await readComparisonDraft(scope, "scan")).raw).toBe(raw);
  db.options.hang = true; vi.useFakeTimers(); const pending = writeComparisonDraft(scope, "scan", raw, null);
  await vi.advanceTimersByTimeAsync(15_001); expect(await pending).toMatchObject({ ok: false, message: expect.stringContaining("stalled") });
  expect(db.rows.get(JSON.stringify([scope.userId, "scan"]))).toBe(raw);
});

it("fails closed on unreadable storage, mismatched scan IDs and incomplete alignment", async () => {
  mocks.open.mockRejectedValueOnce(new Error("Blocked database")); expect((await readComparisonDraft(getAccountScope(), "scan")).ok).toBe(false);
  expect((await writeComparisonDraft(getAccountScope(), "other", null, newComparisonDraft("scan", "photo-1"))).ok).toBe(false);
  const draft = newComparisonDraft("scan", "photo-1"); expect(parseComparisonDraft(JSON.stringify({ ...draft, record: { ...draft.record, alignment: {} } }))).toBeNull();
});

it("resets claims and transforms on pair change without throwing away entered notes", () => {
  const draft = newComparisonDraft("scan", "photo-1");
  draft.record.relationship = { sameVehicle: true, component: "same_part", basis: "I own this car" };
  draft.record.observation = { outcome: "change_observed", notes: "Review this note for the new pair" };
  draft.record.conditions = { angle: "similar", lighting: "different", surfaceNotes: "Wet surface" };
  draft.record.alignment.rotation = 90;
  const next = changeComparisonPair(draft, { currentPhotoId: "photo-2" });
  expect(next.record).toMatchObject({ earlier: null, current: null, relationship: { sameVehicle: false, component: "unconfirmed" }, observation: { outcome: "not_reviewed", notes: draft.record.observation.notes }, alignment: { rotation: 0, scale: 1 } });
  expect(next.record.conditions.surfaceNotes).toBe("Wet surface"); expect(draft.record.relationship.sameVehicle).toBe(true);
});

it("creates a new correction ID while retaining the exact historical originals", () => {
  const side = { lookupId: "earlier", photoId: "photo:1.a", photoLabel: "overview" as const, photoAddedAt: "2026-11-01T12:00:00Z", scanSavedAt: "2026-11-01T12:00:00Z", sha256: "a".repeat(64), width: 40, height: 30, observedOn: null, vehicleContext: { model: "Saved vehicle" } };
  const draft = newComparisonDraft("current", "photo-1");
  const original: InspectionComparison = { ...draft.record, subject: "Rust", earlier: side, current: { ...side, lookupId: "current", photoId: "photo-1" } };
  const corrected = correctionComparisonDraft(original);
  expect(corrected.record.id).not.toBe(original.id); expect(corrected.record.supersedesId).toBe(original.id);
  expect(corrected.record.earlier).toEqual(original.earlier); expect(corrected.record.current).toEqual(original.current);
  expect(parseComparisonDraft(JSON.stringify(corrected))).toEqual(corrected);
});
