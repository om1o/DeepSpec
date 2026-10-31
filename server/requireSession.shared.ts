import { createSupabaseAdminClient, getSupabaseAdminKey } from "./supabaseAdmin.shared.js";

// Paid AI endpoints always require a non-anonymous Supabase session. This is an auth
// gate, not a complete cost-control layer; IP rate limiting (rateLimit.shared.ts) and
// scan credits cap API cost.

type SessionEnv = Record<string, string | undefined>;

export type SessionDecision =
  | { ok: true; userId?: string }
  | { ok: false; status: number; body: { error: { code: string; message: string } } };

const createSessionClient = createSupabaseAdminClient as unknown as (
  url: string,
  key: string,
  options?: unknown,
) => {
  auth: {
    getUser: (token: string) => Promise<{
      data: { user: { id: string; is_anonymous?: boolean } | null };
      error: unknown;
    }>;
  };
};

export async function requireSession(
  headers: Record<string, string | string[] | undefined>,
  env: SessionEnv,
): Promise<SessionDecision> {
  const supabaseUrl = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim();
  const serviceRoleKey = getSupabaseAdminKey(env);
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
  if (error || !data.user || data.user.is_anonymous === true) {
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
