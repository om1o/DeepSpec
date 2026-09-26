import { describe, expect, it } from "vitest";
import { viewportBoxToNormalized } from "./cropBoxGeometry";

describe("viewportBoxToNormalized", () => {
  it("maps directly when the video and viewport share an aspect ratio", () => {
    // 1000x1000 video shown in a 500x500 viewport -> uniform 0.5 scale, no crop.
    const box = viewportBoxToNormalized({ left: 100, top: 100, width: 200, height: 200 }, 500, 500, 1000, 1000);
    expect(box.x).toBeCloseTo(0.2, 5);
    expect(box.y).toBeCloseTo(0.2, 5);
    expect(box.width).toBeCloseTo(0.4, 5);
    expect(box.height).toBeCloseTo(0.4, 5);
  });

  it("inverts object-fit: cover cropping for a wide video in a tall viewport", () => {
    // 2000x1000 video, 500x1000 viewport -> scale 1, video overflows horizontally and is
    // centered, so the visible viewport is the middle 25% of the frame width.
    const box = viewportBoxToNormalized({ left: 0, top: 0, width: 500, height: 1000 }, 500, 1000, 2000, 1000);
    expect(box.x).toBeCloseTo(0.375, 5);
    expect(box.y).toBeCloseTo(0, 5);
    expect(box.width).toBeCloseTo(0.25, 5);
    expect(box.height).toBeCloseTo(1, 5);
  });

  it("clamps out-of-bounds boxes into the normalized [0,1] range", () => {
    const box = viewportBoxToNormalized({ left: -50, top: -50, width: 10_000, height: 10_000 }, 500, 500, 1000, 1000);
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.width).toBeLessThanOrEqual(1);
    expect(box.height).toBeLessThanOrEqual(1);
    expect(box.x + box.width).toBeLessThanOrEqual(1);
    expect(box.y + box.height).toBeLessThanOrEqual(1);
  });

  it("falls back safely when video dimensions are zero", () => {
    const box = viewportBoxToNormalized({ left: 0, top: 0, width: 100, height: 100 }, 500, 500, 0, 0);
    expect(Number.isFinite(box.x)).toBe(true);
    expect(Number.isFinite(box.width)).toBe(true);
  });
});
