import { describe, expect, it } from "vitest";
import { getDisplayedFocusRect, getReviewCardPlacement, SCAN_CARD_WIDTH_PX, type PxRect } from "./reviewCardPlacement";

const focusBox = { x: 0.55, y: 0.35, width: 0.25, height: 0.3, confidence: 1 };
const portraitPhoto = { width: 1080, height: 1440 };

function overlapsHorizontally(part: PxRect, cardLeft: number) {
  return cardLeft < part.x + part.width && cardLeft + SCAN_CARD_WIDTH_PX > part.x;
}

describe("getDisplayedFocusRect", () => {
  it("maps through the letterboxed stage: a portrait photo is pillarboxed on a landscape screen", () => {
    // 1440x900 viewport, 3:4 photo → 675x900 stage centred at x=382.5.
    const rect = getDisplayedFocusRect(focusBox, portraitPhoto, { width: 1440, height: 900 });
    expect(rect?.x).toBeCloseTo(382.5 + 0.55 * 675);
    expect(rect?.y).toBeCloseTo(0.35 * 900);
    expect(rect?.width).toBeCloseTo(0.25 * 675);
    expect(rect?.height).toBeCloseTo(0.3 * 900);
  });

  it("maps through the letterboxed stage: a landscape photo is letterboxed on a portrait screen", () => {
    // 820x1180 viewport, 16:9 photo → 820x461.25 stage centred at y=359.375.
    const rect = getDisplayedFocusRect(focusBox, { width: 1280, height: 720 }, { width: 820, height: 1180 });
    expect(rect?.x).toBeCloseTo(0.55 * 820);
    expect(rect?.y).toBeCloseTo(359.375 + 0.35 * 461.25);
  });

  it("returns null for an undecoded or empty frame", () => {
    expect(getDisplayedFocusRect(focusBox, { width: 0, height: 0 }, { width: 1440, height: 900 })).toBeNull();
  });
});

describe("getReviewCardPlacement", () => {
  // The viewports where the old object-cover anchor put the card over 9–15% of the part.
  it.each([
    [1180, 820],
    [1440, 900],
    [1024, 768],
  ])("keeps the card off the displayed part (%ix%i viewport, portrait photo)", (width, height) => {
    const viewport = { width, height };
    const part = getDisplayedFocusRect(focusBox, portraitPhoto, viewport)!;
    const placement = getReviewCardPlacement(part, viewport);
    expect(overlapsHorizontally(part, placement.left)).toBe(false);
  });

  it("docks the card low on narrow screens regardless of the target", () => {
    const placement = getReviewCardPlacement({ x: 10, y: 10, width: 100, height: 100 }, { width: 390, height: 844 });
    expect(placement).toEqual({ anchorSide: "right", left: 14, top: 844 - 320 });
  });
});
