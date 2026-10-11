// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), fetch: vi.fn(), cleanup: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("node:fs", () => ({ readFileSync: () => { throw new Error("no env file"); } }));
vi.mock("./qa/cloud-fixture-checks.mjs", () => ({ fetchCloudVerification: mocks.fetch, cleanupCloudFixture: mocks.cleanup, assertInspectionSchema: vi.fn(), verifyInspectionRoundTrip: vi.fn() }));
let owner;
let other;
let oldExit;
const client = (id) => ({ auth: {
  signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id, email_confirmed_at: "date" }, session: { access_token: "token" } } }),
  signOut: vi.fn().mockResolvedValue({ error: null }),
}, storage: { from: vi.fn(() => { throw new Error("stop at first fixture write"); }) } });
beforeEach(() => {
  vi.resetModules();
  mocks.createClient.mockReset();
  mocks.cleanup.mockReset();
  oldExit = process.exitCode;
  process.exitCode = undefined;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const [key, value] of Object.entries({ VITE_SUPABASE_URL: "https://example.test", VITE_SUPABASE_PUBLISHABLE_KEY: "public", DEEPSPEC_AUTH_TEST_EMAIL: "owner@example.test", DEEPSPEC_AUTH_TEST_PASSWORD: "pass", DEEPSPEC_AUTH_TEST_OTHER_EMAIL: "other@example.test", DEEPSPEC_AUTH_TEST_OTHER_PASSWORD: "otherpass" })) vi.stubEnv(key, value);
  mocks.fetch.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ external: { anonymous_users: false } }) });
  owner = client("owner"); other = client("other");
  mocks.createClient.mockReturnValueOnce(owner).mockReturnValueOnce(other);
});
afterEach(() => { process.exitCode = oldExit; vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const run = () => import("./verify-supabase-sync.mjs");
describe("cloud verifier account preflight", () => {
  it("fails without secondary credentials before any network or fixture writes", async () => {
    vi.stubEnv("DEEPSPEC_AUTH_TEST_OTHER_PASSWORD", "");
    await run();
    expect(process.exitCode).toBe(1);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(owner.storage.from).not.toHaveBeenCalled();
  });
  it("fails before writes if the secondary login resolves to the owner", async () => {
    other.auth.signInWithPassword.mockResolvedValue(await owner.auth.signInWithPassword());
    await run();
    expect(process.exitCode).toBe(1);
    expect(owner.storage.from).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("two distinct"));
  });
  it("fails before writes when the second session is unconfirmed", async () => {
    other.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: "other" }, session: { access_token: "token" } } });
    await run();
    expect(owner.storage.from).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
  it("with anonymous auth disabled reaches fixture writes only after both confirmed logins", async () => {
    await run();
    expect(other.auth.signInWithPassword).toHaveBeenCalledWith({ email: "other@example.test", password: "otherpass" });
    expect(owner.storage.from).toHaveBeenCalledWith("scan-images");
    expect(owner.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(other.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(console.error).toHaveBeenCalledWith("stop at first fixture write");
  });
});
