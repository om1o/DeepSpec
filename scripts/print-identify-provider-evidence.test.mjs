import { describe, expect, it } from "vitest";
import { buildIdentifyProviderEvidence, classifyIdentifyProviderReadiness } from "./print-identify-provider-evidence.mjs";

const NOW = "2026-10-31T12:00:00.000Z";
const GEMINI_ROUTE = {
  provider: "gemini",
  model: "gemini-2.5-flash",
  endpointRoute: "https://generativelanguage.googleapis.com/v1beta/models/:model:generateContent",
  attemptedCount: 50,
  passCount: 50,
  failureCount: 0,
};
const GROQ_ROUTE = {
  provider: "groq",
  model: "meta-llama/llama-4-scout-17b-16e-instruct",
  endpointRoute: "https://api.groq.com/openai/v1/chat/completions",
  attemptedCount: 50,
  passCount: 50,
  failureCount: 0,
};
const HF_ROUTE = {
  provider: "huggingface",
  model: "Qwen/Qwen2.5-VL-7B-Instruct",
  endpointRoute: "https://router.huggingface.co/v1/chat/completions",
  attemptedCount: 50,
  passCount: 50,
  failureCount: 0,
};

function passingIdentifySummary(route = GEMINI_ROUTE, generatedAt = "2026-10-31T11:00:00.000Z") {
  return {
  attemptedCount: 50,
  failureCount: 0,
  generatedAt,
  modelConfig: { evaluatedRoutes: [route] },
  passCount: 50,
  providerFailureCount: 0,
  providerStatus: "available",
  sampleSize: 50,
  skippedCount: 0,
  };
}

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
      identifySummary: passingIdentifySummary(),
      options: { now: NOW },
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
      options: { now: NOW },
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
      identifySummary: passingIdentifySummary(GROQ_ROUTE),
      options: { now: NOW },
    });

    expect(result.ok).toBe(true);
    expect(result.recommendation).toBe("live_identify_ready");
    expect(result.checks.join("\n")).toContain("Release eval: Identify eval passed");
    expect(result.checks.join("\n")).toContain("Cloud fallback ready: Groq");
  });

  it("accepts enabled Hugging Face as the sole production cloud route", () => {
    const result = classifyIdentifyProviderReadiness({
      env: {
        DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK: "true",
        HF_TOKEN: "hf_secret",
      },
      identifySummary: passingIdentifySummary(HF_ROUTE),
      options: { now: NOW },
    });

    expect(result.ok).toBe(true);
    expect(result.recommendation).toBe("live_identify_ready");
    expect(result.checks.join("\n")).toContain("Identify provider route configured: Hugging Face.");
  });

  it("blocks a passing eval that is stale", () => {
    const result = classifyIdentifyProviderReadiness({
      env: { GEMINI_API_KEY: "gemini_secret" },
      identifySummary: passingIdentifySummary(GEMINI_ROUTE, "2026-10-29T11:00:00.000Z"),
      options: { now: NOW },
    });

    expect(result.ok).toBe(false);
    expect(result.recommendation).toBe("provider_config_ready_release_blocked");
    expect(result.blockers.join("\n")).toContain("stale");
  });

  it("blocks a passing eval for a different model or endpoint route", () => {
    const result = classifyIdentifyProviderReadiness({
      env: { GEMINI_API_KEY: "gemini_secret", GEMINI_MODEL: "gemini-current" },
      identifySummary: passingIdentifySummary(GEMINI_ROUTE),
      options: { now: NOW },
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join("\n")).toContain("does not match the active Gemini provider, model, and endpoint route");
  });

  it("blocks when one active-route pass is padded by 49 fallback-route passes", () => {
    const result = classifyIdentifyProviderReadiness({
      env: {
        DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK: "true",
        GEMINI_API_KEY: "gemini_secret",
        HF_TOKEN: "hf_secret",
      },
      identifySummary: {
        ...passingIdentifySummary(),
        modelConfig: {
          evaluatedRoutes: [
            { ...GEMINI_ROUTE, attemptedCount: 1, passCount: 1 },
            { ...HF_ROUTE, attemptedCount: 49, passCount: 49 },
          ],
        },
      },
      options: { now: NOW },
    });

    expect(result.ok).toBe(false);
    expect(result.recommendation).toBe("provider_config_ready_release_blocked");
    expect(result.blockers.join("\n")).toContain("1/1 passing samples");
    expect(result.blockers.join("\n")).toContain("requires at least 50 attempts");
  });

  it("rejects a configured production endpoint outside the HTTPS provider allowlist", () => {
    const result = classifyIdentifyProviderReadiness({
      env: {
        DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK: "true",
        HF_TOKEN: "hf_secret",
        HF_IDENTIFY_ENDPOINT_URL: "https://router.huggingface.co.attacker.example/v1/chat/completions",
      },
      identifySummary: passingIdentifySummary(HF_ROUTE),
      options: { now: NOW },
    });

    expect(result.ok).toBe(false);
    expect(result.recommendation).toBe("configure_identify_provider");
    expect(result.warnings.join("\n")).toContain("explicitly supported provider host");
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
    expect(markdown).toContain("Subdomains and lookalike suffixes are not accepted");
    expect(markdown).toContain("network: 1");
    expect(markdown).toContain("status 502");
    expect(markdown).not.toContain("gemini_secret");
    expect(markdown).not.toContain("hf_secret");
  });
});
