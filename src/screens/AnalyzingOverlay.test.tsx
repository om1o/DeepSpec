import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import * as onDeviceIdentify from "../services/onDeviceIdentify";
import { AnalyzingOverlay } from "./Scanner";

describe("AnalyzingOverlay", () => {
  let reportProgress: (progress: onDeviceIdentify.OnDeviceModelProgress) => void;
  let unsubscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    unsubscribe = vi.fn();
    vi.spyOn(onDeviceIdentify, "onOnDeviceModelProgress").mockImplementation((listener) => {
      reportProgress = listener;
      return unsubscribe;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("shows the step first, then swaps to progress copy with a visible elapsed counter at 8s", () => {
    render(<AnalyzingOverlay onCancel={() => {}} step="Reading photo" />);

    expect(screen.getByTestId("scan-brand-animation")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Reading photo");
    expect(document.querySelector('img[src="/brand/deepspec-scan-badge-glass.webp"]')).toHaveAttribute("alt", "");
    expect(screen.getByText("0s elapsed")).toBeInTheDocument();
    expect(screen.getAllByText("Reading photo")).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(7000);
    });

    expect(screen.getByText("7s elapsed")).toBeInTheDocument();
    expect(screen.getAllByText("Reading photo")).toHaveLength(2);
    expect(screen.queryByText("Almost done.")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText("8s elapsed")).toBeInTheDocument();
    expect(screen.getByText("Almost done.")).toBeInTheDocument();
  });

  it("keeps visible timer ticks outside live regions without mutating the status", () => {
    render(<AnalyzingOverlay onCancel={() => {}} step="Checking part details" />);

    const status = screen.getByRole("status");
    const timer = screen.getByText("0s elapsed");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).not.toContainElement(timer);
    expect(timer.closest('[aria-live], [role="status"], [role="alert"]')).toBeNull();
    expect(timer.closest('[aria-hidden="true"]')).toBeNull();

    const observer = new MutationObserver(() => {});
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    try {
      for (let seconds = 1; seconds <= 7; seconds += 1) {
        act(() => vi.advanceTimersByTime(1000));
        expect(timer).toHaveTextContent(`${seconds}s elapsed`);
        expect(timer).toBeVisible();
        expect(observer.takeRecords()).toHaveLength(0);
      }

      act(() => vi.advanceTimersByTime(1000));
      expect(status).toHaveTextContent("Almost done.");
      expect(observer.takeRecords().length).toBeGreaterThan(0);

      act(() => vi.advanceTimersByTime(5000));
      expect(timer).toHaveTextContent("13s elapsed");
      expect(observer.takeRecords()).toHaveLength(0);
      expect(status).not.toHaveTextContent(/elapsed/);
    } finally {
      observer.disconnect();
    }
  });

  it("keeps analysis-step changes in the same polite status region", () => {
    const { rerender } = render(<AnalyzingOverlay onCancel={() => {}} step={null} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Reading photo");

    rerender(<AnalyzingOverlay onCancel={() => {}} step="Checking part details" />);

    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toContainElement(screen.getByText("Checking part details"));
  });

  it("keeps download progress and completion in the status while the timer remains separate", () => {
    render(<AnalyzingOverlay onCancel={() => {}} step="Checking part details" />);
    const status = screen.getByRole("status");

    act(() => reportProgress({ stage: "downloading", percent: 25 }));
    expect(status).toHaveTextContent("Downloading offline model... 25%");

    act(() => vi.advanceTimersByTime(9000));
    expect(screen.getByText("9s elapsed")).toBeVisible();
    expect(status).not.toHaveTextContent(/elapsed|Almost done/);
    expect(status).toHaveTextContent("Downloading offline model... 25%");

    act(() => reportProgress({ stage: "downloading", percent: 75 }));
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("Downloading offline model... 75%");

    act(() => reportProgress({ stage: "ready", percent: 100 }));
    expect(status).toHaveTextContent("Almost done.");
    expect(status).not.toHaveTextContent(/Downloading/);
  });

  it("keeps cancellation accessible outside the status and cleans up on unmount", () => {
    const onCancel = vi.fn();
    const { unmount } = render(<AnalyzingOverlay onCancel={onCancel} step="Reading photo" />);
    const cancel = screen.getByRole("button", { name: "Cancel scan" });
    expect(cancel).toBeEnabled();
    expect(screen.getByRole("status")).not.toContainElement(cancel);

    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
