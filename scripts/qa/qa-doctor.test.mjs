import { afterEach, describe, expect, it, vi } from "vitest";

import { checkDatabaseReachable } from "./qa-doctor.mjs";

const config = { url: "https://example.supabase.co/", key: "sb_publishable_test_only" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QA doctor public REST configuration check", () => {
  it.each([config.key, "legacy-anon-test-key"])("sends the API key without pretending it is a user JWT: %s", async (key) => {
    const response = new Response("{}", { status: 200 });
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetch);

    const result = await checkDatabaseReachable({ ...config, key });

    expect(result).toMatchObject({ status: "passed", classification: "none" });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://example.supabase.co/rest/v1/");
    const headers = new Headers(options.headers);
    expect(headers.get("apikey")).toBe(key);
    expect(headers.has("authorization")).toBe(false);
  });

  it.each([401, 403])("reports HTTP %s as rejected access even though the endpoint responds", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private server diagnostic", { status })));

    const result = await checkDatabaseReachable(config);

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

    expect(await checkDatabaseReachable(config)).toMatchObject({ status: "failed", classification });
  });

  it("keeps a transport failure distinct from rejected access", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));

    expect(await checkDatabaseReachable(config)).toMatchObject({ status: "failed", classification: "network/transient issue" });
  });

  it("does not contact Supabase when the public key is missing", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    expect(await checkDatabaseReachable({ url: config.url, key: "" })).toMatchObject({ status: "failed", classification: "missing env" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
