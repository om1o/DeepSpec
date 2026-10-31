import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Pricing from "./Pricing";
import { getAuthClient } from "../services/auth";

vi.mock("../services/auth", () => ({ getAuthClient: vi.fn() }));

describe("Pricing", () => {
  beforeEach(() => {
    vi.mocked(getAuthClient).mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());


  it("retains session verification for normal sandbox checkout", async () => {
    vi.mocked(getAuthClient).mockResolvedValue({ auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } } as never);
    render(<MemoryRouter><Pricing /></MemoryRouter>);
    fireEvent.click(screen.getAllByRole("button", { name: "Start sandbox checkout" })[0]);
    expect(await screen.findByText("Sign in again before checkout. Paid access stays locked without a verified session.")).toBeInTheDocument();
    expect(getAuthClient).toHaveBeenCalledTimes(1);
  });
});
