import { describe, expect, it } from "vitest";
import { getBoxPromptPoints, getPromptableSegmentationModel, isPromptableSegmentationEnabled, pickBestFitMask } from "./promptableSegmentation";

describe("promptableSegmentation gating", () => {
  it("is enabled by default with the SlimSAM model", () => {
    expect(isPromptableSegmentationEnabled({})).toBe(true);
    expect(getPromptableSegmentationModel({})).toBe("Xenova/slimsam-77-uniform");
  });

  it.each(["off", "false", "0"])("can be turned off with %s", (value) => {
    expect(isPromptableSegmentationEnabled({ VITE_DEEPSPEC_PROMPTABLE_SEG: value })).toBe(false);
  });

  it("honors a model override", () => {
    expect(
      getPromptableSegmentationModel({ VITE_DEEPSPEC_PROMPTABLE_SEG_MODEL: "Xenova/sam-vit-base" }),
    ).toBe("Xenova/sam-vit-base");
  });
});

describe("getBoxPromptPoints", () => {
  it("spreads five points across the inner half of the box, center first", () => {
    const points = getBoxPromptPoints({ x: 0.2, y: 0.4, width: 0.4, height: 0.2, confidence: 1 });
    const rounded = points.map(([x, y]) => [Number(x.toFixed(3)), Number(y.toFixed(3))]);
    expect(rounded).toEqual([
      [0.4, 0.5],
      [0.3, 0.5],
      [0.5, 0.5],
      [0.4, 0.45],
      [0.4, 0.55],
    ]);
  });

  it("keeps every point inside the frame", () => {
    const points = getBoxPromptPoints({ x: 0.9, y: -0.1, width: 0.4, height: 0.3, confidence: 1 });
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });
});

describe("pickBestFitMask", () => {
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

  it("prefers the mask that fills the target box over a higher-scored sub-part", () => {
    // Label-at-center case: SAM scored the label highest, but the whole product fits the box.
    const target = { ...box(0.35, 0.3, 0.3, 0.4), confidence: 1 };
    const picked = pickBestFitMask(
      [
        { box: box(0.441, 0.46, 0.138, 0.08), samScore: 0.97 },
        { box: box(0.35, 0.3, 0.3, 0.399), samScore: 0.9 },
        { box: box(0.1, 0.1, 0.8, 0.8), samScore: 0.8 },
      ],
      target,
    );
    expect(picked).toBe(1);
  });

  it("prefers the mask that fits the target box over a higher-scored oversized one", () => {
    // Rotated engine-cover case: SAM scored "cover + manifold" highest.
    const target = { ...box(0.48, 0.18, 0.37, 0.65), confidence: 1 };
    const picked = pickBestFitMask(
      [
        { box: box(0.6, 0.4, 0.1, 0.1), samScore: 0.7 },
        { box: box(0.474, 0.194, 0.373, 0.635), samScore: 0.88 },
        { box: box(0.193, 0.184, 0.654, 0.816), samScore: 0.95 },
      ],
      target,
    );
    expect(picked).toBe(1);
  });

  it("lets SAM's score break a near-tie in fit", () => {
    const target = { ...box(0.2, 0.2, 0.4, 0.4), confidence: 1 };
    const picked = pickBestFitMask(
      [
        { box: box(0.2, 0.2, 0.4, 0.4), samScore: 0.5 },
        { box: box(0.2, 0.2, 0.4, 0.396), samScore: 0.95 },
      ],
      target,
    );
    expect(picked).toBe(1);
  });

  it("skips empty masks and returns -1 when all are empty", () => {
    const target = { ...box(0.2, 0.2, 0.4, 0.4), confidence: 1 };
    expect(pickBestFitMask([{ box: null, samScore: 0.99 }, { box: box(0.9, 0.9, 0.05, 0.05), samScore: 0.1 }], target)).toBe(1);
    expect(pickBestFitMask([{ box: null, samScore: 0.99 }], target)).toBe(-1);
  });
});
