import { describe, expect, it } from "vitest";
import {
  DATASET_FETCH_TIMEOUT_MS,
  RELEASE_SAMPLE_IMAGES,
  buildEvalResultRow,
  buildEvalViteServerOptions,
  buildReviewLookup,
  getEvalExitCode,
  isReviewableEvalFailure,
  scoreIdentificationResult,
} from "./eval-identify.mjs";

const result = {
  partName: "Rear bumper",
  confidence: "high",
  scanCategory: "body",
  candidateMatches: [
    {
      partName: "Tail light",
      confidence: "low",
      scanCategory: "body",
      reason: "A nearby rear body part that may appear in the same crop.",
    },
  ],
  whatItDoes: "It protects the rear of the vehicle.",
  visibleObservations: ["Painted rear bumper cover is visible."],
  evidenceRegions: [
    {
      label: "Rear bumper cover",
      observation: "Painted rear bumper cover is visible.",
      regionLabel: "Scanned area",
    },
  ],
  concerns: [],
  safetyTriage: "can_help",
  isSafetyCritical: false,
  nextAction: "Take a closer photo if you need damage detail.",
  needsBetterPhoto: false,
  evidence: ["The lower rear body panel shape matches a bumper."],
  sourceLinks: [],
};

describe("identify eval scoring", () => {
  it("uses a fixed 50-case release sample set split across damage and parts", () => {
    expect(RELEASE_SAMPLE_IMAGES).toHaveLength(50);
    expect(new Set(RELEASE_SAMPLE_IMAGES).size).toBe(50);
    expect(RELEASE_SAMPLE_IMAGES.filter((path) => path.startsWith("Car damages dataset/"))).toHaveLength(25);
    expect(RELEASE_SAMPLE_IMAGES.filter((path) => path.startsWith("Car parts dataset/"))).toHaveLength(25);
    expect(RELEASE_SAMPLE_IMAGES.every((path) => path.includes("/img/") && /\.(png|jpg)$/.test(path))).toBe(true);
  });

  it("accepts directional label aliases", () => {
    expect(scoreIdentificationResult(result, ["Back-bumper"])).toEqual({
      ok: true,
      matchedLabels: ["Back-bumper"],
      failureReasons: [],
    });
  });

  it("flags specific misses as wrong results", () => {
    expect(scoreIdentificationResult(result, ["Headlight"])).toMatchObject({
      ok: false,
      matchedLabels: [],
      failureReasons: ["wrong_result"],
    });
  });

  it("flags low-confidence generic answers as too vague", () => {
    expect(
      scoreIdentificationResult(
        {
          ...result,
          partName: "Vehicle component",
          confidence: "low",
          needsBetterPhoto: true,
        },
        ["Back-bumper"],
      ),
    ).toMatchObject({
      ok: false,
      failureReasons: expect.arrayContaining(["too_vague"]),
    });
  });

  it("builds lookup-compatible failure review rows", () => {
    const lookup = buildReviewLookup({
      analyzedAt: "2026-05-20T12:00:00.000Z",
      dataUrl: "data:image/jpeg;base64,aGVsbG8=",
      error: null,
      expectedLabels: ["Back-bumper", "Dent"],
      imagePath: "Car damages dataset/File1/img/Car damages 100.png",
      result,
      score: {
        ok: false,
        matchedLabels: ["Back-bumper"],
        failureReasons: ["too_vague"],
      },
    });

    expect(lookup).toMatchObject({
      rating: "down",
      correction: "Back-bumper",
      trainingLabel: "Back-bumper",
      trainingStatus: "user_corrected",
      scanCategory: "body",
      frame: {
        imageBase64: "data:image/jpeg;base64,aGVsbG8=",
      },
      eval: {
        datasetId: "DrBimmer/car-parts-and-damage-dataset",
        expectedLabels: ["Back-bumper", "Dent"],
      },
    });
  });

  it("uses body as the fallback category for exterior damage review rows", () => {
    const lookup = buildReviewLookup({
      analyzedAt: "2026-05-20T12:00:00.000Z",
      dataUrl: "data:image/jpeg;base64,aGVsbG8=",
      error: {
        code: "invalid_response",
        message: "Gemini returned JSON that Deep Spec could not read.",
      },
      expectedLabels: ["Front-bumper", "Front-wheel"],
      imagePath: "Car damages dataset/File1/img/Car damages 101.png",
      result: null,
      score: {
        ok: false,
        matchedLabels: [],
        failureReasons: ["pipeline_error"],
      },
    });

    expect(lookup.scanCategory).toBe("body");
  });

  it("scores ranked candidate labels as possible matches", () => {
    expect(scoreIdentificationResult(result, ["Tail light"])).toMatchObject({
      ok: true,
      matchedLabels: ["Tail light"],
      failureReasons: [],
    });
  });

  it("scores common visible damage wording as canonical damage labels", () => {
    const damageResult = {
      ...result,
      partName: "Front bumper cover",
      concerns: [
        "Plastic deformation and buckling near the corner.",
        "Scuffing, paint transfer, and chipped paint across the bumper.",
        "Missing headlight with exposed wiring.",
        "Panel misalignment and impact damage around the edge.",
        "Rust and peeling paint around the damaged edge.",
      ],
      evidence: [
        "The jagged edge and cracked plastic indicate a broken part.",
        "Surface abrasions are visible on the painted cover.",
      ],
      visibleObservations: ["Crushed bumper plastic and rusted exposed metal are visible."],
    };

    expect(
      scoreIdentificationResult(damageResult, [
        "Dent",
        "Scratch",
        "Paint chip",
        "Missing part",
        "Corrosion",
        "Flaking",
        "Broken part",
      ]),
    ).toMatchObject({
      ok: true,
      matchedLabels: [
        "Dent",
        "Scratch",
        "Paint chip",
        "Missing part",
        "Corrosion",
        "Flaking",
        "Broken part",
      ],
      failureReasons: [],
    });
  });

  it("keeps provider availability failures out of training review rows", () => {
    expect(isReviewableEvalFailure({ code: "rate_limited" })).toBe(false);
    expect(isReviewableEvalFailure({ code: "network" })).toBe(false);
    expect(isReviewableEvalFailure({ code: "invalid_response" })).toBe(true);
    expect(isReviewableEvalFailure(null)).toBe(true);
  });

  it("fails the release gate when provider availability or scoring blocks the eval", () => {
    expect(
      getEvalExitCode({
        attemptedCount: 6,
        failureCount: 0,
        passCount: 6,
        providerFailureCount: 0,
        providerStatus: "available",
        sampleSize: 6,
      }),
    ).toBe(0);

    expect(
      getEvalExitCode({
        attemptedCount: 1,
        failureCount: 0,
        passCount: 0,
        providerFailureCount: 1,
        providerStatus: "blocked",
        sampleSize: 6,
      }),
    ).toBe(1);

    expect(
      getEvalExitCode({
        attemptedCount: 6,
        failureCount: 1,
        passCount: 5,
        providerFailureCount: 0,
        providerStatus: "available",
        sampleSize: 6,
      }),
    ).toBe(1);
  });

  it("keeps provider error details in release summaries", () => {
    expect(
      buildEvalResultRow({
        elapsedMs: 150,
        error: {
          code: "provider_error",
          message: "API key not valid. Please pass a valid API key.",
        },
        expectedLabels: ["Hood"],
        imagePath: "Car damages dataset/File1/img/Car damages 2.jpg",
        providerAvailabilityFailure: true,
        responseStatus: 400,
        result: null,
        score: {
          ok: false,
          matchedLabels: [],
          failureReasons: ["wrong_result"],
        },
      }),
    ).toMatchObject({
      errorCode: "provider_error",
      errorMessage: "API key not valid. Please pass a valid API key.",
      failureReasons: ["provider_error"],
      status: 400,
    });
  });

  it("does not open a Vite HMR websocket during eval SSR loading", () => {
    expect(buildEvalViteServerOptions()).toMatchObject({
      server: {
        hmr: false,
        middlewareMode: true,
        ws: false,
      },
    });
  });

  it("allows slower Hugging Face dataset reads before timing out", () => {
    expect(DATASET_FETCH_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });
});
