import { describe, expect, it } from "vitest";
import { getScannerReticleBounds, isTargetInsideScannerBox } from "./scannerReticle";

describe("scanner reticle target lock zone", () => {
  it("matches the visible scanner box geometry", () => {
    expect(getScannerReticleBounds(1000, 800)).toEqual({
      height: 520,
      left: 305,
      top: 100,
      width: 390,
    });
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
