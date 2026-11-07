import { describe, expect, it, vi } from "vitest";
import { verifyIdentifyProviderAccess } from "./verify-identify-provider-access.mjs";

const ENV = {
  DEEPSPEC_ENABLE_GROQ_IDENTIFY_FALLBACK: "true",
  DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK: "true",
  GEMINI_API_KEY: "gemini_secret",
  GEMINI_MODEL: "gemini-2.5-flash",
  GROQ_API_KEY: "groq_secret",
  GROQ_IDENTIFY_MODEL: "qwen/qwen3.8-27b",
  HF_IDENTIFY_ENDPOINT_URL: "https://openrouter.ai/api/v1/chat/completions",
  HF_IDENTIFY_MODEL: "google/gemma-4-31b-it:free",
  HF_TOKEN: "openrouter_secret",
};

function response(body, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("verifyIdentifyProviderAccess", () => {
  it("checks metadata for the current default model without inference", async () => {
    const fetchImpl = vi.fn(() => response({
      name: "models/gemini-3.5-flash-lite",
      supportedGenerationMethods: ["generateContent"],
    }));
    const { evidence } = await verifyIdentifyProviderAccess({
      env: { GEMINI_API_KEY: "test-key" }, fetchImpl, minCloudRoutes: 1,
    });

    expect(evidence).toMatchObject({ accessibleRouteCount: 1, ok: true });
    expect(evidence.routes.find((route) => route.providerId === "gemini")).toMatchObject({
      model: "gemini-3.5-flash-lite", modelAvailable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("verifies three independent online routes without inference", async () => {
    const fetchImpl = vi.fn((url) => {
      const value = String(url);
      if (value.includes("generativelanguage")) return response({ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] });
      if (value.includes("api.groq.com")) return response({ data: [{ active: true, id: "qwen/qwen3.8-27b" }] });
      if (value.endsWith("/api/v1/key")) return response({ data: { is_free_tier: true } });
      return response({ data: { id: "google/gemma-4-31b-it:free" } });
    });

    const { evidence, markdown } = await verifyIdentifyProviderAccess({ env: ENV, fetchImpl, generatedAt: "2026-11-01T00:00:00Z" });

    expect(evidence).toMatchObject({ accessibleRouteCount: 3, minCloudRoutes: 3, ok: true });
    expect(evidence.routes.every((route) => route.accessible)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
    expect(markdown).not.toContain("gemini_secret");
    expect(markdown).not.toContain("groq_secret");
    expect(markdown).not.toContain("openrouter_secret");
  });

  it("fails closed without credentials and performs no requests", async () => {
    const fetchImpl = vi.fn();
    const { evidence } = await verifyIdentifyProviderAccess({ env: {}, fetchImpl });
    expect(evidence).toMatchObject({ accessibleRouteCount: 0, ok: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects lookalike adapter endpoints before sending a token", async () => {
    const fetchImpl = vi.fn();
    const { evidence } = await verifyIdentifyProviderAccess({
      env: {
        DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK: "true",
        HF_IDENTIFY_ENDPOINT_URL: "https://openrouter.ai.attacker.example/v1/chat/completions",
        HF_TOKEN: "secret",
      },
      fetchImpl,
      minCloudRoutes: 1,
    });
    expect(evidence.ok).toBe(false);
    expect(evidence.routes.find((route) => route.providerId === "huggingface")).toMatchObject({ status: "endpoint_not_allowed" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not count an accepted credential when its model is unavailable", async () => {
    const fetchImpl = vi.fn((url) => String(url).endsWith("/api/v1/key")
      ? response({ data: {} })
      : response({ error: "missing" }, 404));
    const { evidence } = await verifyIdentifyProviderAccess({
      env: {
        DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK: "true",
        HF_IDENTIFY_ENDPOINT_URL: "https://openrouter.ai/api/v1/chat/completions",
        HF_TOKEN: "secret",
      },
      fetchImpl,
      minCloudRoutes: 1,
    });
    expect(evidence.routes.find((route) => route.providerId === "openrouter")).toMatchObject({
      accessible: false,
      credentialAccepted: true,
      modelAvailable: false,
    });
  });
});
