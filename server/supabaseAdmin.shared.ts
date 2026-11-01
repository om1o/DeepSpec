import { createClient } from "@supabase/supabase-js";

export type SupabaseAdminEnv = Record<string, string | undefined>;

type SupabaseClientOptions = Parameters<typeof createClient>[2];
const SUPABASE_ADMIN_REQUEST_TIMEOUT_MS = 8_000;

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
  const safeFetch = createSupabaseAdminFetch(key, configuredFetch);

  return createClient(url, key, {
    ...options,
    global: {
      ...options?.global,
      fetch: safeFetch,
    },
  });
}

export function createSupabaseAdminFetch(key: string, configuredFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (key.startsWith("sb_secret_") && headers.get("authorization") === `Bearer ${key}`) {
      headers.delete("authorization");
    }

    const controller = new AbortController();
    const sourceSignal = init?.signal;
    const forwardAbort = () => controller.abort(sourceSignal?.reason);
    if (sourceSignal?.aborted) {
      forwardAbort();
    } else {
      sourceSignal?.addEventListener("abort", forwardAbort, { once: true });
    }
    const timeoutId = setTimeout(
      () => controller.abort(new Error("Supabase request timed out.")),
      SUPABASE_ADMIN_REQUEST_TIMEOUT_MS,
    );

    try {
      return await configuredFetch(input, { ...init, headers, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
      sourceSignal?.removeEventListener("abort", forwardAbort);
    }
  };
}
