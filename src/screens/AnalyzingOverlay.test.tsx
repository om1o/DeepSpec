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

  it("shows the step first, then swaps to reassurance with a live elapsed counter at 8s", () => {
    render(<AnalyzingOverlay onCancel={() => {}} step="Matching vehicle data" />);

    expect(screen.getByText("0s elapsed")).toBeInTheDocument();
    expect(screen.getByText("Matching vehicle data")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(7000);
    });

    expect(screen.getByText("7s elapsed")).toBeInTheDocument();
    expect(screen.getByText("Matching vehicle data")).toBeInTheDocument();
    expect(screen.queryByText("Still working — larger photos take a few more seconds.")).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText("8s elapsed")).toBeInTheDocument();
    expect(screen.getByText("Still working — larger photos take a few more seconds.")).toBeInTheDocument();
  });
});
