import { afterEach, describe, expect, it, vi } from "vitest";

import { checkAuthSessionAndDatabase, checkPlaywrightInstalled, checkPublicAuthConfiguration } from "./qa-doctor.mjs";

const config = { url: "https://example.supabase.co/", key: "sb_publishable_test_only" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QA doctor optional browser tooling", () => {
  it("loads the available runtime browser package without launching a browser", async () => {
    const state = {};

    expect(await checkPlaywrightInstalled(state)).toMatchObject({ status: "passed" });
    expect(state.playwright.chromium.launch).toBeTypeOf("function");
  });

  it("falls back to playwright when the optional test package is absent", async () => {
    const playwright = { chromium: {} };
    const loadModule = vi.fn()
      .mockRejectedValueOnce(new Error("Optional test package unavailable"))
      .mockResolvedValueOnce(playwright);
    const state = {};

    expect(await checkPlaywrightInstalled(state, loadModule)).toMatchObject({ status: "passed" });
    expect(loadModule.mock.calls.map(([name]) => name)).toEqual(["@playwright/test", "playwright"]);
    expect(state.playwright).toBe(playwright);
  });

  it("reports missing tooling without rejecting the complete doctor run", async () => {
    const state = {};
    const loadModule = vi.fn().mockRejectedValue(new Error("Browser tooling unavailable"));

    expect(await checkPlaywrightInstalled(state, loadModule)).toMatchObject({ status: "failed", classification: "test bug" });
    expect(state.playwright).toBeUndefined();
  });
});

describe("QA doctor public Auth configuration check", () => {
  it.each([config.key, "legacy-anon-test-key"])("sends the API key without pretending it is a user JWT: %s", async (key) => {
    const response = new Response("{}", { status: 200 });
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetch);

    const result = await checkPublicAuthConfiguration({ ...config, key });

    expect(result).toMatchObject({ status: "passed", classification: "none" });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://example.supabase.co/auth/v1/settings");
    const headers = new Headers(options.headers);
    expect(headers.get("apikey")).toBe(key);
    expect(headers.has("authorization")).toBe(false);
  });

  it.each([401, 403])("reports HTTP %s as rejected access even though the endpoint responds", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private server diagnostic", { status })));

    const result = await checkPublicAuthConfiguration(config);

    expect(result).toMatchObject({ status: "failed", classification: "auth/session issue" });
    expect(result.details).toContain(`HTTP ${status}`);
    expect(JSON.stringify(result)).not.toContain(config.key);
    expect(JSON.stringify(result)).not.toContain("private server diagnostic");
  });

  it.each([
    [404, "stale environment"],
    [429, "network/transient issue"],
    [503, "stale environment"],
  ])("does not treat HTTP %s as healthy configuration", async (status, classification) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));

    expect(await checkPublicAuthConfiguration(config)).toMatchObject({ status: "failed", classification });
  });

  it("keeps a transport failure distinct from rejected access", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));

    expect(await checkPublicAuthConfiguration(config)).toMatchObject({ status: "failed", classification: "network/transient issue" });
  });

  it("does not contact Supabase when the public key is missing", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    expect(await checkPublicAuthConfiguration({ url: config.url, key: "" })).toMatchObject({ status: "failed", classification: "missing env" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("QA doctor authenticated zero-row database check", () => {
  const credentials = { email: "dedicated@example.test", password: "private-password-marker" };
  const session = { access_token: "private-session-marker", refresh_token: "private-refresh-marker" };
  const user = { id: "private-user-marker" };

  function fixture() {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ error: null, status: 200 }),
    };
    const client = {
      auth: {
        signInWithPassword: vi.fn().mockResolvedValue({ data: { session, user }, error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
      from: vi.fn().mockReturnValue(query),
    };
    return { client, query, createClientImpl: vi.fn().mockReturnValue(client) };
  }

  it("does not construct a client or claim database access without QA credentials", async () => {
    const createClientImpl = vi.fn();
    const checks = await checkAuthSessionAndDatabase(config, { credentials: null, createClientImpl });
    expect(checks).toEqual([
      expect.objectContaining({ name: "auth/session is valid", status: "failed", classification: "missing env" }),
      expect.objectContaining({ name: "authenticated database access", status: "failed", classification: "missing env" }),
    ]);
    expect(createClientImpl).not.toHaveBeenCalled();
  });

  it("uses the authenticated owner, requests no rows/count, and signs out only its own session", async () => {
    const { client, query, createClientImpl } = fixture();
    const checks = await checkAuthSessionAndDatabase(config, { credentials, createClientImpl });
    expect(checks.map(({ status }) => status)).toEqual(["passed", "passed"]);
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith(credentials);
    expect(client.from).toHaveBeenCalledWith("scan_lookups");
    expect(query.select).toHaveBeenCalledWith("local_id", { head: true });
    expect(query.eq).toHaveBeenCalledWith("user_id", user.id);
    expect(query.limit).toHaveBeenCalledWith(0);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(JSON.stringify(checks)).not.toMatch(/private-|dedicated@example/);
  });

  it("keeps successful Auth separate from rejected database access and cleans up the session", async () => {
    const { client, query, createClientImpl } = fixture();
    query.limit.mockResolvedValue({ error: { message: "private-database-diagnostic" }, status: 403 });
    const checks = await checkAuthSessionAndDatabase(config, { credentials, createClientImpl });
    expect(checks[0]).toMatchObject({ status: "passed" });
    expect(checks[1]).toMatchObject({ status: "failed", classification: "auth/session issue" });
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(JSON.stringify(checks)).not.toMatch(/private-|dedicated@example/);
  });

  it("always signs out after an authenticated database transport failure", async () => {
    const { client, query, createClientImpl } = fixture();
    query.limit.mockRejectedValue(new Error("private-transport-diagnostic"));
    const checks = await checkAuthSessionAndDatabase(config, { credentials, createClientImpl });
    expect(checks[0]).toMatchObject({ status: "passed" });
    expect(checks[1]).toMatchObject({ status: "failed", classification: "network/transient issue" });
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(JSON.stringify(checks)).not.toContain("private-");
  });

  it("never probes the database when sign-in is rejected", async () => {
    const { client, createClientImpl } = fixture();
    client.auth.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: { message: "private-auth-diagnostic" } });
    const checks = await checkAuthSessionAndDatabase(config, { credentials, createClientImpl });
    expect(checks.map(({ status }) => status)).toEqual(["failed", "failed"]);
    expect(client.from).not.toHaveBeenCalled();
    expect(client.auth.signOut).not.toHaveBeenCalled();
    expect(JSON.stringify(checks)).not.toContain("private-");
  });

  it("reports failed local session cleanup even after a successful database check", async () => {
    const { client, createClientImpl } = fixture();
    client.auth.signOut.mockResolvedValue({ error: { message: "private-cleanup-diagnostic" } });
    const checks = await checkAuthSessionAndDatabase(config, { credentials, createClientImpl });
    expect(checks[0]).toMatchObject({ status: "failed", classification: "auth/session issue" });
    expect(checks[1]).toMatchObject({ status: "passed" });
    expect(JSON.stringify(checks)).not.toContain("private-");
  });
});
