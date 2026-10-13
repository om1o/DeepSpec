import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertQaScanAccess } from "./scan-access.mjs";

const access = () => ({ mode: "non-production", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), userId: "qa-owner" });
// Execute the actual browser callback, using jsdom storage and intercepted HTTP.
const page = { evaluate: (callback) => callback() };
function setup(payload = { qaScanAccess: access() }, status = 200) {
  localStorage.setItem("sb-test-auth-token", JSON.stringify({ access_token: "private-token", user: { id: "qa-owner" } }));
  const fetch = vi.fn(async () => ({ ok: status === 200, json: async () => payload }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

describe("repeatable QA scan preflight", () => {
  it("uses the actual browser session in a read-only same-origin request", async () => {
    const fetch = setup();
    expect(await assertQaScanAccess(page)).toMatchObject({ mode: "non-production", userId: "qa-owner" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith("/api/account-entitlement", expect.objectContaining({
      headers: { Authorization: "Bearer private-token" }, cache: "no-store", redirect: "error",
    }));
  });
  it.each([
    {},
    { entitlement: { status: "active", scanAllowance: 1000 } },
    { qaScanAccess: { ...access(), userId: "someone-else" } },
    { qaScanAccess: { ...access(), mode: "production" } },
    { qaScanAccess: { ...access(), expiresAt: "2020-01-01T00:00:00Z" } },
    { qaScanAccess: { ...access(), expiresAt: "2099-01-01T00:00:00Z" } },
    { qaScanAccess: { ...access(), expiresAt: "invalid" } },
  ])("blocks absent, mismatched and invalid access without spending a scan: %j", async (payload) => {
    const fetch = setup(payload);
    await expect(assertQaScanAccess(page)).rejects.toThrow("No test image was submitted");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([401, 503])("blocks HTTP %i without exposing credentials or response bodies", async (status) => {
    setup({ error: "private-token" }, status);
    await expect(assertQaScanAccess(page)).rejects.toThrow("Configure the dedicated non-production account");
  });
  it("fails closed on transport errors and missing or ambiguous sessions", async () => {
    const fetch = setup();
    fetch.mockRejectedValue(new Error("private-token"));
    await expect(assertQaScanAccess(page)).rejects.toThrow("QA scan access is not active");
    fetch.mockClear();
    localStorage.clear();
    await expect(assertQaScanAccess(page)).rejects.toThrow("QA scan access is not active");
    expect(fetch).not.toHaveBeenCalled();
    setup();
    localStorage.setItem("sb-other-auth-token", localStorage.getItem("sb-test-auth-token"));
    await expect(assertQaScanAccess(page)).rejects.toThrow("QA scan access is not active");
  });
  it.each(["web-ar-tester.mjs", "external-ar-tester.mjs", "real-website-tester.mjs"])("keeps preflight ahead of live fixture upload in %s", (filename) => {
    const source = readFileSync(resolve("scripts/qa", filename), "utf8");
    const start = filename === "real-website-tester.mjs" ? source.indexOf("async function runScannerAiEngine()") : source.indexOf("async function runCase(");
    const flow = source.slice(start);
    const preflight = flow.indexOf("await assertQaScanAccess(page)");
    expect(preflight).toBeGreaterThan(0);
    expect(preflight).toBeLessThan(flow.indexOf(".setInputFiles("));
  });
  it("keeps doctor cleanup scoped to its own session", () => {
    const source = readFileSync(resolve("scripts/qa/qa-doctor.mjs"), "utf8");
    expect(source).toContain('client.auth.signOut({ scope: "local" })');
    expect(source).not.toContain("client.auth.signOut()");
  });
});
