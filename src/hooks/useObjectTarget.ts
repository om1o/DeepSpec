import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import Webcam from "react-webcam";
import { detectObjectTargetFromImageData, type ObjectTargetBox } from "../lib/objectTargeting";
import { getScannerReticleBounds, isTargetInsideScannerBox } from "../lib/scannerReticle";

export type CameraObjectTarget = {
  confidence: number;
  height: number;
  holdProgress: number;
  isInScannerBox: boolean;
  isLocked: boolean;
  left: number;
  top: number;
  width: number;
};

type UseObjectTargetOptions = {
  enabled: boolean;
  holdDurationMs?: number;
  holdEnabled: boolean;
};

const SAMPLE_LONG_EDGE = 128;
const SAMPLE_INTERVAL_MS = 180;
const TARGET_SHIFT_TOLERANCE = 0.12;

export function useObjectTarget(
  webcamRef: RefObject<Webcam | null>,
  { enabled, holdDurationMs = 1500, holdEnabled }: UseObjectTargetOptions,
) {
  const [target, setTarget] = useState<CameraObjectTarget | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lockRef = useRef<{ box: ObjectTargetBox; startedAt: number } | null>(null);

  useEffect(() => {
    if (!enabled) {
      lockRef.current = null;
      return undefined;
    }

    const timer = window.setInterval(() => {
      const video = getVideoElement(webcamRef.current);
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
        lockRef.current = null;
        setTarget(null);
        return;
      }

      const detected = detectCurrentTarget(video, canvasRef);
      if (!detected) {
        lockRef.current = null;
        setTarget(null);
        return;
      }

      const viewportTarget = toViewportTarget(detected, video);
      const scannerBox = getScannerReticleBounds(window.innerWidth, window.innerHeight);
      if (!isTargetInsideScannerBox(viewportTarget, scannerBox)) {
        lockRef.current = null;
        setTarget({
          ...viewportTarget,
          confidence: detected.confidence,
          holdProgress: 0,
          isInScannerBox: false,
          isLocked: false,
        });
        return;
      }

      const now = Date.now();
      const previousLock = lockRef.current;
      const isSameTarget = Boolean(previousLock && getTargetShift(previousLock.box, detected) < TARGET_SHIFT_TOLERANCE);
      const startedAt = holdEnabled && isSameTarget && previousLock ? previousLock.startedAt : now;
      lockRef.current = { box: detected, startedAt };

      const holdProgress = holdEnabled ? Math.min(1, (now - startedAt) / holdDurationMs) : 0;
      setTarget({
        ...viewportTarget,
        confidence: detected.confidence,
        holdProgress,
        isInScannerBox: true,
        isLocked: holdProgress >= 1,
      });
    }, SAMPLE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [enabled, holdDurationMs, holdEnabled, webcamRef]);

  return enabled ? target : null;
}

function detectCurrentTarget(video: HTMLVideoElement, canvasRef: MutableRefObject<HTMLCanvasElement | null>) {
  const canvas = canvasRef.current ?? document.createElement("canvas");
  canvasRef.current = canvas;

  const scale = SAMPLE_LONG_EDGE / Math.max(video.videoWidth, video.videoHeight);
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return null;
  }

  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return detectObjectTargetFromImageData(context.getImageData(0, 0, canvas.width, canvas.height));
}

function getVideoElement(webcam: Webcam | null) {
  return (webcam as (Webcam & { video?: HTMLVideoElement }) | null)?.video ?? null;
}

function getTargetShift(a: ObjectTargetBox, b: ObjectTargetBox) {
  const aCenterX = a.x + a.width / 2;
  const aCenterY = a.y + a.height / 2;
  const bCenterX = b.x + b.width / 2;
  const bCenterY = b.y + b.height / 2;

  return Math.hypot(aCenterX - bCenterX, aCenterY - bCenterY) + Math.abs(a.width - b.width) * 0.5 + Math.abs(a.height - b.height) * 0.5;
}

function toViewportTarget(box: ObjectTargetBox, video: HTMLVideoElement) {
  const rect = video.getBoundingClientRect();
  const videoAspect = video.videoWidth / video.videoHeight;
  const rectAspect = rect.width / rect.height;
  let renderedWidth = rect.width;
  let renderedHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;

  if (videoAspect > rectAspect) {
    renderedWidth = rect.height * videoAspect;
    offsetX = (rect.width - renderedWidth) / 2;
  } else {
    renderedHeight = rect.width / videoAspect;
    offsetY = (rect.height - renderedHeight) / 2;
  }

  const left = rect.left + offsetX + box.x * renderedWidth;
  const top = rect.top + offsetY + box.y * renderedHeight;
  const width = box.width * renderedWidth;
  const height = box.height * renderedHeight;

  return {
    left: clamp(left, 0, window.innerWidth),
    top: clamp(top, 0, window.innerHeight),
    width: clamp(width, 64, window.innerWidth),
    height: clamp(height, 64, window.innerHeight),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
