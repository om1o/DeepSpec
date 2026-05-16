import { useCallback, useRef, useState } from "react";
import Webcam from "react-webcam";
import { compressImageDataUrl } from "../lib/utils";

type CameraState = "loading" | "ready" | "blocked";

export function useCamera() {
  const webcamRef = useRef<Webcam>(null);
  const [cameraState, setCameraState] = useState<CameraState>("loading");
  const [cameraError, setCameraError] = useState<string | null>(null);

  const markReady = useCallback(() => {
    setCameraState("ready");
    setCameraError(null);
  }, []);

  const markError = useCallback((error: string | DOMException) => {
    const message = typeof error === "string" ? error : error.message;
    setCameraState("blocked");
    setCameraError(message || "Camera access was blocked.");
  }, []);

  const captureFrame = useCallback(async () => {
    const screenshot = webcamRef.current?.getScreenshot();
    if (!screenshot) {
      throw new Error("No camera frame was available.");
    }

    return compressImageDataUrl(screenshot, 1024, 0.8);
  }, []);

  return {
    webcamRef,
    cameraState,
    cameraError,
    markReady,
    markError,
    captureFrame,
  };
}
