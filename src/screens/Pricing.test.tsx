import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Pricing from "./Pricing";
import { getAuthClient } from "../services/auth";
import { isGuestPreview } from "../lib/guestPreview";

vi.mock("../services/auth", () => ({ getAuthClient: vi.fn() }));
vi.mock("../lib/guestPreview", () => ({ isGuestPreview: vi.fn() }));

describe("Pricing", () => {
  beforeEach(() => {
    vi.mocked(isGuestPreview).mockReturnValue(false);
    vi.mocked(getAuthClient).mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps plan browsing available without billing requests in the guest preview", () => {
    vi.mocked(isGuestPreview).mockReturnValue(true);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<MemoryRouter><Pricing /></MemoryRouter>);
    const checkoutButtons = screen.getAllByRole("button", { name: "Checkout unavailable here" });
    expect(checkoutButtons.length).toBeGreaterThan(0);
    for (const button of checkoutButtons) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(screen.getByRole("link", { name: "Scan" })).toHaveAttribute("href", "/scan");
    expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("href", "/history");
    expect(screen.getByRole("link", { name: "Workspace" })).toHaveAttribute("href", "/account");
    expect(getAuthClient).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retains session verification for normal sandbox checkout", async () => {
    vi.mocked(getAuthClient).mockResolvedValue({ auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } } as never);
    render(<MemoryRouter><Pricing /></MemoryRouter>);
    fireEvent.click(screen.getAllByRole("button", { name: "Start sandbox checkout" })[0]);
    expect(await screen.findByText("Sign in again before checkout. Paid access stays locked without a verified session.")).toBeInTheDocument();
    expect(getAuthClient).toHaveBeenCalledTimes(1);
  });
});
