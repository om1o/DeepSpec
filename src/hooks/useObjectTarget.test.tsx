import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Webcam from "react-webcam";
import { useObjectTarget, type CameraObjectTarget } from "./useObjectTarget";
import type { ObjectTargetBox } from "../lib/objectTargeting";

const detectionState = vi.hoisted(() => ({
  current: null as ObjectTargetBox | null,
}));

vi.mock("../lib/objectTargeting", () => ({
  detectObjectTargetFromImageData: vi.fn(() => detectionState.current),
}));

describe("useObjectTarget scanner-box hold", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    detectionState.current = null;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4), height: 1, width: 1 })),
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not build hold progress for a detected object outside the reticle", async () => {
    detectionState.current = outsideReticleTarget();

    render(<TargetProbe video={makeVideo()} />);

    await advanceSamples(6);

    expect(readTarget()).toMatchObject({
      holdProgress: 0,
      isInScannerBox: false,
      isLocked: false,
    });
  });

  it("locks only after the same target stays inside the reticle for the full hold", async () => {
    detectionState.current = insideReticleTarget();

    render(<TargetProbe video={makeVideo()} />);

    await advanceSamples(1);
    expect(readTarget()).toMatchObject({
      isInScannerBox: true,
      isLocked: false,
    });

    await advanceSamples(4);

    expect(readTarget()).toMatchObject({
      isInScannerBox: true,
      isLocked: true,
    });
  });

  it("resets the hold when the same object leaves the reticle before locking", async () => {
    detectionState.current = insideReticleTarget();

    render(<TargetProbe video={makeVideo()} />);

    await advanceSamples(2);
    expect(readTarget().holdProgress).toBeGreaterThan(0);
    expect(readTarget().isLocked).toBe(false);

    detectionState.current = outsideReticleTarget();
    await advanceSamples(1);
    expect(readTarget()).toMatchObject({
      holdProgress: 0,
      isInScannerBox: false,
      isLocked: false,
    });

    detectionState.current = insideReticleTarget();
    await advanceSamples(1);
    expect(readTarget()).toMatchObject({
      isInScannerBox: true,
      isLocked: false,
    });
    expect(readTarget().holdProgress).toBe(0);

    await advanceSamples(4);
    expect(readTarget()).toMatchObject({
      isInScannerBox: true,
      isLocked: true,
    });
  });
});

function TargetProbe({ video }: { video: HTMLVideoElement }) {
  const target = useObjectTarget(
    { current: { video } as Webcam & { video: HTMLVideoElement } },
    { enabled: true, holdDurationMs: 500, holdEnabled: true },
  );

  return <output data-testid="target">{target ? JSON.stringify(target) : "null"}</output>;
}

async function advanceSamples(count: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(180 * count);
  });
}

function readTarget() {
  const text = screen.getByTestId("target").textContent;
  expect(text).toBeTruthy();
  expect(text).not.toBe("null");
  return JSON.parse(text!) as CameraObjectTarget;
}

function makeVideo() {
  const video = document.createElement("video");
  Object.defineProperty(video, "readyState", { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA });
  Object.defineProperty(video, "videoWidth", { configurable: true, value: 1000 });
  Object.defineProperty(video, "videoHeight", { configurable: true, value: 800 });
  video.getBoundingClientRect = () => ({
    bottom: 800,
    height: 800,
    left: 0,
    right: 1000,
    top: 0,
    width: 1000,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return video;
}

function insideReticleTarget(): ObjectTargetBox {
  return {
    confidence: 0.84,
    height: 0.2,
    width: 0.12,
    x: 0.43,
    y: 0.31,
  };
}

function outsideReticleTarget(): ObjectTargetBox {
  return {
    confidence: 0.84,
    height: 0.18,
    width: 0.12,
    x: 0.06,
    y: 0.32,
  };
}
