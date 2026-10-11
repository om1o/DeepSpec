import { describe, expect, it } from "vitest";
import { readSupabaseAdminKey } from "./supabase-admin-env.mjs";

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
