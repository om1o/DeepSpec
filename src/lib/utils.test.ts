import { accountStorageKey } from "./accountScope";
import {
  cx,
  getScaledDimensions,
  readLatestCapturedFrame,
  readLatestScanState,
  saveLatestCapturedFrame,
  saveLatestScanState,
} from "./utils";

describe("cx", () => {
  it("keeps truthy class names and removes empty values", () => {
    expect(cx("base", false, null, undefined, "active")).toBe("base active");
  });
});

describe("getScaledDimensions", () => {
  it("scales a landscape image down to the max longest edge", () => {
    expect(getScaledDimensions(4000, 2000, 1024)).toEqual({ width: 1024, height: 512 });
  });

  it("scales a portrait image down to the max longest edge", () => {
    expect(getScaledDimensions(2000, 4000, 1024)).toEqual({ width: 512, height: 1024 });
  });

  it("does not upscale small images", () => {
    expect(getScaledDimensions(800, 600, 1024)).toEqual({ width: 800, height: 600 });
  });
});

describe("latest captured frame storage", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("saves and reads the last captured frame", () => {
    const frame = {
      imageBase64: "data:image/jpeg;base64,test",
      capturedAt: "2026-05-16T00:00:00.000Z",
    };

    saveLatestCapturedFrame(frame);

    expect(readLatestCapturedFrame()).toEqual(frame);
    expect(readLatestScanState()).toEqual({ frame });
  });

  it("ignores invalid saved frame data", () => {
    sessionStorage.setItem(accountStorageKey("deep-spec:latest-captured-frame"), JSON.stringify({ imageBase64: 123 }));

    expect(readLatestCapturedFrame()).toBeNull();
  });

  it("restores labeled photos, component cutouts, geometry and capture provenance", () => {
    const frame = { imageBase64: "data:image/jpeg;base64,dGVzdA==", capturedAt: "2026-11-05T00:00:00.000Z" };
    const state: import("../types").ScanAnalysisState = {
      frame, photos: [{ ...frame, id: "photo-1", label: "overview" }, { ...frame, id: "photo-2", label: "mounting" }],
      isolatedObjects: [{ name: "Hose", category: "engine", primary: false, isolatedImageBase64: frame.imageBase64, focusBox: { x: 0.2, y: 0.2, width: 0.2, height: 0.2, confidence: 0.5 } }],
      provenance: { captureMode: "upload", analysisSource: "ai_detection", savedAt: frame.capturedAt },
    };
    saveLatestScanState(state);
    expect(readLatestScanState()).toEqual(state);
  });

  it("saves and reads an analyzed scan state", () => {
    const scanState = {
      frame: {
        imageBase64: "data:image/jpeg;base64,test",
        capturedAt: "2026-05-16T00:00:00.000Z",
      },
      analyzedAt: "2026-05-16T00:00:05.000Z",
      result: {
        partName: "Alternator",
        confidence: "high" as const,
        scanCategory: "electrical" as const,
        candidateMatches: [],
        whatItDoes: "It charges the battery while the engine runs.",
        visibleObservations: ["Belt-driven housing is visible."],
        evidenceRegions: [],
        concerns: [],
        safetyTriage: "can_help" as const,
        isSafetyCritical: false,
        nextAction: "Take another photo if you need more detail.",
        needsBetterPhoto: false,
        evidence: ["The pulley and housing match an alternator."],
        sourceLinks: [],
      },
    };

    saveLatestScanState(scanState);

    expect(readLatestScanState()).toEqual(scanState);
  });
});
