import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasLocalAuthBypass, markLocalAuthBypass } from "./auth";

describe("auth local bypass", () => {
  beforeEach(() => {
    localStorage.clear();
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
});
