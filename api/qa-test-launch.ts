/// <reference types="node" />

import { QA_TEST_CLEANUP_EXPIRES_AT } from "../server/qaTestConfig.shared.js";
import { QA_TEST_COOKIE_NAME, QA_TEST_COOKIE_PATH, qaTestFailure, validateQaTestCapability } from "../server/qaTestGate.shared.js";

type Request = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type Response = { status: (code: number) => Response; json: (body: unknown) => void; setHeader: (name: string, value: string) => void; end: () => void };
const MAX_FORM_BYTES = 256;

export default function handler(request: Request, response: Response) {
  response.setHeader("Cache-Control", "no-store");
  const reject = (status: number, code: string) => response.status(status).json(qaTestFailure(status, code).body);
  if (request.method !== "POST") return reject(405, "method_not_allowed");
  const headers = request.headers ?? {};
  const deploymentHost = process.env.VERCEL_URL;
  if (headers.origin !== "http://127.0.0.1:43129" || !deploymentHost || typeof headers.host !== "string" || headers.host !== deploymentHost) return reject(403, "invalid_origin");
  const contentType = headers["content-type"];
  const contentLength = headers["content-length"];
  if (typeof contentType !== "string" || !/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(contentType) ||
    (contentLength !== undefined && (typeof contentLength !== "string" || !/^\d+$/.test(contentLength) || Number(contentLength) > MAX_FORM_BYTES))) return reject(400, "invalid_request");
  const capability = parseCapability(request.body);
  if (capability === null) return reject(400, "invalid_request");
  const now = Date.now();
  const gate = validateQaTestCapability(capability, process.env, "POST", now);
  if (gate) return response.status(gate.status).json(gate.body);
  const maxAge = Math.floor((Date.parse(QA_TEST_CLEANUP_EXPIRES_AT) - now) / 1000);
  if (!Number.isFinite(maxAge) || maxAge <= 0) return reject(404, "not_found");
  response.setHeader("Set-Cookie", `${QA_TEST_COOKIE_NAME}=${capability}; Max-Age=${maxAge}; Path=${QA_TEST_COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict`);
  response.setHeader("Location", "/auth?private-test=1");
  response.status(303).end();
}

function parseCapability(body: unknown): string | null {
  if (typeof body === "string") {
    if (Buffer.byteLength(body) > MAX_FORM_BYTES) return null;
    const entries = [...new URLSearchParams(body).entries()];
    return entries.length === 1 && entries[0][0] === "capability" ? entries[0][1] : null;
  }
  // Vercel may parse form-encoded data before invoking the Node handler.
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const entries = Object.entries(body);
  if (entries.length !== 1 || entries[0][0] !== "capability" || typeof entries[0][1] !== "string" || Buffer.byteLength(entries[0][1]) + 11 > MAX_FORM_BYTES) return null;
  return entries[0][1];
}
