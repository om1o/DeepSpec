export function readSupabaseAdminKey(env = process.env) {
  return String(env.SUPABASE_SECRET_KEY ?? "").trim()
    || String(env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
}
