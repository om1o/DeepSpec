import { useCallback, useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import { compressImageDataUrl } from "../lib/utils";

type CameraState = "loading" | "ready" | "blocked";
export type CameraDevice = {
  deviceId: string;
  label: string;
};

const CAMERA_START_TIMEOUT_MS = 15000;
const CAMERA_PERMISSION_WAITING_MESSAGE =
  "Camera permission is still waiting. Approve the browser camera prompt, then try again.";
const CAMERA_PERMISSION_REQUESTED_MESSAGE =
  "Camera permission requested. Approve the browser camera prompt, or upload a photo instead.";
const CAMERA_DEVICE_IN_USE_MESSAGE =
  "Camera is already open in another tab or app. Close the other camera, choose another camera if available, then try again.";

export function useCamera() {
  const webcamRef = useRef<Webcam>(null);
  const retryAttemptRef = useRef(0);
  const retryTimeoutRef = useRef<number | null>(null);
  const cameraCaptureSupported = hasCameraCapture();
  const [cameraRequestId, setCameraRequestId] = useState(0);
  const [cameraState, setCameraState] = useState<CameraState>(() => (cameraCaptureSupported ? "loading" : "blocked"));
  const [cameraDevices, setCameraDevices] = useState<CameraDevice[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(() =>
    cameraCaptureSupported ? null : "This browser does not support camera capture. Use Safari or Chrome over HTTPS.",
  );

  const cancelPendingRetry = useCallback(() => {
    retryAttemptRef.current += 1;
    if (retryTimeoutRef.current !== null) {
      window.clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const refreshCameraDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameraDevices(devices
        .filter((device) => device.kind === "videoinput" && device.deviceId)
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Camera ${index + 1}`,
        })));
    } catch {
      setCameraDevices([]);
    }
  }, []);

  const markReady = useCallback(() => {
    setCameraState("ready");
    setCameraError(null);
    void refreshCameraDevices();
  }, [refreshCameraDevices]);

  const markError = useCallback((error: string | DOMException) => {
    const message = typeof error === "string" ? error : `${error.name} ${error.message}`.trim();
    setCameraState("blocked");
    setCameraError(getCameraErrorMessage(message));
    void refreshCameraDevices();
  }, [refreshCameraDevices]);

  const retryCamera = useCallback(() => {
    if (!cameraCaptureSupported) {
      setCameraState("blocked");
      setCameraError("This browser does not support camera capture. Use Safari or Chrome over HTTPS.");
      return;
    }

    cancelPendingRetry();
    const retryAttempt = retryAttemptRef.current;
    setCameraState("blocked");
    setCameraError(CAMERA_PERMISSION_REQUESTED_MESSAGE);
    retryTimeoutRef.current = window.setTimeout(() => {
      if (retryAttemptRef.current !== retryAttempt) {
        return;
      }

      retryAttemptRef.current += 1;
      retryTimeoutRef.current = null;
      setCameraState("blocked");
      setCameraError(CAMERA_PERMISSION_WAITING_MESSAGE);
    }, CAMERA_START_TIMEOUT_MS);

    void requestCameraAccess(selectedCameraId)
      .then(() => {
        if (retryAttemptRef.current !== retryAttempt) {
          return;
        }

        if (retryTimeoutRef.current !== null) {
          window.clearTimeout(retryTimeoutRef.current);
          retryTimeoutRef.current = null;
        }
        setCameraState("loading");
        setCameraError(null);
        setCameraRequestId((current) => current + 1);
      })
      .catch((error: DOMException) => {
        if (retryAttemptRef.current !== retryAttempt) {
          return;
        }

        cancelPendingRetry();
        markError(error);
      });
  }, [cameraCaptureSupported, cancelPendingRetry, markError, selectedCameraId]);

  const selectCamera = useCallback((deviceId: string) => {
    cancelPendingRetry();
    setSelectedCameraId(deviceId);
    setCameraState("loading");
    setCameraError(null);
    setCameraRequestId((current) => current + 1);
  }, [cancelPendingRetry]);

  useEffect(() => cancelPendingRetry, [cancelPendingRetry]);

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
    cameraDevices,
    webcamRef,
    cameraState,
    cameraError,
    selectedCameraId,
    markReady,
    markError,
    retryCamera,
    selectCamera,
    captureFrame,
  };
}

function hasCameraCapture() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

function getCameraErrorMessage(message: string) {
  if (/device in use|notreadable|could not start video source/i.test(message)) {
    return CAMERA_DEVICE_IN_USE_MESSAGE;
  }

  return message || "Camera access was blocked.";
}

async function requestCameraAccess(deviceId: string) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: deviceId ? { deviceId: { exact: deviceId } } : true,
  });
  stream.getTracks().forEach((track) => track.stop());
}
