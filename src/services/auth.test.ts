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
    verifyOtp: vi.fn(),
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
    supabaseMock.auth.verifyOtp.mockReset();
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
    supabaseMock.auth.verifyOtp.mockResolvedValue({ data: {}, error: null });
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

    await expect(sendEmailSignInLink("user@example.com")).resolves.toEqual({
      delivery: "link",
      emailRedirectTo: "http://localhost:3000/auth?next=%2Fscan",
    });

    expect(supabaseMock.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "user@example.com",
      options: {
        emailRedirectTo: "http://localhost:3000/auth?next=%2Fscan",
        shouldCreateUser: true,
      },
    });
  });

  it("falls back to a code-only email OTP when Supabase rejects the public redirect URL", async () => {
    const { sendEmailSignInLink } = await import("./auth");
    supabaseMock.auth.signInWithOtp
      .mockResolvedValueOnce({
        data: {},
        error: {
          message: "Redirect URL is not allowed",
        },
      })
      .mockResolvedValueOnce({
        data: {},
        error: null,
      });

    await expect(sendEmailSignInLink("user@example.com")).resolves.toEqual({
      delivery: "code",
    });

    expect(supabaseMock.auth.signInWithOtp).toHaveBeenNthCalledWith(1, {
      email: "user@example.com",
      options: {
        emailRedirectTo: "http://localhost:3000/auth?next=%2Fscan",
        shouldCreateUser: true,
      },
    });
    expect(supabaseMock.auth.signInWithOtp).toHaveBeenNthCalledWith(2, {
      email: "user@example.com",
      options: {
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
        emailRedirectTo: "http://localhost:3000/auth?next=%2Fscan",
      },
    });
  });

  it("normalizes post-auth routes to same-origin app paths only", async () => {
    const { normalizePostAuthRedirectPath } = await import("./auth");

    expect(normalizePostAuthRedirectPath("/history?filter=recent#scan-1")).toBe("/history?filter=recent#scan-1");
    expect(normalizePostAuthRedirectPath("http://localhost:3000/result/123")).toBe("/result/123");
    expect(normalizePostAuthRedirectPath("https://evil.example.com/steal")).toBe("/scan");
    expect(normalizePostAuthRedirectPath("//evil.example.com/steal")).toBe("/scan");
  });

  it("never lets a hostile next value resolve to another origin", async () => {
    const { normalizePostAuthRedirectPath } = await import("./auth");
    const backslash = String.fromCharCode(92);
    const tab = String.fromCharCode(9);
    const lineFeed = String.fromCharCode(10);
    const carriageReturn = String.fromCharCode(13);
    // The URL parser treats a backslash as a slash and drops tabs/newlines, so each of these
    // resolves to https://evil.example.com even though none starts with a literal "//".
    const hostile = [
      `/${backslash}evil.example.com`,
      `/${backslash}${backslash}evil.example.com`,
      `/${tab}/evil.example.com`,
      `/${lineFeed}/evil.example.com`,
      `/${carriageReturn}/evil.example.com`,
      `${backslash}/evil.example.com`,
      `${backslash}${backslash}evil.example.com`,
    ];

    for (const value of hostile) {
      const normalized = normalizePostAuthRedirectPath(value);
      expect(new URL(normalized, window.location.origin).origin, JSON.stringify(value)).toBe(window.location.origin);
    }
  });

  it("keeps ordinary same-origin post-auth paths untouched", async () => {
    const { normalizePostAuthRedirectPath } = await import("./auth");

    expect(normalizePostAuthRedirectPath("/scan?jobId=abc-123")).toBe("/scan?jobId=abc-123");
    expect(normalizePostAuthRedirectPath("/result/42/chat?q=is%20it%20safe")).toBe("/result/42/chat?q=is%20it%20safe");
    expect(normalizePostAuthRedirectPath("/%5Cnot-a-host")).toBe("/%5Cnot-a-host");
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

  it("reuses a recently verified Supabase user without a second network verification", async () => {
    const { getVerifiedAuthUser } = await import("./auth");
    supabaseMock.auth.getUser.mockResolvedValue({
      data: {
        user: makeAuthUser("verified-user"),
      },
      error: null,
    });

    await expect(getVerifiedAuthUser()).resolves.toEqual(expect.objectContaining({ id: "verified-user" }));
    await expect(getVerifiedAuthUser()).resolves.toEqual(expect.objectContaining({ id: "verified-user" }));

    expect(supabaseMock.auth.getUser).toHaveBeenCalledTimes(1);
  });

  it("clears the verified user cache after Supabase sign-out succeeds", async () => {
    const { getVerifiedAuthUser, signOut } = await import("./auth");
    supabaseMock.auth.getUser
      .mockResolvedValueOnce({
        data: {
          user: makeAuthUser("verified-user"),
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          user: null,
        },
        error: null,
      });
    supabaseMock.auth.signOut.mockResolvedValue({ error: null });

    await expect(getVerifiedAuthUser()).resolves.toEqual(expect.objectContaining({ id: "verified-user" }));
    await expect(signOut()).resolves.toBeUndefined();
    await expect(getVerifiedAuthUser()).resolves.toBeNull();

    expect(supabaseMock.auth.getUser).toHaveBeenCalledTimes(2);
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

  it("recovers from a spent callback code so a fresh email code can still sign in", async () => {
    window.history.pushState({}, "", "/auth?next=%2Fscan&code=already-used");
    const { getVerifiedAuthUser, verifyEmailCode } = await import("./auth");
    supabaseMock.auth.exchangeCodeForSession.mockResolvedValue({
      data: {},
      error: {
        message: "invalid request: both auth code and code verifier should be non-empty",
      },
    });
    supabaseMock.auth.getUser.mockResolvedValue({
      data: {
        user: {
          app_metadata: {},
          aud: "authenticated",
          created_at: new Date(0).toISOString(),
          id: "otp-user",
          user_metadata: {},
        },
      },
      error: null,
    });

    await expect(getVerifiedAuthUser()).resolves.toBeNull();

    await expect(verifyEmailCode("user@example.com", "123456")).resolves.toEqual(
      expect.objectContaining({ id: "otp-user" }),
    );

    expect(window.location.search).toBe("?next=%2Fscan");
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

  it("reports a cold saved session as pending, not signed out, until verified", async () => {
    vi.useFakeTimers();
    const { subscribeToAuthChanges } = await import("./auth");
    const { setActiveAccount } = await import("../lib/accountScope");
    setActiveAccount(null);
    const onChange = vi.fn();
    const onVerifying = vi.fn();
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: makeAuthUser("saved-user") }, error: null });
    await subscribeToAuthChanges(onChange, onVerifying);
    const listener = supabaseMock.auth.onAuthStateChange.mock.calls[0][0];
    listener("INITIAL_SESSION", { user: { id: "saved-user" } });
    expect(onVerifying).toHaveBeenCalledWith("saved-user");
    expect(onChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "saved-user" }));
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

  it("does not restore an old verified user after sign-out", async () => {
    const { getVerifiedAuthUser, signOut } = await import("./auth");
    const { getAccountScope } = await import("../lib/accountScope");
    let resolveUser: (value: unknown) => void = () => {};
    supabaseMock.auth.getUser.mockReturnValue(new Promise((resolve) => { resolveUser = resolve; }));
    supabaseMock.auth.signOut.mockResolvedValue({ error: null });
    const pending = getVerifiedAuthUser();
    await vi.waitFor(() => expect(supabaseMock.auth.getUser).toHaveBeenCalled());
    await signOut();
    resolveUser({ data: { user: { id: "old-user" } }, error: null });
    expect(await pending).toBeNull();
    expect(getAccountScope().userId).toBeNull();
  });

  it("does not verify across sign-out while client initialization is pending", async () => {
    let resolveClient!: (value: unknown) => void;
    supabaseMock.createClient.mockReturnValue(new Promise((resolve) => { resolveClient = resolve; }));
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: makeAuthUser("old-user") }, error: null });
    supabaseMock.auth.signOut.mockResolvedValue({ error: null });
    const { getVerifiedAuthUser, signOut } = await import("./auth");
    const pending = getVerifiedAuthUser();
    await vi.waitFor(() => expect(supabaseMock.createClient).toHaveBeenCalled());
    const signingOut = signOut();
    resolveClient({ auth: supabaseMock.auth });
    expect(await pending).toBeNull();
    await signingOut;
    expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  });

  it("keeps verification blocked while sign-out is pending", async () => {
    let finishSignOut!: (value: unknown) => void;
    supabaseMock.auth.signOut.mockReturnValue(new Promise((resolve) => { finishSignOut = resolve; }));
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: makeAuthUser("old-user") }, error: null });
    const { getVerifiedAuthUser, signOut } = await import("./auth");
    const signingOut = signOut();
    await vi.waitFor(() => expect(supabaseMock.auth.signOut).toHaveBeenCalled());
    expect(await getVerifiedAuthUser()).toBeNull();
    expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
    finishSignOut({ error: null });
    await signingOut;
    const { getAccountScope } = await import("../lib/accountScope");
    expect(getAccountScope().userId).toBeNull();
  });

  it("verifies the newly signed-in identity instead of reusing a previous account cache", async () => {
    const { getVerifiedAuthUser, signInWithPassword } = await import("./auth");
    supabaseMock.auth.getUser.mockResolvedValueOnce({ data: { user: makeAuthUser("account-a") }, error: null })
      .mockResolvedValueOnce({ data: { user: makeAuthUser("account-b") }, error: null });
    expect((await getVerifiedAuthUser())?.id).toBe("account-a");
    supabaseMock.auth.signInWithPassword.mockResolvedValue({ data: { user: makeAuthUser("account-b") }, error: null });
    expect((await signInWithPassword("b@example.com", "password")).id).toBe("account-b");
    expect(supabaseMock.auth.getUser).toHaveBeenCalledTimes(2);
  });

  it("rejects a sign-in completing after sign-out", async () => {
    let finishSignIn!: (value: unknown) => void;
    supabaseMock.auth.signInWithPassword.mockReturnValue(new Promise((resolve) => { finishSignIn = resolve; }));
    supabaseMock.auth.signOut.mockResolvedValue({ error: null });
    const { signInWithPassword, signOut } = await import("./auth");
    const pending = signInWithPassword("a@example.com", "password");
    const rejected = expect(pending).rejects.toThrow("Session changed");
    await vi.waitFor(() => expect(supabaseMock.auth.signInWithPassword).toHaveBeenCalled());
    await signOut();
    finishSignIn({ data: { user: makeAuthUser("account-a") }, error: null });
    await rejected;
    expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  });

  it("surfaces a sign-out failure instead of failing silently", async () => {
    const { signOut } = await import("./auth");
    supabaseMock.auth.signOut.mockResolvedValue({ error: { message: "Sign-out failed" } });

    await expect(signOut()).rejects.toThrow("Sign-out failed");
  });
});

function makeAuthUser(id: string) {
  return {
    app_metadata: {},
    aud: "authenticated",
    created_at: new Date(0).toISOString(),
    id,
    user_metadata: {},
  };
}
