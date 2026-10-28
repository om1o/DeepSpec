import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Account from "./Account";
import { getAuthClient } from "../services/auth";
import { isGuestPreview } from "../lib/guestPreview";

vi.mock("../services/auth", () => ({ getAuthClient: vi.fn() }));
vi.mock("../lib/guestPreview", () => ({ isGuestPreview: vi.fn() }));

const getAuthClientMock = vi.mocked(getAuthClient);
const getSession = vi.fn();
const isGuestPreviewMock = vi.mocked(isGuestPreview);

describe("Account", () => {
  beforeEach(() => {
    getSession.mockReset();
    isGuestPreviewMock.mockReturnValue(false);
    getAuthClientMock.mockReset();
    getAuthClientMock.mockResolvedValue({ auth: { getSession } } as never);
    vi.unstubAllGlobals();
  });

  it("shows a device workspace without checking an account or billing in guest preview", () => {
    isGuestPreviewMock.mockReturnValue(true);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    renderAccount();
    expect(screen.getByRole("heading", { name: "Ready on this device" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("href", "/history");
    expect(screen.getByRole("link", { name: "Open camera" })).toHaveAttribute("href", "/scan");
    expect(screen.queryByRole("button", { name: "Manage billing" })).not.toBeInTheDocument();
    expect(getAuthClientMock).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows verification-required without deriving allowance from local history", async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    renderAccount();
    expect(await screen.findByText("Verification required")).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    expect(screen.queryByText(/Scanning allowed/i)).not.toBeInTheDocument();
  });

  it("uses authoritative free counts from the server", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "verified-token" } }, error: null });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ entitlement: {
      status: "free", scanAllowance: 5, scansUsed: 2, verifiedAt: "2026-10-09T00:00:00.000Z",
    } }), { status: 200, headers: { "Content-Type": "application/json" } })));
    renderAccount();
    expect(await screen.findByText("Free preview")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/Status: Scanning allowed/i)).toBeInTheDocument();
  });

  it("shows unavailable when server verification fails", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "verified-token" } }, error: null });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network unavailable"); }));
    renderAccount();
    expect(await screen.findByText("Access unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Entitlement check unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/Scanning allowed/i)).not.toBeInTheDocument();
  });
});

function renderAccount() {
  render(
    <MemoryRouter initialEntries={["/account"]}>
      <Routes><Route path="/account" element={<Account />} /></Routes>
    </MemoryRouter>,
  );
}
