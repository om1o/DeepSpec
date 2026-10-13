import handler from "./chat";
import { enforceRateLimit } from "../server/rateLimit.shared";
import { requireSession } from "../server/requireSession.shared";

vi.mock("../server/rateLimit.shared", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("../server/requireSession.shared", () => ({ requireSession: vi.fn() }));

function response() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("DEEPSPEC_ENABLE_CHAT", "");
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
