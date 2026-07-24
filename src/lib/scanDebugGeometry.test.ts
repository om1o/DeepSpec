import { describe, expect, it } from "vitest";
import { getSamGeometryVerdict } from "./scanDebugGeometry";

describe("getSamGeometryVerdict", () => {
  it("flags a frame/model decode or orientation mismatch before comparing boxes", () => {
    expect(
      getSamGeometryVerdict({
        frameDims: "1280x720",
        modelDims: "720x1280",
        targetBoxNorm: "0.400,0.400,0.200,0.200",
        maskBoxNorm: "0.410,0.410,0.100,0.100",
      }),
    ).toBe("frame/model dims mismatch");
  });

  it("flags a SAM mask that is far from the target when dimensions match", () => {
    expect(
      getSamGeometryVerdict({
        frameDims: "1280x720",
        modelDims: "1280x720",
        targetBoxNorm: "0.400,0.400,0.200,0.200",
        maskBoxNorm: "0.050,0.050,0.100,0.100",
      }),
    ).toBe("mask missed target");
  });

  it("accepts a smaller mask inside the target as the expected SAM geometry", () => {
    expect(
      getSamGeometryVerdict({
        frameDims: "1280x720",
        modelDims: "1280x720",
        targetBoxNorm: "0.400,0.400,0.300,0.300",
        maskBoxNorm: "0.445,0.454,0.121,0.213",
      }),
    ).toBe("mask overlaps target");
  });

  it("waits for enough geometry before giving a verdict", () => {
    expect(getSamGeometryVerdict({ frameDims: "1280x720", modelDims: "1280x720" })).toBe("need geometry");
  });
});
