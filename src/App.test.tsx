import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const authMock = vi.hoisted(() => ({
  getVerifiedAuthUser: vi.fn(),
  hasLocalAuthBypass: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
}));

vi.mock("./services/auth", () => authMock);
vi.mock("./screens/Auth", () => ({ default: () => <div>Auth screen</div> }));
vi.mock("./screens/Chat", () => ({ default: () => <div>Chat screen</div> }));
vi.mock("./screens/EarlyAccess", () => ({ default: () => <div>Early access screen</div> }));
vi.mock("./screens/History", () => ({ default: () => <div>History screen</div> }));
vi.mock("./screens/Result", () => ({ default: () => <div>Result screen</div> }));
vi.mock("./screens/Scanner", () => ({ default: () => <div>Scanner screen</div> }));

describe("App auth guard", () => {
  beforeEach(() => {
    authMock.getVerifiedAuthUser.mockReset();
    authMock.hasLocalAuthBypass.mockReset();
    authMock.subscribeToAuthChanges.mockReset();

    authMock.hasLocalAuthBypass.mockReturnValue(false);
    authMock.subscribeToAuthChanges.mockResolvedValue(() => undefined);
  });

  it("redirects protected routes when Supabase does not verify a user", async () => {
    authMock.getVerifiedAuthUser.mockResolvedValue(null);

    renderApp("/");

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

    renderApp("/");

    expect(await screen.findByText("Scanner screen")).toBeInTheDocument();
  });
});

function renderApp(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}
