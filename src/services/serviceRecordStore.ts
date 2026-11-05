import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { mergeServiceRecords, normalizeServiceRecord, normalizeServiceRecords } from "../lib/serviceRecord";
import type { ServiceRecord } from "../types/serviceRecord";
import { EVIDENCE_STORAGE_TIMEOUT_MS, openEvidenceDatabase, SERVICE_RECORD_STORE } from "./evidenceDb";

export const SERVICE_RECORDS_CHANGED = "deep-spec:service-records-changed";
const CHANNEL = "deep-spec:service-records";
const invalid = () => new Error("Saved human records are invalid or incomplete. They were preserved; do not clear browser data. Reopen the scan for recovery.");
function requireScope(scope: AccountScope) {
  if (!isAccountScopeCurrent(scope)) throw new Error("Account changed. Reopen the scan in the account that owns these human records.");
}
function requireId(id: string) {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(id) || id === "." || id === "..") throw new Error("This saved scan reference is invalid.");
}
function notify(lookupId: string, scope: AccountScope) {
  if (!isAccountScopeCurrent(scope)) return;
  const detail = { owner: scope.userId, lookupId };
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SERVICE_RECORDS_CHANGED, { detail }));
  if (typeof BroadcastChannel !== "undefined") {
    try { const channel = new BroadcastChannel(CHANNEL); channel.postMessage(detail); channel.close(); }
    catch { /* Notification failure cannot undo a committed record. */ }
  }
}

export function subscribeServiceRecords(listener: (lookupId: string) => void, scope = getAccountScope()): () => void {
  const receive = (value: unknown) => {
    if (!isAccountScopeCurrent(scope) || !value || typeof value !== "object") return;
    const change = value as { owner?: unknown; lookupId?: unknown };
    if (change.owner === scope.userId && typeof change.lookupId === "string") listener(change.lookupId);
  };
  const onLocal = (event: Event) => receive((event as CustomEvent).detail);
  if (typeof window !== "undefined") window.addEventListener(SERVICE_RECORDS_CHANGED, onLocal);
  let channel: BroadcastChannel | undefined;
  if (typeof BroadcastChannel !== "undefined") {
    try { channel = new BroadcastChannel(CHANNEL); channel.onmessage = (event) => receive(event.data); }
    catch { /* Same-tab events remain available. */ }
  }
  return () => { if (typeof window !== "undefined") window.removeEventListener(SERVICE_RECORDS_CHANGED, onLocal); channel?.close(); };
}

async function transact(lookupId: string, scope: AccountScope, merge?: (current: ServiceRecord[]) => ServiceRecord[]): Promise<ServiceRecord[]> {
  requireId(lookupId); requireScope(scope);
  const database = await openEvidenceDatabase();
  try { requireScope(scope); } catch (error) { database.close(); throw error; }
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction | undefined, failure: Error | undefined;
    let settled = false, changed = false;
    let result: ServiceRecord[] = [];
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); database.close();
      if (error) reject(error); else { if (changed) notify(lookupId, scope); resolve(structuredClone(result)); }
    };
    const fail = (error: unknown) => {
      failure = error instanceof Error ? error : invalid();
      try { tx?.abort(); } catch { /* Already aborted or committed. */ }
      finish(failure);
    };
    const timer = setTimeout(() => fail(new Error("Human-record storage stalled. Your previous records are preserved. Reopen the scan and retry.")), EVIDENCE_STORAGE_TIMEOUT_MS);
    try {
      tx = database.transaction(SERVICE_RECORD_STORE, merge ? "readwrite" : "readonly");
      const store = tx.objectStore(SERVICE_RECORD_STORE);
      const key = [scope.userId!, lookupId];
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          requireScope(scope);
          const current = normalizeServiceRecords(request.result === undefined ? [] : request.result, lookupId);
          if (!current) throw invalid();
          result = merge ? merge(structuredClone(current)) : current;
          const checked = normalizeServiceRecords(result, lookupId);
          if (!checked) throw invalid();
          result = checked;
          // This merge always starts with the transaction's current set, never an
          // opened UI or cloud acknowledgment snapshot. Existing IDs are immutable.
          if (merge && JSON.stringify(result) !== JSON.stringify(current)) {
            requireScope(scope); store.put(result, key); changed = true;
          }
        } catch (error) { fail(error); }
      };
      tx.oncomplete = () => { try { requireScope(scope); finish(); } catch (error) { finish(error as Error); } };
      tx.onerror = () => finish(failure ?? new Error("Human records could not be saved. Free device space and retry; previous records are preserved."));
      tx.onabort = () => finish(failure ?? new Error("Human-record storage was interrupted. Previous records are preserved."));
    } catch (error) { fail(error); }
  });
}

export function readServiceRecords(lookupId: string, scope = getAccountScope()): Promise<ServiceRecord[]> {
  return transact(lookupId, scope);
}

export function appendServiceRecord(record: ServiceRecord, scope = getAccountScope()): Promise<ServiceRecord[]> {
  const checked = normalizeServiceRecord(record);
  if (!checked) return Promise.reject(new Error("Complete this human record and its supporting details before saving."));
  return transact(checked.lookupId, scope, (current) => {
    if (!current.some((entry) => entry.id === checked.id) && checked.supersedesId
      && current.some((entry) => entry.supersedesId === checked.supersedesId)) {
      throw new Error("This record was already corrected or retracted in another view. Your draft remains; reload the history before correcting its current version.");
    }
    return mergeServiceRecords(current, [checked], checked.lookupId);
  });
}

/** Union remote history inside a fresh transaction; correction forks remain visible. */
export function importServiceRecords(lookupId: string, records: ServiceRecord[], scope = getAccountScope()): Promise<ServiceRecord[]> {
  const incoming = structuredClone(records);
  return transact(lookupId, scope, (current) => mergeServiceRecords(current, incoming, lookupId));
}
