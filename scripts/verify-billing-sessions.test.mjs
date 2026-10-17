// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), writeFileSync: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("node:fs", () => ({ readFileSync: () => { throw new Error("no env file"); }, mkdirSync: vi.fn(), writeFileSync: mocks.writeFileSync }));
import { main as checkout } from "./verify-billing-checkout.mjs";
import { main as replay } from "./verify-billing-webhook-replay.mjs";
let client;
let admin;
let deleteEntitlements;
const reply = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockReset();
  for (const [key, value] of Object.entries({ BILLING_PROVIDER: "polar", VITE_SUPABASE_URL: "https://example.test", VITE_SUPABASE_PUBLISHABLE_KEY: "public", SUPABASE_SECRET_KEY: "server-only", DEEPSPEC_AUTH_TEST_EMAIL: "qa@example.test", DEEPSPEC_AUTH_TEST_PASSWORD: " pass ", POLAR_WEBHOOK_SECRET: "webhook-secret", DEEPSPEC_ENABLE_LIVE_BILLING: "false" })) vi.stubEnv(key, value);
  vi.spyOn(console, "log").mockImplementation(() => {});
  client = { auth: {
    signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: "disposable", email_confirmed_at: "date" }, session: { access_token: "public-session" } } }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  } };
  deleteEntitlements = vi.fn().mockResolvedValue({ error: null });
  admin = { auth: { admin: {
    createUser: vi.fn().mockImplementation(async ({ password }) => {
      const meetsPolicy = password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password)
        && /[0-9]/.test(password) && /[!@#$%^&*()_+\-=]/.test(password);
      return meetsPolicy ? { data: { user: { id: "disposable" } } } : { error: { message: "weak password" } };
    }),
    deleteUser: vi.fn().mockResolvedValue({ error: null }),
  } }, from: vi.fn().mockReturnValue({ delete: () => ({ eq: deleteEntitlements }) }) };
  mocks.createClient.mockReturnValueOnce(client).mockReturnValueOnce(admin);
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("billing verifier confirmed-session integration", () => {
  it("requests checkout with the confirmed public bearer and revokes only this session", async () => {
    fetch.mockResolvedValue(reply({ url: "https://polar.sh/checkout/test" }));
    await checkout(["--url", "https://app.example.test"]);
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: "qa@example.test", password: " pass " });
    expect(fetch).toHaveBeenCalledWith("https://app.example.test/api/billing-checkout", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer public-session" }) }));
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.writeFileSync).toHaveBeenCalledOnce();
  });
  it("does not request checkout or write success for an anonymous session", async () => {
    client.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: "anon", is_anonymous: true }, session: { access_token: "token" } } });
    await expect(checkout([])).rejects.toThrow("confirmed user session");
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });
  it("fails before checkout when dedicated credentials are missing", async () => {
    vi.stubEnv("DEEPSPEC_AUTH_TEST_PASSWORD", "");
    await expect(checkout([])).rejects.toThrow("DEEPSPEC_AUTH_TEST_PASSWORD");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses a new confirmed identity for entitlement/portal checks and deletes only its data", async () => {
    fetch.mockResolvedValueOnce(reply({ received: true, handled: true }))
      .mockResolvedValueOnce(reply({ entitlement: { status: "active", planId: "scan_pack", scanAllowance: 20, billingProvider: "polar" } }))
      .mockResolvedValueOnce(reply({ url: "https://polar.sh/portal/test" }));
    await replay(["--url", "https://app.example.test"]);
    expect(admin.auth.admin.createUser).toHaveBeenCalledWith(expect.objectContaining({ email_confirm: true }));
    const { email, password } = admin.auth.admin.createUser.mock.calls[0][0];
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email, password });
    expect(JSON.parse(fetch.mock.calls[0][1].body).data.metadata.supabase_user_id).toBe("disposable");
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer public-session");
    expect(fetch.mock.calls[2][1].headers.Authorization).toBe("Bearer public-session");
    expect(admin.from).toHaveBeenCalledExactlyOnceWith("billing_entitlements");
    expect(deleteEntitlements).toHaveBeenCalledExactlyOnceWith("user_id", "disposable");
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith("disposable");
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(client.auth.signOut.mock.invocationCallOrder[0]).toBeLessThan(deleteEntitlements.mock.invocationCallOrder[0]);
    expect(deleteEntitlements.mock.invocationCallOrder[0]).toBeLessThan(admin.auth.admin.deleteUser.mock.invocationCallOrder[0]);
    expect(mocks.writeFileSync).toHaveBeenCalledOnce();
    const output = JSON.stringify([console.log.mock.calls, mocks.writeFileSync.mock.calls]);
    for (const secret of [email, password, "public-session", "server-only", "webhook-secret"]) expect(output.includes(secret)).toBe(false);
  });
  it("cleans the created account on failed login and never posts a webhook", async () => {
    client.auth.signInWithPassword.mockResolvedValue({ error: {} });
    await expect(replay([])).rejects.toThrow("sign-in failed");
    expect(deleteEntitlements).toHaveBeenCalledExactlyOnceWith("user_id", "disposable");
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith("disposable");
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });
  it("reports cleanup failure without emitting a pass artifact", async () => {
    fetch.mockResolvedValueOnce(reply({ received: true, handled: true }))
      .mockResolvedValueOnce(reply({ entitlement: { status: "active", planId: "scan_pack", scanAllowance: 20, billingProvider: "polar" } }))
      .mockResolvedValueOnce(reply({ url: "https://polar.sh/portal/test" }));
    admin.auth.admin.deleteUser.mockResolvedValue({ error: {} });
    await expect(replay([])).rejects.toThrow("account cleanup failed");
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });
  it("continues disposable cleanup when session revocation throws and records no pass", async () => {
    client.auth.signInWithPassword.mockResolvedValue({ error: {} });
    client.auth.signOut.mockRejectedValue(new Error("network failure"));
    await expect(replay([])).rejects.toThrow("Could not revoke");
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledWith("disposable");
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });
  it("redacts rejected creation credentials and never signs in or deletes an unrelated account", async () => {
    admin.auth.admin.createUser.mockImplementation(async ({ password }) => ({ error: { message: `Rejected ${password} server-only` } }));
    await expect(replay([])).rejects.toThrow(/^Could not create the disposable confirmed billing replay account\.$/);
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalled();
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });
  it.each([
    { id: "existing-account", email_confirmed_at: "date" },
    { id: "disposable", is_anonymous: true, email_confirmed_at: "date" },
    { id: "disposable" },
  ])("rejects mismatched or unconfirmed identities and cleans up only the created account: %j", async (user) => {
    client.auth.signInWithPassword.mockResolvedValue({ data: { user, session: { access_token: "public-session" } } });
    await expect(replay([])).rejects.toThrow(/does not match|confirmed user session/);
    expect(fetch).not.toHaveBeenCalled();
    expect(deleteEntitlements).toHaveBeenCalledExactlyOnceWith("user_id", "disposable");
    expect(admin.auth.admin.deleteUser).toHaveBeenCalledExactlyOnceWith("disposable");
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });
  it("retains the disposable account when entitlement cleanup fails and emits no success", async () => {
    client.auth.signInWithPassword.mockResolvedValue({ error: {} });
    deleteEntitlements.mockResolvedValue({ error: {} });
    await expect(replay([])).rejects.toThrow("disposable account retained for investigation");
    expect(deleteEntitlements).toHaveBeenCalledExactlyOnceWith("user_id", "disposable");
    expect(admin.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });
  it("rejects a live Stripe key before creating a disposable account or contacting a provider", async () => {
    vi.stubEnv("BILLING_PROVIDER", "stripe");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_synthetic_fixture");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_synthetic_fixture");
    await expect(replay([])).rejects.toThrow("requires a test-mode STRIPE_SECRET_KEY");
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(admin.auth.admin.createUser).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });
});
