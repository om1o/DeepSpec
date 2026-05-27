import { describe, expect, it } from "vitest";
import { classifyIdentifyEvalSummary } from "./verify-identify-eval-summary.mjs";

const qualityMetrics = {
  accuracy: 1,
  failureRate: 0,
  invalidResponseCount: 0,
  invalidResponseRate: 0,
  latencyMs: {
    average: 100,
    max: 100,
    median: 100,
    min: 100,
    p95: 100,
  },
  ocrUsageCount: 0,
  ocrUsageRate: 0,
  providerFailureRate: 0,
  retryCount: 0,
  retryRate: 0,
  safetyEscalationCount: 0,
  safetyFalseNegativeCount: 0,
  safetyFalseNegativeRate: 0,
  safetyFalsePositiveCount: 0,
  safetyFalsePositiveRate: 0,
};

function makePassingSummary(overrides = {}) {
  return {
    attemptedCount: 6,
    failureCount: 0,
    passCount: 6,
    providerFailureCount: 0,
    providerStatus: "available",
    qualityMetrics,
    ...overrides,
  };
}

describe("identify eval summary gate", () => {
  it("passes when all attempted samples pass and provider is available", () => {
    expect(
      classifyIdentifyEvalSummary(makePassingSummary()),
    ).toMatchObject({
      ok: true,
      kind: "passed",
      exitCode: 0,
    });
  });

  it("fails as provider unavailable before judging model quality", () => {
    expect(
      classifyIdentifyEvalSummary({
        attemptedCount: 1,
        failureCount: 0,
        passCount: 0,
        providerFailureCount: 1,
        providerStatus: "blocked",
        stoppedEarlyReason: "provider_availability",
      }),
    ).toMatchObject({
      ok: false,
      kind: "provider_unavailable",
      exitCode: 2,
    });
  });

  it("fails model quality separately from provider health", () => {
    expect(
      classifyIdentifyEvalSummary(makePassingSummary({
        attemptedCount: 6,
        failureCount: 2,
        passCount: 4,
      })),
    ).toMatchObject({
      ok: false,
      kind: "model_quality",
      exitCode: 1,
    });
  });

  it("requires the configured minimum sample size for public launch gates", () => {
    expect(
      classifyIdentifyEvalSummary(
        makePassingSummary({
          attemptedCount: 50,
          failureCount: 0,
          passCount: 50,
        }),
        { minSampleSize: 300 },
      ),
    ).toMatchObject({
      ok: false,
      kind: "incomplete_eval",
      exitCode: 1,
    });

    expect(
      classifyIdentifyEvalSummary(
        makePassingSummary({
          attemptedCount: 300,
          failureCount: 0,
          passCount: 300,
        }),
        { minSampleSize: 300 },
      ),
    ).toMatchObject({
      ok: true,
      kind: "passed",
      exitCode: 0,
    });
  });

  it("fails all-passing summaries that are missing launch quality metrics", () => {
    expect(
      classifyIdentifyEvalSummary({
        attemptedCount: 300,
        failureCount: 0,
        passCount: 300,
        providerFailureCount: 0,
        providerStatus: "available",
      }),
    ).toMatchObject({
      ok: false,
      kind: "missing_quality_metrics",
      exitCode: 1,
    });

    expect(
      classifyIdentifyEvalSummary(makePassingSummary({
        attemptedCount: 300,
        passCount: 300,
        qualityMetrics: {
          ...qualityMetrics,
          safetyFalseNegativeRate: undefined,
        },
      })),
    ).toMatchObject({
      ok: false,
      kind: "missing_quality_metrics",
      message: expect.stringContaining("qualityMetrics.safetyFalseNegativeRate"),
    });
  });
});
