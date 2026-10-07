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

  it("flags a tiny mask inside the target as SAM grabbing a sub-part", () => {
    // Real probe values: SAM segmented only the label at the center of a boxed product.
    expect(
      getSamGeometryVerdict({
        frameDims: "1080x1440",
        modelDims: "1080x1440",
        targetBoxNorm: "0.350,0.300,0.300,0.400",
        maskBoxNorm: "0.441,0.460,0.138,0.080",
      }),
    ).toBe("mask much smaller than target");
  });

  it("flags a mask that spills well past the target as SAM grabbing the surroundings", () => {
    // Rotated engine-cover case: SAM's top-scored mask covered the cover plus the manifold.
    expect(
      getSamGeometryVerdict({
        frameDims: "1080x1440",
        modelDims: "1080x1440",
        targetBoxNorm: "0.480,0.180,0.370,0.650",
        maskBoxNorm: "0.193,0.184,0.654,0.816",
      }),
    ).toBe("mask much larger than target");
  });

  it("accepts a mask slightly larger than a snug target box", () => {
    expect(
      getSamGeometryVerdict({
        frameDims: "1080x1440",
        modelDims: "1080x1440",
        targetBoxNorm: "0.400,0.400,0.200,0.200",
        maskBoxNorm: "0.380,0.380,0.260,0.240",
      }),
    ).toBe("mask overlaps target");
  });

  it("waits for enough geometry before giving a verdict", () => {
    expect(getSamGeometryVerdict({ frameDims: "1280x720", modelDims: "1280x720" })).toBe("need geometry");
  });
});
