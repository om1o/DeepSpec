import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enforceGuestQuota } from "./guestQuota.shared";
import { handleGuestQuota } from "../supabase/functions/deepspec-guest-quota/index";

const URL = "https://project.supabase.co/functions/v1/deepspec-guest-quota";
const ENV = { DEEPSPEC_GUEST_QUOTA_URL: URL };
const IP = "203.0.113.9";
const HASH = createHash("sha256").update(`deepspec-guest-preview\0${IP}`).digest("hex");
const unavailable = { ok: false, status: 503, body: { error: { code: "rate_limit_unavailable" } } };

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("real preview quota client", () => {
  it("sends only scope and a stable SHA-256 IP hash, without account credentials", async () => {
    const request = vi.fn(async () => Response.json({ allowed: true }));
    vi.stubGlobal("fetch", request);
    await expect(enforceGuestQuota("identify", IP, ENV)).resolves.toEqual({ ok: true });
    const [target, options] = request.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(target)).toBe(URL);
    expect(options).toMatchObject({ method: "POST", redirect: "error", headers: { "Content-Type": "application/json" } });
    expect(JSON.parse(String(options.body))).toEqual({ scope: "identify", ipHash: HASH });
    expect(options.body).not.toContain(IP);
    expect(options.headers).not.toHaveProperty("Authorization");
    expect(options.headers).not.toHaveProperty("apikey");
  });

  it.each([null, "", "unknown", "203.0.113.9, 10.0.0.1"])("rejects a missing or malformed trusted IP (%s)", async (ip) => {
    const request = vi.fn(); vi.stubGlobal("fetch", request);
    await expect(enforceGuestQuota("identify", ip, ENV)).resolves.toMatchObject(unavailable);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "http://quota.test/", "https://name:password@quota.test/", "https://quota.test/?key=value"])("requires a configured HTTPS quota endpoint (%s)", async (url) => {
    const request = vi.fn(); vi.stubGlobal("fetch", request);
    await expect(enforceGuestQuota("identify", IP, { DEEPSPEC_GUEST_QUOTA_URL: url })).resolves.toMatchObject(unavailable);
    expect(request).not.toHaveBeenCalled();
  });

  it("preserves fixed-window quota denial", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ allowed: false, retryAfterSeconds: 60 }, { status: 429 })));
    await expect(enforceGuestQuota("chat", IP, ENV)).resolves.toMatchObject({ ok: false, status: 429, retryAfterSeconds: 60, body: { error: { code: "rate_limited" } } });
  });

  it.each([null, {}, { allowed: "true" }, { allowed: 1 }, { allowed: false }])("rejects malformed success decisions (%j)", async (body) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
    await expect(enforceGuestQuota("identify", IP, ENV)).resolves.toMatchObject(unavailable);
  });

  it.each([0, -1, 1.5, 86_401, "60", undefined])("rejects malformed quota retry periods (%s)", async (retryAfterSeconds) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ allowed: false, retryAfterSeconds }, { status: 429 })));
    await expect(enforceGuestQuota("identify", IP, ENV)).resolves.toMatchObject(unavailable);
  });

  it("fails closed on upstream errors and network failures", async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json({ allowed: true }, { status: 503 })).mockRejectedValueOnce(new Error("network"));
    vi.stubGlobal("fetch", request);
    await expect(enforceGuestQuota("identify", IP, ENV)).resolves.toMatchObject(unavailable);
    await expect(enforceGuestQuota("identify", IP, ENV)).resolves.toMatchObject(unavailable);
  });

  it("bounds an unresponsive quota service and clears the timer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_input, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")));
    })));
    const pending = enforceGuestQuota("identify", IP, ENV);
    await vi.advanceTimersByTimeAsync(4001);
    await expect(pending).resolves.toMatchObject(unavailable);
    expect(vi.getTimerCount()).toBe(0);
  });
});

const edgeEnv = (values: Record<string, string | undefined>) => ({ get: (name: string) => values[name] });
const MODERN = edgeEnv({ SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEYS: '{"default":"sb_secret_server-only"}' });
const edgeRequest = (body: unknown = { scope: "identify", ipHash: HASH }) => new Request(URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("consume-only Supabase Edge quota service", () => {
  it.each([["identify", 15, 150], ["chat", 30, 300]] as const)("checks fixed %s limits using injected modern credentials", async (scope, minute, day) => {
    const request = vi.fn(async () => Response.json(true));
    const response = await handleGuestQuota(edgeRequest({ scope, ipHash: HASH }), MODERN, request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ allowed: true });
    expect(request).toHaveBeenCalledTimes(2);
    const bodies = request.mock.calls.map((call) => JSON.parse(String((call as unknown as [unknown, RequestInit])[1].body)));
    expect(bodies).toEqual([
      { p_key: `guest-preview:${scope}:min:${HASH}`, p_max: minute, p_window_seconds: 60 },
      { p_key: `guest-preview:${scope}:day:${HASH}`, p_max: day, p_window_seconds: 86_400 },
    ]);
    for (const call of request.mock.calls) {
      const [target, options] = call as unknown as [URL, RequestInit];
      expect(String(target)).toBe("https://project.supabase.co/rest/v1/rpc/check_rate_limit");
      expect(options.headers).toEqual({ "Content-Type": "application/json", apikey: "sb_secret_server-only" });
    }
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("supports the automatically injected legacy server key without exposing it", async () => {
    const request = vi.fn(async () => Response.json(true));
    const response = await handleGuestQuota(edgeRequest(), edgeEnv({ SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEYS: "invalid-json", SUPABASE_SERVICE_ROLE_KEY: "legacy-server-jwt" }), request);
    expect(response.status).toBe(200);
    const options = (request.mock.calls[0] as unknown as [unknown, RequestInit])[1];
    expect(options.headers).toEqual({ "Content-Type": "application/json", apikey: "legacy-server-jwt", Authorization: "Bearer legacy-server-jwt" });
    expect(await response.text()).not.toContain("legacy-server-jwt");
  });

  it.each([
    null,
    { scope: "billing", ipHash: HASH },
    { scope: "identify", ipHash: IP },
    { scope: "identify", ipHash: HASH.toUpperCase() },
    { scope: "identify", ipHash: HASH, p_max: 999999 },
    { scope: "identify", ipHash: HASH, rpc: "read_account_data" },
    { scope: "identify", ipHash: HASH, reset: true },
    { scope: "identify", ipHash: "a".repeat(1025) },
  ])("rejects malformed or caller-adjustable quota requests (%j)", async (body) => {
    const request = vi.fn();
    expect((await handleGuestQuota(edgeRequest(body), MODERN, request)).status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });

  it("accepts only POST JSON and requires injected server configuration", async () => {
    const request = vi.fn();
    expect((await handleGuestQuota(new Request(URL), MODERN, request)).status).toBe(405);
    expect((await handleGuestQuota(new Request(URL, { method: "POST", body: "{}" }), MODERN, request)).status).toBe(415);
    expect((await handleGuestQuota(edgeRequest(), edgeEnv({}), request)).status).toBe(503);
    expect(request).not.toHaveBeenCalled();
  });

  it("returns bounded denials for the minute and daily windows", async () => {
    const minute = vi.fn(async () => Response.json(false));
    const denied = await handleGuestQuota(edgeRequest(), MODERN, minute);
    expect(denied.status).toBe(429);
    expect(await denied.json()).toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(minute).toHaveBeenCalledTimes(1);
    const day = vi.fn().mockResolvedValueOnce(Response.json(true)).mockResolvedValueOnce(Response.json(false));
    const daily = await handleGuestQuota(edgeRequest(), MODERN, day);
    expect(daily.status).toBe(429);
    expect(await daily.json()).toEqual({ allowed: false, retryAfterSeconds: 86_400 });
  });

  it.each([null, "true", 1, {}])("fails closed for non-boolean RPC results (%j)", async (body) => {
    const request = vi.fn(async () => Response.json(body));
    const response = await handleGuestQuota(edgeRequest(), MODERN, request);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: "quota_unavailable", message: "Preview request limits are unavailable." } });
  });

  it("fails closed for RPC HTTP failures and timeouts without returning secret errors", async () => {
    const request = vi.fn().mockResolvedValueOnce(Response.json({ message: "private database details" }, { status: 401 })).mockRejectedValueOnce(new DOMException("Timed out", "AbortError"));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await handleGuestQuota(edgeRequest(), MODERN, request);
      expect(response.status).toBe(503);
      expect(await response.text()).not.toMatch(/private|server-only|legacy/);
    }
  });

  it("interoperates with the server client without any Vercel admin key", async () => {
    const rpc = vi.fn(async () => Response.json(true));
    vi.stubGlobal("fetch", vi.fn(async (input: URL, init: RequestInit) => handleGuestQuota(new Request(input, init), MODERN, rpc)));
    await expect(enforceGuestQuota("identify", IP, ENV)).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
