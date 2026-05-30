import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCamera } from "./useCamera";

describe("useCamera", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stops waiting forever when the camera permission prompt stays pending", () => {
    render(<CameraProbe />);

    expect(screen.getByTestId("state")).toHaveTextContent("loading");

    act(() => {
      vi.advanceTimersByTime(8000);
    });

    expect(screen.getByTestId("state")).toHaveTextContent("blocked");
    expect(screen.getByTestId("error")).toHaveTextContent("Camera permission is still waiting");
  });

  it("does not show the timeout error after the camera starts", () => {
    render(<CameraProbe />);

    fireEvent.click(screen.getByRole("button", { name: "Ready" }));
    act(() => {
      vi.advanceTimersByTime(8000);
    });

    expect(screen.getByTestId("state")).toHaveTextContent("ready");
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("retries the camera request after a pending permission timeout", () => {
    render(<CameraProbe />);

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByTestId("state")).toHaveTextContent("blocked");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByTestId("state")).toHaveTextContent("loading");
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });
});

function CameraProbe() {
  const { cameraError, cameraState, markReady, retryCamera } = useCamera();

  return (
    <div>
      <p data-testid="state">{cameraState}</p>
      <p data-testid="error">{cameraError ?? "none"}</p>
      <button type="button" onClick={markReady}>
        Ready
      </button>
      <button type="button" onClick={retryCamera}>
        Retry
      </button>
    </div>
  );
}
