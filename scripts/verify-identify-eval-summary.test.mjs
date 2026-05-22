import { describe, expect, it } from "vitest";
import { classifyIdentifyEvalSummary } from "./verify-identify-eval-summary.mjs";

describe("identify eval summary gate", () => {
  it("passes when all attempted samples pass and provider is available", () => {
    expect(
      classifyIdentifyEvalSummary({
        attemptedCount: 6,
        failureCount: 0,
        passCount: 6,
        providerFailureCount: 0,
        providerStatus: "available",
      }),
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
      classifyIdentifyEvalSummary({
        attemptedCount: 6,
        failureCount: 2,
        passCount: 4,
        providerFailureCount: 0,
        providerStatus: "available",
      }),
    ).toMatchObject({
      ok: false,
      kind: "model_quality",
      exitCode: 1,
    });
  });

  it("requires the configured minimum sample size for public launch gates", () => {
    expect(
      classifyIdentifyEvalSummary(
        {
          attemptedCount: 50,
          failureCount: 0,
          passCount: 50,
          providerFailureCount: 0,
          providerStatus: "available",
        },
        { minSampleSize: 300 },
      ),
    ).toMatchObject({
      ok: false,
      kind: "incomplete_eval",
      exitCode: 1,
    });

    expect(
      classifyIdentifyEvalSummary(
        {
          attemptedCount: 300,
          failureCount: 0,
          passCount: 300,
          providerFailureCount: 0,
          providerStatus: "available",
        },
        { minSampleSize: 300 },
      ),
    ).toMatchObject({
      ok: true,
      kind: "passed",
      exitCode: 0,
    });
  });
});
