import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQaTestSessionResponse } from "./qaTestSession.shared.js";
import handler from "../api/qa-test-session.js";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), generateLink: vi.fn(), getUser: vi.fn(), signOut: vi.fn(), deleteUser: vi.fn(),
  list: vi.fn(), remove: vi.fn(), from: vi.fn(), deleteRows: vi.fn(), eq: vi.fn(), upsert: vi.fn(),
  loginExpiry: "2026-11-06T04:00:00Z", cleanupExpiry: "2026-11-07T04:00:00Z", digest: "",
}));
vi.mock("./supabaseAdmin.shared.js", () => ({ createSupabaseAdminClient: mocks.createClient, getSupabaseAdminKey: (env: Record<string, string>) => env.SUPABASE_SECRET_KEY }));
vi.mock("./qaTestConfig.shared.js", () => ({
  get QA_TEST_CAPABILITY_SHA256() { return mocks.digest; },
  QA_TEST_EMAIL: "deepspec-test-fixed@example.test",
  get QA_TEST_LOGIN_EXPIRES_AT() { return mocks.loginExpiry; },
  get QA_TEST_CLEANUP_EXPIRES_AT() { return mocks.cleanupExpiry; },
}));
const capability = "b".repeat(64);
const userId = "01234567-89ab-4cde-8fab-0123456789ab";
const user = { id: userId, email: "deepspec-test-fixed@example.test", is_anonymous: false };
const jwt = "header.payload.signature";
const now = Date.parse("2026-11-05T20:00:00Z");
const env = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "codex/private-skip-auth-20261108", VITE_SUPABASE_URL: "https://test.supabase.co", SUPABASE_SECRET_KEY: "private-test-admin-key" };
function request(method = "POST", body?: unknown) {
  return { method, headers: { authorization: `Bearer ${capability}`, "x-qa-session": jwt }, body };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loginExpiry = "2026-11-06T04:00:00Z";
  mocks.cleanupExpiry = "2026-11-07T04:00:00Z";
  mocks.digest = createHash("sha256").update(capability).digest("hex");
  mocks.generateLink.mockResolvedValue({ data: { user, properties: { hashed_token: "c".repeat(64), action_link: "must-not-return", email_otp: "must-not-return" } }, error: null });
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.deleteUser.mockResolvedValue({ data: { user }, error: null });
  mocks.list.mockResolvedValue({ data: [], error: null });
  mocks.remove.mockResolvedValue({ data: [], error: null });
  mocks.eq.mockResolvedValue({ error: null });
  mocks.deleteRows.mockReturnValue({ eq: mocks.eq });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.from.mockReturnValue({ delete: mocks.deleteRows, upsert: mocks.upsert });
  mocks.createClient.mockReturnValue({ auth: { getUser: mocks.getUser, admin: { generateLink: mocks.generateLink, signOut: mocks.signOut, deleteUser: mocks.deleteUser } }, storage: { from: (bucket: string) => { expect(bucket).toBe("scan-images"); return { list: mocks.list, remove: mocks.remove }; } }, from: mocks.from });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("temporary test session", () => {
  it("initializes two ordinary free scans without resetting an existing allowance", async () => {
    expect((await createQaTestSessionResponse(request(), env, now)).status).toBe(200);
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith("free_scan_usage");
    expect(mocks.upsert).toHaveBeenCalledExactlyOnceWith(
      { user_id: userId, scans_used: 3 }, { onConflict: "user_id", ignoreDuplicates: true },
    );
  });
  it("does not release a login token when the bounded allowance cannot be initialized", async () => {
    mocks.upsert.mockResolvedValueOnce({ error: { message: "private-database-error" } });
    const result = await createQaTestSessionResponse(request(), env, now);
    expect(result.status).toBe(502);
    expect(result.body).not.toHaveProperty("token_hash");
    expect(JSON.stringify(result)).not.toContain("private-database-error");
  });
  it.each(["GET", "PUT", "OPTIONS"])("rejects %s without creating a client", async (method) => {
    expect((await createQaTestSessionResponse(request(method), env, now)).status).toBe(405);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it.each([{ VERCEL_ENV: "production" }, { VERCEL_ENV: "development" }, { VERCEL_GIT_COMMIT_REF: "main" }])("rejects unapproved runtime %#", async (override) => {
    expect((await createQaTestSessionResponse(request(), { ...env, ...override }, now)).status).toBe(404);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("fails closed for malformed, expired, or inconsistent expiration/configuration", async () => {
    mocks.loginExpiry = "invalid";
    expect((await createQaTestSessionResponse(request(), env, now)).status).toBe(404);
    mocks.loginExpiry = new Date(now).toISOString();
    expect((await createQaTestSessionResponse(request(), env, now)).status).toBe(404);
    mocks.cleanupExpiry = "invalid";
    expect((await createQaTestSessionResponse(request("DELETE"), env, now)).status).toBe(404);
    mocks.cleanupExpiry = new Date(now).toISOString();
    expect((await createQaTestSessionResponse(request("DELETE"), env, now)).status).toBe(404);
    mocks.loginExpiry = "2026-11-06T04:00:00Z";
    mocks.cleanupExpiry = "2026-11-07T04:00:00Z";
    mocks.digest = "bad";
    expect((await createQaTestSessionResponse(request(), env, now)).status).toBe(404);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it.each([undefined, "", "Bearer bad", `Bearer ${"a".repeat(64)}`, [`Bearer ${capability}`]])("rejects missing or wrong capability %#", async (authorization) => {
    const result = await createQaTestSessionResponse({ ...request(), headers: { authorization } }, env, now);
    expect(result.status).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it.each([{ email: "another@example.test" }, { userId: "other" }, { redirectTo: "https://example.com" }, [], null, "invalid", "x".repeat(1000)])("rejects input fields/body %#", async (body) => {
    expect((await createQaTestSessionResponse(request("POST", body), env, now)).status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("uses only the fixed magiclink identity and returns only the hash and UUID", async () => {
    const result = await createQaTestSessionResponse(request("POST", {}), env, now);
    expect(mocks.generateLink).toHaveBeenCalledExactlyOnceWith({ type: "magiclink", email: user.email });
    expect(result).toEqual({ status: 200, body: { token_hash: "c".repeat(64), userId } });
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.deleteRows).not.toHaveBeenCalled();
  });
  it("accepts the scoped private cookie without an Authorization header", async () => {
    const result = await createQaTestSessionResponse({ ...request(), headers: { cookie: `unrelated=value; __Secure-deepspec-qa-test=${capability}` } }, env, now);
    expect(result.status).toBe(200);
    expect(mocks.generateLink).toHaveBeenCalledOnce();
  });
  it.each([
    { cookie: `__Secure-deepspec-qa-test=${capability}; __Secure-deepspec-qa-test=${capability}` },
    { cookie: `__Secure-deepspec-qa-test=${"a".repeat(64)}`, authorization: `Bearer ${capability}` },
    { cookie: `__Secure-deepspec-qa-test=${capability}`, authorization: "Bearer invalid" },
    { cookie: "__Secure-deepspec-qa-test=invalid" },
    { cookie: [`__Secure-deepspec-qa-test=${capability}`] },
  ])("rejects duplicate, conflicting or malformed cookie credentials %#", async (headers) => {
    expect((await createQaTestSessionResponse({ ...request(), headers }, env, now)).status).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("expires the scoped cookie only after successful HTTP cleanup", async () => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() };
    await handler({ ...request("DELETE"), headers: { cookie: `__Secure-deepspec-qa-test=${capability}`, "x-qa-session": jwt } }, response);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.setHeader).toHaveBeenCalledWith("Set-Cookie", "__Secure-deepspec-qa-test=; Max-Age=0; Path=/api/qa-test-session; HttpOnly; Secure; SameSite=Strict");
    response.setHeader.mockClear();
    mocks.deleteUser.mockResolvedValueOnce({ error: { message: "failed" } });
    await handler(request("DELETE"), response);
    expect(response.setHeader.mock.calls.some(([name]) => name === "Set-Cookie")).toBe(false);
  });
  it.each([{ ...user, email: "other@example.test" }, { ...user, is_anonymous: true }, { ...user, id: "../other" }])("rejects a mismatched generated identity %#", async (generatedUser) => {
    mocks.generateLink.mockResolvedValue({ data: { user: generatedUser, properties: { hashed_token: "c".repeat(64) } }, error: null });
    expect((await createQaTestSessionResponse(request(), env, now)).status).toBe(502);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
  it("sanitizes configuration, provider and thrown errors", async () => {
    expect((await createQaTestSessionResponse(request(), { ...env, SUPABASE_SECRET_KEY: "" }, now)).status).toBe(500);
    mocks.generateLink.mockResolvedValueOnce({ data: null, error: { message: "private-admin-key" } });
    expect(JSON.stringify(await createQaTestSessionResponse(request(), env, now))).not.toContain("private-admin-key");
    mocks.generateLink.mockRejectedValueOnce(new Error("private-exception"));
    expect(JSON.stringify(await createQaTestSessionResponse(request(), env, now))).not.toContain("private-exception");
  });
  it.each([undefined, "", "not-a-jwt", [jwt]])("rejects missing/malformed cleanup session %#", async (session) => {
    expect((await createQaTestSessionResponse({ ...request("DELETE"), headers: { ...request().headers, "x-qa-session": session } }, env, now)).status).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it.each([{ ...user, email: "real-user@example.com" }, { ...user, is_anonymous: true }, { ...user, id: "../../other" }])("never cleans a different or invalid account %#", async (verifiedUser) => {
    mocks.getUser.mockResolvedValue({ data: { user: verifiedUser }, error: null });
    expect((await createQaTestSessionResponse(request("DELETE"), env, now)).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
  it("allows cleanup after login expires, revokes first, removes nested objects and exact owned records", async () => {
    mocks.list.mockImplementation(async (prefix: string) => ({ error: null, data: prefix === userId ? [{ name: "scan-1", id: null }] : [{ name: "original.jpg", id: "object-id" }] }));
    const result = await createQaTestSessionResponse(request("DELETE"), env, Date.parse("2026-11-06T12:00:00Z"));
    expect(result).toEqual({ status: 200, body: { cleaned: true, userId, removedObjects: 1 } });
    expect(mocks.getUser).toHaveBeenCalledExactlyOnceWith(jwt);
    expect(mocks.signOut).toHaveBeenCalledExactlyOnceWith(jwt, "global");
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith([`${userId}/scan-1/original.jpg`]);
    expect(mocks.from.mock.calls).toEqual([["feedback_submissions"], ["waitlist_signups"]]);
    expect(mocks.eq.mock.calls).toEqual([["user_id", userId], ["user_id", userId]]);
    expect(mocks.deleteUser).toHaveBeenCalledExactlyOnceWith(userId);
    expect(mocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0]);
    expect(mocks.eq.mock.invocationCallOrder[1]).toBeLessThan(mocks.deleteUser.mock.invocationCallOrder[0]);
  });
  it("paginates before deleting so offsets never skip objects", async () => {
    mocks.list.mockImplementation(async (_prefix: string, { offset }: { offset: number }) => ({ error: null, data: offset === 0 ? Array.from({ length: 100 }, (_, i) => ({ name: `file-${i}.jpg`, id: `file-id-${i}` })) : [{ name: "last.jpg", id: "last-id" }] }));
    expect((await createQaTestSessionResponse(request("DELETE"), env, now)).status).toBe(200);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.list.mock.calls.map(([, options]) => options.offset)).toEqual([0, 100]);
    expect(mocks.remove.mock.calls.flatMap(([paths]) => paths)).toHaveLength(101);
    expect(mocks.list.mock.invocationCallOrder[1]).toBeLessThan(mocks.remove.mock.invocationCallOrder[0]);
  });
  it.each(["..", "../other/file.jpg", "/other/file.jpg", "other\\file.jpg", "%2e%2e", ""]) ("rejects unsafe storage entry %s without destructive calls", async (name) => {
    mocks.list.mockResolvedValue({ data: [{ name, id: "id" }], error: null });
    expect((await createQaTestSessionResponse(request("DELETE"), env, now)).status).toBe(502);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
  it("bounds storage listing and refuses oversized cleanup before deletion", async () => {
    mocks.list.mockImplementation(async (_prefix: string, { offset }: { offset: number }) => ({ error: null, data: Array.from({ length: 100 }, (_, i) => ({ name: `file-${offset + i}.jpg`, id: `id-${offset + i}` })) }));
    expect((await createQaTestSessionResponse(request("DELETE"), env, now)).status).toBe(502);
    expect(mocks.list.mock.calls.length).toBeLessThanOrEqual(3);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
  it.each(["signOut", "remove", "eq", "deleteUser"] as const)("stops and reports incomplete cleanup on %s failure", async (operation) => {
    mocks.list.mockResolvedValue({ data: [{ name: "photo.jpg", id: "object-id" }], error: null });
    mocks[operation].mockResolvedValueOnce({ error: { message: "private-server-detail" } });
    const result = await createQaTestSessionResponse(request("DELETE"), env, now);
    expect(result.status).toBe(502);
    expect(JSON.stringify(result)).not.toContain("private-server-detail");
    if (operation !== "deleteUser") expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
  it("sets no-store on the HTTP entry point even for rejected requests", async () => {
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() };
    await handler({ method: "GET" }, response);
    expect(response.status).toHaveBeenCalledWith(405);
    expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
