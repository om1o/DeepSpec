import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { MAX_OBSERVATION_AREA_BYTES, normalizeObservationAreaDraft, normalizeObservationAreaRecords, observationAreaBindingKey, observationAreaGroups, observationAreaRecordFromDraft } from "../lib/observationArea";
import type { ObservationAreaBinding, ObservationAreaDraft, ObservationAreaRecord } from "../types/observationArea";
import { EVIDENCE_STORAGE_TIMEOUT_MS, OBSERVATION_AREA_DRAFT_STORE, OBSERVATION_AREA_STORE, openEvidenceDatabase } from "./evidenceDb";

export const OBSERVATION_AREAS_CHANGED = "deep-spec:observation-areas-changed";
const CHANNEL = "deep-spec:observation-areas";
const invalid = () => new Error("Saved observation areas are invalid or incomplete. They were preserved; keep your recovery copy and reopen the inspection.");
const staleDraft = () => new Error("Another view changed this observation-area draft. Your entered work was kept; download it before reopening the saved draft.");
function requireScope(scope: AccountScope, lookupId: string) {
  if (!isAccountScopeCurrent(scope)) throw new Error("Account changed. Reopen these observation areas in the account that owns them.");
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(lookupId) || lookupId === "." || lookupId === "..") throw new Error("This saved scan reference is invalid.");
}
function notify(lookupId: string, scope: AccountScope) {
  if (!isAccountScopeCurrent(scope)) return;
  const detail = { owner: scope.userId, lookupId };
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OBSERVATION_AREAS_CHANGED, { detail }));
  if (typeof BroadcastChannel !== "undefined") {
    try { const channel = new BroadcastChannel(CHANNEL); channel.postMessage(detail); channel.close(); }
    catch { /* A notification failure cannot undo committed evidence. */ }
  }
}
export function subscribeObservationAreas(listener: (lookupId: string) => void, scope = getAccountScope()): () => void {
  const receive = (value: unknown) => {
    if (!isAccountScopeCurrent(scope) || !value || typeof value !== "object") return;
    const change = value as { owner?: unknown; lookupId?: unknown };
    if (change.owner === scope.userId && typeof change.lookupId === "string") listener(change.lookupId);
  };
  const local = (event: Event) => receive((event as CustomEvent).detail);
  if (typeof window !== "undefined") window.addEventListener(OBSERVATION_AREAS_CHANGED, local);
  let channel: BroadcastChannel | undefined;
  if (typeof BroadcastChannel !== "undefined") {
    try { channel = new BroadcastChannel(CHANNEL); channel.onmessage = (event) => receive(event.data); }
    catch { /* Same-tab events remain available. */ }
  }
  return () => { if (typeof window !== "undefined") window.removeEventListener(OBSERVATION_AREAS_CHANGED, local); channel?.close(); };
}
type Snapshot = { history: unknown; draft: unknown };
type Mutation<T> = { result: T; records?: ObservationAreaRecord[]; raw?: string | null };
async function transact<T>(lookupId: string, scope: AccountScope, write: boolean, mutate: (current: Snapshot) => Mutation<T>): Promise<T> {
  requireScope(scope, lookupId);
  const database = await openEvidenceDatabase();
  try { requireScope(scope, lookupId); } catch (error) { database.close(); throw error; }
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction | undefined, failure: Error | undefined, result: T;
    let settled = false, changed = false;
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer); database.close();
      if (error) reject(error); else { if (changed) notify(lookupId, scope); resolve(result); }
    };
    const fail = (error: unknown) => {
      failure = error instanceof Error ? error : invalid();
      try { tx?.abort(); } catch { /* Already finished. */ } finish(failure);
    };
    const timer = setTimeout(() => fail(new Error("Observation-area storage stalled. Previous history and draft recovery were preserved; keep your entered work and retry.")), EVIDENCE_STORAGE_TIMEOUT_MS);
    try {
      tx = database.transaction([OBSERVATION_AREA_STORE, OBSERVATION_AREA_DRAFT_STORE], write ? "readwrite" : "readonly");
      const historyStore = tx.objectStore(OBSERVATION_AREA_STORE), draftStore = tx.objectStore(OBSERVATION_AREA_DRAFT_STORE), key = [scope.userId!, lookupId];
      const historyRequest = historyStore.get(key), draftRequest = draftStore.get(key);
      let remaining = 2;
      const ready = () => {
        if (--remaining) return;
        try {
          requireScope(scope, lookupId);
          const update = mutate({ history: historyRequest.result, draft: draftRequest.result });
          if (!update || typeof update !== "object" || !("result" in update) || "then" in update) throw new Error("Observation-area transactions must finish synchronously.");
          result = update.result; requireScope(scope, lookupId);
          if (update.records !== undefined) {
            if (!write || !normalizeObservationAreaRecords(update.records, lookupId)) throw invalid();
            if (JSON.stringify(update.records) !== JSON.stringify(historyRequest.result ?? [])) { historyStore.put(update.records, key); changed = true; }
          }
          if (Object.hasOwn(update, "raw")) {
            if (!write || (update.raw !== null && typeof update.raw !== "string")) throw invalid();
            if (update.raw !== (draftRequest.result ?? null)) { draftStore.put(update.raw, key); changed = true; }
          }
        } catch (error) { fail(error); }
      };
      historyRequest.onsuccess = ready; draftRequest.onsuccess = ready;
      tx.oncomplete = () => { try { requireScope(scope, lookupId); finish(); } catch (error) { finish(error as Error); } };
      tx.onerror = () => finish(failure ?? new Error("Observation areas could not be saved. Previous history and draft were preserved; free device space and retry."));
      tx.onabort = () => finish(failure ?? new Error("Observation-area storage was interrupted. Previous history and draft were preserved."));
    } catch (error) { fail(error); }
  });
}
function history(value: unknown, lookupId: string): ObservationAreaRecord[] {
  const records = normalizeObservationAreaRecords(value === undefined ? [] : value, lookupId);
  if (!records) throw invalid(); return records;
}
function rawDraft(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error("Saved area-draft recovery has an unreadable format. It was preserved and cannot be overwritten.");
  return value;
}
function parseDraft(raw: string, lookupId: string): ObservationAreaDraft | undefined {
  if (raw.length > MAX_OBSERVATION_AREA_BYTES || new TextEncoder().encode(raw).byteLength > MAX_OBSERVATION_AREA_BYTES) return undefined;
  try { return normalizeObservationAreaDraft(JSON.parse(raw), lookupId); } catch { return undefined; }
}
function draftTarget(draft: ObservationAreaDraft) {
  return JSON.stringify({ id: draft.id, lookupId: draft.lookupId, recordedAt: draft.recordedAt, binding: draft.binding, expectedHeadId: draft.expectedHeadId, kind: draft.kind });
}
function verifyBeforeCommit(guard: (binding: ObservationAreaBinding) => void, binding: ObservationAreaBinding, scope: AccountScope, lookupId: string) {
  const returned: unknown = guard(structuredClone(binding));
  if (returned && typeof returned === "object" && "then" in returned) {
    void Promise.resolve(returned).catch(() => undefined);
    throw new Error("Observation-area source verification must finish synchronously before saving.");
  }
  requireScope(scope, lookupId);
}
export function readObservationAreas(lookupId: string, scope = getAccountScope()): Promise<ObservationAreaRecord[]> {
  return transact(lookupId, scope, false, (current) => ({ result: structuredClone(history(current.history, lookupId)) }));
}
export type ObservationAreaDraftRead = { ok: boolean; raw: string | null; draft: ObservationAreaDraft | null; message: string };
export type ObservationAreaDraftWrite = { ok: true; raw: string | null } | { ok: false; message: string };
export async function readObservationAreaDraft(scope: AccountScope, lookupId: string): Promise<ObservationAreaDraftRead> {
  try {
    return await transact(lookupId, scope, false, (current) => {
      const raw = rawDraft(current.draft), draft = raw === null ? null : parseDraft(raw, lookupId) ?? null;
      return { result: { ok: true, raw, draft, message: raw !== null && !draft ? "This area draft cannot be read. Download its recovery copy before explicitly discarding it." : "" } };
    });
  } catch (error) { return { ok: false, raw: null, draft: null, message: error instanceof Error ? error.message : "Area draft recovery is unavailable." }; }
}
export async function writeObservationAreaDraft(scope: AccountScope, lookupId: string, expectedRaw: string | null, draft: ObservationAreaDraft | null): Promise<ObservationAreaDraftWrite> {
  try {
    requireScope(scope, lookupId);
    const checked = draft === null ? null : normalizeObservationAreaDraft(draft, lookupId);
    if (draft !== null && !checked) throw new Error("The area draft is invalid or exceeds its limit. Your entered work was kept.");
    const raw = checked === null ? null : JSON.stringify(checked);
    return await transact(lookupId, scope, true, (current) => {
      const previousRaw = rawDraft(current.draft); if (previousRaw !== expectedRaw) throw staleDraft();
      if (previousRaw !== null && checked) {
        const previous = parseDraft(previousRaw, lookupId);
        if (!previous || draftTarget(previous) !== draftTarget(checked)) throw new Error("An unfinished area draft cannot be replaced or moved to another claim/photo. Download or explicitly discard it first.");
      }
      return { raw, result: { ok: true as const, raw } };
    });
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : "The area draft could not be saved. Your entered work was kept." }; }
}
export type ObservationAreaCommit = { records: ObservationAreaRecord[]; record: ObservationAreaRecord; raw: null };
/** Append immutable history and retire only its matching recovery draft atomically. */
export function commitObservationAreaDraft(scope: AccountScope, lookupId: string, expectedRaw: string,
  precommitGuard: (binding: ObservationAreaBinding) => void): Promise<ObservationAreaCommit> {
  const draft = parseDraft(expectedRaw, lookupId), record = draft ? observationAreaRecordFromDraft(draft) : undefined;
  if (!draft || !record || typeof precommitGuard !== "function") return Promise.reject(new Error("Complete and save the area draft, its correction reason and source verification before applying it."));
  return transact(lookupId, scope, true, (current) => {
    const currentRaw = rawDraft(current.draft), records = history(current.history, lookupId);
    if (currentRaw !== expectedRaw && currentRaw !== null) throw staleDraft();
    const existing = records.find((entry) => entry.id === record.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(record)) throw new Error("This area entry ID has different saved content. Neither version was overwritten.");
      verifyBeforeCommit(precommitGuard, record.binding, scope, lookupId);
      return { raw: null, result: { records: structuredClone(records), record: structuredClone(existing), raw: null } };
    }
    if (currentRaw !== expectedRaw) throw staleDraft();
    const group = observationAreaGroups(records).find((g) => g.key === observationAreaBindingKey(record.binding));
    if (draft.expectedHeadId === null ? Boolean(group) : !group?.head || group.head.id !== draft.expectedHeadId) {
      throw new Error("This observation/photo area changed in another view or has conflicting corrections. Your draft was preserved; reopen the saved history before applying it.");
    }
    const merged = normalizeObservationAreaRecords([...records, record], lookupId);
    if (!merged) throw new Error("Observation-area history is invalid or exceeds 100 entries / 256 KiB. No history was truncated and your draft was kept.");
    verifyBeforeCommit(precommitGuard, record.binding, scope, lookupId);
    return { records: merged, raw: null, result: { records: structuredClone(merged), record: structuredClone(record), raw: null } };
  });
}
