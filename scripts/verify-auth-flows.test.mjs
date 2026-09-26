// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ readFileSync: vi.fn(), createClient: vi.fn() }));
vi.mock("node:fs", () => ({ readFileSync: mocks.readFileSync }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

const keys = [
  "VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY", "DEEPSPEC_AUTH_TEST_EMAIL",
  "DEEPSPEC_AUTH_TEST_PASSWORD", "DEEPSPEC_AUTH_TEST_EMAIL_CODE", "DEEPSPEC_AUTH_SEND_CODE",
  "DEEPSPEC_AUTH_REQUIRE_CREDENTIALS", "VITE_ENABLE_GOOGLE_AUTH", "VITE_ENABLE_GITHUB_AUTH",
];
let auth;
let output;
let previousExitCode;

beforeEach(() => {
  vi.resetModules();
  keys.forEach((key) => vi.stubEnv(key, undefined));
  vi.stubEnv("VITE_SUPABASE_URL", "https://auth.example.test");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "fictional-public-key");
  previousExitCode = process.exitCode;
  process.exitCode = undefined;
  output = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.readFileSync.mockImplementation(() => { throw new Error("No local file"); });
  const session = { data: { user: { id: "test-user" }, session: { access_token: "fictional-token" } }, error: null };
  auth = {
    signInWithPassword: vi.fn().mockResolvedValue(session),
    verifyOtp: vi.fn().mockResolvedValue(session),
    signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  };
  mocks.createClient.mockReturnValue({ auth });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, json: async () => ({ external: { anonymous_users: true } }),
  }));
});

afterEach(() => {
  process.exitCode = previousExitCode;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const run = () => import("./verify-auth-flows.mjs");
const log = () => output.mock.calls.flat().join("\n");

describe("auth verifier credential fidelity and coverage", () => {
  it("passes shell password whitespace unchanged without printing credentials", async () => {
    vi.stubEnv("DEEPSPEC_AUTH_TEST_EMAIL", "tester@example.test");
    vi.stubEnv("DEEPSPEC_AUTH_TEST_PASSWORD", "  fictional secret  ");
    await run();
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "tester@example.test", password: "  fictional secret  " });
    expect(log()).toContain("Password sign-in: verified.");
    expect(log()).toContain("Email code sign-in: skipped");
    expect(log()).not.toContain("fictional secret");
    expect(log()).not.toContain("fictional-token");
  });

  it.each(['"  file secret  "', "'  file secret  '", "  file secret  "])("preserves password bytes from env file: %s", async (value) => {
    mocks.readFileSync.mockReturnValue(`DEEPSPEC_AUTH_TEST_EMAIL=tester@example.test\nDEEPSPEC_AUTH_TEST_PASSWORD=${value}\n`);
    await run();
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "tester@example.test", password: "  file secret  " });
    expect(log()).not.toContain("file secret");
  });

  it("does not override an explicitly empty shell password with a local credential", async () => {
    vi.stubEnv("DEEPSPEC_AUTH_TEST_PASSWORD", "");
    mocks.readFileSync.mockReturnValue("DEEPSPEC_AUTH_TEST_EMAIL=tester@example.test\nDEEPSPEC_AUTH_TEST_PASSWORD=local-secret\n");
    await run();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(log()).toContain("Password sign-in: skipped");
  });

  it("clearly reports skipped sign-ins when only settings were checked", async () => {
    await run();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(log()).toContain("Provider settings: verified (not an end-to-end sign-in).");
    expect(log()).toContain("Password sign-in: skipped");
    expect(log()).toContain("Email code sign-in: skipped");
    expect(log()).toContain("OAuth browser sign-in: not tested");
  });

  it("distinguishes accepted email request from verified code sign-in", async () => {
    vi.stubEnv("DEEPSPEC_AUTH_TEST_EMAIL", "tester@example.test");
    vi.stubEnv("DEEPSPEC_AUTH_SEND_CODE", "true");
    vi.stubEnv("DEEPSPEC_AUTH_TEST_EMAIL_CODE", "123456");
    await run();
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: "tester@example.test", token: "123456", type: "email" });
    expect(log()).toContain("Email code sign-in: verified.");
    expect(log()).toContain("inbox delivery not verified");
    expect(log()).not.toContain("123456");
  });

  it("retains strict credential failure without a success coverage summary", async () => {
    vi.stubEnv("DEEPSPEC_AUTH_REQUIRE_CREDENTIALS", "true");
    await run();
    expect(process.exitCode).toBe(1);
    expect(log()).not.toContain("Auth verification coverage:");
  });
});
