import { analyzeQuality, QUALITY_SAMPLE_H, QUALITY_SAMPLE_W } from "./imageQuality";

function makeLum(value: number): Uint8Array {
  return new Uint8Array(QUALITY_SAMPLE_W * QUALITY_SAMPLE_H).fill(value);
}

function makeEdgeLum(): Uint8Array {
  // 3-pixel-wide alternating bands: 200,200,200,50,50,50,200,...
  // Adjacent pixels at band boundaries differ by 150 → high gradient variance.
  // Checkerboard would give zero gx/gy because diagonally-opposite pixels cancel.
  const lum = new Uint8Array(QUALITY_SAMPLE_W * QUALITY_SAMPLE_H);
  for (let y = 0; y < QUALITY_SAMPLE_H; y++) {
    for (let x = 0; x < QUALITY_SAMPLE_W; x++) {
      lum[y * QUALITY_SAMPLE_W + x] = Math.floor(x / 3) % 2 === 0 ? 200 : 50;
    }
  }
  return lum;
}

describe("analyzeQuality", () => {
  it("rejects a completely dark image", () => {
    const result = analyzeQuality(makeLum(0), QUALITY_SAMPLE_W, QUALITY_SAMPLE_H);
    expect(result).toMatchObject({ ok: false, issue: "too_dark" });
  });

  it("rejects a near-black image below the brightness threshold", () => {
    const result = analyzeQuality(makeLum(10), QUALITY_SAMPLE_W, QUALITY_SAMPLE_H);
    expect(result).toMatchObject({ ok: false, issue: "too_dark" });
  });

  it("rejects a uniform mid-grey image (bright but no texture = blurry/blank)", () => {
    const result = analyzeQuality(makeLum(128), QUALITY_SAMPLE_W, QUALITY_SAMPLE_H);
    expect(result).toMatchObject({ ok: false, issue: "too_blurry" });
  });

  it("rejects an overexposed image above the brightness threshold", () => {
    const result = analyzeQuality(makeLum(240), QUALITY_SAMPLE_W, QUALITY_SAMPLE_H);
    expect(result).toMatchObject({ ok: false, issue: "too_bright" });
  });

  it("rejects a fully white image as overexposed (not blurry)", () => {
    const result = analyzeQuality(makeLum(255), QUALITY_SAMPLE_W, QUALITY_SAMPLE_H);
    expect(result).toMatchObject({ ok: false, issue: "too_bright" });
  });

  it("accepts a high-contrast image with strong edges", () => {
    const result = analyzeQuality(makeEdgeLum(), QUALITY_SAMPLE_W, QUALITY_SAMPLE_H);
    expect(result).toMatchObject({
      ok: true,
      metrics: {
        brightnessScore: expect.any(Number),
        glareScore: expect.any(Number),
        sampleHeight: QUALITY_SAMPLE_H,
        sampleWidth: QUALITY_SAMPLE_W,
        sharpnessScore: 100,
      },
    });
  });

  it("returns scan-quality metrics on rejection", () => {
    const result = analyzeQuality(makeLum(10), QUALITY_SAMPLE_W, QUALITY_SAMPLE_H);

    expect(result).toMatchObject({
      ok: false,
      issue: "too_dark",
      metrics: {
        averageLuminance: 10,
        brightnessScore: expect.any(Number),
        darkPixelRatio: 1,
        sampleHeight: QUALITY_SAMPLE_H,
        sampleWidth: QUALITY_SAMPLE_W,
      },
    });
  });

  it("returns a human-readable message on rejection", () => {
    const dark = analyzeQuality(makeLum(5), QUALITY_SAMPLE_W, QUALITY_SAMPLE_H);
    expect(dark).toMatchObject({ ok: false, message: expect.stringContaining("dark") });

    const blurry = analyzeQuality(makeLum(100), QUALITY_SAMPLE_W, QUALITY_SAMPLE_H);
    expect(blurry).toMatchObject({ ok: false, message: expect.stringContaining("closer") });
  });
});
