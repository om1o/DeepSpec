import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { AnalyzingOverlay } from "./Scanner";

describe("AnalyzingOverlay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the step first, then swaps to progress copy with a live elapsed counter at 8s", () => {
    render(<AnalyzingOverlay onCancel={() => {}} step="Reading photo" />);

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
});
