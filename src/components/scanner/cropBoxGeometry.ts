import type { VisualFocusBox } from "../../types";

// Pure geometry + the feature flag for the Lens crop box, split out of CropBox.tsx so the
// component file exports only a component (keeps HMR fast-refresh working) and so the crop
// math is unit-testable in isolation.

export type PixelBox = { left: number; top: number; width: number; height: number };

/** Feature flag — ships dark. Enable with VITE_DEEPSPEC_CROP_BOX=on. */
export function isCropBoxEnabled(): boolean {
  const setting = (import.meta.env.VITE_DEEPSPEC_CROP_BOX as string | undefined)?.trim().toLowerCase();
  return setting === "on" || setting === "true" || setting === "1";
}

// Console tag: proves THIS build's crop-box code loaded and shows exactly what the flag
// resolved to. If you DON'T see this line in DevTools after a hard reload, your browser is
// running a stale/cached bundle (service worker) — clear it with the snippet, then reload.
try {
  const rawCropBoxFlag = import.meta.env.VITE_DEEPSPEC_CROP_BOX;
  console.info(`[DeepSpec CropBox] cropbox-trace-1 loaded — VITE_DEEPSPEC_CROP_BOX=${JSON.stringify(rawCropBoxFlag)} -> enabled=${isCropBoxEnabled()}`);
} catch {
  // ignore logging failures
}

/**
 * Convert an on-screen box (viewport CSS px) to a normalized full-frame box, inverting the
 * `object-fit: cover` transform the camera <video> uses. Mirrors mapImageTargetToViewport in
 * Scanner.tsx so crop coords match the rest of the pipeline.
 */
export function viewportBoxToNormalized(
  box: PixelBox,
  viewportWidth: number,
  viewportHeight: number,
  videoWidth: number,
  videoHeight: number,
): VisualFocusBox {
  const safeVideoW = Math.max(1, videoWidth);
  const safeVideoH = Math.max(1, videoHeight);
  const scale = Math.max(viewportWidth / safeVideoW, viewportHeight / safeVideoH);
  const renderedW = safeVideoW * scale;
  const renderedH = safeVideoH * scale;
  const offsetX = (viewportWidth - renderedW) / 2;
  const offsetY = (viewportHeight - renderedH) / 2;
  return clampNormalizedBox({
    confidence: 1,
    x: (box.left - offsetX) / renderedW,
    y: (box.top - offsetY) / renderedH,
    width: box.width / renderedW,
    height: box.height / renderedH,
  });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampNormalizedBox(box: VisualFocusBox): VisualFocusBox {
  const x = clamp(box.x, 0, 1);
  const y = clamp(box.y, 0, 1);
  return {
    confidence: box.confidence,
    x,
    y,
    width: clamp(box.width, 0, 1 - x),
    height: clamp(box.height, 0, 1 - y),
  };
}
