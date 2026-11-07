import { useCallback, useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import { CAPTURE_MAX_EDGE, compressImageDataUrl } from "../lib/utils";

type CameraState = "loading" | "ready" | "blocked";
type CameraFacingMode = "environment" | "user";
export type CameraDevice = {
  deviceId: string;
  label: string;
};

const CAMERA_START_TIMEOUT_MS = 15000;
const CAMERA_PERMISSION_WAITING_MESSAGE =
  "Camera permission is still waiting. Approve the browser camera prompt, then try again.";
const CAMERA_DEVICE_IN_USE_MESSAGE =
  "Camera is already open in another tab or app. Close the other camera, choose another camera if available, then try again.";

export function useCamera() {
  const webcamRef = useRef<Webcam>(null);
  const mountedRef = useRef(true);
  const activeRequestRef = useRef(0);
  const cameraCaptureSupported = hasCameraCapture();
  const [cameraRequestId, setCameraRequestId] = useState(0);
  const [cameraState, setCameraState] = useState<CameraState>(() => (cameraCaptureSupported ? "loading" : "blocked"));
  const [cameraDevices, setCameraDevices] = useState<CameraDevice[]>([]);
  const [cameraFacingMode, setCameraFacingMode] = useState<CameraFacingMode>("environment");
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(() =>
    cameraCaptureSupported ? null : "This browser does not support camera capture. Use Safari or Chrome over HTTPS.",
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const isCurrentRequest = useCallback(
    () => mountedRef.current && activeRequestRef.current === cameraRequestId,
    [cameraRequestId],
  );

  const startCameraRequest = useCallback(() => {
    activeRequestRef.current += 1;
    setCameraRequestId(activeRequestRef.current);
    setCameraState("loading");
    setCameraError(null);
  }, []);

  const refreshCameraDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!isCurrentRequest()) return;
      setCameraDevices(devices
        .filter((device) => device.kind === "videoinput" && device.deviceId)
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Camera ${index + 1}`,
        })));
    } catch {
      if (isCurrentRequest()) setCameraDevices([]);
    }
  }, [isCurrentRequest]);

  const markReady = useCallback(() => {
    if (!isCurrentRequest()) return;
    setCameraState("ready");
    setCameraError(null);
    void refreshCameraDevices();
  }, [isCurrentRequest, refreshCameraDevices]);

  const markError = useCallback((error: string | DOMException) => {
    // react-webcam can report a rejected request after its instance unmounts.
    if (!isCurrentRequest()) return;
    const message = typeof error === "string" ? error : `${error.name} ${error.message}`.trim();
    setCameraState("blocked");
    setCameraError(getCameraErrorMessage(message));
    void refreshCameraDevices();
  }, [isCurrentRequest, refreshCameraDevices]);

  const retryCamera = useCallback(() => {
    if (!cameraCaptureSupported) {
      setCameraState("blocked");
      setCameraError("This browser does not support camera capture. Use Safari or Chrome over HTTPS.");
      return;
    }

    // The keyed Webcam owns the only stream request, including permission retries.
    startCameraRequest();
  }, [cameraCaptureSupported, startCameraRequest]);

  const selectCamera = useCallback((deviceId: string) => {
    setSelectedCameraId(deviceId);
    startCameraRequest();
  }, [startCameraRequest]);

  const switchCamera = useCallback(() => {
    if (cameraDevices.length > 1) {
      const activeDeviceId = webcamRef.current?.stream?.getVideoTracks()[0]?.getSettings().deviceId;
      const currentIndex = cameraDevices.findIndex((device) => device.deviceId === (selectedCameraId || activeDeviceId));
      const facingCameraIndex = cameraDevices.findIndex((device) =>
        (cameraFacingMode === "environment" ? /back|rear|environment/i : /front|user|facetime/i).test(device.label),
      );
      // The initial facing-mode request has no selected ID; advance past that camera too.
      const startIndex = currentIndex === -1 ? facingCameraIndex : currentIndex;
      const nextIndex = (Math.max(0, startIndex) + 1) % cameraDevices.length;
      selectCamera(cameraDevices[nextIndex].deviceId);
      return;
    }

    setSelectedCameraId("");
    setCameraFacingMode((mode) => (mode === "environment" ? "user" : "environment"));
    startCameraRequest();
  }, [cameraDevices, cameraFacingMode, selectCamera, selectedCameraId, startCameraRequest]);

  useEffect(() => {
    if (cameraState !== "loading") {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      if (!isCurrentRequest()) return;
      activeRequestRef.current += 1;
      setCameraState("blocked");
      setCameraError(CAMERA_PERMISSION_WAITING_MESSAGE);
    }, CAMERA_START_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [cameraRequestId, cameraState, isCurrentRequest]);

  const captureFrame = useCallback(async () => {
    const screenshot = webcamRef.current?.getScreenshot();
    if (!screenshot) {
      throw new Error("No camera frame was available.");
    }

    return compressImageDataUrl(screenshot, CAPTURE_MAX_EDGE, 0.85);
  }, []);

  return {
    cameraRequestId,
    cameraDevices,
    webcamRef,
    cameraState,
    cameraError,
    cameraFacingMode,
    selectedCameraId,
    markReady,
    markError,
    retryCamera,
    selectCamera,
    switchCamera,
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
