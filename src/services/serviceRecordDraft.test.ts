import { webcrypto } from "node:crypto";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import { confirmVehicleContextField, providerVehicleContext, VEHICLE_CONTEXT_FIELDS } from "../lib/vehicleContext";
import { normalizeServiceRecord } from "../lib/serviceRecord";
import { correctionServiceRecordDraft, newServiceRecordDraft, requestedServiceRecordDraft, readServiceRecordDraft, serviceRecordContextForLookup, serviceRecordContextsMatch, serviceRecordDraftKey, serviceRecordFromDraft, writeServiceRecordDraft, type ServiceRecordContext } from "./serviceRecordDraft";
import type { RequestedMeasurementReceipt } from "../types/requestedMeasurement";
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
function receipt(): RequestedMeasurementReceipt {
  return { version: 1, guide: { version: 1, kind: "measurement", request: "Measure the bracket thickness.", purpose: "Photographs cannot establish remaining thickness.", photoIds: ["angle:1.a"], analysisAttemptId: context.analysisAttemptId }, analysisSha256: "b".repeat(64),
    references: [{ lookupId: "scan-a", photoId: "angle:1.a", photoLabel: "overview", photoAddedAt: "2026-11-05T12:00:00.000Z", scanSavedAt: "2026-11-05T12:00:00.000Z", sha256: "c".repeat(64), width: 12, height: 12, observedOn: null, vehicleContext: null, analysisAttemptId: context.analysisAttemptId }] };
}

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); setActiveAccount("draft-a"); vi.stubGlobal("crypto", webcrypto); db = databaseFixture(); mocks.open.mockResolvedValue(db.database); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it("retains an exact requested-measurement receipt in a fenced incomplete draft without inventing readings", async () => {
  const draft = requestedServiceRecordDraft(context, receipt()), guard = vi.fn();
  expect(draft).toMatchObject({ version: 2, requestedMeasurement: receipt(), fields: { subject: "Requested measurement", photoIds: ["angle:1.a"], quantity: "", reading: "", unit: "" } });
  const write = await writeServiceRecordDraft(getAccountScope(), "scan-a", null, draft, guard);
  expect(write.ok).toBe(true); expect(guard).toHaveBeenCalledTimes(1);
  expect((await readServiceRecordDraft(getAccountScope(), "scan-a")).record).toEqual(draft);
  expect(serviceRecordFromDraft(draft)).toMatchObject({ version: 2, requestedMeasurement: receipt() });
});

it("checks the precommit guard for a queued write and identical no-op without altering existing recovery", async () => {
  const scope = getAccountScope(), draft = requestedServiceRecordDraft(context, receipt());
  let valid = true;
  const guard = vi.fn(() => { if (!valid) throw new Error("Saved source changed"); });
  const saved = await writeServiceRecordDraft(scope, "scan-a", null, draft, guard); expect(saved.ok).toBe(true); if (!saved.ok) return;
  db.beforeGet(() => { valid = false; });
  expect(await writeServiceRecordDraft(scope, "scan-a", saved.raw, draft, guard)).toMatchObject({ ok: false, message: "Saved source changed" });
  expect(guard).toHaveBeenCalledTimes(2);
  expect((await readServiceRecordDraft(scope, "scan-a")).raw).toBe(saved.raw);
});

it("rejects requested draft downgrade, receipt replacement and unciting a photo; explicit discard remains possible", async () => {
  const scope = getAccountScope(), draft = requestedServiceRecordDraft(context, receipt());
  const saved = await writeServiceRecordDraft(scope, "scan-a", null, draft); if (!saved.ok) throw new Error(saved.message);
  for (const replacement of [newServiceRecordDraft(context), { ...draft, requestedMeasurement: { ...receipt(), analysisSha256: "d".repeat(64) } }, { ...draft, fields: { ...draft.fields, photoIds: [] } }]) {
    expect((await writeServiceRecordDraft(scope, "scan-a", saved.raw, replacement)).ok).toBe(false);
    expect((await readServiceRecordDraft(scope, "scan-a")).raw).toBe(saved.raw);
  }
  expect((await writeServiceRecordDraft(scope, "scan-a", saved.raw, null)).ok).toBe(true);
});

it("retains but will not restore malformed or downgraded requested metadata", async () => {
  const draft = requestedServiceRecordDraft(context, receipt());
  for (const bad of [{ ...draft, version: 1 }, { ...draft, version: 3 }, { ...draft, requestedMeasurement: { ...receipt(), references: [] } }]) {
    const raw = JSON.stringify(bad); db.rows.set(JSON.stringify([getAccountScope().userId, "scan-a"]), raw);
    expect(await readServiceRecordDraft(getAccountScope(), "scan-a")).toMatchObject({ ok: true, record: null, raw });
  }
});

it("keeps historical receipt and originating analysis for corrections even when current context has no photos", async () => {
  const draft = requestedServiceRecordDraft(context, receipt());
  Object.assign(draft.fields, { recordedBy: "Pat", quantity: "Thickness", reading: "2.40", unit: "mm" });
  const original = normalizeServiceRecord(serviceRecordFromDraft(draft))!; expect(original).toBeDefined();
  const current = { ...context, analysisAttemptId: "new-analysis", photos: [] };
  const correction = correctionServiceRecordDraft(original, current); correction.fields.correctionReason = "Transcription correction";
  expect(await writeServiceRecordDraft(getAccountScope(), "scan-a", null, correction)).toMatchObject({ ok: true });
  expect((await readServiceRecordDraft(getAccountScope(), "scan-a")).record).toEqual(correction);
  expect(normalizeServiceRecord(serviceRecordFromDraft(correction))).toMatchObject({ version: 2, requestedMeasurement: receipt(), analysisAttemptId: context.analysisAttemptId });
  const retraction = correctionServiceRecordDraft(original, current, true); retraction.fields.correctionReason = "Wrong instrument";
  expect(normalizeServiceRecord(serviceRecordFromDraft(retraction))).toMatchObject({ kind: "retraction", requestedMeasurement: receipt() });
});

it("keeps explicitly empty photos empty and permits an uncited zero-photo draft", async () => {
  const empty = await serviceRecordContextForLookup({ ...lookup(), photos: [] });
  expect(empty.photos).toEqual([]);
  expect((await serviceRecordContextForLookup(lookup())).photos.map((photo) => photo.id)).toEqual(["photo-1"]);
  const uncited = { ...receipt(), guide: { ...receipt().guide, photoIds: [] }, references: [] };
  const draft = requestedServiceRecordDraft(empty, uncited);
  expect((await writeServiceRecordDraft(getAccountScope(), "scan-a", null, draft)).ok).toBe(true);
  expect((await readServiceRecordDraft(getAccountScope(), "scan-a")).record?.context.photos).toEqual([]);
});

it("durably round trips rich four-reference corrections and retractions beyond the old 25k parent limit", async () => {
  let vehicle = { year: "Year ".repeat(23).trim(), make: "Make ".repeat(23).trim(), model: "Model ".repeat(20).trim(), engine: "Engine ".repeat(17).trim(), vin: "V".repeat(120), mileage: "1".repeat(120), mileageUnit: "mi" as const, symptom: "S".repeat(500), modifications: { status: "modified" as const, details: '"'.repeat(600) } };
  for (const field of VEHICLE_CONTEXT_FIELDS) vehicle = confirmVehicleContextField(vehicle, field, true, "2026-11-05T12:00:00.000Z") as typeof vehicle;
  const richVehicle = providerVehicleContext(vehicle)!;
  const ids = ["angle:1.a", "second", "third", "fourth"];
  const current: ServiceRecordContext = { ...context, vehicleContext: richVehicle, photos: ids.map((id) => ({ ...context.photos[0], id })) };
  const richReceipt: RequestedMeasurementReceipt = { ...receipt(), guide: { ...receipt().guide, request: "R".repeat(600), purpose: "P".repeat(600), photoIds: ids },
    references: ids.map((id) => ({ ...receipt().references[0], photoId: id, vehicleContext: richVehicle })) };
  const initial = requestedServiceRecordDraft(current, richReceipt);
  Object.assign(initial.fields, { recordedBy: "Pat", quantity: "Thickness", reading: "2.50", unit: "mm", method: "M".repeat(1000), instrument: "I".repeat(200), conditions: "C".repeat(1000), notes: "N".repeat(2000) });
  const original = normalizeServiceRecord(serviceRecordFromDraft(initial));
  expect(original).toBeDefined(); expect(JSON.stringify(original).length).toBeGreaterThan(25_000);
  const scope = getAccountScope();
  for (const retract of [false, true]) {
    const corrected = correctionServiceRecordDraft(original!, current, retract); corrected.fields.correctionReason = retract ? "Wrong instrument" : "Correct recorded reading";
    const written = await writeServiceRecordDraft(scope, "scan-a", null, corrected);
    expect(written.ok).toBe(true); if (!written.ok) throw new Error(written.message);
    const recovered = await readServiceRecordDraft(scope, "scan-a");
    expect(recovered.record).toEqual(corrected);
    expect(recovered.record!.baseRecord).toBe(JSON.stringify(original));
    expect(normalizeServiceRecord(serviceRecordFromDraft(recovered.record!))).toMatchObject({ version: 2, requestedMeasurement: richReceipt, kind: retract ? "retraction" : "measurement" });
    expect((await writeServiceRecordDraft(scope, "scan-a", recovered.raw, null)).ok).toBe(true);
  }
});

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
