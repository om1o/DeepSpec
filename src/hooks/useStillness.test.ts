import { isMotionSampleStill, STILLNESS_CONFIG } from "./useStillness";

function motionSample({
  acceleration = { x: 0.02, y: 0.02, z: 0.01 },
  accelerationIncludingGravity = null,
  rotationRate = { alpha: 0.2, beta: 0.2, gamma: 0.2 },
}: Partial<Pick<DeviceMotionEvent, "acceleration" | "accelerationIncludingGravity" | "rotationRate">> = {}) {
  return {
    acceleration,
    accelerationIncludingGravity,
    rotationRate,
  } as Pick<DeviceMotionEvent, "acceleration" | "accelerationIncludingGravity" | "rotationRate">;
}

describe("isMotionSampleStill", () => {
  it("accepts small acceleration and small rotation as still", () => {
    expect(isMotionSampleStill(motionSample())).toBe(true);
  });

  it("rejects samples above the acceleration threshold", () => {
    expect(
      isMotionSampleStill(
        motionSample({
          acceleration: { x: STILLNESS_CONFIG.accelerationThreshold + 0.2, y: 0, z: 0 },
        }),
      ),
    ).toBe(false);
  });

  it("rejects samples above the rotation threshold", () => {
    expect(
      isMotionSampleStill(
        motionSample({
          rotationRate: { alpha: STILLNESS_CONFIG.rotationThreshold + 1, beta: 0, gamma: 0 },
        }),
      ),
    ).toBe(false);
  });

  it("falls back to accelerationIncludingGravity when raw acceleration is missing", () => {
    expect(
      isMotionSampleStill(
        motionSample({
          acceleration: null,
          accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
        }),
      ),
    ).toBe(true);
  });
});
