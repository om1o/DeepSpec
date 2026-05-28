import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({
  auth: {
    getUser: vi.fn(),
    onAuthStateChange: vi.fn(),
  },
  createClient: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: supabaseMock.createClient,
}));

describe("auth service", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    supabaseMock.auth.getUser.mockReset();
    supabaseMock.auth.onAuthStateChange.mockReset();
    supabaseMock.createClient.mockReset();
    supabaseMock.unsubscribe.mockReset();
    supabaseMock.createClient.mockReturnValue({
      auth: supabaseMock.auth,
    });
    supabaseMock.auth.onAuthStateChange.mockReturnValue({
      data: {
        subscription: {
          unsubscribe: supabaseMock.unsubscribe,
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fails closed when Supabase user verification hangs", async () => {
    vi.useFakeTimers();
    const { getVerifiedAuthUser } = await import("./auth");
    supabaseMock.auth.getUser.mockReturnValue(new Promise(() => undefined));

    const userPromise = getVerifiedAuthUser();
    await vi.advanceTimersByTimeAsync(8_000);

    await expect(userPromise).resolves.toBeNull();
  });

  it("verifies auth-change sessions with Supabase before reporting a user", async () => {
    const { subscribeToAuthChanges } = await import("./auth");
    const onChange = vi.fn();
    supabaseMock.auth.getUser.mockResolvedValue({
      data: {
        user: {
          app_metadata: {},
          aud: "authenticated",
          created_at: new Date(0).toISOString(),
          id: "verified-user",
          user_metadata: {},
        },
      },
      error: null,
    });

    await subscribeToAuthChanges(onChange);
    const listener = supabaseMock.auth.onAuthStateChange.mock.calls[0][0];
    listener("SIGNED_IN", {
      user: {
        id: "event-user",
      },
    });

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "verified-user" })));
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ id: "event-user" }));
  });

  it("fails closed when an auth-change session cannot be verified", async () => {
    const { subscribeToAuthChanges } = await import("./auth");
    const onChange = vi.fn();
    supabaseMock.auth.getUser.mockResolvedValue({
      data: {
        user: null,
      },
      error: {
        message: "Invalid token",
      },
    });

    await subscribeToAuthChanges(onChange);
    const listener = supabaseMock.auth.onAuthStateChange.mock.calls[0][0];
    listener("SIGNED_IN", {
      user: {
        id: "event-user",
      },
    });

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
  });
});
