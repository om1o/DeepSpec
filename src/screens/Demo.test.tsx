import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountStorageKey, getAccountScope } from "../lib/accountScope";
import Demo from "./Demo";

const KEY = "deepspec.demo.saved-samples.v1";

function renderDemo() {
  return render(<MemoryRouter><Demo /></MemoryRouter>);
}

function scanSample() {
  fireEvent.click(screen.getByRole("button", { name: "Scan sample" }));
  act(() => { vi.advanceTimersByTime(1600); });
  act(() => { vi.advanceTimersByTime(600); });
}

describe("no-account demo", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("runs a sample scan and authored follow-up without an account or API request", () => {
    renderDemo();
    expect(screen.getByText("Demo · no account needed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Scan sample" }));
    expect(screen.getByRole("button", { name: "Scanning sample…" })).toBeDisabled();
    expect(screen.getByText("Scanning sample…", { selector: "p" })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1600); });
    expect(screen.getByText("Preparing example review…")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.getByRole("heading", { name: "Likely a ventilated brake rotor" })).toBeInTheDocument();
    expect(screen.getByText("EXAMPLE REVIEW · PREDETERMINED")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "What does it do?" }));
    expect(screen.getByText(/Brake pads clamp the rotor/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("saves only example IDs and can revisit them after reload", () => {
    const first = renderDemo();
    fireEvent.click(screen.getByRole("button", { name: "Engine bay" }));
    scanSample();
    fireEvent.click(screen.getByRole("button", { name: "Save example" }));
    expect(JSON.parse(localStorage.getItem(KEY) ?? "[]")).toEqual(["engine"]);
    first.unmount();
    renderDemo();
    fireEvent.click(screen.getByRole("button", { name: /Saved examples 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open Engine bay example review" }));
    expect(screen.getByRole("heading", { name: "An engine-bay overview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Example saved/ })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reset cancels a pending scan and leaves account scope and real records untouched", () => {
    const scope = getAccountScope();
    const realKey = accountStorageKey("deep-spec:lookups");
    localStorage.setItem(realKey, '[{"id":"real-scan"}]');
    localStorage.setItem("sb-example-auth-token", "existing-session");
    localStorage.setItem(KEY, '["rotor"]');
    renderDemo();
    fireEvent.click(screen.getByRole("button", { name: "Scan sample" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset demo" }));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByRole("heading", { name: "Likely a ventilated brake rotor" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scan sample" })).toBeEnabled();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(localStorage.getItem(realKey)).toBe('[{"id":"real-scan"}]');
    expect(localStorage.getItem("sb-example-auth-token")).toBe("existing-session");
    expect(getAccountScope()).toEqual(scope);
  });

  it("handles malformed or unavailable storage honestly", () => {
    localStorage.setItem(KEY, '{"invalid":true}');
    renderDemo();
    scanSample();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Blocked", "SecurityError"); });
    fireEvent.click(screen.getByRole("button", { name: "Save example" }));
    expect(screen.getByText("Saved for this visit. This browser is not allowing storage.")).toBeInTheDocument();
  });

  it("cleans up scan timers when the page unmounts", () => {
    const { unmount } = renderDemo();
    fireEvent.click(screen.getByRole("button", { name: "Scan sample" }));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
