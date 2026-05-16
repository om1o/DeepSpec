import type { CapturedFrame, ScanAnalysisState } from "../types";

const LATEST_CAPTURED_FRAME_KEY = "deep-spec:latest-captured-frame";
const LATEST_SCAN_STATE_KEY = "deep-spec:latest-scan-state";

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function saveLatestCapturedFrame(frame: CapturedFrame) {
  saveLatestScanState({ frame });

  if (typeof sessionStorage === "undefined") {
    return;
  }

  try {
    sessionStorage.setItem(LATEST_CAPTURED_FRAME_KEY, JSON.stringify(frame));
  } catch {
    // Phase 1 should still navigate even if browser storage is unavailable.
  }
}

export function readLatestCapturedFrame(): CapturedFrame | null {
  return readLatestScanState()?.frame ?? readLegacyCapturedFrame();
}

export function saveLatestScanState(state: ScanAnalysisState) {
  if (typeof sessionStorage === "undefined") {
    return;
  }

  try {
    sessionStorage.setItem(LATEST_SCAN_STATE_KEY, JSON.stringify(state));
  } catch {
    // Phase 2 should still show the current route state if browser storage is unavailable.
  }
}

export function readLatestScanState(): ScanAnalysisState | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }

  try {
    const rawState = sessionStorage.getItem(LATEST_SCAN_STATE_KEY);
    if (!rawState) {
      return null;
    }

    const state = JSON.parse(rawState) as Partial<ScanAnalysisState>;
    if (!isCapturedFrame(state.frame)) {
      return null;
    }

    return {
      frame: state.frame,
      result: state.result,
      errorMessage: typeof state.errorMessage === "string" ? state.errorMessage : undefined,
      errorCode: typeof state.errorCode === "string" ? state.errorCode : undefined,
      analyzedAt: typeof state.analyzedAt === "string" ? state.analyzedAt : undefined,
    };
  } catch {
    return null;
  }
}

function readLegacyCapturedFrame(): CapturedFrame | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }

  try {
    const rawFrame = sessionStorage.getItem(LATEST_CAPTURED_FRAME_KEY);
    if (!rawFrame) {
      return null;
    }

    const frame = JSON.parse(rawFrame) as Partial<CapturedFrame>;
    if (!isCapturedFrame(frame)) {
      return null;
    }

    return {
      imageBase64: frame.imageBase64,
      capturedAt: frame.capturedAt,
    };
  } catch {
    return null;
  }
}

function isCapturedFrame(value: unknown): value is CapturedFrame {
  return (
    typeof value === "object" &&
    value !== null &&
    "imageBase64" in value &&
    "capturedAt" in value &&
    typeof value.imageBase64 === "string" &&
    typeof value.capturedAt === "string"
  );
}

export async function compressImageDataUrl(
  dataUrl: string,
  maxLongestEdge = 1024,
  quality = 0.8,
): Promise<string> {
  const image = await loadImage(dataUrl);
  const { width, height } = getScaledDimensions(image.width, image.height, maxLongestEdge);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not prepare image compression.");
  }

  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

export function getScaledDimensions(width: number, height: number, maxLongestEdge: number) {
  const scale = Math.min(1, maxLongestEdge / Math.max(width, height));

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read captured image."));
    image.src = dataUrl;
  });
}
