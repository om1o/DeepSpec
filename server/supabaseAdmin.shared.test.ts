// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createSupabaseAdminClient as createScriptAdminClient } from "../scripts/supabase-admin-env.mjs";
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

// Exercise the installed SDK, not a mocked createClient: auth, REST and Storage
// have separate header construction paths. Both admin factories must agree.
describe.each([
  ["server", createSupabaseAdminClient],
  ["trusted script", createScriptAdminClient],
] as const)("%s admin SDK transport", (_name, createAdmin) => {
  it.each(["sb_secret_test", "eyJhbGciOiJIUzI1NiJ9.legacy.signature"])(
    "authorizes admin RPC, writes, Auth and Storage requests with %s",
    async (key) => {
      const requests: { path: string; method: string; headers: Headers; body: unknown }[] = [];
      const client = createAdmin("https://project.supabase.co", key, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: {
          headers: { "x-qa-request": "transport-regression" },
          fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            const headers = new Headers(init?.headers);
            const path = new URL(String(input)).pathname;
            requests.push({ path, method: init?.method ?? "GET", headers, body: init?.body && JSON.parse(String(init.body)) });
            const authorized = headers.get("apikey") === key
              && headers.get("authorization") === (key.startsWith("sb_secret_") ? null : `Bearer ${key}`);
            return Response.json(authorized
              ? path.startsWith("/auth/") ? { id: "00000000-0000-4000-8000-000000000001" } : []
              : { message: "Invalid administrative headers" }, { status: authorized ? 200 : 401 });
          },
        },
      });

      expect((await client.rpc("check_rate_limit", { p_key: "identify:min:qa" })).error).toBeNull();
      expect((await client.from("billing_entitlements").upsert({ user_id: "owner" })).error).toBeNull();
      expect((await client.auth.admin.createUser({ email: "qa@example.test", email_confirm: true })).error).toBeNull();
      expect((await client.auth.admin.deleteUser("00000000-0000-4000-8000-000000000001")).error).toBeNull();
      expect((await client.storage.from("scan-images").download("owner/scan.jpg")).error).toBeNull();
      expect(requests.map(({ path, method }) => [path, method])).toEqual([
        ["/rest/v1/rpc/check_rate_limit", "POST"],
        ["/rest/v1/billing_entitlements", "POST"],
        ["/auth/v1/admin/users", "POST"],
        ["/auth/v1/admin/users/00000000-0000-4000-8000-000000000001", "DELETE"],
        ["/storage/v1/object/scan-images/owner/scan.jpg", "GET"],
      ]);
      expect(requests[0].body).toEqual({ p_key: "identify:min:qa" });
      expect(requests[1].body).toEqual({ user_id: "owner" });
      for (const request of requests) expect(request.headers.get("x-qa-request")).toBe("transport-regression");
    },
  );

  it.each(["eyJhbGciOiJIUzI1NiJ9.user.signature", "invalid-user-token"])(
    "preserves an explicit bearer instead of silently elevating it: %s",
    async (token) => {
      const requests: Headers[] = [];
      const client = createAdmin("https://project.supabase.co", "sb_secret_test", {
        auth: { autoRefreshToken: false, persistSession: false },
        global: {
          headers: { Authorization: `Bearer ${token}` },
          fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
            requests.push(new Headers(init?.headers));
            return Response.json({ message: "User access denied" }, { status: 403 });
          },
        },
      });
      const result = await client.from("billing_entitlements").select("*");
      expect(result.status).toBe(403);
      expect(result.error).not.toBeNull();
      expect(requests).toHaveLength(1);
      expect(requests[0].get("apikey")).toBe("sb_secret_test");
      expect(requests[0].get("authorization")).toBe(`Bearer ${token}`);
    },
  );
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
