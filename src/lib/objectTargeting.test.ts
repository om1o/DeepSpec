import { describe, expect, it } from "vitest";
import { detectObjectTargetFromImageData } from "./objectTargeting";

describe("object targeting", () => {
  it("finds the largest high-detail object near the center", () => {
    const image = makeImage(120, 90, 180);
    paintCheckerObject(image, 42, 24, 38, 32);

    const target = detectObjectTargetFromImageData(image);

    expect(target).not.toBeNull();
    expect(target!.x).toBeGreaterThan(0.25);
    expect(target!.x + target!.width).toBeLessThan(0.8);
    expect(target!.y).toBeGreaterThan(0.15);
    expect(target!.confidence).toBeGreaterThan(0.22);
  });

  it("does not invent a target on a flat background", () => {
    expect(detectObjectTargetFromImageData(makeImage(120, 90, 180))).toBeNull();
  });
});

function makeImage(width: number, height: number, value: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }

  return { data, height, width } as ImageData;
}

function paintCheckerObject(image: ImageData, startX: number, startY: number, width: number, height: number) {
  for (let y = startY; y < startY + height; y += 1) {
    for (let x = startX; x < startX + width; x += 1) {
      const value = (x + y) % 8 < 4 ? 40 : 230;
      const index = (y * image.width + x) * 4;
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
    }
  }
}
