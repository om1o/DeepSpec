import { describe, expect, it } from "vitest";
import { getScannerReticleBounds, isTargetInsideScannerBox } from "./scannerReticle";

describe("scanner reticle target lock zone", () => {
  it.each([
    { viewport: [390, 844], expected: { height: 202.8, left: 54.6, top: 320.6, width: 280.8 } },
    { viewport: [430, 932], expected: { height: 223.6, left: 60.2, top: 354.2, width: 309.6 } },
    { viewport: [768, 1024], expected: { height: 240, left: 224, top: 392, width: 320 } },
    { viewport: [820, 1180], expected: { height: 240, left: 250, top: 470, width: 320 } },
    { viewport: [1024, 768], expected: { height: 240, left: 352, top: 264, width: 320 } },
    { viewport: [667, 375], expected: { height: 165, left: 223.5, top: 105, width: 220 } },
  ])("matches the visible scanner box geometry at $viewport", ({ expected, viewport }) => {
    const bounds = getScannerReticleBounds(viewport[0], viewport[1]);

    expect(bounds.height).toBeCloseTo(expected.height, 5);
    expect(bounds.left).toBeCloseTo(expected.left, 5);
    expect(bounds.top).toBeCloseTo(expected.top, 5);
    expect(bounds.width).toBeCloseTo(expected.width, 5);
  });

  it("accepts a target centered inside the scanner box", () => {
    const scannerBox = getScannerReticleBounds(1000, 800);

    expect(isTargetInsideScannerBox({ height: 160, left: 430, top: 250, width: 120 }, scannerBox)).toBe(true);
  });

  it("rejects a target outside the scanner box", () => {
    const scannerBox = getScannerReticleBounds(1000, 800);

    expect(isTargetInsideScannerBox({ height: 120, left: 90, top: 250, width: 120 }, scannerBox)).toBe(false);
  });

  it("accepts close targets that are larger than the scanner box", () => {
    const scannerBox = getScannerReticleBounds(1000, 800);

    expect(isTargetInsideScannerBox({ height: 760, left: 180, top: 20, width: 640 }, scannerBox)).toBe(true);
  });
});
