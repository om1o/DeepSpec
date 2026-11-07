/// <reference types="node" />

import { createVehicleReferenceResponse, validateVehicleReferenceRequest } from "../server/vehicleReference.shared.js";
import { enforceRateLimit } from "../server/rateLimit.shared.js";
import { requireSession } from "../server/requireSession.shared.js";

type VercelRequest = { headers?: Record<string, string | string[] | undefined>; method?: string; body?: unknown };
type VercelResponse = { status: (code: number) => VercelResponse; json: (body: unknown) => void; setHeader: (name: string, value: string) => void };
export const VEHICLE_REFERENCE_GATE_TIMEOUT_MS = 5_000;

export default async function handler(request: VercelRequest, response: VercelResponse) {
  return handleVehicleReference(request, response, process.env);
}

export async function handleVehicleReference(request: VercelRequest, response: VercelResponse, env: Record<string, string | undefined>) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: { code: "method_not_allowed", message: "Use POST to look up vehicle information." } });
    return;
  }
  const headers = request.headers ?? {};
  let session;
  try { session = await boundedGate(() => requireSession(headers, env)); }
  catch {
    response.status(503).json({ error: { code: "session_unavailable", message: "DeepSpec cannot verify your session right now. Please try again shortly." } });
    return;
  }
  if (session.ok === false) { response.status(session.status).json(session.body); return; }
  const invalid = validateVehicleReferenceRequest(request.body);
  if (invalid) { response.status(invalid.status).json(invalid.body); return; }
  let quota;
  try { quota = await boundedGate(() => enforceRateLimit("vehicle-reference", headers, env)); }
  catch {
    response.setHeader("Retry-After", "60");
    response.status(503).json({ error: { code: "rate_limit_unavailable", message: "DeepSpec cannot verify request limits right now. Please try again in a minute." } });
    return;
  }
  if (quota.ok === false) {
    response.setHeader("Retry-After", String(quota.retryAfterSeconds));
    response.status(quota.status).json(quota.body);
    return;
  }
  let result;
  try { result = await createVehicleReferenceResponse(request.body); }
  catch { result = { status: 502, body: { error: { code: "vehicle_reference_unavailable", message: "NHTSA vehicle information could not be read. Keep your vehicle details and try again later." } } }; }
  response.status(result.status).json(result.body);
}

async function boundedGate<T>(run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([run(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Request gate timed out.")), VEHICLE_REFERENCE_GATE_TIMEOUT_MS);
    })]);
  } finally { clearTimeout(timer); }
}
