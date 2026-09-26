import { getContainedFrameSize } from "../components/result/isolatedPartViewGeometry";
import type { VisualFocusBox } from "../types";

export type PxRect = { x: number; y: number; width: number; height: number };
export type Viewport = { width: number; height: number };

export type ReviewCardPlacement = {
  left: number;
  top: number;
  anchorSide: "left" | "right";
};

export const SCAN_CARD_WIDTH_PX = 340;
const SCAN_CARD_SAFE_HEIGHT_PX = 560;

/**
 * Where the focused part actually sits on screen during scan review: the frame is contain-fit
 * (letterboxed) and centred in the full-viewport stage (IsolatedPartView's ArStage), so the
 * frame-normalized focus box maps through that same fit. The live-camera/upload targets were in
 * object-cover (cropped) coordinates instead, which drifted from the displayed part on any screen
 * whose aspect differs from the photo's — the result card then landed on top of the part.
 */
export function getDisplayedFocusRect(focusBox: VisualFocusBox, frameSize: Viewport, viewport: Viewport): PxRect | null {
  if (frameSize.width <= 0 || frameSize.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return null;
  }
  const stage = getContainedFrameSize(viewport, frameSize.width / frameSize.height);
  const offsetX = (viewport.width - stage.width) / 2;
  const offsetY = (viewport.height - stage.height) / 2;
  return {
    x: offsetX + clamp01(focusBox.x) * stage.width,
    y: offsetY + clamp01(focusBox.y) * stage.height,
    width: clamp01(focusBox.width) * stage.width,
    height: clamp01(focusBox.height) * stage.height,
  };
}

/** Place the scan result card beside the target (or docked low on narrow screens). */
export function getReviewCardPlacement(target: PxRect | null, viewport: Viewport): ReviewCardPlacement {
  if (viewport.width < 520 && target) {
    return {
      anchorSide: "right",
      left: 14,
      top: Math.max(72, viewport.height - 320),
    };
  }

  if (!target) {
    return {
      anchorSide: "right",
      left: 14,
      top: Math.max(72, viewport.height - 420),
    };
  }

  const margin = 12;
  const gap = 10;
  const canPlaceRight = target.x + target.width + SCAN_CARD_WIDTH_PX + gap < viewport.width;
  const anchorSide = canPlaceRight ? "left" : "right";
  const left = canPlaceRight
    ? clampNumber(target.x + target.width + gap, 14, viewport.width - SCAN_CARD_WIDTH_PX - 14)
    : clampNumber(target.x - SCAN_CARD_WIDTH_PX - gap, 14, viewport.width - SCAN_CARD_WIDTH_PX - 14);
  const rawTop = target.y + target.height / 2;
  const top = clampNumber(rawTop - margin, 72, Math.max(72, viewport.height - SCAN_CARD_SAFE_HEIGHT_PX));

  return { anchorSide, left, top };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
