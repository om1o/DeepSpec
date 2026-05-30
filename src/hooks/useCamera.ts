import { useCallback, useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import { compressImageDataUrl } from "../lib/utils";

type CameraState = "loading" | "ready" | "blocked";

const CAMERA_START_TIMEOUT_MS = 8000;
const CAMERA_PERMISSION_WAITING_MESSAGE =
  "Camera permission is still waiting. Approve the browser camera prompt, then try again.";

export function useCamera() {
  const webcamRef = useRef<Webcam>(null);
  const cameraCaptureSupported = hasCameraCapture();
  const [cameraRequestId, setCameraRequestId] = useState(0);
  const [cameraState, setCameraState] = useState<CameraState>(() => (cameraCaptureSupported ? "loading" : "blocked"));
  const [cameraError, setCameraError] = useState<string | null>(() =>
    cameraCaptureSupported ? null : "This browser does not support camera capture. Use Safari or Chrome over HTTPS.",
  );

  const markReady = useCallback(() => {
    setCameraState("ready");
    setCameraError(null);
  }, []);

  const markError = useCallback((error: string | DOMException) => {
    const message = typeof error === "string" ? error : error.message;
    setCameraState("blocked");
    setCameraError(message || "Camera access was blocked.");
  }, []);

  const retryCamera = useCallback(() => {
    if (!cameraCaptureSupported) {
      setCameraState("blocked");
      setCameraError("This browser does not support camera capture. Use Safari or Chrome over HTTPS.");
      return;
    }

    setCameraState("loading");
    setCameraError(null);
    setCameraRequestId((current) => current + 1);
  }, [cameraCaptureSupported]);

  useEffect(() => {
    if (cameraState !== "loading") {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setCameraState("blocked");
      setCameraError(CAMERA_PERMISSION_WAITING_MESSAGE);
    }, CAMERA_START_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [cameraRequestId, cameraState]);

  const captureFrame = useCallback(async () => {
    const screenshot = webcamRef.current?.getScreenshot();
    if (!screenshot) {
      throw new Error("No camera frame was available.");
    }

    return compressImageDataUrl(screenshot, 1024, 0.8);
  }, []);

  return {
    cameraRequestId,
    webcamRef,
    cameraState,
    cameraError,
    markReady,
    markError,
    retryCamera,
    captureFrame,
  };
}

function hasCameraCapture() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}
