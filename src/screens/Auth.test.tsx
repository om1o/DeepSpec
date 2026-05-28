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
    supabaseMock.auth.signUp.mockReset();
    supabaseMock.auth.verifyOtp.mockReset();
    supabaseMock.createClient.mockReset();

    supabaseMock.createClient.mockReturnValue({ auth: supabaseMock.auth });
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    supabaseMock.auth.signInWithOAuth.mockResolvedValue({ data: {}, error: null });
    supabaseMock.auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
    supabaseMock.auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    supabaseMock.auth.signUp.mockResolvedValue({ data: {}, error: null });
    supabaseMock.auth.verifyOtp.mockResolvedValue({ data: {}, error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses Deep Spec branding and defaults to code sign-in", async () => {
    await renderAuth();

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByAltText("Deep Spec")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter your email address")).toBeInTheDocument();
    expect(screen.queryByText(/facebook/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/microsoft/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/apple/i)).not.toBeInTheDocument();
  });

  it("sends and verifies a Supabase email verification code", async () => {
    const user = userEvent.setup();
    supabaseMock.auth.getUser
      .mockResolvedValueOnce({ data: { user: null }, error: null })
      .mockResolvedValueOnce({ data: { user: makeUser("user-1") }, error: null });

    await renderAuth();

    await user.type(await screen.findByPlaceholderText("Enter your email address"), "Tester@Example.com");
    await user.click(screen.getByRole("button", { name: "Send verification code" }));

    await waitFor(() => {
      expect(supabaseMock.auth.signInWithOtp).toHaveBeenCalledWith({
        email: "tester@example.com",
        options: {
          shouldCreateUser: true,
        },
      });
    });
    expect(supabaseMock.auth.signInWithOtp.mock.calls[0][0].options).not.toHaveProperty("emailRedirectTo");

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

  it("starts Google auth by default when Supabase is configured", async () => {
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

    await user.click(await screen.findByRole("tab", { name: "Password" }));
    await user.type(screen.getByPlaceholderText("Enter your email address"), "Tester@Example.com");
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

    await user.click(await screen.findByRole("tab", { name: "Password" }));
    await user.type(screen.getByPlaceholderText("Enter your email address"), "tester@example.com");
    await user.type(screen.getByPlaceholderText("Enter your password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in with password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid login credentials");
    expect(screen.queryByText("Scanner opened")).not.toBeInTheDocument();
  });

  it("creates a password account but waits for email confirmation before opening the scanner", async () => {
    const user = userEvent.setup();

    await renderAuth();

    await user.click(await screen.findByRole("tab", { name: "Password" }));
    await user.click(screen.getByRole("button", { name: "New account" }));
    await user.type(screen.getByPlaceholderText("Enter your email address"), "NewUser@Example.com");
    await user.type(screen.getByPlaceholderText("Create a password"), "new-password-123");
    await user.click(screen.getByRole("button", { name: "Create password account" }));

    await waitFor(() => {
      expect(supabaseMock.auth.signUp).toHaveBeenCalledWith({
        email: "newuser@example.com",
        password: "new-password-123",
      });
    });
    expect(await screen.findByText("Account created. Check your email to confirm it, then sign in with your password.")).toBeInTheDocument();
    expect(screen.queryByText("Scanner opened")).not.toBeInTheDocument();
  });

  it("opens the scanner after password account creation only when Supabase returns a verified session", async () => {
    const user = userEvent.setup();
    supabaseMock.auth.getUser
      .mockResolvedValueOnce({ data: { user: null }, error: null })
      .mockResolvedValueOnce({ data: { user: makeUser("new-password-user") }, error: null });

    await renderAuth();

    await user.click(await screen.findByRole("tab", { name: "Password" }));
    await user.click(screen.getByRole("button", { name: "New account" }));
    await user.type(screen.getByPlaceholderText("Enter your email address"), "newuser@example.com");
    await user.type(screen.getByPlaceholderText("Create a password"), "new-password-123");
    await user.click(screen.getByRole("button", { name: "Create password account" }));

    expect(await screen.findByText("Scanner opened")).toBeInTheDocument();
  });

  it("starts GitHub auth by default when Supabase is configured", async () => {
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

    await user.type(await screen.findByPlaceholderText("Enter your email address"), "tester@example.com");
    await user.click(screen.getByRole("button", { name: "Send verification code" }));

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

  it("disables the resend button with a live countdown after sending a code", async () => {
    const user = userEvent.setup();
    await renderAuth();

    await user.type(await screen.findByPlaceholderText("Enter your email address"), "tester@example.com");
    await user.click(screen.getByRole("button", { name: "Send verification code" }));

    const resendButton = await screen.findByRole("button", { name: /Resend in \d+s/ });
    expect(resendButton).toBeDisabled();
    expect(resendButton.textContent).toMatch(/Resend in 30s/);
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
