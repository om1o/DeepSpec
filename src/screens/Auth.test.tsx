import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMock = vi.hoisted(() => ({
  auth: {
    getUser: vi.fn(),
    signInWithOAuth: vi.fn(),
    signInWithOtp: vi.fn(),
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
    vi.stubEnv("VITE_ENABLE_GOOGLE_AUTH", "");

    supabaseMock.auth.getUser.mockReset();
    supabaseMock.auth.signInWithOAuth.mockReset();
    supabaseMock.auth.signInWithOtp.mockReset();
    supabaseMock.auth.verifyOtp.mockReset();
    supabaseMock.createClient.mockReset();

    supabaseMock.createClient.mockReturnValue({ auth: supabaseMock.auth });
    supabaseMock.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    supabaseMock.auth.signInWithOAuth.mockResolvedValue({ data: {}, error: null });
    supabaseMock.auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
    supabaseMock.auth.verifyOtp.mockResolvedValue({ data: {}, error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses Deep Spec branding and defaults to code sign-in", async () => {
    await renderAuth();

    expect(await screen.findByRole("heading", { name: "Sign in with a code" })).toBeInTheDocument();
    expect(screen.getByAltText("Deep Spec")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Verify code" }));

    await waitFor(() => {
      expect(supabaseMock.auth.verifyOtp).toHaveBeenCalledWith({
        email: "tester@example.com",
        token: "123456",
        type: "email",
      });
    });
    expect(await screen.findByText("Scanner opened")).toBeInTheDocument();
  });

  it("starts Google auth only when explicitly enabled", async () => {
    const user = userEvent.setup();
    vi.stubEnv("VITE_ENABLE_GOOGLE_AUTH", "true");
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

  it("keeps local continue limited to unconfigured development builds", async () => {
    const user = userEvent.setup();
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");

    await renderAuth();

    expect(await screen.findByText("Supabase auth is not configured for this build. Local continue is only available for development.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /google/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue locally" }));

    expect(localStorage.getItem("ds_auth_seen")).toBe("1");
    expect(await screen.findByText("Scanner opened")).toBeInTheDocument();
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
