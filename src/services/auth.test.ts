import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { hasLocalAuthBypass, markLocalAuthBypass, verifyEmailCode } from "./auth";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

describe("auth local bypass", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(createClient).mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not allow local bypass in production when auth config is missing", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    localStorage.setItem("ds_auth_seen", "1");

    expect(hasLocalAuthBypass()).toBe(false);
    expect(markLocalAuthBypass()).toBe(false);
  });

  it("fails closed when localStorage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(hasLocalAuthBypass()).toBe(false);
  });

  it("reports when the local bypass marker cannot be saved", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(markLocalAuthBypass()).toBe(false);
  });

  it("trusts the user returned by a successful email code verification", async () => {
    const user = { id: "user-1" };
    const verifyOtp = vi.fn().mockResolvedValue({
      data: {
        session: { user },
        user,
      },
      error: null,
    });
    const getUser = vi.fn();
    vi.mocked(createClient).mockReturnValue({
      auth: {
        getUser,
        verifyOtp,
      },
    } as never);
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "public-key");

    await expect(verifyEmailCode("driver@example.com", "123456")).resolves.toBe(user);
    expect(verifyOtp).toHaveBeenCalledWith({
      email: "driver@example.com",
      token: "123456",
      type: "email",
    });
    expect(getUser).not.toHaveBeenCalled();
  });
});
