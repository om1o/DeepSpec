/// <reference types="node" />

import { createHash, timingSafeEqual } from "node:crypto";
import { createChatResponse, getChatModels } from "../server/chat.shared.js";
import { createIdentifyResponse } from "../server/identify.shared.js";
import { QA_AI_CHECK_BRANCH, QA_AI_CHECK_EXPIRES_AT, QA_AI_CHECK_FIXTURES, QA_AI_CHECK_TOKEN_SHA256 } from "../server/qaAiCheck.config.js";

type Request = { method?: string; headers?: Record<string, string | string[] | undefined>; body?: unknown };
type Response = { status: (code: number) => Response; json: (body: unknown) => void; setHeader: (name: string, value: string) => void };
const MAX_BODY_BYTES = 500_000;
const SAFE_ERROR_CODES = new Set(["not_configured", "feature_disabled", "provider_error", "rate_limited", "network", "invalid_response", "timeout", "identify_timeout"]);

// This temporary bearer grants only the two fixed photo/question checks below.
// It does not impose a cross-instance call budget; the private operator runs a bounded batch.
export default async function handler(request: Request, response: Response) {
  response.setHeader("Cache-Control", "no-store");
  const reject = (status: number, code: string) => response.status(status).json({ error: { code, message: "AI check unavailable." } });
  if (request.method !== "POST") return reject(405, "method_not_allowed");
  const expiresAt = Date.parse(QA_AI_CHECK_EXPIRES_AT);
  if (process.env.VERCEL_ENV !== "preview" || process.env.VERCEL_GIT_COMMIT_REF !== QA_AI_CHECK_BRANCH || !Number.isFinite(expiresAt) || Date.now() >= expiresAt || !/^[a-f0-9]{64}$/.test(QA_AI_CHECK_TOKEN_SHA256)) {
    return reject(404, "not_found");
  }

  const authorization = request.headers?.authorization;
  const token = typeof authorization === "string" ? /^Bearer ([a-f0-9]{64})$/.exec(authorization)?.[1] : undefined;
  if (!token || !timingSafeEqual(createHash("sha256").update(token).digest(), Buffer.from(QA_AI_CHECK_TOKEN_SHA256, "hex"))) {
    return reject(401, "unauthorized");
  }

  const contentType = request.headers?.["content-type"];
  const contentLength = request.headers?.["content-length"];
  if (typeof contentType !== "string" || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType) ||
    (contentLength !== undefined && (typeof contentLength !== "string" || !/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES))) {
    return reject(400, "invalid_request");
  }

  let body: Record<string, unknown>;
  try {
    const serialized = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
    if (typeof serialized !== "string" || Buffer.byteLength(serialized) > MAX_BODY_BYTES) return reject(400, "invalid_request");
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reject(400, "invalid_request");
    body = parsed as Record<string, unknown>;
  } catch {
    return reject(400, "invalid_request");
  }
  if (Object.keys(body).length !== 3 || Object.keys(body).some((key) => !["action", "fixtureId", "imageBase64"].includes(key)) ||
    (body.action !== "identify" && body.action !== "chat") || typeof body.imageBase64 !== "string") {
    return reject(400, "invalid_request");
  }
  const fixture = QA_AI_CHECK_FIXTURES.find(({ id }) => id === body.fixtureId);
  const image = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.imageBase64)?.[1];
  if (!fixture || !image) return reject(400, "invalid_request");
  const bytes = Buffer.from(image, "base64");
  if (bytes.length !== fixture.bytes || bytes.toString("base64") !== image || createHash("sha256").update(bytes).digest("hex") !== fixture.sha256) {
    return reject(400, "invalid_request");
  }

  const chatModels = getChatModels(process.env);
  if (body.action === "chat" && (chatModels.length !== 1 || !/^gemini-[a-zA-Z0-9._-]+$/.test(chatModels[0]))) {
    return reject(409, "ambiguous_chat_model");
  }
  const startedAt = Date.now();
  const diagnostic = () => ({
    action: body.action,
    fixtureId: fixture.id,
    imageSha256: fixture.sha256,
    deploymentCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    keyPresent: Boolean(process.env.GEMINI_API_KEY),
    latencyMs: Date.now() - startedAt,
  });
  try {
    const result = body.action === "identify"
      ? await createIdentifyResponse({ imageBase64: body.imageBase64 }, process.env)
      : await createChatResponse({ imageBase64: body.imageBase64, userMessage: fixture.question, research: false }, process.env);
    if (result.status !== 200 || "error" in result.body) {
      const code = "error" in result.body && SAFE_ERROR_CODES.has(result.body.error.code) ? result.body.error.code : "provider_error";
      response.status(result.status === 200 ? 502 : result.status).json({ error: { code, message: "AI check failed." }, diagnostic: diagnostic() });
      return;
    }
    const output = {
      ...result.body,
      ...(body.action === "chat" ? { modelRun: { provider: "gemini", model: chatModels[0] } } : {}),
      diagnostic: diagnostic(),
    };
    // Shared handlers may contain upstream text. Never expose even an echoed key.
    const redact = (value: string) => {
      const key = process.env.GEMINI_API_KEY;
      return (key ? value.split(key).join("[REDACTED]") : value).replace(/AIza[A-Za-z0-9_-]{20,}/g, "[REDACTED]");
    };
    const sanitized = JSON.parse(JSON.stringify(output, (_key, value: unknown) => typeof value === "string" ? redact(value) : value));
    response.status(200).json(sanitized);
  } catch {
    response.status(502).json({ error: { code: "provider_error", message: "AI check failed." }, diagnostic: diagnostic() });
  }
}
