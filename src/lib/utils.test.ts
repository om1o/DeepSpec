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
    sessionStorage.setItem("deep-spec:latest-captured-frame", JSON.stringify({ imageBase64: 123 }));

    expect(readLatestCapturedFrame()).toBeNull();
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
      modelRun: {
        id: "run-identify-1",
        createdAt: "2026-05-16T00:00:05.000Z",
        kind: "identify" as const,
        latencyMs: 1250,
        model: "gemini-2.5-flash",
        ocrText: "DENSO 104210",
        ocrUsed: true,
        promptVersion: "identify-v1",
        provider: "gemini" as const,
      },
    };

    saveLatestScanState(scanState);

    expect(readLatestScanState()).toEqual(scanState);
  });
});
