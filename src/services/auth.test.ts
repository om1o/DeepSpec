import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({
  auth: {
    exchangeCodeForSession: vi.fn(),
    getUser: vi.fn(),
    onAuthStateChange: vi.fn(),
    signInAnonymously: vi.fn(),
    signInWithOtp: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    signUp: vi.fn(),
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
    window.history.pushState({}, "", "/");
    supabaseMock.auth.exchangeCodeForSession.mockReset();
    supabaseMock.auth.getUser.mockReset();
    supabaseMock.auth.onAuthStateChange.mockReset();
    supabaseMock.auth.signInAnonymously.mockReset();
    supabaseMock.auth.signInWithOtp.mockReset();
    supabaseMock.auth.signInWithPassword.mockReset();
    supabaseMock.auth.signOut.mockReset();
    supabaseMock.auth.signUp.mockReset();
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
    supabaseMock.auth.exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
    supabaseMock.auth.signInAnonymously.mockResolvedValue({ data: {}, error: null });
    supabaseMock.auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
    supabaseMock.auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    supabaseMock.auth.signUp.mockResolvedValue({ data: { session: { access_token: "token" } }, error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("keeps OAuth providers disabled unless the build explicitly enables them", async () => {
    const defaultAuth = await import("./auth");

    expect(defaultAuth.isGoogleAuthEnabled()).toBe(false);
    expect(defaultAuth.isGitHubAuthEnabled()).toBe(false);

    vi.resetModules();
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    vi.stubEnv("VITE_ENABLE_GOOGLE_AUTH", "true");
    vi.stubEnv("VITE_ENABLE_GITHUB_AUTH", "true");

    const enabledAuth = await import("./auth");

    expect(enabledAuth.isGoogleAuthEnabled()).toBe(true);
    expect(enabledAuth.isGitHubAuthEnabled()).toBe(true);
  });

  it("sends email sign-in links with the current scan redirect", async () => {
    const { sendEmailSignInLink } = await import("./auth");

    await expect(sendEmailSignInLink("user@example.com")).resolves.toBeUndefined();

    expect(supabaseMock.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "user@example.com",
      options: {
        emailRedirectTo: "http://localhost:3000/scan",
        shouldCreateUser: true,
      },
    });
  });

  it("starts anonymous sessions through Supabase and verifies the returned user", async () => {
    const { signInAnonymously } = await import("./auth");
    supabaseMock.auth.getUser.mockResolvedValue({
      data: {
        user: {
          app_metadata: {},
          aud: "authenticated",
          created_at: new Date(0).toISOString(),
          id: "anonymous-user",
          user_metadata: {},
        },
      },
      error: null,
    });

    await expect(signInAnonymously()).resolves.toEqual(expect.objectContaining({ id: "anonymous-user" }));

    expect(supabaseMock.auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it("creates a password account only when Supabase returns an active session", async () => {
    const { signUpWithPassword } = await import("./auth");
    supabaseMock.auth.getUser.mockResolvedValue({
      data: {
        user: {
          app_metadata: {},
          aud: "authenticated",
          created_at: new Date(0).toISOString(),
          id: "new-password-user",
          user_metadata: {},
        },
      },
      error: null,
    });

    await expect(signUpWithPassword("new@example.com", "correct-password")).resolves.toEqual(expect.objectContaining({ id: "new-password-user" }));

    expect(supabaseMock.auth.signUp).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "correct-password",
      options: {
        emailRedirectTo: "http://localhost:3000/scan",
      },
    });
  });

  it("fails password account creation clearly when email confirmation is still required", async () => {
    const { signUpWithPassword } = await import("./auth");
    supabaseMock.auth.signUp.mockResolvedValueOnce({ data: { session: null }, error: null });

    await expect(signUpWithPassword("new@example.com", "correct-password")).rejects.toThrow(
      "Supabase still requires email confirmation for new password accounts.",
    );
    expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  });

  it("fails closed when Supabase user verification hangs", async () => {
    vi.useFakeTimers();
    const { getVerifiedAuthUser } = await import("./auth");
    supabaseMock.auth.getUser.mockReturnValue(new Promise(() => undefined));

    const userPromise = getVerifiedAuthUser();
    await vi.advanceTimersByTimeAsync(8_000);

    await expect(userPromise).resolves.toBeNull();
  });

  it("exchanges an OAuth callback code before returning the verified user", async () => {
    window.history.pushState({}, "", "/scan?code=oauth-code&keep=1#camera");
    const { getVerifiedAuthUser } = await import("./auth");
    supabaseMock.auth.getUser.mockResolvedValue({
      data: {
        user: {
          app_metadata: {},
          aud: "authenticated",
          created_at: new Date(0).toISOString(),
          id: "oauth-user",
          user_metadata: {},
        },
      },
      error: null,
    });

    await expect(getVerifiedAuthUser()).resolves.toEqual(expect.objectContaining({ id: "oauth-user" }));

    expect(supabaseMock.auth.exchangeCodeForSession).toHaveBeenCalledWith("oauth-code");
    expect(supabaseMock.auth.exchangeCodeForSession.mock.invocationCallOrder[0]).toBeLessThan(
      supabaseMock.auth.getUser.mock.invocationCallOrder[0],
    );
    expect(window.location.pathname).toBe("/scan");
    expect(window.location.search).toBe("?keep=1");
    expect(window.location.hash).toBe("#camera");
  });

  it("fails closed when an OAuth callback code cannot be exchanged", async () => {
    window.history.pushState({}, "", "/scan?code=bad-code");
    const { getVerifiedAuthUser } = await import("./auth");
    supabaseMock.auth.exchangeCodeForSession.mockResolvedValue({
      data: {},
      error: {
        message: "Invalid code",
      },
    });

    await expect(getVerifiedAuthUser()).resolves.toBeNull();

    expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
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

  it("defers Supabase user verification outside the auth-change callback", async () => {
    vi.useFakeTimers();
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

    expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "verified-user" })));
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

  it("signs out through the Supabase client", async () => {
    const { signOut } = await import("./auth");
    supabaseMock.auth.signOut.mockResolvedValue({ error: null });

    await expect(signOut()).resolves.toBeUndefined();
    expect(supabaseMock.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("surfaces a sign-out failure instead of failing silently", async () => {
    const { signOut } = await import("./auth");
    supabaseMock.auth.signOut.mockResolvedValue({ error: { message: "Sign-out failed" } });

    await expect(signOut()).rejects.toThrow("Sign-out failed");
  });
});
