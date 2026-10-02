import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import OAuthConsent from "./OAuthConsent";
import * as auth from "../services/auth";
import * as browserRedirect from "../lib/browserRedirect";

vi.mock("../services/auth", () => ({ getAuthClient: vi.fn(), getVerifiedAuthUser: vi.fn() }));

describe("OAuthConsent", () => {
  beforeEach(() => vi.resetAllMocks());

  it("redirects signed-out users to auth while preserving the request", async () => {
    vi.mocked(auth.getVerifiedAuthUser).mockResolvedValue(null);
    renderConsent();
    expect(await screen.findByText("Sign in route")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/auth");
  });

  it("shows the privacy boundary and approves the OAuth request", async () => {
    const approveAuthorization = vi.fn().mockResolvedValue({ data: { redirect_url: "https://chatgpt.com/callback?code=test" }, error: null });
    const getAuthorizationDetails = vi.fn().mockResolvedValue({
      data: { authorization_id: "auth-1", client: { name: "ChatGPT" }, scope: "openid email profile", user: { email: "tester@example.com" } },
      error: null,
    });
    vi.mocked(auth.getVerifiedAuthUser).mockResolvedValue({ id: "user-1" } as never);
    vi.mocked(auth.getAuthClient).mockResolvedValue({ auth: { oauth: { approveAuthorization, denyAuthorization: vi.fn(), getAuthorizationDetails } } } as never);
    const assign = vi.spyOn(browserRedirect, "redirectBrowser").mockImplementation(() => undefined);
    renderConsent();

    expect(await screen.findByRole("heading", { name: "Connect ChatGPT to DeepSpec" })).toBeInTheDocument();
    expect(screen.getByText(/turn a saved scan into training permission/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Connect DeepSpec" }));
    await waitFor(() => expect(approveAuthorization).toHaveBeenCalledWith("auth-1", { skipBrowserRedirect: true }));
    expect(assign).toHaveBeenCalledWith("https://chatgpt.com/callback?code=test");
  });
});

function renderConsent() {
  render(
    <MemoryRouter initialEntries={["/oauth/consent?authorization_id=auth-1"]}>
      <Routes>
        <Route path="/oauth/consent" element={<OAuthConsent />} />
        <Route path="/auth" element={<><p>Sign in route</p><p data-testid="location">/auth</p></>} />
      </Routes>
    </MemoryRouter>,
  );
}
