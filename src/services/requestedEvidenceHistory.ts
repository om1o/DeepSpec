import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { MAX_INSPECTION_COMPARISON_BYTES, normalizeInspectionComparisons } from "../lib/inspectionComparison";
import type { RequestedInspectionComparison } from "../types/inspectionComparison";
import { EVIDENCE_STORAGE_TIMEOUT_MS, INSPECTION_COMPARISON_STORE, openEvidenceDatabase } from "./evidenceDb";

export const REQUESTED_HISTORY_MAX_BUCKETS = 512;
export const REQUESTED_HISTORY_MAX_BYTES = 8 * 1024 * 1024;
export const REQUESTED_HISTORY_MAX_RECORDS = 200;
export type RequestedEvidenceHistory = {
  records: RequestedInspectionComparison[];
  complete: boolean;
  reason?: string;
  scannedBuckets: number;
};
const validId = (id: string) => /^[A-Za-z0-9._:-]{1,160}$/.test(id) && id !== "." && id !== "..";
const incomplete = "Some device comparison history could not be read. Additional requested photos may exist.";
const limited = "Device comparison history exceeded the search limit. Additional requested photos may exist.";
function requireScope(scope: AccountScope) {
  if (!scope.userId || !isAccountScopeCurrent(scope)) throw new Error("Account changed. Reopen the scan in the account that owns its requested photos.");
}

/** Queue synchronously in the caller's transaction, also used by the report's
 * final snapshot. Never enumerate another account or load the whole store. */
export function queueRequestedEvidenceHistory(
  store: IDBObjectStore, originLookupId: string, scope: AccountScope,
  onComplete: (result: RequestedEvidenceHistory) => void, onError: (error: Error) => void,
): void {
  let finished = false;
  const result: RequestedEvidenceHistory = { records: [], complete: true, scannedBuckets: 0 };
  let bytes = 0;
  const fail = (error: unknown) => {
    if (finished) return;
    finished = true; onError(error instanceof Error ? error : new Error(incomplete));
  };
  const finish = () => {
    if (finished) return;
    requireScope(scope);
    result.records.sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt)
      || a.lookupId.localeCompare(b.lookupId, "en") || a.id.localeCompare(b.id, "en"));
    finished = true; onComplete(result);
  };
  const markIncomplete = (reason: string) => { result.complete = false; result.reason = reason; };
  try {
    requireScope(scope);
    if (!validId(originLookupId)) throw new Error("This saved scan reference is invalid.");
    // IndexedDB arrays sort above strings: this bounds all compound keys whose
    // first item is exactly the owner, including a malformed same-owner suffix.
    const request = store.openCursor(IDBKeyRange.bound([scope.userId!], [scope.userId!, []]));
    request.onerror = () => fail(new Error(incomplete));
    request.onsuccess = () => {
      if (finished) return;
      try {
        requireScope(scope);
        const cursor = request.result;
        if (!cursor) { finish(); return; }
        if (result.scannedBuckets >= REQUESTED_HISTORY_MAX_BUCKETS) { markIncomplete(limited); finish(); return; }
        result.scannedBuckets++;
        const key = cursor.key;
        if (!Array.isArray(key) || key.length !== 2 || key[0] !== scope.userId || typeof key[1] !== "string" || !validId(key[1])) {
          markIncomplete(incomplete); cursor.continue(); return;
        }
        let raw: string | undefined;
        try { raw = JSON.stringify(cursor.value); } catch { /* Invalid data remains untouched. */ }
        if (typeof raw !== "string" || raw.length > MAX_INSPECTION_COMPARISON_BYTES) {
          markIncomplete(incomplete); cursor.continue(); return;
        }
        const size = new TextEncoder().encode(raw).byteLength;
        bytes += size;
        if (bytes > REQUESTED_HISTORY_MAX_BYTES) { markIncomplete(limited); finish(); return; }
        const records = normalizeInspectionComparisons(cursor.value, key[1]);
        if (!records) { markIncomplete(incomplete); cursor.continue(); return; }
        const matches = records.filter((record): record is RequestedInspectionComparison => record.version === 2 && record.earlier.lookupId === originLookupId);
        if (result.records.length + matches.length > REQUESTED_HISTORY_MAX_RECORDS) { markIncomplete(limited); finish(); return; }
        result.records.push(...matches);
        cursor.continue();
      } catch (error) { fail(error); }
    };
  } catch (error) { fail(error); }
}

/** Device-only reverse lookup. Deleted scans can still have immutable receipts. */
export async function readRequestedEvidenceHistory(originLookupId: string, scope = getAccountScope()): Promise<RequestedEvidenceHistory> {
  requireScope(scope);
  if (!validId(originLookupId)) throw new Error("This saved scan reference is invalid.");
  const database = await openEvidenceDatabase();
  try { requireScope(scope); } catch (error) { database.close(); throw error; }
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction | undefined, result: RequestedEvidenceHistory | undefined;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); database.close();
      if (error) reject(error); else if (result) resolve(structuredClone(result)); else reject(new Error(incomplete));
    };
    const fail = (error: Error) => { try { tx?.abort(); } catch { /* Already settled. */ } finish(error); };
    const timer = setTimeout(() => fail(new Error("Checking requested-photo history stalled. Reopen the scan to retry.")), EVIDENCE_STORAGE_TIMEOUT_MS);
    try {
      requireScope(scope);
      tx = database.transaction(INSPECTION_COMPARISON_STORE, "readonly");
      queueRequestedEvidenceHistory(tx.objectStore(INSPECTION_COMPARISON_STORE), originLookupId, scope, (value) => { result = value; }, fail);
      tx.oncomplete = () => { try { requireScope(scope); finish(); } catch (error) { finish(error as Error); } };
      tx.onerror = () => finish(new Error(incomplete));
      tx.onabort = () => finish(new Error("Checking requested-photo history was interrupted. Reopen the scan to retry."));
    } catch (error) { fail(error instanceof Error ? error : new Error(incomplete)); }
  });
}
