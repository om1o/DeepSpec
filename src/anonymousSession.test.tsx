import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), signInWithPassword: vi.fn(), signOut: vi.fn(),
  onAuthStateChange: vi.fn(), scannerMount: vi.fn(), unsubscribe: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: {
  getUser: mocks.getUser, signInWithPassword: mocks.signInWithPassword,
  signOut: mocks.signOut, onAuthStateChange: mocks.onAuthStateChange,
}}) }));
vi.mock("./screens/Scanner", () => ({ default: () => { mocks.scannerMount(); return <div>Scanner screen</div>; } }));
vi.mock("./screens/Chat", () => ({ default: () => <div>Chat screen</div> }));
vi.mock("./screens/EarlyAccess", () => ({ default: () => <div>EarlyAccess screen</div> }));
vi.mock("./screens/History", () => ({ default: () => <div>History screen</div> }));
vi.mock("./screens/Account", () => ({ default: () => <div>Account screen</div> }));
vi.mock("./screens/Pricing", () => ({ default: () => <div>Pricing screen</div> }));
vi.mock("./screens/Result", () => ({ default: () => <div>Result screen</div> }));
vi.mock("./screens/Shop", () => ({ default: () => <div>Shop screen</div> }));
vi.mock("./screens/ShopJob", () => ({ default: () => <div>ShopJob screen</div> }));
vi.mock("./screens/ShopNewJob", () => ({ default: () => <div>ShopNewJob screen</div> }));

const user = (anonymous = false) => ({
  id: anonymous ? "legacy-user" : "confirmed-user", is_anonymous: anonymous,
  app_metadata: {}, aud: "authenticated", created_at: "2026-01-01T00:00:00Z", user_metadata: {},
});
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); localStorage.clear();
  window.history.pushState({}, "", "/");
  vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "synthetic-public-key");
  mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: mocks.unsubscribe } } });
  mocks.getUser.mockResolvedValue({ data: { user: user(true) }, error: null });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });
async function open(path: string) {
  const { default: App } = await import("./App");
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

it.each(["/scan", "/auth"])("keeps legacy anonymous session on credential form from %s without mounting scanner", async path => {
  localStorage.setItem("deep-spec:account:legacy-user:lookups", "preserved");
  await open(path);
  await screen.findByRole("heading", { name: "Sign in" });
  await waitFor(() => expect(mocks.getUser).toHaveBeenCalled());
  await act(async () => {});
  expect(mocks.scannerMount).not.toHaveBeenCalled();
  expect(localStorage.getItem("deep-spec:account:legacy-user:lookups")).toBe("preserved");
  expect(mocks.signOut).not.toHaveBeenCalled();
});
it("keeps anonymous reload blocked after the first mount", async () => {
  const view = await open("/scan");
  await screen.findByRole("heading", { name: "Sign in" });
  view.unmount();
  await open("/scan");
  await screen.findByRole("heading", { name: "Sign in" });
  expect(mocks.scannerMount).not.toHaveBeenCalled();
});
it("removes an allowed scanner immediately when an anonymous token event arrives", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: user(false) }, error: null });
  await open("/scan");
  await screen.findByText("Scanner screen");
  const listener = mocks.onAuthStateChange.mock.calls[0][0];
  mocks.getUser.mockResolvedValue({ data: { user: user(true) }, error: null });
  await act(async () => { listener("TOKEN_REFRESHED", { user: user(true) }); });
  await screen.findByRole("heading", { name: "Sign in" });
  expect(screen.queryByText("Scanner screen")).not.toBeInTheDocument();
  const { getAccountScope } = await import("./lib/accountScope");
  expect(getAccountScope().userId).toBeNull();
});
it("allows a permanent user through the real auth service", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: user(false) }, error: null });
  await open("/scan");
  await screen.findByText("Scanner screen");
});
it("allows a permanent password sign-in from the blocked legacy credential form", async () => {
  await open("/scan");
  await screen.findByRole("heading", { name: "Sign in" });
  mocks.getUser.mockResolvedValue({ data: { user: user(false) }, error: null });
  mocks.signInWithPassword.mockResolvedValue({ data: { user: user(false) }, error: null });
  fireEvent.change(screen.getByPlaceholderText("you@example.com"), { target: { value: "qa@example.com" } });
  fireEvent.change(screen.getByPlaceholderText("Your password"), { target: { value: "synthetic-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in to scanner" }));
  await screen.findByText("Scanner screen");
  expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: "qa@example.com", password: "synthetic-password" });
});
