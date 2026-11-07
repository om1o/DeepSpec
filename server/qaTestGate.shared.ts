import { createHash, timingSafeEqual } from "node:crypto";
import { QA_TEST_CAPABILITY_SHA256, QA_TEST_EMAIL, QA_TEST_LOGIN_EXPIRES_AT, QA_TEST_CLEANUP_EXPIRES_AT } from "./qaTestConfig.shared.js";

export const QA_TEST_COOKIE_NAME = "__Secure-deepspec-qa-test";
export const QA_TEST_COOKIE_PATH = "/api/qa-test-session";
export const QA_TEST_COOKIE_CLEAR = `${QA_TEST_COOKIE_NAME}=; Max-Age=0; Path=${QA_TEST_COOKIE_PATH}; HttpOnly; Secure; SameSite=Strict`;
const BRANCH = "codex/pilot-assembled-20261103";

export function qaTestFailure(status: number, code: string) {
  return { status, body: { error: { code, message: "Temporary test access is unavailable." } } };
}

export function validateQaTestCapability(capability: string | undefined, env: Record<string, string | undefined>, operation: "POST" | "DELETE", now = Date.now()) {
  const loginExpiry = Date.parse(QA_TEST_LOGIN_EXPIRES_AT);
  const cleanupExpiry = Date.parse(QA_TEST_CLEANUP_EXPIRES_AT);
  const expiresAt = operation === "POST" ? loginExpiry : cleanupExpiry;
  if (env.VERCEL_ENV !== "preview" || env.VERCEL_GIT_COMMIT_REF !== BRANCH ||
    !Number.isFinite(loginExpiry) || !Number.isFinite(cleanupExpiry) || cleanupExpiry < loginExpiry || now >= expiresAt ||
    !/^[a-f0-9]{64}$/.test(QA_TEST_CAPABILITY_SHA256) || !/^[a-zA-Z0-9._+-]{1,128}@example\.test$/.test(QA_TEST_EMAIL)) {
    return qaTestFailure(404, "not_found");
  }
  if (!capability || !/^[a-f0-9]{64}$/.test(capability) || !timingSafeEqual(createHash("sha256").update(capability).digest(), Buffer.from(QA_TEST_CAPABILITY_SHA256, "hex"))) return qaTestFailure(401, "unauthorized");
  return null;
}

export function readQaTestCapability(headers: Record<string, string | string[] | undefined> = {}) {
  const authorization = headers.authorization;
  const bearer = typeof authorization === "string" ? /^Bearer ([a-f0-9]{64})$/.exec(authorization)?.[1] : undefined;
  if (authorization !== undefined && !bearer) return undefined;
  const cookieHeader = headers.cookie;
  if (cookieHeader !== undefined && (typeof cookieHeader !== "string" || cookieHeader.length > 16_384)) return undefined;
  const entries = typeof cookieHeader === "string" ? cookieHeader.split(";").map((entry) => entry.trim()).filter((entry) => entry.split("=", 1)[0] === QA_TEST_COOKIE_NAME) : [];
  if (entries.length > 1) return undefined;
  const cookie = entries.length === 1 ? entries[0].slice(QA_TEST_COOKIE_NAME.length + 1) : undefined;
  if (entries.length && (!cookie || !/^[a-f0-9]{64}$/.test(cookie))) return undefined;
  if (bearer && cookie && bearer !== cookie) return undefined;
  return cookie ?? bearer;
}
