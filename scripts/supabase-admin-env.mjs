import { createClient } from "@supabase/supabase-js";

export function readSupabaseAdminKey(env = process.env) {
  return String(env.SUPABASE_SECRET_KEY ?? "").trim()
    || String(env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
}

export function createSupabaseAdminClient(url, key, options = {}) {
  const configuredFetch = options.global?.fetch ?? globalThis.fetch.bind(globalThis);
  const safeFetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (key.startsWith("sb_secret_") && headers.get("authorization") === `Bearer ${key}`) {
      headers.delete("authorization");
    }
    return configuredFetch(input, { ...init, headers });
  };

  return createClient(url, key, {
    ...options,
    global: {
      ...options.global,
      fetch: safeFetch,
    },
  });
}
