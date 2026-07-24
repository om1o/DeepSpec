import { describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DATASET_FETCH_TIMEOUT_MS,
  PUBLIC_SAMPLE_SIZE,
  RELEASE_SAMPLE_IMAGES,
  buildPublicSampleImages,
  createIdentifyResponseWithRetry,
  buildEvalViteServerOptions,
  buildReviewLookup,
  getEvalExitCode,
  isReviewableEvalFailure,
  isSafetyFalsePositive,
  loadEvalSample,
  parseArgs,
  scoreIdentificationResult,
  summarizeEvalMetrics,
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

  it("builds a deterministic 300-case public sample set from the dataset index shape", () => {
    const records = Array.from({ length: PUBLIC_SAMPLE_SIZE + 5 }, (_, index) => {
      const label = index % 2 === 0 ? "Back-bumper" : "Scratch";
      const group = label === "Scratch" ? "Car parts dataset" : "Car damages dataset";

      return {
        id: `record-${String(index).padStart(3, "0")}`,
        primaryLabel: label,
        rawGroupName: group,
        source: {
          image: `File1/img/Car damages ${index}.png`,
        },
      };
    });

    const samples = buildPublicSampleImages(records, PUBLIC_SAMPLE_SIZE);

    expect(samples).toHaveLength(300);
    expect(new Set(samples).size).toBe(300);
    expect(samples[0]).toBe("Car damages dataset/File1/img/Car damages 0.png");
    expect(samples[1]).toBe("Car parts dataset/File1/img/Car damages 1.png");
  });

  it("rejects a public sample set when the local index has too few usable images", () => {
    expect(() =>
      buildPublicSampleImages(
        [
          {
            id: "one",
            primaryLabel: "Scratch",
            rawGroupName: "Car parts dataset",
            source: { image: "File1/img/Car damages 1.png" },
          },
        ],
        2,
      ),
    ).toThrow(/needs 2 usable indexed images/);
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

  it("scores mechanic-grade candidate parts and damage observations without accepting negated damage", () => {
    expect(
      scoreIdentificationResult(
        {
          ...result,
          partName: "Front bumper",
          primaryPart: {
            partName: "Front bumper",
            confidence: "high",
            scanCategory: "body",
            evidence: ["The bumper cover is detached and hanging near the mounting point."],
          },
          candidateParts: [
            {
              partName: "Front bumper cover",
              confidence: "medium",
              scanCategory: "body",
              evidence: ["Returned as an alternate visible candidate."],
            },
          ],
          visibleObservations: ["The front fender has damage near the wheel opening."],
          requiredNextEvidence: ["Second angle showing connectors or mounting tabs."],
        },
        ["Broken part", "Missing part"],
      ),
    ).toMatchObject({
      ok: true,
      matchedLabels: ["Broken part", "Missing part"],
      failureReasons: [],
    });

    expect(
      scoreIdentificationResult(
        {
          ...result,
          partName: "Front bumper",
          visibleObservations: ["Bumper appears intact with no visible damage."],
          evidence: ["Local dataset match: Front-bumper (damage, 693 labeled samples)."],
        },
        ["Broken part"],
      ),
    ).toMatchObject({
      ok: false,
      matchedLabels: [],
      failureReasons: ["wrong_result"],
    });
  });

  it("keeps provider availability failures out of training review rows", () => {
    expect(isReviewableEvalFailure({ code: "rate_limited" })).toBe(false);
    expect(isReviewableEvalFailure({ code: "network" })).toBe(false);
    expect(isReviewableEvalFailure({ code: "not_configured" })).toBe(false);
    expect(isReviewableEvalFailure({ code: "invalid_response" })).toBe(true);
    expect(isReviewableEvalFailure(null)).toBe(true);
  });

  it("parses provider mode for Hugging Face health checks", () => {
    expect(parseArgs(["--provider", "hf"])).toMatchObject({
      provider: "hf",
    });
    expect(() => parseArgs(["--provider", "bad"])).toThrow(/provider must be auto, gemini, or hf/);
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
    ).toBe(2);

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

  it("can skip long rate-limit retries for quick live smoke checks", async () => {
    const identify = {
      createIdentifyResponse: vi.fn(async () => ({
        status: 429,
        body: {
          error: {
            code: "rate_limited",
            message: "Too many AI lookups right now.",
          },
        },
      })),
    };

    const response = await createIdentifyResponseWithRetry(identify, "data:image/jpeg;base64,aGVsbG8=", {}, 0);

    expect(response.status).toBe(429);
    expect(identify.createIdentifyResponse).toHaveBeenCalledTimes(1);
  });

  it("marks safety false positives only when the expected label is not safety-critical", () => {
    expect(isSafetyFalsePositive({ ...result, isSafetyCritical: true, safetyTriage: "needs_professional" }, ["Back-bumper"])).toBe(true);
    expect(isSafetyFalsePositive({ ...result, isSafetyCritical: true, safetyTriage: "needs_professional" }, ["Brake caliper"])).toBe(false);
    expect(
      isSafetyFalsePositive(
        {
          ...result,
          isSafetyCritical: true,
          safetyTriage: "needs_professional",
          visibleObservations: ["Rear bumper is damaged and detached from the mount."],
        },
        ["Broken part"],
      ),
    ).toBe(false);
    expect(scoreIdentificationResult({ ...result, isSafetyCritical: true, safetyTriage: "needs_professional" }, ["Back-bumper"])).toMatchObject({
      ok: false,
      failureReasons: ["safety_false_positive"],
    });
  });

  it("summarizes release eval latency and failure rates", () => {
    expect(
      summarizeEvalMetrics(
        [
          {
            status: 200,
            expectedLabels: ["alternator"],
            failureReasons: [],
            providerMs: 100,
            totalMs: 140,
            invalidResponse: false,
            safetyFalsePositive: false,
          },
          {
            status: 502,
            expectedLabels: ["alternator"],
            failureReasons: ["invalid_response"],
            providerMs: 300,
            totalMs: 350,
            invalidResponse: true,
            safetyFalsePositive: true,
          },
          {
            status: 500,
            expectedLabels: ["brake caliper"],
            failureReasons: ["not_configured"],
            providerMs: 20,
            totalMs: 25,
            invalidResponse: false,
            safetyFalsePositive: false,
          },
        ],
        4,
      ),
    ).toMatchObject({
      requestedSampleCount: 4,
      attemptedCount: 3,
      attemptedRate: 0.75,
      passRate: 0.3333,
      providerAvailabilityFailureRate: 0.3333,
      invalidResponseCount: 1,
      invalidResponseRate: 0.3333,
      safetyFalsePositiveCount: 1,
      safetyFalsePositiveRate: 0.3333,
      failureModes: {
        invalid_response: 1,
        not_configured: 1,
      },
      labelBuckets: {
        alternator: {
          attemptedCount: 2,
          failureCount: 1,
          passCount: 1,
          passRate: 0.5,
        },
        "brake caliper": {
          attemptedCount: 1,
          failureCount: 1,
          passCount: 0,
          passRate: 0,
        },
      },
      latencyMs: {
        provider: {
          average: 140,
          p50: 100,
          p95: 300,
          max: 300,
        },
      },
    });
  });

  it("loads release samples from a local dataset root before using Hugging Face", async () => {
    const datasetRoot = resolve(process.cwd(), "tmp-eval-dataset");
    const imagePath = "Car parts dataset/File1/img/Car damages 101.png";
    const annotationPath = "Car parts dataset/File1/ann/Car damages 101.png.json";
    mkdirSync(resolve(datasetRoot, "Car parts dataset/File1/img"), { recursive: true });
    mkdirSync(resolve(datasetRoot, "Car parts dataset/File1/ann"), { recursive: true });
    writeFileSync(
      resolve(datasetRoot, annotationPath),
      JSON.stringify({
        objects: [
          {
            classTitle: "Alternator",
            points: { exterior: [[0, 0], [10, 0], [10, 10], [0, 10]] },
          },
        ],
      }),
    );
    writeFileSync(resolve(datasetRoot, imagePath), Buffer.from("fake-png"));

    try {
      const sample = await loadEvalSample(imagePath, datasetRoot);
      expect(sample.datasetSource).toBe("local");
      expect(sample.annotation.objects[0].classTitle).toBe("Alternator");
      expect(sample.image.contentType).toBe("image/png");
    } finally {
      rmSync(datasetRoot, { force: true, recursive: true });
    }
  });
});
