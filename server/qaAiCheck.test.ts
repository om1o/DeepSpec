import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../api/qa-ai-check.js";

const mocks = vi.hoisted(() => ({ identify: vi.fn(), chat: vi.fn(), expiresAt: "2026-11-05T04:00:00.000Z", tokenHash: null as string | null }));
const testToken = "a".repeat(64);
const imageBytes = Buffer.from("fixture-image");
const imageBase64 = `data:image/jpeg;base64,${imageBytes.toString("base64")}`;

vi.mock("./identify.shared.js", () => ({ createIdentifyResponse: mocks.identify }));
vi.mock("./chat.shared.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./chat.shared.js")>(),
  createChatResponse: mocks.chat,
}));
vi.mock("./qaAiCheck.config.js", async () => {
  const { createHash } = await import("node:crypto");
  return {
    get QA_AI_CHECK_EXPIRES_AT() { return mocks.expiresAt; },
    QA_AI_CHECK_BRANCH: "codex/pilot-assembled-20261103",
    get QA_AI_CHECK_TOKEN_SHA256() { return mocks.tokenHash ?? createHash("sha256").update("a".repeat(64)).digest("hex"); },
    QA_AI_CHECK_FIXTURES: [{
      id: "commons-engine-bay",
      bytes: 13,
      sha256: createHash("sha256").update("fixture-image").digest("hex"),
      question: "What visible evidence supports this identification, and what cannot this photo establish?",
    }],
  };
});

function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() };
}

function request(body: unknown = { action: "identify", fixtureId: "commons-engine-bay", imageBase64 }) {
  return { method: "POST", headers: { authorization: `Bearer ${testToken}`, "content-type": "application/json" }, body };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.expiresAt = "2026-11-05T04:00:00.000Z";
  mocks.tokenHash = null;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T02:00:00.000Z"));
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("VERCEL_GIT_COMMIT_REF", "codex/pilot-assembled-20261103");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "test-deployment-sha");
  vi.stubEnv("GEMINI_CHAT_MODEL", "");
  vi.stubEnv("GEMINI_TEXT_MODEL", "");
  vi.stubEnv("GEMINI_CHAT_FALLBACK_MODELS", "");
  vi.stubEnv("GEMINI_FALLBACK_MODELS", "");
  mocks.identify.mockResolvedValue({ status: 200, body: { result: { partName: "Engine" }, modelRun: { provider: "gemini", model: "gemini-3.5-flash-lite" } } });
  mocks.chat.mockResolvedValue({ status: 200, body: { message: "The photo cannot establish operating condition." } });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("temporary private Preview AI check", () => {
  it.each(["GET", "OPTIONS", "PUT"])("rejects %s", async (method) => {
    const res = response();
    await handler({ ...request(), method }, res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(mocks.identify).not.toHaveBeenCalled();
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it.each(["production", "development", ""])("rejects environment %s", async (environment) => {
    vi.stubEnv("VERCEL_ENV", environment);
    const res = response();
    await handler(request(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(mocks.identify).not.toHaveBeenCalled();
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it("fails closed for malformed expiry or token digest configuration", async () => {
    const res = response();
    mocks.expiresAt = "invalid";
    await handler(request(), res);
    expect(res.status).toHaveBeenLastCalledWith(404);
    mocks.expiresAt = "2026-11-05T04:00:00.000Z";
    mocks.tokenHash = "invalid";
    await handler(request(), res);
    expect(res.status).toHaveBeenLastCalledWith(404);
    expect(mocks.identify).not.toHaveBeenCalled();
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it("rejects another branch and the exact expiry boundary", async () => {
    const res = response();
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "main");
    await handler(request(), res);
    expect(res.status).toHaveBeenLastCalledWith(404);
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "codex/pilot-assembled-20261103");
    vi.setSystemTime(new Date("2026-11-05T04:00:00.000Z"));
    await handler(request(), res);
    expect(res.status).toHaveBeenLastCalledWith(404);
    expect(mocks.identify).not.toHaveBeenCalled();
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "Bearer wrong", `Bearer ${"b".repeat(64)}`, [`Bearer ${testToken}`]])("rejects absent or wrong authorization %#", async (authorization) => {
    const res = response();
    await handler({ ...request(), headers: { authorization, "content-type": "application/json" } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mocks.identify).not.toHaveBeenCalled();
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it.each([
    null,
    "not JSON",
    { action: "identify", fixtureId: "arbitrary", imageBase64 },
    { action: "identify", fixtureId: "commons-engine-bay", imageBase64, userMessage: "Injected prompt" },
    { action: "chat", fixtureId: "commons-engine-bay", imageBase64, model: "other" },
    { action: "chat", fixtureId: "commons-engine-bay", imageBase64, sourceUrls: ["https://example.com"] },
    { action: "other", fixtureId: "commons-engine-bay", imageBase64 },
    { action: "identify", fixtureId: "commons-engine-bay", imageBase64: imageBase64.replace("jpeg", "png") },
    { action: "identify", fixtureId: "commons-engine-bay", imageBase64: `data:image/jpeg;base64,${Buffer.from("tampered-data").toString("base64")}` },
    { action: "identify", fixtureId: "commons-engine-bay", imageBase64: "x".repeat(500_001) },
  ])("rejects invalid or tampered payload %# before provider work", async (body) => {
    const res = response();
    await handler(request(body), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mocks.identify).not.toHaveBeenCalled();
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it("rejects non-JSON content and an excessive declared body size", async () => {
    for (const headers of [{ "content-type": "text/plain" }, { "content-type": "application/json", "content-length": "500001" }]) {
      const res = response();
      await handler({ ...request(), headers: { ...request().headers, ...headers } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(mocks.identify).not.toHaveBeenCalled();
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it("passes the exact allowlisted photo and unchanged server environment to identify", async () => {
    const res = response();
    await handler(request(), res);
    expect(mocks.identify).toHaveBeenCalledExactlyOnceWith({ imageBase64 }, process.env);
    expect(mocks.chat).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ modelRun: { provider: "gemini", model: "gemini-3.5-flash-lite" }, diagnostic: expect.objectContaining({ deploymentCommit: "test-deployment-sha" }) }));
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it("submits only the fixed follow-up and reports the sole configured chat model", async () => {
    const res = response();
    await handler(request({ action: "chat", fixtureId: "commons-engine-bay", imageBase64 }), res);
    expect(mocks.chat).toHaveBeenCalledExactlyOnceWith({ imageBase64, userMessage: "What visible evidence supports this identification, and what cannot this photo establish?", research: false }, process.env);
    expect(mocks.identify).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "The photo cannot establish operating condition.", modelRun: { provider: "gemini", model: "gemini-3.5-flash-lite" } }));
  });

  it("refuses ambiguous chat model provenance instead of overriding server settings", async () => {
    vi.stubEnv("GEMINI_CHAT_FALLBACK_MODELS", "gemini-2.5-flash");
    const res = response();
    await handler(request({ action: "chat", fixtureId: "commons-engine-bay", imageBase64 }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mocks.chat).not.toHaveBeenCalled();
    expect(process.env.GEMINI_CHAT_FALLBACK_MODELS).toBe("gemini-2.5-flash");
  });

  it("does not return provider error text or thrown exceptions", async () => {
    const res = response();
    mocks.identify.mockResolvedValueOnce({ status: 403, body: { error: { code: "provider_error", message: "secret-provider-detail" } } });
    await handler(request(), res);
    expect(res.status).toHaveBeenLastCalledWith(403);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain("secret-provider-detail");
    mocks.identify.mockRejectedValueOnce(new Error("secret-exception"));
    await handler(request(), res);
    expect(res.status).toHaveBeenLastCalledWith(502);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain("secret-exception");
  });

  it("redacts a server key or Google key pattern echoed in a successful answer", async () => {
    vi.stubEnv("GEMINI_API_KEY", "private-server-test-key");
    mocks.chat.mockResolvedValueOnce({ status: 200, body: { message: "private-server-test-key AIzaABCDEFGHIJKLMNOPQRSTUVWXYZ123456789" } });
    const res = response();
    await handler(request({ action: "chat", fixtureId: "commons-engine-bay", imageBase64 }), res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "[REDACTED] [REDACTED]", diagnostic: expect.objectContaining({ keyPresent: true }) }));
    mocks.identify.mockResolvedValueOnce({ status: 200, body: { result: { evidence: ["private-server-test-key"] }, modelRun: { provider: "gemini", model: "gemini-3.5-flash-lite" } } });
    await handler(request(), res);
    expect(res.json).toHaveBeenLastCalledWith(expect.objectContaining({ result: { evidence: ["[REDACTED]"] } }));
  });

  it("keeps the real fixed fixture manifest and non-test credential digest", async () => {
    const config = await vi.importActual<typeof import("./qaAiCheck.config.js")>("./qaAiCheck.config.js");
    expect(config.QA_AI_CHECK_TOKEN_SHA256).toMatch(/^[a-f0-9]{64}$/);
    expect(config.QA_AI_CHECK_TOKEN_SHA256).not.toBe(createHash("sha256").update(testToken).digest("hex"));
    expect(config.QA_AI_CHECK_FIXTURES.map(({ id, bytes, sha256 }) => ({ id, bytes, sha256 }))).toEqual([
      { id: "commons-engine-bay", bytes: 359688, sha256: "1dc22ccfa8700c0a0d1af7c8ef3b81e9655a0cca7356c334d3f99fad46d05294" },
      { id: "commons-disc-brake", bytes: 259037, sha256: "7655f44117bbd48384ebc347e4d43237d181ff2c88908139a2fa7565f9e91026" },
    ]);
  });
});
