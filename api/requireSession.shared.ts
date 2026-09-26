import { createClient } from "@supabase/supabase-js";

// Optional auth gate for the paid AI endpoints. Off by default. When on, it requires a
// valid Supabase session on /api/identify and /api/chat. Anonymous sessions
// (signInAnonymously) count, so the "no email" flow keeps working — but a determined
// bot can still mint anonymous tokens, so this only blocks trivial no-token callers.
// IP rate limiting (rateLimit.shared.ts) is what actually caps API cost.

type SessionEnv = Record<string, string | undefined>;

export type SessionDecision =
  | { ok: true; userId?: string }
  | { ok: false; status: number; body: { error: { code: string; message: string } } };

const createSessionClient = createClient as unknown as (
  url: string,
  key: string,
  options?: unknown,
) => {
  auth: { getUser: (token: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
};

export async function requireSession(
  headers: Record<string, string | string[] | undefined>,
  env: SessionEnv,
): Promise<SessionDecision> {
  // Default OFF. Turn on DEEPSPEC_REQUIRE_SESSION=true only after confirming Supabase
  // anonymous auth is enabled and established before the first scan — otherwise
  // legitimate users who reach identify/chat without a session get a 401.
  if (env.DEEPSPEC_REQUIRE_SESSION !== "true") {
    return { ok: true };
  }

  const supabaseUrl = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false,
      status: 500,
      body: { error: { code: "not_configured", message: "DeepSpec session enforcement is not configured." } },
    };
  }

  const token = parseBearerToken(headers.authorization ?? headers.Authorization);
  if (!token) {
    return {
      ok: false,
      status: 401,
      body: { error: { code: "missing_session", message: "Sign in to use DeepSpec." } },
    };
  }

  const supabase = createSessionClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return {
      ok: false,
      status: 401,
      body: { error: { code: "invalid_session", message: "DeepSpec could not verify your session." } },
    };
  }

  return { ok: true, userId: data.user.id };
}

function parseBearerToken(value: string | string[] | undefined): string | null {
  const header = Array.isArray(value) ? value[0] : value;
  const match = typeof header === "string" ? header.match(/^Bearer\s+(.+)$/i) : null;
  return match ? match[1].trim() : null;
}
