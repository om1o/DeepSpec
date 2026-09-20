import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { getAccountScope, setActiveAccount } from "./lib/accountScope";

const authMock = vi.hoisted(() => ({
  getVerifiedAuthUser: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  startOfflineUpgradeWatcher: vi.fn(),
  stopOfflineUpgradeWatcher: vi.fn(),
}));

vi.mock("./services/auth", () => authMock);
vi.mock("./services/offlineUpgrade", () => ({ startOfflineUpgradeWatcher: authMock.startOfflineUpgradeWatcher }));
vi.mock("./screens/Auth", () => ({ default: () => <div>Auth screen</div> }));
vi.mock("./screens/Chat", () => ({ default: () => <div>Chat screen</div> }));
vi.mock("./screens/EarlyAccess", () => ({ default: () => <div>Early access screen</div> }));
vi.mock("./screens/History", () => ({ default: () => <div>History screen</div> }));
vi.mock("./screens/Account", () => ({ default: () => <div>Account screen</div> }));
vi.mock("./screens/Pricing", () => ({ default: () => <div>Pricing screen</div> }));
vi.mock("./screens/Result", () => ({ default: () => <div>Result screen</div> }));
vi.mock("./screens/Scanner", () => ({ default: () => <div>Scanner screen</div> }));
vi.mock("./screens/Shop", () => ({ default: () => <div>Shop screen</div> }));
vi.mock("./screens/ShopJob", () => ({ default: () => <div>Shop job screen</div> }));
vi.mock("./screens/ShopNewJob", () => ({ default: () => <div>Shop new job screen</div> }));

describe("App auth guard", () => {
  beforeEach(() => {
    authMock.getVerifiedAuthUser.mockReset();
    authMock.subscribeToAuthChanges.mockReset();
    authMock.stopOfflineUpgradeWatcher.mockReset();
    authMock.startOfflineUpgradeWatcher.mockReset().mockReturnValue(authMock.stopOfflineUpgradeWatcher);

    authMock.subscribeToAuthChanges.mockResolvedValue(() => undefined);
  });

  it("redirects protected routes when Supabase does not verify a user", async () => {
    authMock.getVerifiedAuthUser.mockResolvedValue(null);

    renderApp("/scan");

    expect(await screen.findByText("Auth screen")).toBeInTheDocument();
  });

  it("opens protected routes after the Supabase auth check passes", async () => {
    authMock.getVerifiedAuthUser.mockResolvedValue({
      app_metadata: {},
      aud: "authenticated",
      created_at: new Date(0).toISOString(),
      id: "verified-user",
      user_metadata: {},
    });

    renderApp("/scan");

    expect(await screen.findByText("Scanner screen")).toBeInTheDocument();
  });

  it("does not let initial verification replace a newer account event", async () => {
    let resolveUser: (user: unknown) => void = () => {};
    let notify: (user: { id: string } | null) => void = () => {};
    authMock.getVerifiedAuthUser.mockReturnValue(new Promise((resolve) => { resolveUser = resolve; }));
    authMock.subscribeToAuthChanges.mockImplementation(async (handler) => { notify = handler; return () => {}; });
    renderApp("/history");
    await act(async () => { notify({ id: "new-account" }); });
    expect(await screen.findByText("History screen")).toBeInTheDocument();
    await act(async () => { resolveUser({ id: "old-account" }); });
    expect(getAccountScope().userId).toBe("new-account");
  });

  it("waits for initial-session verification when the first auth promise becomes stale", async () => {
    setActiveAccount(null);
    let resolveInitial!: (user: unknown) => void;
    let notify!: (user: { id: string } | null) => void;
    let verifying!: (userId: string) => void;
    authMock.getVerifiedAuthUser.mockReturnValue(new Promise((resolve) => { resolveInitial = resolve; }));
    authMock.subscribeToAuthChanges.mockImplementation(async (handler, pending) => { notify = handler; verifying = pending; return () => {}; });
    renderApp("/history");
    await act(async () => { verifying("saved-user"); resolveInitial(null); });
    expect(screen.getByText("Checking your session...")).toBeInTheDocument();
    expect(screen.queryByText("Auth screen")).not.toBeInTheDocument();
    expect(authMock.startOfflineUpgradeWatcher).not.toHaveBeenCalled();
    await act(async () => { notify({ id: "saved-user" }); });
    expect(screen.getByText("History screen")).toBeInTheDocument();
    expect(authMock.startOfflineUpgradeWatcher).toHaveBeenCalledTimes(1);
  });

  it("keeps same-account refresh mounted but stops work and remounts for a different account", async () => {
    let notify!: (user: { id: string } | null) => void;
    let verifying!: (userId: string) => void;
    authMock.getVerifiedAuthUser.mockResolvedValue({ id: "account-a" });
    authMock.subscribeToAuthChanges.mockImplementation(async (handler, pending) => { notify = handler; verifying = pending; return () => {}; });
    renderApp("/history");
    const original = await screen.findByText("History screen");
    await act(async () => { verifying("account-a"); });
    expect(screen.getByText("History screen")).toBe(original);
    expect(authMock.stopOfflineUpgradeWatcher).not.toHaveBeenCalled();
    await act(async () => { notify({ id: "account-a" }); });
    expect(screen.getByText("History screen")).toBe(original);
    await act(async () => { setActiveAccount(null); verifying("account-b"); });
    expect(screen.getByText("Checking your session...")).toBeInTheDocument();
    expect(authMock.stopOfflineUpgradeWatcher).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Auth screen")).not.toBeInTheDocument();
    await act(async () => { notify({ id: "account-b" }); });
    expect(screen.getByText("History screen")).not.toBe(original);
    expect(getAccountScope().userId).toBe("account-b");
    expect(authMock.startOfflineUpgradeWatcher).toHaveBeenCalledTimes(2);
  });

  it("does not downgrade an allowed route when the auth listener setup fails later", async () => {
    let resolveUser: (user: unknown) => void = () => undefined;
    let rejectSubscription: (error: Error) => void = () => undefined;
    authMock.getVerifiedAuthUser.mockReturnValue(new Promise((resolve) => {
      resolveUser = resolve;
    }));
    authMock.subscribeToAuthChanges.mockReturnValue(new Promise((_resolve, reject) => {
      rejectSubscription = reject;
    }));

    renderApp("/scan");

    await act(async () => {
      resolveUser({
        app_metadata: {},
        aud: "authenticated",
        created_at: new Date(0).toISOString(),
        id: "verified-user",
        user_metadata: {},
      });
    });
    expect(await screen.findByText("Scanner screen")).toBeInTheDocument();

    await act(async () => {
      rejectSubscription(new Error("listener failed"));
    });

    await waitFor(() => expect(screen.getByText("Scanner screen")).toBeInTheDocument());
    expect(screen.queryByText("Auth screen")).not.toBeInTheDocument();
  });

  it("sends the app root to the scanner route", async () => {
    authMock.getVerifiedAuthUser.mockResolvedValue({
      app_metadata: {},
      aud: "authenticated",
      created_at: new Date(0).toISOString(),
      id: "verified-user",
      user_metadata: {},
    });

    renderApp("/");

    expect(await screen.findByText("Scanner screen")).toBeInTheDocument();
  });

  it("protects the pricing route behind verified auth", async () => {
    authMock.getVerifiedAuthUser.mockResolvedValue(null);

    renderApp("/pricing");

    expect(await screen.findByText("Auth screen")).toBeInTheDocument();
  });

  it("opens account after the Supabase auth check passes", async () => {
    authMock.getVerifiedAuthUser.mockResolvedValue({
      app_metadata: {},
      aud: "authenticated",
      created_at: new Date(0).toISOString(),
      id: "verified-user",
      user_metadata: {},
    });

    renderApp("/account");

    expect(await screen.findByText("Account screen")).toBeInTheDocument();
  });

  it("protects shop mode behind verified auth", async () => {
    authMock.getVerifiedAuthUser.mockResolvedValue(null);

    renderApp("/shop");

    expect(await screen.findByText("Auth screen")).toBeInTheDocument();
  });

  it("opens shop job creation after the Supabase auth check passes", async () => {
    authMock.getVerifiedAuthUser.mockResolvedValue({
      app_metadata: {},
      aud: "authenticated",
      created_at: new Date(0).toISOString(),
      id: "verified-user",
      user_metadata: {},
    });

    renderApp("/shop/new");

    expect(await screen.findByText("Shop new job screen")).toBeInTheDocument();
  });
});

function renderApp(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}
