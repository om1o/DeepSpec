import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../api/identify";
import { enforceRateLimit } from "./rateLimit.shared";
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), identify: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("./identify.shared", async (original) => ({ ...await original<typeof import("./identify.shared")>(), createIdentifyResponse: mocks.identify }));
vi.mock("./rateLimit.shared", () => ({ enforceRateLimit: vi.fn(async () => ({ ok: true })) }));
vi.mock("./requireSession.shared", () => ({ requireSession: vi.fn(async () => ({ ok: true })) }));
const body = { imageBase64: "data:image/jpeg;base64,aGVsbG8=" };
function response() {
  const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}
describe("identify HTTP credit gate", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");
    vi.stubEnv("DEEPSPEC_ENFORCE_SCAN_CREDITS", "true");
    mocks.identify.mockResolvedValue({ status: 200, body: { result: {} } });
  });
  afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
  function client(data: unknown, qa = false) {
    const rpc = vi.fn(async () => ({ data, error: null }));
    mocks.createClient.mockReturnValue({ auth: { getUser: vi.fn(async () => ({ data: { user: { id: "verified-user", email_confirmed_at: "2026-10-07", app_metadata: qa ? { deepspec_scan_qa: true } : {} } }, error: null })) }, rpc });
    return rpc;
  }
  it("never invokes identification when the free allowance is exhausted", async () => {
    client({ ok: false });
    const res = response();
    await handler({ method: "POST", body, headers: { authorization: "Bearer token" } }, res);
    expect(res.status).toHaveBeenCalledWith(402);
    expect(mocks.identify).not.toHaveBeenCalled();
  });
  it("validates malformed images before consuming a free scan", async () => {
    const rpc = client({ ok: true, reservation_id: null });
    const res = response();
    await handler({ method: "POST", body: { imageBase64: "https://example.com/image.jpg" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.identify).not.toHaveBeenCalled();
  });
  it("does not spend a free credit when no provider is configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK", "false");
    vi.stubEnv("DEEPSPEC_ENABLE_GROQ_IDENTIFY_FALLBACK", "false");
    vi.stubEnv("DEEPSPEC_ENABLE_OLLAMA_IDENTIFY_FALLBACK", "false");
    const rpc = client({ ok: true, reservation_id: null });
    const res = response();
    await handler({ method: "POST", body, headers: { authorization: "Bearer token" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.identify).not.toHaveBeenCalled();
  });
  it("preserves the forced Hugging Face path without requiring the fallback flag", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("DEEPSPEC_FORCE_HF_IDENTIFY", "true");
    vi.stubEnv("HF_TOKEN", "test-hf-token");
    vi.stubEnv("DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK", "false");
    client({ ok: true, reservation_id: null });
    await handler({ method: "POST", body, headers: { authorization: "Bearer token" } }, response());
    expect(mocks.identify).toHaveBeenCalledOnce();
  });
  it.each([200, 502])("finalizes paid holds after a provider response with status %i", async (status) => {
    const rpc = client({ ok: true, reservation_id: "paid-hold" });
    mocks.identify.mockResolvedValue({ status, body: {} });
    await handler({ method: "POST", body, headers: { authorization: "Bearer token" } }, response());
    expect(rpc).toHaveBeenLastCalledWith("finalize_scan_credit", { p_user_id: "verified-user", p_reservation_id: "paid-hold", p_succeeded: status === 200 });
  });
  function configureQa() {
    vi.stubEnv("DEEPSPEC_ENFORCE_SCAN_CREDITS", "false");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("DEEPSPEC_QA_SCAN_USER_ID", "verified-user");
    vi.stubEnv("DEEPSPEC_QA_SCAN_EXPIRES_AT", new Date(Date.now() + 3_600_000).toISOString());
  }
  it("runs two full eight-image suites for the dedicated QA identity without spending credits", async () => {
    configureQa();
    const rpc = client({ ok: false }, true);
    for (let attempt = 0; attempt < 16; attempt += 1) {
      mocks.identify.mockResolvedValueOnce({ status: attempt === 3 ? 502 : 200, body: {} });
      const res = response();
      await handler({ method: "POST", body, headers: { authorization: "Bearer token" } }, res);
      expect(res.status).toHaveBeenCalledWith(attempt === 3 ? 502 : 200);
    }
    expect(mocks.identify).toHaveBeenCalledTimes(16);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("still blocks a QA identity at the rate limiter before invoking its provider", async () => {
    configureQa();
    client({ ok: false }, true);
    vi.mocked(enforceRateLimit).mockResolvedValueOnce({ ok: false, status: 429, retryAfterSeconds: 60, body: { error: { code: "rate_limit_exceeded", message: "Wait" } } });
    const res = response();
    await handler({ method: "POST", body, headers: { authorization: "Bearer token" } }, res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(mocks.identify).not.toHaveBeenCalled();
  });
  it("blocks an exhausted QA account in production even with every QA flag set", async () => {
    configureQa();
    vi.stubEnv("VERCEL_ENV", "production");
    client({ ok: false }, true);
    const res = response();
    await handler({ method: "POST", body, headers: { authorization: "Bearer token", "x-deepspec-qa": "true" } }, res);
    expect(res.status).toHaveBeenCalledWith(402);
    expect(mocks.identify).not.toHaveBeenCalled();
  });
  it("never skips authentication just because the development credit switch is false", async () => {
    vi.stubEnv("DEEPSPEC_ENFORCE_SCAN_CREDITS", "false");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "development");
    const res = response();
    await handler({ method: "POST", body }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mocks.identify).not.toHaveBeenCalled();
  });
});
