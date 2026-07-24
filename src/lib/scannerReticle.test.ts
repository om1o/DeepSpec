import { describe, expect, it } from "vitest";
import { getScannerReticleBounds, isTargetInsideScannerBox } from "./scannerReticle";

describe("scanner reticle target lock zone", () => {
  it("matches the visible scanner box geometry", () => {
    expect(getScannerReticleBounds(1000, 800)).toEqual({
      height: 240,
      left: 340,
      top: 280,
      width: 320,
    });
  });

  it("uses the same mobile geometry as the visible AR brackets", () => {
    expect(getScannerReticleBounds(390, 844)).toEqual({
      height: 202.8,
      left: 54.599999999999994,
      top: 320.6,
      width: 280.8,
    });
  });

  it("accepts a target centered inside the scanner box", () => {
    const scannerBox = getScannerReticleBounds(1000, 800);

    expect(isTargetInsideScannerBox({ height: 120, left: 430, top: 330, width: 120 }, scannerBox)).toBe(true);
  });

  it("rejects a target outside the scanner box", () => {
    const scannerBox = getScannerReticleBounds(1000, 800);

    expect(isTargetInsideScannerBox({ height: 120, left: 90, top: 330, width: 120 }, scannerBox)).toBe(false);
  });

  it("accepts close targets that are larger than the scanner box", () => {
    const scannerBox = getScannerReticleBounds(1000, 800);

    expect(isTargetInsideScannerBox({ height: 760, left: 180, top: 20, width: 640 }, scannerBox)).toBe(true);
  });
});
