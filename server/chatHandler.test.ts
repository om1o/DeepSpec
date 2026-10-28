import handler from "../api/chat";
import { enforceRateLimit } from "./rateLimit.shared";
import { requireSession } from "./requireSession.shared";

vi.mock("./rateLimit.shared", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("./requireSession.shared", () => ({ requireSession: vi.fn() }));

function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("DEEPSPEC_ENABLE_CHAT", "");
  vi.stubEnv("DEEPSPEC_GUEST_PREVIEW", "false");
  vi.stubEnv("GEMINI_API_KEY", "test-key");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it.each(["", "false", " FALSE "])("returns feature_disabled without unavailable infrastructure (%s)", async (flag) => {
  vi.stubEnv("DEEPSPEC_ENABLE_CHAT", flag);
  vi.mocked(enforceRateLimit).mockRejectedValue(new Error("limiter offline"));
  vi.mocked(requireSession).mockRejectedValue(new Error("auth offline"));
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const res = response();
  await handler({ method: "POST", body: null }, res);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({ error: { code: "feature_disabled", message: "Follow-up chat is unavailable in this beta." } });
  expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  expect(enforceRateLimit).not.toHaveBeenCalled();
  expect(requireSession).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("keeps the POST-only contract when disabled", async () => {
  const res = response();
  await handler({ method: "GET" }, res);
  expect(res.status).toHaveBeenCalledWith(405);
  expect(enforceRateLimit).not.toHaveBeenCalled();
});

it.each([
  [429, "rate_limited"],
  [503, "rate_limit_unavailable"],
])("keeps enabled-chat rate limit failures (%s)", async (status, code) => {
  vi.stubEnv("DEEPSPEC_ENABLE_CHAT", "true");
  const body = { error: { code, message: "Rejected" } };
  vi.mocked(enforceRateLimit).mockResolvedValue({ ok: false, status, body, retryAfterSeconds: 30 });
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const res = response();
  await handler({ method: "POST" }, res);
  expect(res.status).toHaveBeenCalledWith(status);
  expect(res.json).toHaveBeenCalledWith(body);
  expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "30");
  expect(requireSession).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([[401, "missing_session"], [401, "invalid_session"], [500, "not_configured"]])("keeps enabled-chat authorization failures (%s %s)", async (status, code) => {
  vi.stubEnv("DEEPSPEC_ENABLE_CHAT", "true");
  vi.mocked(enforceRateLimit).mockResolvedValue({ ok: true });
  const body = { error: { code, message: "Rejected" } };
  vi.mocked(requireSession).mockResolvedValue({ ok: false, status, body });
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const res = response();
  await handler({ method: "POST", headers: { authorization: "Bearer test-session" } }, res);
  expect(res.status).toHaveBeenCalledWith(status);
  expect(res.json).toHaveBeenCalledWith(body);
  expect(requireSession).toHaveBeenCalledWith({ authorization: "Bearer test-session" }, process.env);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("calls the provider only after enabled-chat gates succeed", async () => {
  vi.stubEnv("DEEPSPEC_ENABLE_CHAT", "true");
  vi.mocked(enforceRateLimit).mockResolvedValue({ ok: true });
  vi.mocked(requireSession).mockResolvedValue({ ok: true, userId: "confirmed-user" });
  const fetchMock = vi.fn().mockImplementation(async () => {
    expect(enforceRateLimit).toHaveBeenCalledTimes(1);
    expect(requireSession).toHaveBeenCalledTimes(1);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Check the marking." }] } }] }), { headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  const res = response();
  await handler({ method: "POST", body: { userMessage: "What next?" } }, res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({ message: "Check the marking." });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

function configureGuestPreview() {
  vi.stubEnv("DEEPSPEC_GUEST_PREVIEW", "true");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("DEEPSPEC_ENABLE_CHAT", "false");
}

it("runs live account-free preview chat even when project chat is disabled", async () => {
  configureGuestPreview();
  vi.mocked(enforceRateLimit).mockResolvedValue({ ok: true });
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Inspect the visible marking." }] } }] }), { headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  const res = response();
  await handler({ method: "POST", body: { userMessage: "Which marking should I inspect?" } }, res);
  expect(enforceRateLimit).toHaveBeenCalledWith("chat", {}, process.env);
  expect(requireSession).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({ message: "Inspect the visible marking." });
  expect(process.env.DEEPSPEC_ENABLE_CHAT).toBe("false");
});

it.each([429, 503] as const)("fails closed before guest chat provider use when IP quota is unavailable (%i)", async (status) => {
  configureGuestPreview();
  const body = { error: { code: "preview_limited", message: "Wait" } };
  vi.mocked(enforceRateLimit).mockResolvedValue({ ok: false, status, body, retryAfterSeconds: 30 });
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const res = response();
  await handler({ method: "POST", body: { userMessage: "What next?" } }, res);
  expect(res.status).toHaveBeenCalledWith(status);
  expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "30");
  expect(requireSession).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("keeps production chat disabled despite the preview flag", async () => {
  configureGuestPreview();
  vi.stubEnv("VERCEL_ENV", "production");
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const res = response();
  await handler({ method: "POST", body: { userMessage: "What next?" } }, res);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({ error: { code: "feature_disabled", message: "Follow-up chat is unavailable in this beta." } });
  expect(enforceRateLimit).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("does not use the guest chat feature override for authenticated preview requests", async () => {
  configureGuestPreview();
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const res = response();
  await handler({ method: "POST", headers: { authorization: "Bearer real-session" }, body: { userMessage: "What next?" } }, res);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(enforceRateLimit).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("still verifies supplied preview credentials when regular chat is enabled", async () => {
  configureGuestPreview();
  vi.stubEnv("DEEPSPEC_ENABLE_CHAT", "true");
  vi.mocked(enforceRateLimit).mockResolvedValue({ ok: true });
  vi.mocked(requireSession).mockResolvedValue({ ok: false, status: 401, body: { error: { code: "invalid_session", message: "Invalid" } } });
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const res = response();
  await handler({ method: "POST", headers: { authorization: "Bearer invalid" }, body: { userMessage: "What next?" } }, res);
  expect(requireSession).toHaveBeenCalledWith({ authorization: "Bearer invalid" }, process.env);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(fetchMock).not.toHaveBeenCalled();
});
