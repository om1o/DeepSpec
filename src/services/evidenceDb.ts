export const EVIDENCE_DATABASE_NAME = "deep-spec-evidence";
export const EVIDENCE_DATABASE_VERSION = 8;
export const PHOTO_DRAFT_STORE = "photo-drafts";
export const COMPONENT_MAP_STORE = "component-maps";
export const SERVICE_RECORD_STORE = "service-records";
export const SERVICE_RECORD_DRAFT_STORE = "service-record-drafts";
export const INSPECTION_COMPARISON_STORE = "inspection-comparisons";
export const COMPARISON_DRAFT_STORE = "comparison-drafts";
export const DIAGNOSTIC_REPORT_STORE = "diagnostic-reports";
export const DIAGNOSTIC_DRAFT_STORE = "diagnostic-drafts";
export const VEHICLE_REFERENCE_STORE = "vehicle-references";
export const OBSERVATION_AREA_STORE = "observation-areas";
export const OBSERVATION_AREA_DRAFT_STORE = "observation-area-drafts";
export const EVIDENCE_STORAGE_TIMEOUT_MS = 15_000;

// Every caller closes its connection after its transaction. A version change must
// also close idle connections so one tab cannot indefinitely block another upgrade.
export function openEvidenceDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("This browser cannot save inspection evidence. Enable site storage and retry."));
  return new Promise((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail("Opening inspection storage stalled. Close other DeepSpec tabs and retry."), EVIDENCE_STORAGE_TIMEOUT_MS);
    try { request = indexedDB.open(EVIDENCE_DATABASE_NAME, EVIDENCE_DATABASE_VERSION); }
    catch { fail("Inspection storage could not be opened. Allow site storage and retry."); return; }
    request.onupgradeneeded = () => {
      // An abandoned open must not migrate storage after the caller has failed.
      if (settled) { request.transaction?.abort(); return; }
      for (const store of [PHOTO_DRAFT_STORE, COMPONENT_MAP_STORE, SERVICE_RECORD_STORE, SERVICE_RECORD_DRAFT_STORE, INSPECTION_COMPARISON_STORE, COMPARISON_DRAFT_STORE, DIAGNOSTIC_REPORT_STORE, DIAGNOSTIC_DRAFT_STORE, VEHICLE_REFERENCE_STORE, OBSERVATION_AREA_STORE, OBSERVATION_AREA_DRAFT_STORE]) {
        if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
      }
    };
    request.onerror = () => fail(request.error?.name === "VersionError"
      ? "A newer DeepSpec version updated inspection storage. Keep your entered work, then reload this tab. Saved evidence was not cleared."
      : "Inspection storage could not be opened. Free device space or allow site storage, then retry.");
    request.onblocked = () => fail("Another DeepSpec tab is blocking inspection storage. Close that tab and retry.");
    request.onsuccess = () => {
      const database = request.result;
      if (settled) { database.close(); return; }
      settled = true;
      clearTimeout(timer);
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}
