import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { normalizeVehicleIdentityReference, normalizeVehicleReferenceQuery } from "../lib/vehicleReference";
import type { VehicleIdentityReference } from "../types/vehicleReference";
import { EVIDENCE_STORAGE_TIMEOUT_MS, openEvidenceDatabase, VEHICLE_REFERENCE_STORE } from "./evidenceDb";

export const MAX_VEHICLE_REFERENCES_PER_VIN = 20;
export const MAX_VEHICLE_REFERENCE_BUCKET_BYTES = 128 * 1024;
const invalid = () => new Error("Saved vehicle references are invalid or incomplete. They were preserved; do not clear browser data. Reopen this vehicle's reference history before retrying.");
function requireScope(scope: AccountScope) {
  if (!scope.userId || !isAccountScopeCurrent(scope)) throw new Error("Account changed. Reopen vehicle references in the account that owns this device history.");
}
function canonicalVin(value: string): string {
  const query = normalizeVehicleReferenceQuery({ vin: value });
  if (!query) throw new Error("Enter a valid VIN before opening its saved references.");
  return query.vin;
}
function fits(value: unknown): boolean {
  try { const raw = JSON.stringify(value); return typeof raw === "string" && raw.length <= MAX_VEHICLE_REFERENCE_BUCKET_BYTES && new TextEncoder().encode(raw).byteLength <= MAX_VEHICLE_REFERENCE_BUCKET_BYTES; }
  catch { return false; }
}
function newestFirst(left: VehicleIdentityReference, right: VehicleIdentityReference): number {
  return Date.parse(right.retrievedAt) - Date.parse(left.retrievedAt) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}
function normalizeBucket(value: unknown, vin: string): VehicleIdentityReference[] | null {
  if (!Array.isArray(value) || value.length > MAX_VEHICLE_REFERENCES_PER_VIN || !fits(value)) return null;
  const result: VehicleIdentityReference[] = [], ids = new Set<string>();
  for (const raw of value) {
    const reference = normalizeVehicleIdentityReference(raw);
    if (!reference || reference.query.vin !== vin || ids.has(reference.id.toLowerCase())) return null;
    ids.add(reference.id.toLowerCase()); result.push(reference);
  }
  return result.sort(newestFirst);
}

/** Read, immutable ID check and append share one transaction. No opened UI
 * snapshot can replace a reference committed by another tab. */
async function transact(vin: string, scope: AccountScope, incoming?: VehicleIdentityReference): Promise<VehicleIdentityReference[]> {
  requireScope(scope);
  const database = await openEvidenceDatabase();
  try { requireScope(scope); } catch (error) { database.close(); throw error; }
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction | undefined, failure: Error | undefined;
    let settled = false;
    let result: VehicleIdentityReference[] = [];
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); database.close();
      if (error) reject(error); else resolve(structuredClone(result));
    };
    const fail = (error: unknown) => {
      failure = error instanceof Error ? error : invalid();
      try { tx?.abort(); } catch { /* Already aborted or completed. */ }
      finish(failure);
    };
    const timer = setTimeout(() => fail(new Error("Vehicle reference storage stalled. Existing references were preserved. Reopen the history and retry.")), EVIDENCE_STORAGE_TIMEOUT_MS);
    try {
      tx = database.transaction(VEHICLE_REFERENCE_STORE, incoming ? "readwrite" : "readonly");
      const store = tx.objectStore(VEHICLE_REFERENCE_STORE), key = [scope.userId!, vin], request = store.get(key);
      request.onsuccess = () => {
        try {
          requireScope(scope);
          const current = normalizeBucket(request.result === undefined ? [] : request.result, vin);
          if (!current) throw invalid();
          result = current;
          if (!incoming) return;
          const previous = current.find((entry) => entry.id.toLowerCase() === incoming.id.toLowerCase());
          if (previous) {
            if (JSON.stringify(previous) !== JSON.stringify(incoming)) throw new Error("This vehicle reference ID has conflicting content. Its saved result was not overwritten.");
            return; // An exact retry remains valid at capacity and does not rewrite history.
          }
          if (current.length >= MAX_VEHICLE_REFERENCES_PER_VIN) throw new Error("This VIN already has 20 saved references on this device. No earlier reference was removed; the new result has not been saved.");
          const next = [...current, incoming].sort(newestFirst);
          if (!fits(next)) throw new Error("This VIN's saved references exceed the 128 KiB device-history limit. No earlier reference was removed; the new result has not been saved.");
          requireScope(scope); store.put(next, key); result = next;
        } catch (error) { fail(error); }
      };
      tx.oncomplete = () => { try { requireScope(scope); finish(); } catch (error) { finish(error as Error); } };
      tx.onerror = () => finish(failure ?? new Error("Vehicle references could not be saved. Free device space and retry; existing history was preserved."));
      tx.onabort = () => finish(failure ?? new Error("Vehicle reference storage was interrupted. Existing history was preserved."));
    } catch (error) { fail(error); }
  });
}

/** Device history is independent from vehicle profiles and confirmation state. */
export async function readVehicleReferences(vin: string, scope = getAccountScope()): Promise<VehicleIdentityReference[]> {
  const references = await transact(canonicalVin(vin), scope);
  requireScope(scope);
  return references;
}
export async function appendVehicleReference(reference: VehicleIdentityReference, scope = getAccountScope()): Promise<VehicleIdentityReference> {
  requireScope(scope);
  const checked = normalizeVehicleIdentityReference(reference);
  if (!checked) throw new Error("This vehicle reference is invalid or incomplete. Its result was not saved; retry the lookup before applying it.");
  const incoming = structuredClone(checked);
  const saved = await transact(incoming.query.vin, scope, incoming);
  requireScope(scope);
  const acknowledged = saved.find((entry) => entry.id.toLowerCase() === incoming.id.toLowerCase());
  if (!acknowledged) throw invalid();
  return acknowledged;
}
