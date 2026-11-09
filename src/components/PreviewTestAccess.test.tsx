import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Reload the marker-capturing component without giving it a second React instance.
const reactModule = await vi.hoisted(() => import("react"));
vi.mock("react", () => reactModule);

const mocks = vi.hoisted(() => ({
  pathname: "/auth",
  navigate: vi.fn(),
  fetch: vi.fn<typeof fetch>(),
  getAuthClient: vi.fn(),
  getSession: vi.fn(),
  signInToPreviewTestAccount: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: mocks.pathname }),
  useNavigate: () => mocks.navigate,
}));

vi.mock("../services/auth", () => ({
  getAuthClient: mocks.getAuthClient,
  signInToPreviewTestAccount: mocks.signInToPreviewTestAccount,
  signOut: mocks.signOut,
}));

async function renderAccess(url = "/auth?private-test=1", placement: "auth" | "banner" = "auth") {
  window.history.replaceState({}, "", url);
  const { PreviewTestAccess } = await import("./PreviewTestAccess");
  return render(<PreviewTestAccess placement={placement} />);
}

describe("PreviewTestAccess", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    mocks.pathname = "/auth";
    mocks.fetch.mockRejectedValue(new Error("Unexpected mocked request"));
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.getAuthClient.mockResolvedValue({ auth: { getSession: mocks.getSession } });
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: "mock-session-token" } },
      error: null,
    });
    mocks.signOut.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it.each(["/auth", "/auth?private-test=0"])("hides temporary controls on %s", async (url) => {
    await renderAccess(url);

    expect(screen.queryByRole("group", { name: "Private test entry" })).not.toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.signInToPreviewTestAccount).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("removes the marker while refusing entry when the server rejects the POST", async () => {
    const user = userEvent.setup();
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await renderAccess("/auth?private-test=1&keep=1#details");

    expect(window.location.pathname + window.location.search + window.location.hash).toBe("/auth?keep=1#details");
    expect(mocks.fetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Skip sign-in and try AI" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Test entry failed or expired");
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith("/api/qa-test-session", {
      method: "POST", cache: "no-store", credentials: "same-origin",
    });
    expect(mocks.signInToPreviewTestAccount).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Skip sign-in and try AI" })).toBeEnabled();
  });

  it("waits for normal authentication before navigating and showing the account UUID", async () => {
    const user = userEvent.setup();
    const userId = "11111111-2222-4333-8444-555555555555";
    let completeSignIn!: (account: { id: string }) => void;
    mocks.signInToPreviewTestAccount.mockReturnValueOnce(new Promise<{ id: string }>((resolve) => {
      completeSignIn = resolve;
    }));
    mocks.fetch.mockResolvedValueOnce(Response.json({ token_hash: "mock-token-hash", userId }));
    await renderAccess();

    await user.click(screen.getByRole("button", { name: "Skip sign-in and try AI" }));
    await waitFor(() => expect(mocks.signInToPreviewTestAccount).toHaveBeenCalledExactlyOnceWith("mock-token-hash", userId));
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Opening AI…" })).toBeDisabled();

    await act(async () => { completeSignIn({ id: userId }); });

    expect(screen.getByRole("status")).toHaveTextContent(`Test account: ${userId}. Normal scan limits apply.`);
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/scan", { replace: true });
  });

  it("does not navigate when the normal auth helper rejects a successful POST", async () => {
    const user = userEvent.setup();
    mocks.fetch.mockResolvedValueOnce(Response.json({ token_hash: "mock-token-hash", userId: "mock-user" }));
    mocks.signInToPreviewTestAccount.mockRejectedValueOnce(new Error("Verification failed"));
    await renderAccess();

    await user.click(screen.getByRole("button", { name: "Skip sign-in and try AI" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Test entry failed or expired");
    expect(mocks.signInToPreviewTestAccount).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("retries only local sign-out after confirmed server cleanup", async () => {
    const user = userEvent.setup();
    mocks.pathname = "/scan";
    mocks.fetch.mockResolvedValueOnce(Response.json({ cleaned: true }));
    mocks.signOut.mockRejectedValueOnce(new Error("Local sign-out failed"));
    await renderAccess("/scan?private-test=1", "banner");

    await user.click(screen.getByRole("button", { name: "Finish test and remove test account" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Cleanup or local sign-out needs a retry");
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith("/api/qa-test-session", {
      method: "DELETE", cache: "no-store", credentials: "same-origin",
      headers: { "x-qa-session": "mock-session-token" },
    });
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.navigate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Retry local sign-out" }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith("/auth", { replace: true }));
    expect(mocks.signOut).toHaveBeenCalledTimes(2);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.getAuthClient).toHaveBeenCalledOnce();
    expect(mocks.getSession).toHaveBeenCalledOnce();
    expect(screen.queryByRole("complementary", { name: "Temporary private test access" })).not.toBeInTheDocument();
  });
});
