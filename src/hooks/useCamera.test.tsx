import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { StrictMode } from "react";
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

  it("starts a bounded retry immediately without opening a second permission stream", () => {
    getUserMedia.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useCamera());
    act(() => vi.advanceTimersByTime(CAMERA_START_TIMEOUT_MS));

    act(() => result.current.retryCamera());
    expect(result.current.cameraState).toBe("loading");
    expect(result.current.cameraRequestId).toBeGreaterThan(0);
    expect(getUserMedia).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(CAMERA_START_TIMEOUT_MS));
    expect(result.current.cameraState).toBe("blocked");
    expect(result.current.cameraError).toContain("Camera permission is still waiting");
  });

  it("ignores an old request failure after switching to a working camera", () => {
    const { result } = renderHook(() => useCamera());
    const oldError = result.current.markError;
    act(() => result.current.switchCamera());
    act(() => result.current.markReady());

    act(() => oldError(new DOMException("Old camera unavailable", "NotReadableError")));
    expect(result.current.cameraState).toBe("ready");
    expect(result.current.cameraError).toBeNull();
  });

  it("ignores old success and failure callbacks after retry", () => {
    const { result } = renderHook(() => useCamera());
    const oldReady = result.current.markReady;
    const oldError = result.current.markError;
    act(() => result.current.markError("Permission denied"));
    act(() => result.current.retryCamera());

    act(() => oldReady());
    expect(result.current.cameraState).toBe("loading");
    act(() => oldError("Old request failed"));
    expect(result.current.cameraState).toBe("loading");
    expect(result.current.cameraError).toBeNull();
  });

  it("ignores callbacks after the permission request timed out", () => {
    const { result } = renderHook(() => useCamera());
    const oldReady = result.current.markReady;
    const oldError = result.current.markError;
    act(() => vi.advanceTimersByTime(CAMERA_START_TIMEOUT_MS));

    act(() => oldReady());
    act(() => oldError("Late request error"));
    expect(result.current.cameraState).toBe("blocked");
    expect(result.current.cameraError).toContain("Camera permission is still waiting");
  });

  it("does not replace current devices with an old enumeration result", async () => {
    let resolveOldDevices!: (devices: unknown[]) => void;
    const enumerateDevices = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldDevices = resolve; }))
      .mockResolvedValue([{ kind: "videoinput", deviceId: "current", label: "Current camera" }]);
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", { configurable: true, value: enumerateDevices });
    const { result } = renderHook(() => useCamera());
    act(() => result.current.markReady());
    act(() => result.current.selectCamera("current"));
    await act(async () => result.current.markReady());

    await act(async () => resolveOldDevices([{ kind: "videoinput", deviceId: "old", label: "Old camera" }]));
    expect(result.current.cameraDevices).toEqual([{ deviceId: "current", label: "Current camera" }]);
  });

  it("does not process late camera callbacks after unmount", () => {
    const enumerateDevices = vi.fn();
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", { configurable: true, value: enumerateDevices });
    const { result, unmount } = renderHook(() => useCamera());
    const { markReady, markError } = result.current;
    unmount();

    act(() => { markReady(); markError("Late failure"); });
    expect(enumerateDevices).not.toHaveBeenCalled();
  });

  it("accepts the active request after StrictMode replays effect setup", () => {
    const { result } = renderHook(() => useCamera(), { wrapper: StrictMode });
    act(() => result.current.markReady());
    expect(result.current.cameraState).toBe("ready");
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

    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByTestId("state")).toHaveTextContent("loading");
    expect(screen.getByTestId("error")).toHaveTextContent("none");
  });

  it("shows the browser camera error when retry permission fails", async () => {
    render(<CameraProbe />);

    act(() => {
      vi.advanceTimersByTime(CAMERA_START_TIMEOUT_MS);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Permission error" }));

    expect(screen.getByTestId("state")).toHaveTextContent("blocked");
    expect(screen.getByTestId("error")).toHaveTextContent("Permission denied");
  });

  it("explains when another app is already using the camera", async () => {
    render(<CameraProbe />);

    act(() => {
      vi.advanceTimersByTime(CAMERA_START_TIMEOUT_MS);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Device error" }));

    expect(screen.getByTestId("state")).toHaveTextContent("blocked");
    expect(screen.getByTestId("error")).toHaveTextContent("already open in another tab or app");
  });

  it("switches between rear and front camera constraints when device labels are unavailable", async () => {
    render(<CameraProbe />);

    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    expect(screen.getByTestId("facing")).toHaveTextContent("user");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await Promise.resolve();
    });

    expect(screen.getByTestId("facing")).toHaveTextContent("user");
    expect(screen.getByTestId("state")).toHaveTextContent("loading");
  });

  it("uses the active stream device to flip when camera labels are unavailable", async () => {
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
      configurable: true,
      value: vi.fn(async () => [
        { kind: "videoinput", deviceId: "front", label: "" },
        { kind: "videoinput", deviceId: "rear", label: "" },
      ]),
    });
    const { result } = renderHook(() => useCamera());
    Object.defineProperty(result.current.webcamRef, "current", {
      value: { stream: { getVideoTracks: () => [{ getSettings: () => ({ deviceId: "rear" }) }] } },
    });
    await act(async () => result.current.markReady());

    act(() => result.current.switchCamera());
    expect(result.current.selectedCameraId).toBe("front");
  });

  it("keeps the facing-mode fallback when device enumeration fails", async () => {
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error("Enumeration unavailable")),
    });
    const { result } = renderHook(() => useCamera());
    await act(async () => result.current.markReady());

    act(() => result.current.switchCamera());
    expect(result.current.selectedCameraId).toBe("");
    expect(result.current.cameraFacingMode).toBe("user");

    act(() => result.current.switchCamera());
    expect(result.current.cameraFacingMode).toBe("environment");
  });

  it.each([false, true])("flips away from the initial environment camera (front listed first: %s)", async (frontFirst) => {
    const cameras = [
      { kind: "videoinput", deviceId: "rear", label: "Back Camera" },
      { kind: "videoinput", deviceId: "front", label: "Front Camera" },
    ];
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
      configurable: true,
      value: vi.fn(async () => frontFirst ? [...cameras].reverse() : cameras),
    });
    render(<CameraProbe />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ready" }));
    });
    expect(screen.getByTestId("facing")).toHaveTextContent("environment");
    expect(screen.getByTestId("selected")).toHaveTextContent("none");

    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    expect(screen.getByTestId("selected")).toHaveTextContent("front");
    expect(screen.getByTestId("state")).toHaveTextContent("loading");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    expect(screen.getByTestId("selected")).toHaveTextContent("front");

    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    expect(screen.getByTestId("selected")).toHaveTextContent("rear");
  });
});

function CameraProbe() {
  const { cameraError, cameraFacingMode, cameraState, selectedCameraId, markError, markReady, retryCamera, switchCamera } = useCamera();

  return (
    <div>
      <p data-testid="state">{cameraState}</p>
      <p data-testid="error">{cameraError ?? "none"}</p>
      <p data-testid="facing">{cameraFacingMode}</p>
      <p data-testid="selected">{selectedCameraId || "none"}</p>
      <button type="button" onClick={markReady}>
        Ready
      </button>
      <button type="button" onClick={retryCamera}>
        Retry
      </button>
      <button type="button" onClick={() => markError(new DOMException("Permission denied", "NotAllowedError"))}>
        Permission error
      </button>
      <button type="button" onClick={() => markError(new DOMException("Device in use", "NotReadableError"))}>
        Device error
      </button>
      <button type="button" onClick={switchCamera}>
        Switch
      </button>
    </div>
  );
}
