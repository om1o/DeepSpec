import { describe, expect, it } from "vitest";
import { createSupabaseAdminClient, readSupabaseAdminKey } from "./supabase-admin-env.mjs";

describe("readSupabaseAdminKey", () => {
  it("prefers a non-empty rotatable secret key", () => {
    expect(readSupabaseAdminKey({
      SUPABASE_SECRET_KEY: " new-secret ",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-secret",
    })).toBe("new-secret");
  });

  it("falls back when the new key is blank", () => {
    expect(readSupabaseAdminKey({
      SUPABASE_SECRET_KEY: "   ",
      SUPABASE_SERVICE_ROLE_KEY: " legacy-secret ",
    })).toBe("legacy-secret");
  });
});

describe("createSupabaseAdminClient", () => {
  it("keeps opaque admin keys out of Authorization while preserving user JWTs", async () => {
    const requests = [];
    const client = createSupabaseAdminClient(
      "https://project.supabase.co",
      "sb_secret_test",
      {
        auth: { autoRefreshToken: false, persistSession: false },
        global: {
          fetch: async (_input, init) => {
            requests.push(new Headers(init?.headers));
            return new Response(JSON.stringify([]), {
              headers: { "content-type": "application/json" },
              status: 200,
            });
          },
        },
      },
    );

    await client.from("billing_entitlements").select("*");
    await client.auth.getUser("user-jwt");

    expect(requests[0]?.get("apikey")).toBe("sb_secret_test");
    expect(requests[0]?.get("authorization")).toBeNull();
    expect(requests[1]?.get("authorization")).toBe("Bearer user-jwt");
  });
});
