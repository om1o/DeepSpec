type QaUser = {
  id: string;
  is_anonymous?: boolean;
  email_confirmed_at?: string;
  phone_confirmed_at?: string;
  app_metadata?: Record<string, unknown>;
};

export type QaScanAccess = { mode: "non-production"; expiresAt: string; userId: string };

// Server configuration AND freshly verified, admin-owned metadata are required.
// Never trust request headers, user_metadata, or locally decoded JWT claims here.
export function getQaScanAccess(user: QaUser, env: Record<string, string | undefined>, now = Date.now()): QaScanAccess | undefined {
  if (env.DEEPSPEC_ENFORCE_SCAN_CREDITS !== "false") return;
  if (env.VERCEL_ENV === "production") return;
  // Vercel previews run NODE_ENV=production; only its explicit preview tier may
  // override that. Unknown/custom production runtimes always retain enforcement.
  const nonProduction = env.VERCEL_ENV === "preview"
    || ((!env.VERCEL_ENV || env.VERCEL_ENV === "development")
      && (env.NODE_ENV === "development" || env.NODE_ENV === "test"));
  if (!nonProduction) return;
  if (!env.DEEPSPEC_QA_SCAN_USER_ID || user.id !== env.DEEPSPEC_QA_SCAN_USER_ID) return;
  if (user.is_anonymous === true || !(user.email_confirmed_at || user.phone_confirmed_at)) return;
  if (user.app_metadata?.deepspec_scan_qa !== true) return;
  const expiresAt = env.DEEPSPEC_QA_SCAN_EXPIRES_AT ?? "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(expiresAt)) return;
  const remaining = Date.parse(expiresAt) - now;
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 24 * 60 * 60 * 1000) return;
  return { mode: "non-production", expiresAt, userId: user.id };
}
