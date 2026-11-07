import { randomUUID } from "node:crypto";
import { normalizeVehicleIdentityReference, normalizeVehicleReferenceQuery } from "../src/lib/vehicleReference.js";
import {
  VEHICLE_REFERENCE_ADAPTER_VERSION,
  VEHICLE_REFERENCE_SOURCE_URL,
  type VehicleIdentityReference,
  type VehicleReferenceFacts,
  type VehicleReferenceQuery,
} from "../src/types/vehicleReference.js";

export const VEHICLE_REFERENCE_TIMEOUT_MS = 12_000;
export const MAX_VEHICLE_REFERENCE_RESPONSE_BYTES = 256 * 1024;
const UPSTREAM_URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/";
type Failure = { status: number; body: { error: { code: string; message: string } } };
export type VehicleReferenceResponse = { status: 200; body: { reference: VehicleIdentityReference } } | Failure;

const invalidRequest = (): Failure => ({ status: 400, body: { error: { code: "invalid_vehicle_reference_request", message: "Enter one complete 17-character VIN and, optionally, a model year from 1981 through 2099." } } });
const unavailable = (): Failure => ({ status: 502, body: { error: { code: "vehicle_reference_unavailable", message: "NHTSA vehicle information could not be read. Keep your vehicle details and try again later." } } });

export function validateVehicleReferenceRequest(body: unknown): Failure | null {
  return normalizeVehicleReferenceQuery(body) ? null : invalidRequest();
}

/** One explicit request, with no redirects, retries, cache, or VIN-bearing URL/log. */
export async function createVehicleReferenceResponse(body: unknown, fetchImpl: typeof fetch = fetch): Promise<VehicleReferenceResponse> {
  const query = normalizeVehicleReferenceQuery(body);
  if (!query) return invalidRequest();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error("Vehicle reference deadline reached."));
    }, VEHICLE_REFERENCE_TIMEOUT_MS);
  });
  try {
    const reference = await Promise.race([requestReference(query, fetchImpl, controller.signal), deadline]);
    return { status: 200, body: { reference } };
  } catch {
    return timedOut
      ? { status: 504, body: { error: { code: "vehicle_reference_timeout", message: "The NHTSA lookup took too long. Your vehicle details were kept; try again later." } } }
      : unavailable();
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function requestReference(query: VehicleReferenceQuery, fetchImpl: typeof fetch, signal: AbortSignal): Promise<VehicleIdentityReference> {
  const response = await fetchImpl(UPSTREAM_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ format: "json", data: `${query.vin}${query.modelYear === undefined ? "" : `,${query.modelYear}`}` }).toString(),
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
    signal,
  });
  if (signal.aborted || response.status !== 200 || response.redirected) throw new Error("Unexpected vehicle response.");
  if (!/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw new Error("Unexpected vehicle format.");
  const payload = await readJson(response, signal);
  if (!isRecord(payload) || !Array.isArray(payload.Results) || payload.Results.length !== 1
    || (payload.Count !== undefined && payload.Count !== 1)) throw new Error("Ambiguous vehicle response.");
  const row: unknown = payload.Results[0];
  if (!isRecord(row) || typeof row.VIN !== "string" || row.VIN.trim().toUpperCase() !== query.vin) throw new Error("Vehicle response did not match.");
  const facts: VehicleReferenceFacts = {};
  const fields = {
    year: "ModelYear", make: "Make", model: "Model", engineModel: "EngineModel",
    engineManufacturer: "EngineManufacturer", cylinders: "EngineCylinders", displacementL: "DisplacementL", fuelType: "FuelTypePrimary",
  } as const;
  for (const [field, source] of Object.entries(fields)) {
    const value = row[source];
    if (value === null || value === undefined) continue;
    if (typeof value !== "string" || value.length > 120) throw new Error("Invalid vehicle fact.");
    const text = value.trim();
    if (text && !/^(?:not applicable|n\/a)$/i.test(text)) facts[field as keyof VehicleReferenceFacts] = text;
  }
  const errorCode = row.ErrorCode;
  if (errorCode !== undefined && errorCode !== null && (typeof errorCode !== "string" || errorCode.length > 127)) throw new Error("Invalid decode status.");
  const codes = typeof errorCode === "string" && errorCode.trim() ? errorCode.split(",").map((code) => code.trim()) : [];
  if (codes.length > 32 || codes.some((code) => !/^\d{1,3}$/.test(code))) throw new Error("Invalid decode codes.");
  // vPIC's official variable list defines Error Text (191) and Additional Error Text (156).
  // https://vpic.nhtsa.dot.gov/api/vehicles/GetVehicleVariableList?format=json
  const messages: string[] = [];
  for (const source of ["ErrorText", "AdditionalErrorText"] as const) {
    const message = row[source];
    if (message === undefined || message === null) continue;
    if (typeof message !== "string" || message.length > 2000) throw new Error("Invalid decode message.");
    if (message.trim()) messages.push(message);
  }
  const reference = normalizeVehicleIdentityReference({
    version: 1, id: randomUUID(), provider: "nhtsa-vpic", adapterVersion: VEHICLE_REFERENCE_ADAPTER_VERSION,
    retrievedAt: new Date().toISOString(), sourceUrl: VEHICLE_REFERENCE_SOURCE_URL, query, facts,
    decode: { codes, messages },
  });
  if (!reference || signal.aborted) throw new Error("Invalid vehicle reference.");
  return reference;
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const advertised = response.headers.get("content-length");
  if (advertised !== null && (!/^\d+$/.test(advertised) || Number(advertised) > MAX_VEHICLE_REFERENCE_RESPONSE_BYTES)) throw new Error("Vehicle response too large.");
  if (!response.body) throw new Error("Missing vehicle response.");
  const reader = response.body.getReader();
  const cancelReader = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancelReader, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (signal.aborted) throw new Error("Vehicle request stopped.");
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_VEHICLE_REFERENCE_RESPONSE_BYTES) throw new Error("Vehicle response too large.");
      chunks.push(next.value);
    }
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } finally {
    signal.removeEventListener("abort", cancelReader);
    // Cancellation is best-effort and must not extend the request deadline.
    cancelReader();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
