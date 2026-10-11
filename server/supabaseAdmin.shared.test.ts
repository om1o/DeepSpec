import { describe, expect, it } from "vitest";
import { createSupabaseAdminClient, getSupabaseAdminKey } from "./supabaseAdmin.shared";

describe("getSupabaseAdminKey", () => {
  it("prefers the rotatable Supabase secret key", () => {
    expect(getSupabaseAdminKey({
      SUPABASE_SECRET_KEY: " sb_secret_new ",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-service-role",
    })).toBe("sb_secret_new");
  });

  it("keeps the legacy key as a rollback fallback during rotation", () => {
    expect(getSupabaseAdminKey({ SUPABASE_SERVICE_ROLE_KEY: " legacy-service-role " }))
      .toBe("legacy-service-role");
  });

  it("fails closed when neither server key is configured", () => {
    expect(getSupabaseAdminKey({ SUPABASE_SECRET_KEY: "  " })).toBe("");
  });
});

describe("createSupabaseAdminClient", () => {
  it("keeps opaque admin keys out of Authorization while preserving user JWTs", async () => {
    const requests: Headers[] = [];
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Headers(init?.headers));
      return new Response(JSON.stringify([]), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    };
    const client = createSupabaseAdminClient(
      "https://project.supabase.co",
      "sb_secret_test",
      {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { fetch: fetchImpl },
      },
    );

    await client.from("rate_limit_hits").select("*");
    await client.auth.getUser("user-jwt");

    expect(requests[0]?.get("apikey")).toBe("sb_secret_test");
    expect(requests[0]?.get("authorization")).toBeNull();
    expect(requests[1]?.get("authorization")).toBe("Bearer user-jwt");
  });
});
