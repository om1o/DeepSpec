import { describe, expect, it } from "vitest";
import { getSupabaseAdminKey } from "./supabaseAdmin.shared";

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
