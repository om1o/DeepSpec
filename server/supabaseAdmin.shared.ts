export type SupabaseAdminEnv = Record<string, string | undefined>;

export function getSupabaseAdminKey(env: SupabaseAdminEnv): string {
  return env.SUPABASE_SECRET_KEY?.trim()
    || env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    || "";
}
