import { createClient } from "@supabase/supabase-js";

// Server-side rate limiting for the paid AI endpoints. Keyed by client IP only:
// anonymous sign-in is unlimited, so keying by user id would let an attacker reset the
// counter by minting fresh anonymous tokens. Backed by the rate_limit_hits table +
// check_rate_limit() RPC (see supabase/migrations), so it works across serverless
// instances where in-memory counters would not.

type RateLimitEnv = Record<string, string | undefined>;

type RateLimitRule = { label: string; windowSeconds: number; max: number };

export type RateLimitScope = "identify" | "chat";

export type RateLimitDecision =
  | { ok: true }
  | { ok: false; status: 429; retryAfterSeconds: number; body: { error: { code: string; message: string } } };

// Approved limits: identify 15/min + 150/day, chat 30/min + 300/day (per IP).
const RULES: Record<RateLimitScope, RateLimitRule[]> = {
  identify: [
    { label: "min", windowSeconds: 60, max: 15 },
    { label: "day", windowSeconds: 86_400, max: 150 },
  ],
  chat: [
    { label: "min", windowSeconds: 60, max: 30 },
    { label: "day", windowSeconds: 86_400, max: 300 },
  ],
};

const createRateLimitClient = createClient as unknown as (
  url: string,
  key: string,
  options?: unknown,
) => {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

export async function enforceRateLimit(
  scope: RateLimitScope,
  headers: Record<string, string | string[] | undefined>,
  env: RateLimitEnv,
): Promise<RateLimitDecision> {
  const supabaseUrl = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const clientIp = getClientIp(headers);

  // Fail open: without a backing store or a client IP to key on, we cannot rate limit.
  // Availability beats strictness here — a misconfigured limiter must never block scans.
  if (!supabaseUrl || !serviceRoleKey || !clientIp) {
    return { ok: true };
  }

  const supabase = createRateLimitClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const rule of RULES[scope]) {
    const key = `${scope}:${rule.label}:${clientIp}`;
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_key: key,
      p_max: rule.max,
      p_window_seconds: rule.windowSeconds,
    });

    if (error) {
      // Limiter query failed: fail open for this request, but log so it is visible.
      console.warn(`[DeepSpec] rate limit check failed (${scope}/${rule.label}):`, error);
      return { ok: true };
    }

    if (data === false) {
      return {
        ok: false,
        status: 429,
        retryAfterSeconds: rule.windowSeconds,
        body: {
          error: {
            code: "rate_limited",
            message: "Too many requests. Please wait a moment and try again.",
          },
        },
      };
    }
  }

  return { ok: true };
}

function getClientIp(headers: Record<string, string | string[] | undefined>): string | null {
  const forwarded = headerValue(headers["x-forwarded-for"] ?? headers["X-Forwarded-For"]);
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  const realIp = headerValue(headers["x-real-ip"] ?? headers["X-Real-IP"]);
  return realIp ? realIp.trim() : null;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
