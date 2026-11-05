import { webcrypto } from "node:crypto";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import { confirmVehicleContextField } from "../lib/vehicleContext";
import { normalizeServiceRecord } from "../lib/serviceRecord";
import { correctionServiceRecordDraft, newServiceRecordDraft, readServiceRecordDraft, serviceRecordContextForLookup, serviceRecordContextsMatch, serviceRecordDraftKey, serviceRecordFromDraft, writeServiceRecordDraft, type ServiceRecordContext } from "./serviceRecordDraft";
import type { Lookup } from "../types";
const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("./evidenceDb", () => ({ openEvidenceDatabase: mocks.open, SERVICE_RECORD_DRAFT_STORE: "service-record-drafts", EVIDENCE_STORAGE_TIMEOUT_MS: 15_000 }));

// Request fixture verifies app-level CAS and abort behavior. Native browser QA
// separately checks actual IndexedDB serialization across simultaneous callers.
function databaseFixture() {
  const rows = new Map<string, unknown>();
  let queue = Promise.resolve();
  let failPut = false, hang = false;
  let beforeGet: (() => void) | undefined;
  const database = { close: vi.fn(), transaction: vi.fn(() => {
    let aborted = false;
    const writes = new Map<string, unknown>();
    const tx = { oncomplete: null, onerror: null, onabort: null,
      abort: () => { aborted = true; queueMicrotask(() => tx.onabort?.()); },
      objectStore: () => ({
        get: (key: unknown) => {
          const request = { result: undefined, onsuccess: null } as { result: unknown; onsuccess: (() => void) | null };
          queue = queue.then(() => {
            if (hang || aborted) return;
            beforeGet?.(); request.result = structuredClone(rows.get(JSON.stringify(key))); request.onsuccess?.();
            if (aborted) return;
            for (const [storedKey, value] of writes) rows.set(storedKey, value);
            tx.oncomplete?.();
          });
          return request;
        },
        put: (value: unknown, key: unknown) => {
          if (failPut) throw new Error("Draft could not be kept. Download a copy before leaving.");
          writes.set(JSON.stringify(key), structuredClone(value));
        },
      }),
    } as { oncomplete: (() => void) | null; onerror: (() => void) | null; onabort: (() => void) | null; abort: () => void; objectStore: () => unknown };
    return tx;
  }) };
  return { rows, database, setFailPut: () => { failPut = true; }, setHang: () => { hang = true; }, beforeGet: (run: () => void) => { beforeGet = run; } };
}
let db: ReturnType<typeof databaseFixture>;

const context: ServiceRecordContext = { lookupId: "scan-a", analysisAttemptId: "original-analysis:One", vehicleContext: { model: "Original car", mileage: "010020", mileageUnit: "mi" }, photos: [{ id: "angle:1.a", label: "overview", capturedAt: "2026-11-05T12:00:00.000Z", fingerprint: "a".repeat(64) }] };
const lookup = (image = "data:image/png;base64,YQ=="): Lookup => ({ id: "scan-a", createdAt: "2026-11-05T12:00:00.000Z", frame: { imageBase64: image, capturedAt: "2026-11-05T12:00:00.000Z" }, analysisAttemptId: "original-analysis:One", vehicleContext: confirmVehicleContextField({ model: "Original car", mileage: "010020", mileageUnit: "mi", customerName: "PRIVATE", notes: "PRIVATE NOTES" }, "mileage", true, "2026-11-05T12:00:00.000Z"), rating: null, correction: null, notes: "", scanCategory: "engine", trainingLabel: "", trainingStatus: "raw_unreviewed", chatHistory: [], provenance: { analysisSource: "ai_detection", captureMode: "camera", savedAt: "2026-11-05T12:00:00.000Z" } });

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); setActiveAccount("draft-a"); vi.stubGlobal("crypto", webcrypto); db = databaseFixture(); mocks.open.mockResolvedValue(db.database); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it("round trips exact incomplete text, opaque analysis/photo IDs and a stable attempt", async () => {
  const draft = newServiceRecordDraft(context);
  draft.fields.reading = "  12.500e-2  "; draft.fields.notes = "  check after\n cooling  "; draft.fields.photoIds = ["angle:1.a"];
  expect(await writeServiceRecordDraft(getAccountScope(), "scan-a", null, draft)).toMatchObject({ ok: true });
  expect((await readServiceRecordDraft(getAccountScope(), "scan-a")).record).toEqual(draft);
  expect(serviceRecordFromDraft(draft)).toMatchObject({ id: draft.id, recordedAt: draft.recordedAt, reading: "  12.500e-2  ", analysisAttemptId: "original-analysis:One" });
});

it("rejects stale edit and discard without touching another tab's recovery", async () => {
  const first = newServiceRecordDraft(context); const scope = getAccountScope();
  const saved = await writeServiceRecordDraft(scope, "scan-a", null, first); expect(saved.ok).toBe(true); if (!saved.ok) return;
  const newer = { ...first, fields: { ...first.fields, notes: "Newer tab" } };
  expect((await writeServiceRecordDraft(scope, "scan-a", saved.raw, newer)).ok).toBe(true);
  expect(await writeServiceRecordDraft(scope, "scan-a", saved.raw, first)).toMatchObject({ ok: false });
  expect(await writeServiceRecordDraft(scope, "scan-a", saved.raw, null)).toMatchObject({ ok: false });
  expect((await readServiceRecordDraft(scope, "scan-a")).record).toEqual(newer);
});

it("allows exactly one concurrent CAS winner and rejects an overlapping stale clear", async () => {
  const scope = getAccountScope();
  const left = newServiceRecordDraft(context), right = newServiceRecordDraft(context);
  left.fields.notes = "Left tab"; right.fields.notes = "Right tab";
  const writes = await Promise.all([writeServiceRecordDraft(scope, "scan-a", null, left), writeServiceRecordDraft(scope, "scan-a", null, right)]);
  expect(writes.filter((write) => write.ok)).toHaveLength(1);
  const first = await readServiceRecordDraft(scope, "scan-a");
  expect(first.record).toEqual(left);
  const edited = { ...left, fields: { ...left.fields, notes: "Latest draft" } };
  const [edit, clear] = await Promise.all([writeServiceRecordDraft(scope, "scan-a", first.raw, edited), writeServiceRecordDraft(scope, "scan-a", first.raw, null)]);
  expect(edit.ok).toBe(true); expect(clear).toMatchObject({ ok: false, message: expect.stringContaining("Another tab") });
  expect((await readServiceRecordDraft(scope, "scan-a")).record).toEqual(edited);
  expect(db.database.transaction).toHaveBeenCalledWith("service-record-drafts", "readwrite");
});

it("imports legacy raw only once and exposes later legacy edits without replacing canonical recovery", async () => {
  const scope = getAccountScope(), draft = newServiceRecordDraft(context);
  const raw = JSON.stringify(draft); localStorage.setItem(serviceRecordDraftKey("scan-a"), raw);
  expect((await readServiceRecordDraft(scope, "scan-a")).raw).toBe(raw);
  localStorage.setItem(serviceRecordDraftKey("scan-a"), "older-tab-new-text");
  expect(await readServiceRecordDraft(scope, "scan-a")).toMatchObject({ raw, record: draft, legacyRaw: "older-tab-new-text" });
  expect(localStorage.getItem(serviceRecordDraftKey("scan-a"))).toBe("older-tab-new-text");
});

it("fails closed on database opening failure while retaining downloadable legacy raw", async () => {
  localStorage.setItem(serviceRecordDraftKey("scan-a"), "exact legacy recovery");
  mocks.open.mockRejectedValue(new Error("Storage unavailable"));
  expect(await readServiceRecordDraft(getAccountScope(), "scan-a")).toMatchObject({ ok: false, raw: "exact legacy recovery", record: null, message: "Storage unavailable" });
  expect((await writeServiceRecordDraft(getAccountScope(), "scan-a", "exact legacy recovery", null)).ok).toBe(false);
  expect(localStorage.getItem(serviceRecordDraftKey("scan-a"))).toBe("exact legacy recovery");
});

it("guards an account switch after open and inside the transaction without replacing its raw", async () => {
  const draft = newServiceRecordDraft(context);
  mocks.open.mockImplementationOnce(async () => { setActiveAccount("other"); return db.database; });
  expect(await writeServiceRecordDraft(getAccountScope(), "scan-a", null, draft)).toMatchObject({ ok: false, message: expect.stringContaining("Account changed") });
  expect(db.rows.size).toBe(0);
  setActiveAccount("draft-a"); db.beforeGet(() => setActiveAccount("other"));
  expect(await writeServiceRecordDraft(getAccountScope(), "scan-a", null, draft)).toMatchObject({ ok: false, message: expect.stringContaining("Account changed") });
  expect(db.rows.size).toBe(0);
});

it("aborts a hung draft transaction rather than acknowledging or clearing recovery", async () => {
  const scope = getAccountScope(), draft = newServiceRecordDraft(context);
  await writeServiceRecordDraft(scope, "scan-a", null, draft);
  vi.useFakeTimers(); db.setHang();
  const pending = writeServiceRecordDraft(scope, "scan-a", JSON.stringify(draft), null);
  await vi.advanceTimersByTimeAsync(15_001);
  expect(await pending).toMatchObject({ ok: false, message: expect.stringContaining("stalled") });
  expect(db.rows.get(JSON.stringify([scope.userId, "scan-a"]))).toBe(JSON.stringify(draft));
});

it("keeps accounts and scans isolated, including sign-out/sign-in generation", async () => {
  const scope = getAccountScope(); const draft = newServiceRecordDraft(context);
  await writeServiceRecordDraft(scope, "scan-a", null, draft);
  expect((await readServiceRecordDraft(scope, "scan-b")).record).toBeNull();
  setActiveAccount("draft-b"); expect((await readServiceRecordDraft(getAccountScope(), "scan-a")).record).toBeNull();
  const get = vi.spyOn(Storage.prototype, "getItem");
  expect((await readServiceRecordDraft(scope, "scan-a")).message).toContain("Account changed");
  expect((await writeServiceRecordDraft(scope, "scan-a", JSON.stringify(draft), null)).ok).toBe(false); expect(get).not.toHaveBeenCalled();
  setActiveAccount("draft-a"); expect((await writeServiceRecordDraft(scope, "scan-a", JSON.stringify(draft), null)).ok).toBe(false);
  expect((await readServiceRecordDraft(getAccountScope(), "scan-a")).record).toEqual(draft);
});

it("preserves corrupt legacy recovery until exact explicit discard, without deleting or resurrecting it", async () => {
  const key = serviceRecordDraftKey("scan-a"); localStorage.setItem(key, "{broken");
  expect(await readServiceRecordDraft(getAccountScope(), "scan-a")).toMatchObject({ raw: "{broken", record: null });
  expect((await writeServiceRecordDraft(getAccountScope(), "scan-a", null, newServiceRecordDraft(context))).ok).toBe(false);
  expect(await writeServiceRecordDraft(getAccountScope(), "scan-a", "{broken", null)).toEqual({ ok: true, raw: null, legacyRaw: "{broken" });
  expect(await readServiceRecordDraft(getAccountScope(), "scan-a")).toMatchObject({ raw: null, record: null, legacyRaw: "{broken" });
  expect(localStorage.getItem(key)).toBe("{broken");
  expect((await writeServiceRecordDraft(getAccountScope(), "scan-b", null, newServiceRecordDraft(context))).ok).toBe(false);
});

it("keeps the last recovery copy on storage failure without changing entered text", async () => {
  const draft = newServiceRecordDraft(context); const scope = getAccountScope(); await writeServiceRecordDraft(scope, "scan-a", null, draft);
  const edited = { ...draft, fields: { ...draft.fields, notes: "Unwritten in-memory text" } };
  db.setFailPut();
  expect(await writeServiceRecordDraft(scope, "scan-a", JSON.stringify(draft), edited)).toMatchObject({ ok: false, message: expect.stringContaining("Download") });
  expect((await readServiceRecordDraft(scope, "scan-a")).record).toEqual(draft);
  expect(edited.fields.notes).toBe("Unwritten in-memory text");
});

it("freezes photo bytes and confirmation/mileage while excluding job identities and private notes", async () => {
  const initial = await serviceRecordContextForLookup(lookup());
  expect(initial.vehicleContext).toMatchObject({ mileage: "010020", mileageUnit: "mi", confirmedFields: { mileage: expect.any(Object) } });
  expect(JSON.stringify(initial)).not.toContain("PRIVATE");
  expect(initial.photos[0].id).toBe("photo-1");
  expect(serviceRecordContextsMatch(initial, await serviceRecordContextForLookup(lookup("data:image/png;base64,Yg==")))).toBe(false);
  const other = lookup(); other.vehicleContext = { ...other.vehicleContext, mileageUnit: "km" };
  expect(serviceRecordContextsMatch(initial, await serviceRecordContextForLookup(other))).toBe(false);
});

it("treats only same configured signed asset query renewal as the same photo", async () => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://fixture.supabase.co");
  const path = "https://fixture.supabase.co/storage/v1/object/sign/scan-images/owner/scan/photo.jpg";
  const initial = await serviceRecordContextForLookup(lookup(`${path}?token=old`));
  expect(serviceRecordContextsMatch(initial, await serviceRecordContextForLookup(lookup(`${path}?token=new`)))).toBe(true);
  expect(serviceRecordContextsMatch(initial, await serviceRecordContextForLookup(lookup(`${path.replace("photo.jpg", "other.jpg")}?token=new`)))).toBe(false);
  const external = "https://other.invalid/storage/v1/object/sign/scan-images/owner/photo.jpg";
  expect(serviceRecordContextsMatch(await serviceRecordContextForLookup(lookup(`${external}?token=old`)), await serviceRecordContextForLookup(lookup(`${external}?token=new`)))).toBe(false);
});

it("corrections and retractions retain prior record context but guard current lookup separately", async () => {
  const draft = newServiceRecordDraft(context);
  Object.assign(draft.fields, { recordedBy: "A", subject: "Alternator", quantity: "Voltage", reading: "12.50", unit: "V" });
  const original = normalizeServiceRecord(serviceRecordFromDraft(draft))!;
  const current = { ...context, analysisAttemptId: "new-analysis", vehicleContext: { model: "Changed car" } };
  for (const retract of [false, true]) {
    const edit = correctionServiceRecordDraft(original, current, retract); edit.fields.correctionReason = "Correct the record";
    expect(edit.context).toEqual(current);
    expect(serviceRecordFromDraft(edit)).toMatchObject({ supersedesId: original.id, vehicleContext: original.vehicleContext, analysisAttemptId: "original-analysis:One" });
    const result = await writeServiceRecordDraft(getAccountScope(), "scan-a", null, edit); expect(result.ok).toBe(true);
    expect((await readServiceRecordDraft(getAccountScope(), "scan-a")).record).toEqual(edit);
    if (result.ok) await writeServiceRecordDraft(getAccountScope(), "scan-a", result.raw, null);
  }
});
