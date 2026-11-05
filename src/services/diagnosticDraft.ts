import { isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { normalizeComparisonSide, normalizeComparisonTimestamp } from "../lib/inspectionComparison";
import type { DiagnosticAssociation, DiagnosticDocument } from "../types/diagnosticReport";
import { DIAGNOSTIC_DRAFT_STORE, EVIDENCE_STORAGE_TIMEOUT_MS, openEvidenceDatabase } from "./evidenceDb";

export type DiagnosticDraft = { version: 1; updatedAt: string; photoIds: string[]; record: DiagnosticAssociation };
export type DiagnosticDraftRead = { ok: boolean; raw: string | null; draft: DiagnosticDraft | null; message: string };
export type DiagnosticDraftWrite = { ok: true; raw: string | null } | { ok: false; message: string };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const validId = (v: unknown, max = 160): v is string => typeof v === "string" && v.length <= max && /^[A-Za-z0-9._:-]+$/.test(v) && v !== "." && v !== "..";
const failure = "Diagnostic draft storage is unavailable. Your entered fields remain here; download a copy before leaving.";
const changed = "Account changed. Reopen this scan in the original account to recover its diagnostic draft.";

export function newDiagnosticDraft(lookupId: string, document?: DiagnosticDocument): DiagnosticDraft {
  const now = new Date().toISOString();
  return { version: 1, updatedAt: now, photoIds: [], record: { version: 1, id: crypto.randomUUID(), lookupId, documentId: document?.id ?? "", sourceSha256: document?.sha256 ?? "",
    recordedAt: now, subject: "", entryIds: [], photos: [], vehicleRelationship: "unconfirmed", basis: "", notes: "" } };
}
export function correctionDiagnosticDraft(record: DiagnosticAssociation): DiagnosticDraft {
  const draft = newDiagnosticDraft(record.lookupId);
  return { ...draft, photoIds: record.photos.map((photo) => photo.photoId), record: { ...structuredClone(record), id: draft.record.id,
    recordedAt: draft.record.recordedAt, supersedesId: record.id, correctionReason: "" } };
}

/** Retains incomplete raw form text; saving the association has stricter rules. */
export function parseDiagnosticDraft(raw: string): DiagnosticDraft | null {
  if (raw.length > 100_000 || new TextEncoder().encode(raw).byteLength > 100_000) return null;
  try {
    const value = JSON.parse(raw) as DiagnosticDraft, r = value?.record;
    const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
    if (value?.version !== 1 || !r || r.version !== 1 || !uuid(r.id) || !validId(r.lookupId)
      || !normalizeComparisonTimestamp(value.updatedAt) || !normalizeComparisonTimestamp(r.recordedAt)
      || !Array.isArray(value.photoIds) || value.photoIds.length > 4 || !value.photoIds.every((id) => validId(id, 80)) || new Set(value.photoIds).size !== value.photoIds.length
      || !(r.documentId === "" || uuid(r.documentId)) || !(r.sourceSha256 === "" || (typeof r.sourceSha256 === "string" && /^[a-f0-9]{64}$/i.test(r.sourceSha256)))
      || (r.documentId === "") !== (r.sourceSha256 === "")
      || !text(r.subject, 200) || !text(r.basis, 1000) || !text(r.notes, 4000)
      || !["unconfirmed", "same_vehicle", "different_vehicle"].includes(r.vehicleRelationship)
      || !Array.isArray(r.entryIds) || r.entryIds.length > 100 || !r.entryIds.every((id) => typeof id === "string" && /^(controller|fault|frame|reading)-[1-9][0-9]{0,4}$/.test(id)) || new Set(r.entryIds).size !== r.entryIds.length
      || !Array.isArray(r.photos) || r.photos.length > 4
      || (r.supersedesId !== undefined && (!uuid(r.supersedesId) || r.supersedesId.toLowerCase() === r.id.toLowerCase()))
      || (r.supersedesId === undefined ? r.correctionReason !== undefined : !text(r.correctionReason, 1000))) return null;
    const photos = r.photos.map(normalizeComparisonSide);
    if (photos.some((photo) => !photo || photo.lookupId !== r.lookupId || !value.photoIds.includes(photo.photoId)) || new Set(photos.map((photo) => photo?.photoId)).size !== photos.length) return null;
    return { version: 1, updatedAt: value.updatedAt, photoIds: [...value.photoIds], record: { version: 1, id: r.id, lookupId: r.lookupId, documentId: r.documentId, sourceSha256: r.sourceSha256,
      recordedAt: r.recordedAt, subject: r.subject, entryIds: [...r.entryIds], photos: photos as DiagnosticAssociation["photos"], vehicleRelationship: r.vehicleRelationship, basis: r.basis, notes: r.notes,
      ...(r.supersedesId === undefined ? {} : { supersedesId: r.supersedesId, correctionReason: r.correctionReason }) } };
  } catch { return null; }
}

function requireScope(scope: AccountScope, lookupId: string) {
  if (!scope.userId || !isAccountScopeCurrent(scope)) throw new Error(changed);
  if (!validId(lookupId)) throw new Error("This saved scan reference is invalid.");
}

/** Raw compare-and-replace is serialized in one transaction. Invalid strings are
 * downloadable and require an exact explicit discard; reads never delete them. */
async function transact(scope: AccountScope, lookupId: string, change?: { expected: string | null; next: string | null }): Promise<string | null> {
  requireScope(scope, lookupId);
  const db = await openEvidenceDatabase();
  try { requireScope(scope, lookupId); } catch (error) { db.close(); throw error; }
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction | undefined; let settled = false; let result: string | null = null;
    const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); db.close(); if (error) reject(error); else resolve(result); };
    const fail = (error: unknown) => { try { tx?.abort(); } catch { /* Already settled. */ } finish(error instanceof Error ? error : new Error(failure)); };
    const timer = setTimeout(() => fail(new Error("Diagnostic draft storage stalled. Download your entered text before leaving.")), EVIDENCE_STORAGE_TIMEOUT_MS);
    try {
      tx = db.transaction(DIAGNOSTIC_DRAFT_STORE, change ? "readwrite" : "readonly");
      const store = tx.objectStore(DIAGNOSTIC_DRAFT_STORE), key = [scope.userId!, lookupId], get = store.get(key);
      get.onsuccess = () => {
        try {
          requireScope(scope, lookupId); const previous: unknown = get.result === undefined ? null : get.result;
          if (previous !== null && typeof previous !== "string") throw new Error("Saved diagnostic recovery is unreadable and was not overwritten.");
          if (change && previous !== change.expected) throw new Error("Another tab changed this diagnostic draft. Your entered text is still here; download it before reopening the saved draft.");
          result = change ? change.next : previous;
          if (change) { requireScope(scope, lookupId); if (result === null) store.delete(key); else store.put(result, key); }
        } catch (error) { fail(error); }
      };
      tx.oncomplete = () => { try { requireScope(scope, lookupId); finish(); } catch (error) { finish(error as Error); } };
      tx.onerror = () => finish(new Error(failure)); tx.onabort = () => finish(new Error(failure));
    } catch (error) { fail(error); }
  });
}

export async function readDiagnosticDraft(scope: AccountScope, lookupId: string): Promise<DiagnosticDraftRead> {
  try { const raw = await transact(scope, lookupId), parsed = raw === null ? null : parseDiagnosticDraft(raw); const draft = parsed?.record.lookupId === lookupId ? parsed : null;
    return { ok: true, raw, draft, message: raw !== null && !draft ? "This diagnostic draft is unreadable. Download its recovery before explicitly discarding it." : "" };
  } catch (error) { return { ok: false, raw: null, draft: null, message: error instanceof Error ? error.message : failure }; }
}
export async function writeDiagnosticDraft(scope: AccountScope, lookupId: string, expectedRaw: string | null, draft: DiagnosticDraft | null): Promise<DiagnosticDraftWrite> {
  try { requireScope(scope, lookupId); const raw = draft === null ? null : JSON.stringify(draft);
    if (raw !== null && (!parseDiagnosticDraft(raw) || draft?.record.lookupId !== lookupId)) return { ok: false, message: "Diagnostic draft fields could not be retained safely. Download your entered text." };
    return { ok: true, raw: await transact(scope, lookupId, { expected: expectedRaw, next: raw }) };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : failure }; }
}
