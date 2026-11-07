import { getAccountScope, isAccountScopeCurrent, type AccountScope } from "../lib/accountScope";
import { normalizeVehicleIdentityReference, normalizeVehicleReferenceQuery } from "../lib/vehicleReference";
import type { VehicleIdentityReference, VehicleReferenceQuery } from "../types/vehicleReference";
import { getAuthClient } from "./auth";

export const VEHICLE_REFERENCE_REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 32 * 1024;
const changed = () => new Error("Account changed. Reopen vehicle details before looking up a VIN.");
const unavailable = () => new Error("Vehicle lookup is unavailable right now. Your vehicle details were kept; try again later.");

function ensureCurrent(scope: AccountScope, signal: AbortSignal) {
  if (!isAccountScopeCurrent(scope)) throw changed();
  if (signal.aborted) throw unavailable();
}

async function readResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body || Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) throw unavailable();
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      if (signal.aborted) throw unavailable();
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) { cancel(); throw unavailable(); }
      chunks.push(chunk.value);
    }
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

/** Only called by the explicit NHTSA lookup action; never sends photos or other context. */
export async function requestVehicleReference(input: VehicleReferenceQuery, scope = getAccountScope()): Promise<VehicleIdentityReference> {
  const query = normalizeVehicleReferenceQuery(input);
  if (!query) throw new Error("Enter a complete 17-character VIN and, if supplied, a model year from 1981 to 2099.");
  const controller = new AbortController();
  ensureCurrent(scope, controller.signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, VEHICLE_REFERENCE_REQUEST_TIMEOUT_MS);
  });
  const operation = async () => {
    const client = await getAuthClient().catch(() => null);
    ensureCurrent(scope, controller.signal);
    const session = await client?.auth.getSession().catch(() => null);
    ensureCurrent(scope, controller.signal);
    const current = session?.data.session;
    if (session?.error || !current?.access_token || current.user?.id !== scope.userId || current.user.is_anonymous === true) throw new Error("Sign in to look up vehicle details.");
    let response: Response;
    try {
      response = await fetch("/api/vehicle-reference", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${current.access_token}` },
        body: JSON.stringify(query), signal: controller.signal, cache: "no-store", credentials: "same-origin", redirect: "error",
      });
    } catch { ensureCurrent(scope, controller.signal); throw unavailable(); }
    ensureCurrent(scope, controller.signal);
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403) throw new Error("Sign in again to look up vehicle details.");
      if (response.status === 429) throw new Error("Vehicle lookup is temporarily limited. Wait before trying again.");
      if (response.status === 400) throw new Error("Check the VIN and model year, then try again.");
      throw unavailable();
    }
    let payload: unknown;
    try { payload = await readResponse(response, controller.signal); } catch { ensureCurrent(scope, controller.signal); throw unavailable(); }
    ensureCurrent(scope, controller.signal);
    const reference = normalizeVehicleIdentityReference(payload && typeof payload === "object" && "reference" in payload ? payload.reference : null);
    if (!reference || reference.query.vin !== query.vin || reference.query.modelYear !== query.modelYear) throw unavailable();
    return reference;
  };
  try { return await Promise.race([operation(), deadline]); }
  finally { clearTimeout(timer); controller.abort(); }
}
