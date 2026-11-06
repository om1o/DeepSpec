import { accountStorageKey, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { providerVehicleContext } from "../lib/vehicleContext";
import { MAX_SERVICE_RECORD_BYTES, normalizeServiceRecord } from "../lib/serviceRecord";
import { normalizeRequestedMeasurementReceipt } from "../lib/requestedMeasurement";
import type { Lookup, VehicleContext } from "../types";
import type { ServiceRecord, ServiceRecordKind } from "../types/serviceRecord";
import type { RequestedMeasurementReceipt } from "../types/requestedMeasurement";
import { EVIDENCE_STORAGE_TIMEOUT_MS, openEvidenceDatabase, SERVICE_RECORD_DRAFT_STORE } from "./evidenceDb";

export type ServiceRecordFields = {
  kind: ServiceRecordKind; occurredOn: string; recordedBy: string; basis: ServiceRecord["basis"]; subject: string; notes: string;
  photoIds: string[]; quantity: string; reading: string; readingState: "obtained" | "not_obtained";
  unit: string; method: string; instrument: string; conditions: string; noReadingReason: string;
  action: string; repairStatus: "planned" | "completed" | "attempted" | "unknown"; parts: string;
  check: string; outcome: "not_checked" | "symptom_observed" | "symptom_not_observed" | "inconclusive";
  relatedRecordIds: string[]; correctionReason: string;
};
export type ServiceRecordContext = {
  lookupId: string; analysisAttemptId?: string; vehicleContext: VehicleContext | null;
  photos: { id: string; label: string; capturedAt: string; fingerprint: string }[];
};
type ServiceRecordDraftBase = {
  id: string; recordedAt: string; updatedAt: string; context: ServiceRecordContext;
  fields: ServiceRecordFields; supersedesId?: string; baseRecord?: string;
};
export type ServiceRecordDraft = ServiceRecordDraftBase & (
  | { version: 1; requestedMeasurement?: never }
  | { version: 2; requestedMeasurement: RequestedMeasurementReceipt }
);
export const emptyServiceRecordFields: ServiceRecordFields = {
  kind: "measurement", occurredOn: "", recordedBy: "", basis: "personally_performed", subject: "", notes: "", photoIds: [],
  quantity: "", reading: "", readingState: "obtained", unit: "", method: "Unknown", instrument: "Unknown", conditions: "", noReadingReason: "",
  action: "", repairStatus: "unknown", parts: "", check: "", outcome: "not_checked", relatedRecordIds: [], correctionReason: "",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const photoId = /^[a-zA-Z0-9._:-]{1,80}$/;
const attemptId = /^[a-zA-Z0-9._:-]{1,160}$/;
const validOpaque = (value: string, pattern: RegExp) => pattern.test(value) && value !== "." && value !== "..";
const changed = "Account changed. Reopen this scan in the original account to recover its service draft.";
const failed = "The service draft could not be kept on this device. Download a copy before leaving.";
export const serviceRecordDraftKey = (lookupId: string) => accountStorageKey(`service-record-draft:${encodeURIComponent(lookupId)}`);

export function serviceRecordPhotos(lookup: Lookup) {
  return lookup.photos !== undefined ? lookup.photos : [{ ...lookup.frame, id: "photo-1", label: "overview" as const }];
}

function evidenceIdentity(image: string) {
  // Signed URL query changes do not change the underlying original. Only accept
  // this canonicalization for the configured storage origin and signed bucket.
  try {
    const url = new URL(image);
    const configured = new URL(import.meta.env.VITE_SUPABASE_URL ?? "");
    if (configured.protocol === "https:" && url.protocol === "https:" && url.origin === configured.origin
      && !configured.username && !configured.password && !url.username && !url.password && !url.hash
      && url.pathname.startsWith("/storage/v1/object/sign/scan-images/") && url.searchParams.has("token")) {
      return `${url.origin}${url.pathname}`;
    }
  } catch { /* Original data strings are fingerprinted without modification. */ }
  return image;
}

export async function serviceRecordContextForLookup(lookup: Lookup): Promise<ServiceRecordContext> {
  const photos = await Promise.all(serviceRecordPhotos(lookup).map(async (photo) => {
    const bytes = new TextEncoder().encode(evidenceIdentity(photo.imageBase64));
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return { id: photo.id, label: photo.label, capturedAt: photo.capturedAt,
      fingerprint: Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("") };
  }));
  return { lookupId: lookup.id, ...(lookup.analysisAttemptId && validOpaque(lookup.analysisAttemptId, attemptId) ? { analysisAttemptId: lookup.analysisAttemptId } : {}), vehicleContext: providerVehicleContext(lookup.vehicleContext) ?? null, photos };
}
export const serviceRecordContextsMatch = (left: ServiceRecordContext, right: ServiceRecordContext) => JSON.stringify(left) === JSON.stringify(right);

export function newServiceRecordDraft(context: ServiceRecordContext): ServiceRecordDraft {
  const now = new Date().toISOString();
  return { version: 1, id: crypto.randomUUID(), recordedAt: now, updatedAt: now, context, fields: { ...emptyServiceRecordFields, photoIds: [], relatedRecordIds: [] } };
}

export function requestedServiceRecordDraft(context: ServiceRecordContext, receipt: RequestedMeasurementReceipt): ServiceRecordDraft {
  const checked = normalizeRequestedMeasurementReceipt(receipt);
  if (!checked || checked.references.some((side) => side.lookupId !== context.lookupId) || !checked.guide.photoIds.every((id) => context.photos.some((photo) => photo.id === id))) throw new Error("The requested measurement references do not match this saved scan.");
  return { ...newServiceRecordDraft(context), version: 2, requestedMeasurement: checked,
    fields: { ...emptyServiceRecordFields, subject: "Requested measurement", photoIds: [...checked.guide.photoIds], relatedRecordIds: [] } };
}

export function serviceRecordFromDraft(draft: ServiceRecordDraft): unknown {
  const f = draft.fields;
  const original = originalRecord(draft);
  const vehicleContext = original ? original.vehicleContext : draft.context.vehicleContext;
  const analysisAttemptId = original ? original.analysisAttemptId : draft.context.analysisAttemptId;
  const common = { version: draft.version, ...(draft.version === 2 ? { requestedMeasurement: draft.requestedMeasurement } : {}), id: draft.id, lookupId: draft.context.lookupId, recordedAt: draft.recordedAt,
    occurredOn: f.occurredOn || null, recordedBy: f.recordedBy, basis: f.basis, subject: f.subject, photoIds: f.photoIds,
    ...(analysisAttemptId ? { analysisAttemptId } : {}),
    ...(vehicleContext ? { vehicleContext } : {}), notes: f.notes,
    ...(draft.supersedesId ? { supersedesId: draft.supersedesId, correctionReason: f.correctionReason } : {}) };
  if (f.kind === "measurement") return { ...common, kind: f.kind, quantity: f.quantity, reading: f.readingState === "obtained" ? f.reading : null, unit: f.unit, method: f.method, instrument: f.instrument, conditions: f.conditions, noReadingReason: f.readingState === "not_obtained" ? f.noReadingReason : "" };
  if (f.kind === "repair") return { ...common, kind: f.kind, action: f.action, status: f.repairStatus, parts: f.parts };
  if (f.kind === "follow_up") return { ...common, kind: f.kind, check: f.check, outcome: f.outcome, conditions: f.conditions, relatedRecordIds: f.relatedRecordIds };
  return { ...common, kind: "retraction" };
}

function originalRecord(draft: ServiceRecordDraft) {
  if (!draft.supersedesId || !draft.baseRecord) return undefined;
  try { return normalizeServiceRecord(JSON.parse(draft.baseRecord)); } catch { return undefined; }
}
export function serviceRecordDraftVehicleContext(draft: ServiceRecordDraft) {
  const original = originalRecord(draft);
  return original ? original.vehicleContext : draft.context.vehicleContext ?? undefined;
}

export function correctionServiceRecordDraft(record: ServiceRecord, context: ServiceRecordContext, retract = false): ServiceRecordDraft {
  const draft = newServiceRecordDraft(context);
  draft.supersedesId = record.id; draft.baseRecord = JSON.stringify(record);
  draft.fields = { ...draft.fields, kind: retract ? "retraction" : record.kind, occurredOn: record.occurredOn ?? "", recordedBy: record.recordedBy,
    basis: record.basis, subject: record.subject, notes: record.notes, photoIds: [...record.photoIds] };
  if (record.kind === "measurement") Object.assign(draft.fields, { quantity: record.quantity, reading: record.reading ?? "", readingState: record.reading === null ? "not_obtained" : "obtained", unit: record.unit, method: record.method, instrument: record.instrument, conditions: record.conditions, noReadingReason: record.noReadingReason });
  if (record.kind === "repair") Object.assign(draft.fields, { action: record.action, repairStatus: record.status, parts: record.parts });
  if (record.kind === "follow_up") Object.assign(draft.fields, { check: record.check, outcome: record.outcome, conditions: record.conditions, relatedRecordIds: [...record.relatedRecordIds] });
  return record.version === 2 ? { ...draft, version: 2, requestedMeasurement: record.requestedMeasurement } : draft;
}

function parseDraft(raw: string): ServiceRecordDraft | null {
  // The envelope holds a receipt plus an escaped immutable parent record.
  // Image bytes never belong here; retain valid rich metadata without truncation.
  if (raw.length > 2 * 1024 * 1024 || new TextEncoder().encode(raw).byteLength > 2 * 1024 * 1024) return null;
  try {
    const value = JSON.parse(raw) as ServiceRecordDraft;
    const c = value?.context; const f = value?.fields;
    if ((value?.version !== 1 && value?.version !== 2) || (value.version === 1 && Object.hasOwn(value, "requestedMeasurement")) || typeof value.id !== "string" || !uuid.test(value.id) || typeof value.recordedAt !== "string" || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.recordedAt)) || !Number.isFinite(Date.parse(value.updatedAt))
      || !c || typeof c.lookupId !== "string" || !validOpaque(c.lookupId, attemptId) || !f
      || (c.analysisAttemptId !== undefined && (typeof c.analysisAttemptId !== "string" || !validOpaque(c.analysisAttemptId, attemptId)))
      || !Array.isArray(c.photos) || c.photos.length > 4
      || c.photos.some((p) => !p || typeof p.id !== "string" || !validOpaque(p.id, photoId) || typeof p.label !== "string" || p.label.length > 80 || typeof p.capturedAt !== "string" || p.capturedAt.length > 80 || typeof p.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(p.fingerprint))
      || new Set(c.photos.map((p) => p.id)).size !== c.photos.length
      || !(c.vehicleContext === null || (c.vehicleContext && typeof c.vehicleContext === "object" && !Array.isArray(c.vehicleContext) && JSON.stringify(providerVehicleContext(c.vehicleContext)) === JSON.stringify(c.vehicleContext)))
      || (value.supersedesId !== undefined && (!uuid.test(value.supersedesId) || typeof value.baseRecord !== "string"
        || value.baseRecord.length > MAX_SERVICE_RECORD_BYTES || new TextEncoder().encode(value.baseRecord).byteLength > MAX_SERVICE_RECORD_BYTES))) return null;
    const original = originalRecord(value);
    if (value.supersedesId && (!original || original.id !== value.supersedesId || original.lookupId !== c.lookupId || original.version !== value.version)) return null;
    const receipt = value.version === 2 ? normalizeRequestedMeasurementReceipt(value.requestedMeasurement) : undefined;
    if (value.version === 2 && (!receipt || !["measurement", "retraction"].includes(f.kind)
      || receipt.references.some((side) => side.lookupId !== c.lookupId)
      || (original?.version === 2 ? JSON.stringify(original.requestedMeasurement) !== JSON.stringify(receipt)
        : receipt.guide.analysisAttemptId !== c.analysisAttemptId))) return null;
    for (const key of Object.keys(emptyServiceRecordFields) as (keyof ServiceRecordFields)[]) {
      if (key === "photoIds" || key === "relatedRecordIds") {
        const ids = f[key]; const max = key === "photoIds" ? 4 : 100;
        if (!Array.isArray(ids) || ids.length > max || ids.some((id) => typeof id !== "string" || !validOpaque(id, key === "photoIds" ? photoId : uuid)) || new Set(ids).size !== ids.length) return null;
      } else if (typeof f[key] !== "string" || f[key].length > 4000) return null;
    }
    if (!f.photoIds.every((id) => c.photos.some((p) => p.id === id) || (original?.version === 2 && original.photoIds.includes(id)))
      || (receipt && !receipt.guide.photoIds.every((id) => f.photoIds.includes(id)))
      || !["measurement", "repair", "follow_up", "retraction"].includes(f.kind)
      || !["personally_performed", "reported_by_another", "transcribed_document"].includes(f.basis)
      || !["obtained", "not_obtained"].includes(f.readingState)
      || !["planned", "completed", "attempted", "unknown"].includes(f.repairStatus)
      || !["not_checked", "symptom_observed", "symptom_not_observed", "inconclusive"].includes(f.outcome)) return null;
    return { ...(value.version === 2 ? { version: 2 as const, requestedMeasurement: receipt! } : { version: 1 as const }), id: value.id, recordedAt: value.recordedAt, updatedAt: value.updatedAt, context: c,
      fields: Object.fromEntries(Object.keys(emptyServiceRecordFields).map((key) => [key, f[key as keyof ServiceRecordFields]])) as ServiceRecordFields,
      ...(value.supersedesId ? { supersedesId: value.supersedesId, baseRecord: value.baseRecord } : {}) };
  } catch { return null; }
}

type DraftRaw = { raw: string | null; legacyRaw?: string };
export type ServiceRecordDraftRead = DraftRaw & { ok: boolean; record: ServiceRecordDraft | null; message: string };
export type ServiceRecordDraftWrite = ({ ok: true } & DraftRaw) | { ok: false; message: string };
const stale = "Another tab changed this service draft. Your entered text is still here; download it before reopening the saved draft.";
function requireDraftScope(scope: AccountScope, lookupId: string) {
  if (!isAccountScopeCurrent(scope)) throw new Error(changed);
  if (!validOpaque(lookupId, attemptId)) throw new Error("This saved scan reference is invalid.");
}

/** Both comparison and replacement run in the same serialized IDB transaction.
 * A stored null is a tombstone: a discarded legacy draft cannot be imported again.
 * Legacy localStorage is never removed, so an older tab's recovery stays downloadable.
 */
async function transactDraft(scope: AccountScope, lookupId: string, change?: { expectedRaw: string | null; raw: string | null; precommitGuard?: () => void }): Promise<DraftRaw> {
  requireDraftScope(scope, lookupId);
  const database = await openEvidenceDatabase();
  try { requireDraftScope(scope, lookupId); } catch (error) { database.close(); throw error; }
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction | undefined;
    let settled = false;
    let result: DraftRaw = { raw: null };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); database.close();
      if (error) reject(error); else resolve(result);
    };
    const fail = (error: unknown) => {
      try { transaction?.abort(); } catch { /* Already completed. */ }
      finish(error instanceof Error ? error : new Error(failed));
    };
    const timer = setTimeout(() => fail(new Error("Draft storage stalled. Your previous recovery is preserved; download your entered text before leaving.")), EVIDENCE_STORAGE_TIMEOUT_MS);
    try {
      transaction = database.transaction(SERVICE_RECORD_DRAFT_STORE, "readwrite");
      const store = transaction.objectStore(SERVICE_RECORD_DRAFT_STORE);
      const key = [scope.userId!, lookupId];
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          requireDraftScope(scope, lookupId);
          let legacy: string | null = null;
          try { legacy = localStorage.getItem(serviceRecordDraftKey(lookupId)); }
          catch { if (request.result === undefined) throw new Error(failed); }
          const current: unknown = request.result === undefined ? legacy : request.result;
          if (current !== null && typeof current !== "string") throw new Error("Saved draft recovery cannot be read safely. It was not overwritten; reopen the scan for recovery.");
          if (change && current !== change.expectedRaw) throw new Error(stale);
          const raw = change ? change.raw : current;
          if (change && typeof current === "string" && raw !== null) {
            const before = parseDraft(current), after = parseDraft(raw);
            if (before?.version === 2 && (!after || after.version !== 2 || before.id !== after.id
              || JSON.stringify(before.requestedMeasurement) !== JSON.stringify(after.requestedMeasurement)
              || before.baseRecord !== after.baseRecord || before.supersedesId !== after.supersedesId
              || !serviceRecordContextsMatch(before.context, after.context))) throw new Error("The requested measurement draft cannot be replaced or detached from its original request. Download or explicitly discard it first.");
          }
          requireDraftScope(scope, lookupId);
          change?.precommitGuard?.();
          requireDraftScope(scope, lookupId);
          if (request.result === undefined || raw !== current) {
            try { store.put(raw, key); } catch { throw new Error(failed); }
          }
          result = { raw, ...(legacy !== null && legacy !== raw ? { legacyRaw: legacy } : {}) };
        } catch (error) { fail(error); }
      };
      transaction.oncomplete = () => { try { requireDraftScope(scope, lookupId); finish(); } catch (error) { finish(error as Error); } };
      transaction.onerror = () => finish(new Error(failed));
      transaction.onabort = () => finish(new Error(failed));
    } catch (error) { fail(error); }
  });
}

export async function readServiceRecordDraft(scope: AccountScope, lookupId: string): Promise<ServiceRecordDraftRead> {
  try {
    const value = await transactDraft(scope, lookupId);
    requireDraftScope(scope, lookupId);
    const parsed = value.raw === null ? null : parseDraft(value.raw);
    const record = parsed?.context.lookupId === lookupId ? parsed : null;
    return { ...value, ok: true, record, message: value.raw !== null && !record ? "A service draft cannot be read. Download its recovery copy before explicitly discarding it." : "" };
  } catch (error) {
    if (!isAccountScopeCurrent(scope)) return { ok: false, raw: null, record: null, message: changed };
    // A storage failure never authorizes overwriting an unknown draft. Older raw
    // recovery remains downloadable, but restore/edit stays blocked until IDB opens.
    let raw: string | null = null;
    try { if (validOpaque(lookupId, attemptId)) raw = localStorage.getItem(serviceRecordDraftKey(lookupId)); } catch { /* No readable legacy copy. */ }
    return { ok: false, raw, record: null, message: error instanceof Error ? error.message : failed };
  }
}

export async function writeServiceRecordDraft(scope: AccountScope, lookupId: string, expectedRaw: string | null, record: ServiceRecordDraft | null, precommitGuard?: () => void): Promise<ServiceRecordDraftWrite> {
  try {
    requireDraftScope(scope, lookupId);
    const raw = record === null ? null : JSON.stringify(record);
    if (raw !== null && (!parseDraft(raw) || record?.context.lookupId !== lookupId)) return { ok: false, message: failed };
    return { ok: true, ...await transactDraft(scope, lookupId, { expectedRaw, raw, precommitGuard }) };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : failed }; }
}
