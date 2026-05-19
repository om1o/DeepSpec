import { useCallback, useRef, useState } from "react";
import Webcam from "react-webcam";
import { compressImageDataUrl } from "../lib/utils";

type CameraState = "loading" | "ready" | "blocked";

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
