// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { assertConfirmedSession, assertDistinctUsers, createConfirmedReplaySession, readTestCredentials, signInConfirmed } from "./confirmed-session.mjs";

const confirmed = (id = "owner") => ({ user: { id, email_confirmed_at: "2026-10-11T00:00:00Z", is_anonymous: false }, session: { access_token: "secret-token" } });

describe("verified QA identity contract", () => {
  it("requires explicit credentials and preserves password bytes", () => {
    expect(() => readTestCredentials({})).toThrow("DEEPSPEC_AUTH_TEST_EMAIL");
    expect(readTestCredentials({ DEEPSPEC_AUTH_TEST_EMAIL: " qa@example.test ", DEEPSPEC_AUTH_TEST_PASSWORD: " pass " })).toEqual({ email: "qa@example.test", password: " pass " });
    expect(() => readTestCredentials({}, "DEEPSPEC_AUTH_TEST_OTHER")).toThrow("DEEPSPEC_AUTH_TEST_OTHER_PASSWORD");
  });
  it.each([
    { user: { id: "owner", is_anonymous: true, email_confirmed_at: "date" }, session: { access_token: "token" } },
    { user: { id: "owner" }, session: { access_token: "token" } },
    { ...confirmed(), session: null },
    null,
  ])("fails closed for unusable or unverified sessions", (data) => {
    expect(() => assertConfirmedSession(data)).toThrow("confirmed user session");
  });
  it("uses password sign-in and does not expose provider secrets on failure", async () => {
    const client = { auth: { signInWithPassword: vi.fn().mockResolvedValue({ data: confirmed(), error: null }) } };
    expect(await signInConfirmed(client, { email: "qa@example.test", password: " pass " })).toEqual(confirmed());
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email: "qa@example.test", password: " pass " });
    client.auth.signInWithPassword.mockResolvedValue({ error: { message: "secret-token" } });
    await expect(signInConfirmed(client, {})).rejects.toThrow("Check credentials");
  });
  it("rejects same-account RLS checks", () => {
    expect(() => assertDistinctUsers({ id: "owner" }, { id: "owner" })).toThrow("two distinct");
    expect(() => assertDistinctUsers({ id: "owner" }, { id: "other" })).not.toThrow();
  });
  it("creates a unique confirmed disposable replay identity and then uses its public session", async () => {
    const admin = { auth: { admin: { createUser: vi.fn().mockResolvedValue({ data: { user: { id: "disposable" } } }) } } };
    const client = { auth: { signInWithPassword: vi.fn().mockResolvedValue({ data: confirmed("disposable") }) } };
    const record = vi.fn();
    await createConfirmedReplaySession(admin, client, record);
    expect(admin.auth.admin.createUser).toHaveBeenCalledWith(expect.objectContaining({ email_confirm: true, email: expect.stringMatching(/^deepspec-replay-.*@example.test$/) }));
    const { email, password } = admin.auth.admin.createUser.mock.calls[0][0];
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email, password });
    expect(record).toHaveBeenCalledWith("disposable");
  });
  it("records the created identity for cleanup even when password login fails", async () => {
    const admin = { auth: { admin: { createUser: vi.fn().mockResolvedValue({ data: { user: { id: "disposable" } } }) } } };
    const client = { auth: { signInWithPassword: vi.fn().mockResolvedValue({ error: {} }) } };
    const record = vi.fn();
    await expect(createConfirmedReplaySession(admin, client, record)).rejects.toThrow("sign-in failed");
    expect(record).toHaveBeenCalledWith("disposable");
  });
});
