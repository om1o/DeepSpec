import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler from "../api/qa-test-launch.js";

const config = vi.hoisted(() => ({ digest: "", loginExpiry: "2026-11-06T04:00:00Z", cleanupExpiry: "2026-11-07T04:00:00Z" }));
vi.mock("./qaTestConfig.shared.js", () => ({
  get QA_TEST_CAPABILITY_SHA256() { return config.digest; },
  QA_TEST_EMAIL: "deepspec-test-fixed@example.test",
  get QA_TEST_LOGIN_EXPIRES_AT() { return config.loginExpiry; },
  get QA_TEST_CLEANUP_EXPIRES_AT() { return config.cleanupExpiry; },
}));
const capability = "d".repeat(64);
const now = Date.parse("2026-11-05T20:00:00Z");
function request(body: unknown = `capability=${capability}`) {
  return { method: "POST", headers: { origin: "http://127.0.0.1:43129", host: "deepspec-test-deep-spec-team.vercel.app", "content-type": "application/x-www-form-urlencoded" }, body };
}
function response() { return { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn(), end: vi.fn() }; }
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("VERCEL_GIT_COMMIT_REF", "codex/pilot-assembled-20261103");
  vi.stubEnv("VERCEL_URL", "deepspec-test-deep-spec-team.vercel.app");
  config.digest = createHash("sha256").update(capability).digest("hex");
  config.loginExpiry = "2026-11-06T04:00:00Z";
  config.cleanupExpiry = "2026-11-07T04:00:00Z";
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("private cookie launch", () => {
  it.each([`capability=${capability}`, { capability }])("sets only an HttpOnly scoped cookie then redirects without credentials %#", async (body) => {
    const res = response();
    await handler(request(body), res);
    expect(res.status).toHaveBeenCalledWith(303);
    expect(res.setHeader).toHaveBeenCalledWith("Location", "/auth?private-test=1");
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    const cookie = res.setHeader.mock.calls.find(([name]) => name === "Set-Cookie")?.[1];
    expect(cookie).toBe(`__Secure-deepspec-qa-test=${capability}; Max-Age=115200; Path=/api/qa-test-session; HttpOnly; Secure; SameSite=Strict`);
    expect(res.end).toHaveBeenCalledOnce();
    expect(res.json).not.toHaveBeenCalled();
    expect(res.setHeader.mock.calls.filter(([name]) => name !== "Set-Cookie").flat().join(" ")).not.toContain(capability);
  });
  it.each(["GET", "DELETE", "OPTIONS"])("rejects %s without cookies", async (method) => {
    const res = response();
    await handler({ ...request(), method }, res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.setHeader.mock.calls.some(([name]) => name === "Set-Cookie")).toBe(false);
  });
  it.each([undefined, "null", "http://localhost:43129", "http://127.0.0.1:43130", "https://attacker.example"]) ("rejects wrong origin %s", async (origin) => {
    const res = response();
    await handler({ ...request(), headers: { ...request().headers, origin } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.setHeader.mock.calls.some(([name]) => name === "Set-Cookie")).toBe(false);
  });
  it.each([undefined, "attacker.example", "deepspec-test-deep-spec-team.vercel.app:443"]) ("requires exact deployment host %s", async (host) => {
    const res = response();
    await handler({ ...request(), headers: { ...request().headers, host } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
  it.each(["", undefined, {}, [], null, "capability=wrong", `capability=${capability}&capability=${capability}`, `capability=${capability}&email=other@example.test`, { capability, redirect: "/other" }, { capability: [capability] }, "x".repeat(257)])("rejects malformed/extra body %#", async (body) => {
    const res = response();
    await handler({ ...request(), body }, res);
    expect([400, 401]).toContain(res.status.mock.calls[0][0]);
    expect(res.setHeader.mock.calls.some(([name]) => name === "Set-Cookie")).toBe(false);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain(capability);
  });
  it.each([{ "content-type": "application/json" }, { "content-length": "257" }, { "content-length": "invalid" }])("rejects wrong type or body limit %#", async (headers) => {
    const res = response();
    await handler({ ...request(), headers: { ...request().headers, ...headers } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("rejects Production, another branch, expired access and malformed configuration", async () => {
    const res = response();
    vi.stubEnv("VERCEL_ENV", "production");
    await handler(request(), res);
    expect(res.status).toHaveBeenLastCalledWith(404);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "main");
    await handler(request(), res);
    expect(res.status).toHaveBeenLastCalledWith(404);
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "codex/pilot-assembled-20261103");
    config.loginExpiry = new Date(now).toISOString();
    await handler(request(), res);
    expect(res.status).toHaveBeenLastCalledWith(404);
    config.loginExpiry = "invalid";
    await handler(request(), res);
    expect(res.status).toHaveBeenLastCalledWith(404);
    config.loginExpiry = "2026-11-06T04:00:00Z";
    config.digest = "invalid";
    await handler(request(), res);
    expect(res.status).toHaveBeenLastCalledWith(404);
    expect(res.setHeader.mock.calls.some(([name]) => name === "Set-Cookie")).toBe(false);
  });
  it("rejects the wrong private capability", async () => {
    const res = response();
    await handler(request(`capability=${"e".repeat(64)}`), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader.mock.calls.some(([name]) => name === "Set-Cookie")).toBe(false);
  });
});
