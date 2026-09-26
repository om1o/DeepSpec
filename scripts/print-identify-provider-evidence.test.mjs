import { describe, expect, it } from "vitest";
import { buildIdentifyProviderEvidence, classifyIdentifyProviderReadiness } from "./print-identify-provider-evidence.mjs";

const PASSING_IDENTIFY_SUMMARY = {
  attemptedCount: 50,
  failureCount: 0,
  passCount: 50,
  providerFailureCount: 0,
  providerStatus: "available",
  sampleSize: 50,
  skippedCount: 0,
};

const BLOCKED_IDENTIFY_SUMMARY = {
  attemptedCount: 1,
  failureCount: 0,
  metrics: {
    failureModes: {
      network: 1,
    },
  },
  passCount: 0,
  providerFailureCount: 1,
  providerStatus: "blocked",
  results: [
    {
      failureReasons: ["network"],
      imagePath: "Car damages dataset/File1/img/Car damages 2.jpg",
      providerMs: 63797,
      status: 502,
      totalMs: 78668,
    },
  ],
  sampleSize: 50,
  skippedCount: 49,
  stoppedEarlyReason: "provider_availability",
};

describe("classifyIdentifyProviderReadiness", () => {
  it("blocks when no production identify provider route is configured", () => {
    const result = classifyIdentifyProviderReadiness({
      env: {},
      identifySummary: PASSING_IDENTIFY_SUMMARY,
    });

    expect(result.ok).toBe(false);
    expect(result.recommendation).toBe("configure_identify_provider");
    expect(result.blockers.join("\n")).toContain("No production cloud identify route");
  });

  it("blocks live identify when the release eval is provider-blocked", () => {
    const result = classifyIdentifyProviderReadiness({
      env: {
        GEMINI_API_KEY: "gemini_secret",
      },
      identifySummary: BLOCKED_IDENTIFY_SUMMARY,
    });

    expect(result.ok).toBe(false);
    expect(result.recommendation).toBe("provider_config_ready_release_blocked");
    expect(result.blockers.join("\n")).toContain("Provider unavailable");
    expect(result.release.summary.lastProviderFailure).toMatchObject({
      failureReasons: ["network"],
      status: 502,
    });
  });

  it("passes only when a production route and the release eval are both ready", () => {
    const result = classifyIdentifyProviderReadiness({
      env: {
        DEEPSPEC_ENABLE_GROQ_IDENTIFY_FALLBACK: "true",
        GEMINI_API_KEY: "gemini_secret",
        GROQ_API_KEY: "groq_secret",
      },
      identifySummary: PASSING_IDENTIFY_SUMMARY,
    });

    expect(result.ok).toBe(true);
    expect(result.recommendation).toBe("live_identify_ready");
    expect(result.checks.join("\n")).toContain("Release eval: Identify eval passed");
    expect(result.checks.join("\n")).toContain("Cloud fallback ready: Groq");
  });
});

describe("buildIdentifyProviderEvidence", () => {
  it("renders no-secret markdown with release failure details", () => {
    const { evidence, markdown } = buildIdentifyProviderEvidence({
      env: {
        DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK: "true",
        GEMINI_API_KEY: "gemini_secret",
        HF_TOKEN: "hf_secret",
        HF_IDENTIFY_ENDPOINT_URL: "https://openrouter.ai/api/v1/chat/completions",
      },
      generatedAt: "2026-06-19T00:00:00.000Z",
      identifySummary: BLOCKED_IDENTIFY_SUMMARY,
    });

    expect(evidence.liveIdentifyReady).toBe(false);
    expect(markdown).toContain("Live identify ready: no");
    expect(markdown).toContain("OpenRouter/HF adapter");
    expect(markdown).toContain("network: 1");
    expect(markdown).toContain("status 502");
    expect(markdown).not.toContain("gemini_secret");
    expect(markdown).not.toContain("hf_secret");
  });
});
