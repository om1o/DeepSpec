import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { RateLimitDecision, RateLimitScope } from "./rateLimit.shared.js";

const QUOTA_TIMEOUT_MS = 4000;

function unavailable(): RateLimitDecision {
  return {
    ok: false,
    status: 503,
    retryAfterSeconds: 60,
    body: { error: { code: "rate_limit_unavailable", message: "DeepSpec cannot verify request limits right now. Please try again in a minute." } },
  };
}

/** The quota service can only consume fixed preview limits; it has no AI or account API. */
export async function enforceGuestQuota(
  scope: RateLimitScope,
  clientIp: string | null,
  env: Record<string, string | undefined>,
): Promise<RateLimitDecision> {
  if (!clientIp || !isIP(clientIp)) return unavailable();
  let url: URL;
  try {
    url = new URL(env.DEEPSPEC_GUEST_QUOTA_URL ?? "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return unavailable();
  } catch {
    return unavailable();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUOTA_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, ipHash: createHash("sha256").update(`deepspec-guest-preview\0${clientIp}`).digest("hex") }),
    });
    const result = await response.json().catch(() => null) as { allowed?: unknown; retryAfterSeconds?: unknown } | null;
    if (response.status === 200 && result?.allowed === true) return { ok: true };
    if (response.status === 429 && result?.allowed === false
      && typeof result.retryAfterSeconds === "number" && Number.isInteger(result.retryAfterSeconds)
      && result.retryAfterSeconds > 0 && result.retryAfterSeconds <= 86_400) {
      return {
        ok: false,
        status: 429,
        retryAfterSeconds: result.retryAfterSeconds,
        body: { error: { code: "rate_limited", message: "Too many requests. Please wait a moment and try again." } },
      };
    }
    return unavailable();
  } catch {
    return unavailable();
  } finally {
    clearTimeout(timeout);
  }
}
