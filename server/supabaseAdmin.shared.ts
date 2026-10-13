import { createClient } from "@supabase/supabase-js";

export type SupabaseAdminEnv = Record<string, string | undefined>;

type SupabaseClientOptions = Parameters<typeof createClient>[2];

export function getSupabaseAdminKey(env: SupabaseAdminEnv): string {
  return env.SUPABASE_SECRET_KEY?.trim()
    || env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    || "";
}

export function createSupabaseAdminClient(
  url: string,
  key: string,
  options?: SupabaseClientOptions,
): ReturnType<typeof createClient> {
  const configuredFetch = options?.global?.fetch ?? globalThis.fetch.bind(globalThis);
  const safeFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (key.startsWith("sb_secret_") && headers.get("authorization") === `Bearer ${key}`) {
      headers.delete("authorization");
    }
    return configuredFetch(input, { ...init, headers });
  };

  return createClient(url, key, {
    ...options,
    global: {
      ...options?.global,
      fetch: safeFetch,
    },
  });
}
