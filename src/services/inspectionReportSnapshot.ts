import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { normalizeComponentMapRecord } from "../lib/componentMap";
import { normalizeServiceRecords } from "../lib/serviceRecord";
import type { ComponentMapRecord } from "../types/componentMap";
import type { ServiceRecord } from "../types/serviceRecord";
import type { InspectionComparison } from "../types/inspectionComparison";
import { normalizeInspectionComparisons } from "../lib/inspectionComparison";
import { COMPONENT_MAP_STORE, EVIDENCE_STORAGE_TIMEOUT_MS, openEvidenceDatabase, SERVICE_RECORD_STORE, INSPECTION_COMPARISON_STORE } from "./evidenceDb";

export type FinalInspectionSnapshot = {
  map: ComponentMapRecord | null;
  // null is unreadable history, never an invented empty history.
  serviceRecords: Map<string, ServiceRecord[] | null>;
  comparisons: Map<string, InspectionComparison[] | null>;
};
const validId = (value: string) => /^[A-Za-z0-9._:-]{1,160}$/.test(value) && value !== "." && value !== "..";
function requireScope(scope: AccountScope) {
  if (!isAccountScopeCurrent(scope)) throw new Error("Account changed. Reopen the inspection in its original account.");
}

/** One readonly IDB transaction, including missing scan IDs. Queue every get
 * synchronously: per-record awaits would permit a mixed revision snapshot. */
export async function readFinalInspectionSnapshot(rootLookupId: string, lookupIds: readonly string[], scope = getAccountScope()): Promise<FinalInspectionSnapshot> {
  requireScope(scope);
  const ids = [...new Set(lookupIds)];
  if (!validId(rootLookupId) || ids.length > 250 || ids.some((id) => !validId(id))) throw new Error("Inspection references are invalid or exceed the report limit.");
  const database = await openEvidenceDatabase();
  try { requireScope(scope); } catch (error) { database.close(); throw error; }
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction | undefined;
    let settled = false, mapRead = false;
    const result: FinalInspectionSnapshot = { map: null, serviceRecords: new Map(), comparisons: new Map() };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); database.close();
      if (error) reject(error); else resolve(structuredClone(result));
    };
    const fail = (error: unknown) => {
      try { transaction?.abort(); } catch { /* Already completed or aborted. */ }
      finish(error instanceof Error ? error : new Error("Saved inspection records could not be checked safely."));
    };
    const timer = setTimeout(() => fail(new Error("Checking saved inspection records stalled. Prepare the report again.")), EVIDENCE_STORAGE_TIMEOUT_MS);
    try {
      requireScope(scope);
      transaction = database.transaction([COMPONENT_MAP_STORE, SERVICE_RECORD_STORE, INSPECTION_COMPARISON_STORE], "readonly");
      const mapRequest = transaction.objectStore(COMPONENT_MAP_STORE).get([scope.userId!, rootLookupId]);
      mapRequest.onsuccess = () => {
        try {
          requireScope(scope);
          if (mapRequest.result !== undefined) {
            const map = normalizeComponentMapRecord(mapRequest.result);
            if (!map || map.document.id !== rootLookupId) throw new Error("The saved component map could not be checked safely.");
            result.map = map;
          }
          mapRead = true;
        } catch (error) { fail(error); }
      };
      const store = transaction.objectStore(SERVICE_RECORD_STORE);
      for (const id of ids) {
        const request = store.get([scope.userId!, id]);
        request.onsuccess = () => {
          try {
            requireScope(scope);
            result.serviceRecords.set(id, normalizeServiceRecords(request.result === undefined ? [] : request.result, id) ?? null);
          } catch (error) { fail(error); }
        };
      }
      const comparisons = transaction.objectStore(INSPECTION_COMPARISON_STORE);
      for (const id of ids) {
        const request = comparisons.get([scope.userId!, id]);
        request.onsuccess = () => {
          try {
            requireScope(scope);
            result.comparisons.set(id, normalizeInspectionComparisons(request.result === undefined ? [] : request.result, id) ?? null);
          } catch (error) { fail(error); }
        };
      }
      transaction.oncomplete = () => {
        try {
          requireScope(scope);
          if (!mapRead || result.serviceRecords.size !== ids.length || result.comparisons.size !== ids.length) throw new Error("Some saved inspection records could not be checked safely.");
          finish();
        } catch (error) { finish(error as Error); }
      };
      transaction.onerror = () => finish(new Error("Saved inspection records could not be checked safely. Prepare the report again."));
      transaction.onabort = () => finish(new Error("Checking saved inspection records was interrupted. Prepare the report again."));
    } catch (error) { fail(error); }
  });
}
