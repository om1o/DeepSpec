import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
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
      video: { facingMode: { ideal: "environment" } },
    });
    expect(stopCameraTrack).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("state")).toHaveTextContent("loading");
    expect(screen.getByTestId("error")).toHaveTextContent("none");
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

  it("switches between rear and front camera constraints when device labels are unavailable", async () => {
    render(<CameraProbe />);

    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    expect(screen.getByTestId("facing")).toHaveTextContent("user");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await Promise.resolve();
    });

    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: { facingMode: { ideal: "user" } },
    });
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
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: { deviceId: { exact: "front" } },
    });

    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    expect(screen.getByTestId("selected")).toHaveTextContent("rear");
  });
});

function CameraProbe() {
  const { cameraError, cameraFacingMode, cameraState, selectedCameraId, markReady, retryCamera, switchCamera } = useCamera();

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
      <button type="button" onClick={switchCamera}>
        Switch
      </button>
    </div>
  );
}
