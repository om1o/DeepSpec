import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCamera } from "./useCamera";

const CAMERA_START_TIMEOUT_MS = 15000;

describe("useCamera", () => {
  let getUserMedia: ReturnType<typeof vi.fn>;
  let stopCameraTrack: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    stopCameraTrack = vi.fn();
    getUserMedia = vi.fn(async () => ({
      getTracks: () => [{ stop: stopCameraTrack }],
    }));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia,
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
      vi.advanceTimersByTime(CAMERA_START_TIMEOUT_MS);
    });

    expect(screen.getByTestId("state")).toHaveTextContent("blocked");
    expect(screen.getByTestId("error")).toHaveTextContent("Camera permission is still waiting");
  });

  it("does not show the timeout error after the camera starts", () => {
    render(<CameraProbe />);

    fireEvent.click(screen.getByRole("button", { name: "Ready" }));
    act(() => {
      vi.advanceTimersByTime(CAMERA_START_TIMEOUT_MS);
    });

    expect(screen.getByTestId("state")).toHaveTextContent("ready");
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("retries the camera request after a pending permission timeout", async () => {
    render(<CameraProbe />);

    act(() => {
      vi.advanceTimersByTime(CAMERA_START_TIMEOUT_MS);
    });
    expect(screen.getByTestId("state")).toHaveTextContent("blocked");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await Promise.resolve();
    });

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: true,
    });
    expect(stopCameraTrack).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("state")).toHaveTextContent("loading");
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("bounds a retry when the camera permission prompt stays pending", () => {
    getUserMedia.mockReturnValueOnce(new Promise(() => undefined));
    render(<CameraProbe />);

    act(() => {
      vi.advanceTimersByTime(CAMERA_START_TIMEOUT_MS);
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByTestId("state")).toHaveTextContent("blocked");
    expect(screen.getByTestId("error")).toHaveTextContent("Camera permission requested");

    act(() => {
      vi.advanceTimersByTime(CAMERA_START_TIMEOUT_MS);
    });

    expect(screen.getByTestId("state")).toHaveTextContent("blocked");
    expect(screen.getByTestId("error")).toHaveTextContent("Camera permission is still waiting");
  });

  it("ignores a permission response that arrives after the retry timeout", async () => {
    let resolveCameraAccess!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValueOnce(new Promise<MediaStream>((resolve) => {
      resolveCameraAccess = resolve;
    }));
    render(<CameraProbe />);

    act(() => {
      vi.advanceTimersByTime(CAMERA_START_TIMEOUT_MS);
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    act(() => {
      vi.advanceTimersByTime(CAMERA_START_TIMEOUT_MS);
    });

    await act(async () => {
      resolveCameraAccess({
        getTracks: () => [{ stop: stopCameraTrack }],
      } as unknown as MediaStream);
      await Promise.resolve();
    });

    expect(stopCameraTrack).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("state")).toHaveTextContent("blocked");
    expect(screen.getByTestId("error")).toHaveTextContent("Camera permission is still waiting");
  });

  it("ignores a permission response from a superseded retry", async () => {
    let resolveFirstRetry!: (stream: MediaStream) => void;
    getUserMedia.mockReturnValueOnce(new Promise<MediaStream>((resolve) => {
      resolveFirstRetry = resolve;
    }));
    render(<CameraProbe />);

    act(() => {
      vi.advanceTimersByTime(CAMERA_START_TIMEOUT_MS);
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await Promise.resolve();
    });

    expect(screen.getByTestId("request-id")).toHaveTextContent("1");

    await act(async () => {
      resolveFirstRetry({
        getTracks: () => [{ stop: stopCameraTrack }],
      } as unknown as MediaStream);
      await Promise.resolve();
    });

    expect(stopCameraTrack).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("request-id")).toHaveTextContent("1");
  });

  it("cancels a pending retry timeout when the hook unmounts", () => {
    getUserMedia.mockReturnValueOnce(new Promise(() => undefined));
    const { unmount } = render(<CameraProbe />);

    act(() => {
      vi.advanceTimersByTime(CAMERA_START_TIMEOUT_MS);
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows the browser camera error when retry permission fails", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("Permission denied"));
    render(<CameraProbe />);

    act(() => {
      vi.advanceTimersByTime(CAMERA_START_TIMEOUT_MS);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await Promise.resolve();
    });

    expect(screen.getByTestId("state")).toHaveTextContent("blocked");
    expect(screen.getByTestId("error")).toHaveTextContent("Permission denied");
  });

  it("explains when another app is already using the camera", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("Device in use", "NotReadableError"));
    render(<CameraProbe />);

    act(() => {
      vi.advanceTimersByTime(CAMERA_START_TIMEOUT_MS);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await Promise.resolve();
    });

    expect(screen.getByTestId("state")).toHaveTextContent("blocked");
    expect(screen.getByTestId("error")).toHaveTextContent("already open in another tab or app");
  });
});

function CameraProbe() {
  const { cameraError, cameraRequestId, cameraState, markReady, retryCamera } = useCamera();

  return (
    <div>
      <p data-testid="request-id">{cameraRequestId}</p>
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
