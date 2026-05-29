import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({
  auth: {
    getUser: vi.fn(),
    signInWithOAuth: vi.fn(),
    signInWithOtp: vi.fn(),
    signInWithPassword: vi.fn(),
    signInAnonymously: vi.fn(),
    signUp: vi.fn(),
    verifyOtp: vi.fn(),
  },
  createClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: supabaseMock.createClient,
}));

describe("Auth", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.stubEnv("VITE_SUPABASE_URL", "https://deep-spec.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "public-test-key");
    vi.stubEnv("VITE_ENABLE_GOOGLE_AUTH", undefined);
    vi.stubEnv("VITE_ENABLE_GITHUB_AUTH", undefined);

    supabaseMock.auth.getUser.mockReset();
    supabaseMock.auth.signInWithOAuth.mockReset();
    supabaseMock.auth.signInWithOtp.mockReset();
    supabaseMock.auth.signInWithPassword.mockReset();
    supabaseMock.auth.signInAnonymously.mockReset();
    supabaseMock.auth.signUp.mockReset();
    supabaseMock.auth.verifyOtp.mockReset();
    supabaseMock.createClient.mockReset();

    supabaseMock.createClient.mockReturnValue({ auth: supabaseMock.auth });
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    supabaseMock.auth.signInWithOAuth.mockResolvedValue({ data: {}, error: null });
    supabaseMock.auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
    supabaseMock.auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    supabaseMock.auth.signInAnonymously.mockResolvedValue({ data: {}, error: null });
    supabaseMock.auth.signUp.mockResolvedValue({ data: {}, error: null });
    supabaseMock.auth.verifyOtp.mockResolvedValue({ data: {}, error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses Deep Spec branding and defaults to password sign-in without unconfigured OAuth providers", async () => {
    await renderAuth();

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getAllByAltText("Deep Spec")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with GitHub" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter your email address")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Password" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Sign in with password" })).toBeInTheDocument();
    expect(screen.getByText("Cloud ready")).toBeInTheDocument();
    expect(screen.queryByText(/facebook/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/microsoft/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/apple/i)).not.toBeInTheDocument();
  });

  it("shows OAuth providers only when they are enabled for the build", async () => {
    vi.stubEnv("VITE_ENABLE_GOOGLE_AUTH", "true");
    vi.stubEnv("VITE_ENABLE_GITHUB_AUTH", "true");

    await renderAuth();

    expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeInTheDocument();
  });

  it("sends a Supabase email sign-in link and verifies the code fallback", async () => {
    const user = userEvent.setup();
    supabaseMock.auth.getUser
      .mockResolvedValueOnce({ data: { user: null }, error: null })
      .mockResolvedValueOnce({ data: { user: makeUser("user-1") }, error: null });

    await renderAuth();

    await user.click(await screen.findByRole("tab", { name: "Email link" }));
    await user.type(await screen.findByPlaceholderText("Enter your email address"), "Tester@Example.com");
    await user.click(screen.getByRole("button", { name: "Send sign-in link" }));

    await waitFor(() => {
      expect(supabaseMock.auth.signInWithOtp).toHaveBeenCalledWith({
        email: "tester@example.com",
        options: {
          emailRedirectTo: "http://localhost:3000/scan",
          shouldCreateUser: true,
        },
      });
    });

    expect(await screen.findByText("Sign-in link sent to tester@example.com. Open it from your email to finish login.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Verification code")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "I have a code" }));
    await user.type(await screen.findByLabelText("Verification code"), "123456");

    await waitFor(() => {
      expect(supabaseMock.auth.verifyOtp).toHaveBeenCalledWith({
        email: "tester@example.com",
        token: "123456",
        type: "email",
      });
    });
    expect(await screen.findByText("Scanner opened")).toBeInTheDocument();
  });

  it("does not open the scanner when code auth does not verify a user", async () => {
    const user = userEvent.setup();
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });

    await renderAuth();

    await user.click(await screen.findByRole("tab", { name: "Email link" }));
    await user.type(await screen.findByPlaceholderText("Enter your email address"), "tester@example.com");
    await user.click(screen.getByRole("button", { name: "Send sign-in link" }));
    await user.click(await screen.findByRole("button", { name: "I have a code" }));
    await user.type(await screen.findByLabelText("Verification code"), "123456");

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not verify this session. Request a new code and try again.");
    expect(screen.queryByText("Scanner opened")).not.toBeInTheDocument();
  });

  it("starts Google auth when that provider is enabled for the build", async () => {
    vi.stubEnv("VITE_ENABLE_GOOGLE_AUTH", "true");
    const user = userEvent.setup();
    await renderAuth();

    await user.click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(supabaseMock.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "http://localhost:3000/scan",
      },
    });
    expect(screen.queryByText(/facebook/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/microsoft/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/apple/i)).not.toBeInTheDocument();
  });

  it("signs in with an email and password after Supabase verifies the session", async () => {
    const user = userEvent.setup();
    supabaseMock.auth.getUser
      .mockResolvedValueOnce({ data: { user: null }, error: null })
      .mockResolvedValueOnce({ data: { user: makeUser("password-user") }, error: null });

    await renderAuth();

    await user.type(await screen.findByPlaceholderText("Enter your email address"), "Tester@Example.com");
    await user.type(screen.getByPlaceholderText("Enter your password"), "correct-password");
    await user.click(screen.getByRole("button", { name: "Sign in with password" }));

    await waitFor(() => {
      expect(supabaseMock.auth.signInWithPassword).toHaveBeenCalledWith({
        email: "tester@example.com",
        password: "correct-password",
      });
    });
    expect(await screen.findByText("Scanner opened")).toBeInTheDocument();
  });

  it("does not open the scanner when password auth does not verify a user", async () => {
    const user = userEvent.setup();
    supabaseMock.auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: { message: "Invalid login credentials" } });

    await renderAuth();

    await user.type(await screen.findByPlaceholderText("Enter your email address"), "tester@example.com");
    await user.type(screen.getByPlaceholderText("Enter your password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in with password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid login credentials");
    expect(screen.queryByText("Scanner opened")).not.toBeInTheDocument();
  });

  it("opens the scanner with a no-email Supabase session", async () => {
    const user = userEvent.setup();
    supabaseMock.auth.getUser
      .mockResolvedValueOnce({ data: { user: null }, error: null })
      .mockResolvedValueOnce({ data: { user: makeUser("anonymous-user") }, error: null });

    await renderAuth();

    await user.click(await screen.findByRole("button", { name: "No email" }));
    expect(screen.queryByPlaceholderText("Enter your email address")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Enter your password")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue without email" }));

    await waitFor(() => {
      expect(supabaseMock.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Scanner opened")).toBeInTheDocument();
  });

  it("starts GitHub auth when that provider is enabled for the build", async () => {
    vi.stubEnv("VITE_ENABLE_GITHUB_AUTH", "true");
    const user = userEvent.setup();
    await renderAuth();

    await user.click(await screen.findByRole("button", { name: "Continue with GitHub" }));

    expect(supabaseMock.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "github",
      options: {
        redirectTo: "http://localhost:3000/scan",
      },
    });
    expect(screen.queryByText(/facebook/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/microsoft/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/apple/i)).not.toBeInTheDocument();
  });

  it("hides OAuth providers when they are explicitly disabled", async () => {
    vi.stubEnv("VITE_ENABLE_GOOGLE_AUTH", "false");
    vi.stubEnv("VITE_ENABLE_GITHUB_AUTH", "false");

    await renderAuth();

    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with GitHub" })).not.toBeInTheDocument();
  });

  it("fails closed when Supabase auth is not configured", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");

    await renderAuth();

    expect(await screen.findByText("Supabase auth is not configured for this build.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /google/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /github/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Auth unavailable" })).toBeDisabled();
    expect(screen.queryByText("Scanner opened")).not.toBeInTheDocument();
  });

  it("fails closed when production auth config is missing", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");

    await renderAuth();

    expect(await screen.findByText("Supabase auth is not configured for this build.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Auth unavailable" })).toBeDisabled();
    expect(screen.queryByText("Scanner opened")).not.toBeInTheDocument();
  });

  it("extracts a 6-digit code from a noisy paste like 'Your code is 123456'", async () => {
    const user = userEvent.setup();
    await renderAuth();

    await user.click(await screen.findByRole("tab", { name: "Email link" }));
    await user.type(await screen.findByPlaceholderText("Enter your email address"), "tester@example.com");
    await user.click(screen.getByRole("button", { name: "Send sign-in link" }));
    await user.click(await screen.findByRole("button", { name: "I have a code" }));

    const codeInput = await screen.findByLabelText("Verification code");
    codeInput.focus();
    await user.paste("Your verification code is: 123456 — do not share.");

    await waitFor(() => {
      expect(supabaseMock.auth.verifyOtp).toHaveBeenCalledWith({
        email: "tester@example.com",
        token: "123456",
        type: "email",
      });
    });
  });

  it("disables the resend button with a live countdown after sending a sign-in link", async () => {
    const user = userEvent.setup();
    await renderAuth();

    await user.click(await screen.findByRole("tab", { name: "Email link" }));
    await user.type(await screen.findByPlaceholderText("Enter your email address"), "tester@example.com");
    await user.click(screen.getByRole("button", { name: "Send sign-in link" }));

    const resendButton = await screen.findByRole("button", { name: /Send in \d+s/ });
    expect(resendButton).toBeDisabled();
    expect(resendButton.textContent).toMatch(/Send in 30s/);
  });
});

async function renderAuth() {
  const { default: Auth } = await import("./Auth");

  render(
    <MemoryRouter initialEntries={["/auth"]}>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/scan" element={<div>Scanner opened</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function makeUser(id: string) {
  return {
    app_metadata: {},
    aud: "authenticated",
    created_at: new Date(0).toISOString(),
    id,
    user_metadata: {},
  };
}
