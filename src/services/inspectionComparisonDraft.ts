import { isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { comparisonSideMatches, normalizeComparisonCaptureTarget, normalizeComparisonSide } from "../lib/inspectionComparison";
import type { ComparisonSide, InspectionComparison } from "../types/inspectionComparison";
import { COMPARISON_DRAFT_STORE, EVIDENCE_STORAGE_TIMEOUT_MS, openEvidenceDatabase } from "./evidenceDb";

type DraftRecord<T extends InspectionComparison = InspectionComparison> = T extends InspectionComparison
  ? Omit<T, "earlier" | "current"> & { earlier: ComparisonSide | null; current: ComparisonSide | null } : never;
export type ComparisonDraft = {
  version: 1 | 2; updatedAt: string;
  earlierLookupId: string; earlierPhotoId: string; currentPhotoId: string;
  record: DraftRecord;
};
export type ComparisonDraftRead = { ok: boolean; raw: string | null; draft: ComparisonDraft | null; message: string };
export type ComparisonDraftWrite = { ok: true; raw: string | null } | { ok: false; message: string };
const opaque = /^[A-Za-z0-9._:-]{1,160}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validId = (value: unknown) => typeof value === "string" && opaque.test(value) && value !== "." && value !== "..";
const failure = "Comparison draft storage is unavailable. Your entered fields remain here; download a copy before leaving.";
const changed = "Account changed. Reopen this scan in the original account to recover its comparison draft.";

export function newComparisonDraft(lookupId: string, currentPhotoId: string): ComparisonDraft {
  const now = new Date().toISOString();
  return { version: 1, updatedAt: now, earlierLookupId: "", earlierPhotoId: "", currentPhotoId,
    record: { version: 1, id: crypto.randomUUID(), lookupId, recordedAt: now, subject: "", earlier: null, current: null,
      relationship: { sameVehicle: false, component: "unconfirmed", basis: "" },
      conditions: { angle: "unknown", lighting: "unknown", surfaceNotes: "" },
      observation: { outcome: "not_reviewed", notes: "" }, alignment: { rotation: 0, scale: 1, offsetX: 0, offsetY: 0 } } };
}

export function correctionComparisonDraft(record: InspectionComparison): ComparisonDraft {
  const next = newComparisonDraft(record.lookupId, record.current.photoId);
  return { ...next, version: record.version, earlierLookupId: record.earlier.lookupId, earlierPhotoId: record.earlier.photoId,
    record: { ...structuredClone(record), id: next.record.id, recordedAt: next.record.recordedAt, supersedesId: record.id, correctionReason: "" } };
}

/** Changing either original invalidates claims and display alignment for that pair. */
export function changeComparisonPair(draft: ComparisonDraft, selection: Partial<Pick<ComparisonDraft, "earlierLookupId" | "earlierPhotoId" | "currentPhotoId">>): ComparisonDraft {
  if (draft.record.version === 2) {
    if (Object.entries(selection).some(([key, value]) => value !== draft[key as keyof typeof selection])) throw new Error("Requested-photo history keeps its original and follow-up evidence fixed. Edit the reported dates and human review fields instead.");
    return draft;
  }
  return { ...draft, ...selection, record: { ...draft.record, earlier: null, current: null,
    relationship: { sameVehicle: false, component: "unconfirmed", basis: draft.record.relationship.basis },
    conditions: { angle: "unknown", lighting: "unknown", surfaceNotes: draft.record.conditions.surfaceNotes },
    observation: { outcome: "not_reviewed", notes: draft.record.observation.notes }, alignment: { rotation: 0, scale: 1, offsetX: 0, offsetY: 0 } } };
}

export function parseComparisonDraft(raw: string): ComparisonDraft | null {
  if (raw.length > 60_000) return null;
  try {
    const value = JSON.parse(raw) as ComparisonDraft; const r = value?.record;
    const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
    const oneOf = (v: unknown, values: string[]) => typeof v === "string" && values.includes(v);
    if ((value?.version !== 1 && value?.version !== 2) || !r || r.version !== value.version || !uuid.test(r.id) || !validId(r.lookupId)
      || !text(value.updatedAt, 40) || !Number.isFinite(Date.parse(value.updatedAt)) || !text(r.recordedAt, 40) || !Number.isFinite(Date.parse(r.recordedAt))
      || ![value.earlierLookupId, value.earlierPhotoId, value.currentPhotoId].every((id) => id === "" || validId(id))
      || !text(r.subject, 200) || !r.relationship || typeof r.relationship.sameVehicle !== "boolean"
      || !oneOf(r.relationship.component, ["unconfirmed", "same_part", "replacement_same_location", "different"]) || !text(r.relationship.basis, 1000)
      || !r.conditions || !oneOf(r.conditions.angle, ["similar", "different", "unknown"]) || !oneOf(r.conditions.lighting, ["similar", "different", "unknown"]) || !text(r.conditions.surfaceNotes, 2000)
      || !r.observation || !oneOf(r.observation.outcome, ["not_reviewed", "change_observed", "no_obvious_change", "inconclusive"]) || !text(r.observation.notes, 2000)
      || !r.alignment || !["rotation", "scale", "offsetX", "offsetY"].every((key) => typeof r.alignment[key as keyof typeof r.alignment] === "number" && Number.isFinite(r.alignment[key as keyof typeof r.alignment]))
      || Math.abs(r.alignment.rotation) > 180 || r.alignment.scale < .25 || r.alignment.scale > 4 || Math.abs(r.alignment.offsetX) > 1 || Math.abs(r.alignment.offsetY) > 1
      || (r.supersedesId !== undefined && (!uuid.test(r.supersedesId) || !text(r.correctionReason, 1000)))) return null;
    const earlier = r.earlier === null ? null : normalizeComparisonSide(r.earlier);
    const current = r.current === null ? null : normalizeComparisonSide(r.current);
    if (earlier === undefined || current === undefined || (earlier && (earlier.lookupId !== value.earlierLookupId || earlier.photoId !== value.earlierPhotoId))
      || (current && (current.lookupId !== r.lookupId || current.photoId !== value.currentPhotoId))) return null;
    const target = r.version === 2 ? normalizeComparisonCaptureTarget({ ...r, comparisonId: r.id, subject: r.subject.trim() || "Pending human subject" }) : undefined;
    if (r.version === 1 ? "requestedEvidence" in r || "analysisSha256" in r : !target || target.version !== 2 || !earlier || !current) return null;
    const metadata = target?.version === 2 ? { version: 2 as const, requestedEvidence: target.requestedEvidence, analysisSha256: target.analysisSha256 } : { version: 1 as const };
    return { version: value.version, updatedAt: value.updatedAt, earlierLookupId: value.earlierLookupId, earlierPhotoId: value.earlierPhotoId, currentPhotoId: value.currentPhotoId,
      record: { ...metadata, id: r.id, lookupId: r.lookupId, recordedAt: r.recordedAt, subject: r.subject, earlier, current,
        relationship: { sameVehicle: r.relationship.sameVehicle, component: r.relationship.component, basis: r.relationship.basis },
        conditions: { angle: r.conditions.angle, lighting: r.conditions.lighting, surfaceNotes: r.conditions.surfaceNotes },
        observation: { outcome: r.observation.outcome, notes: r.observation.notes },
        alignment: { rotation: r.alignment.rotation, scale: r.alignment.scale, offsetX: r.alignment.offsetX, offsetY: r.alignment.offsetY },
        ...(r.supersedesId ? { supersedesId: r.supersedesId, correctionReason: r.correctionReason } : {}) } };
  } catch { return null; }
}

function requireScope(scope: AccountScope, lookupId: string) {
  if (!scope.userId || !isAccountScopeCurrent(scope)) throw new Error(changed);
  if (!validId(lookupId)) throw new Error("This saved scan reference is invalid.");
}

/** Compare and replace are one serialized IDB transaction; stale edits never win. */
async function transact(scope: AccountScope, lookupId: string, change?: { expected: string | null; next: string | null }): Promise<string | null> {
  requireScope(scope, lookupId);
  const db = await openEvidenceDatabase();
  try { requireScope(scope, lookupId); } catch (error) { db.close(); throw error; }
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction | undefined; let settled = false; let result: string | null = null;
    const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timer); db.close(); if (error) reject(error); else resolve(result); };
    const fail = (error: unknown) => { try { tx?.abort(); } catch { /* Already settled. */ } finish(error instanceof Error ? error : new Error(failure)); };
    const timer = setTimeout(() => fail(new Error("Comparison draft storage stalled. Download your entered text before leaving.")), EVIDENCE_STORAGE_TIMEOUT_MS);
    try {
      tx = db.transaction(COMPARISON_DRAFT_STORE, change ? "readwrite" : "readonly");
      const store = tx.objectStore(COMPARISON_DRAFT_STORE); const key = [scope.userId!, lookupId]; const get = store.get(key);
      get.onsuccess = () => {
        try {
          requireScope(scope, lookupId); const previous: unknown = get.result === undefined ? null : get.result;
          if (previous !== null && typeof previous !== "string") throw new Error("Saved comparison recovery is unreadable and was not overwritten.");
          if (change && previous !== change.expected) throw new Error("Another tab changed this comparison draft. Your entered text is still here; download it before reopening the saved draft.");
          if (change?.next && previous) {
            const prior = parseComparisonDraft(previous)?.record, next = parseComparisonDraft(change.next)?.record;
            if (prior?.version === 2 && (!next || next.version !== 2 || next.id !== prior.id || next.supersedesId !== prior.supersedesId
              || next.analysisSha256 !== prior.analysisSha256 || JSON.stringify(next.requestedEvidence) !== JSON.stringify(prior.requestedEvidence)
              || !prior.earlier || !next.earlier || !comparisonSideMatches(prior.earlier, next.earlier)
              || !prior.current || !next.current || !comparisonSideMatches(prior.current, next.current))) {
              throw new Error("Requested-photo recovery keeps its saved request and source evidence fixed. Download or explicitly discard this draft before starting another comparison.");
            }
          }
          result = change ? change.next : previous;
          if (change) { requireScope(scope, lookupId); if (result === null) store.delete(key); else store.put(result, key); }
        } catch (error) { fail(error); }
      };
      tx.oncomplete = () => { try { requireScope(scope, lookupId); finish(); } catch (error) { finish(error as Error); } };
      tx.onerror = () => finish(new Error(failure)); tx.onabort = () => finish(new Error(failure));
    } catch (error) { fail(error); }
  });
}

export async function readComparisonDraft(scope: AccountScope, lookupId: string): Promise<ComparisonDraftRead> {
  try { const raw = await transact(scope, lookupId); const parsed = raw === null ? null : parseComparisonDraft(raw); const draft = parsed?.record.lookupId === lookupId ? parsed : null;
    return { ok: true, raw, draft, message: raw !== null && !draft ? "This comparison draft is unreadable. Download its recovery before explicitly discarding it." : "" };
  } catch (error) { return { ok: false, raw: null, draft: null, message: error instanceof Error ? error.message : failure }; }
}
export async function writeComparisonDraft(scope: AccountScope, lookupId: string, expectedRaw: string | null, draft: ComparisonDraft | null): Promise<ComparisonDraftWrite> {
  try { requireScope(scope, lookupId); const raw = draft === null ? null : JSON.stringify(draft);
    if (raw !== null && (!parseComparisonDraft(raw) || draft?.record.lookupId !== lookupId)) return { ok: false, message: "Comparison draft fields could not be retained safely. Download your entered text." };
    return { ok: true, raw: await transact(scope, lookupId, { expected: expectedRaw, next: raw }) };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : failure }; }
}
