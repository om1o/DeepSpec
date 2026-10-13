import { describe, expect, it, vi } from "vitest";

import { classifyIdentifyApiIssue, classifyQaTransportError, getAuthDependencyBlocker, getQaPasswordCredentials, signInWithQaPassword } from "./qa-utils.mjs";

describe("QA transport and auth dependency classification", () => {
  it.each([
    "page.goto: net::ERR_ABORTED at http://localhost:3000/auth",
    "page.goto: Timeout 30000ms exceeded. Call log: navigating to /auth",
    "This operation was aborted",
    "fetch failed",
  ])("treats transport failure as an environment blocker: %s", (message) => {
    expect(classifyQaTransportError(new Error(message))).toMatchObject({ category: "environment", status: "blocked", likelyFiles: [] });
  });

  it.each([
    "locator.click: Timeout 30000ms exceeded",
    "page.waitForURL: Timeout 20000ms exceeded",
    "Identify API returned HTTP 500: Internal Server Error",
    "AI provider timeout while processing image",
    "Invalid provider response schema",
  ])("does not relabel selector/auth/model errors as transport: %s", (message) => {
    expect(classifyQaTransportError(new Error(message))).toBeNull();
  });

  it.each(["environment", "missing_env", "auth/session"])("blocks dependent flows using auth root category %s", (category) => {
    const blocker = getAuthDependencyBlocker("scanner", { category, details: "root cause", suggestedFix: "fix root cause" });
    expect(blocker).toMatchObject({ category, status: "blocked", likelyFiles: [], suggestedFix: "fix root cause" });
    expect(blocker.message).toContain("root cause");
  });
});

describe("classifyIdentifyApiIssue", () => {
  it("classifies identify HTTP 429 as provider availability", () => {
    expect(classifyIdentifyApiIssue({ status: 429, text: "" })).toMatchObject({
      category: "environment",
    });
  });

  it("classifies visible rate-limit copy as provider availability", () => {
    expect(classifyIdentifyApiIssue({ text: "Too many AI lookups right now. Try again in a few minutes." })).toMatchObject({
      category: "environment",
    });
  });

  it("classifies missing identify provider config separately", () => {
    expect(classifyIdentifyApiIssue({ text: "Deep Spec AI is not configured. Add GEMINI_API_KEY on the server." })).toMatchObject({
      category: "missing_env",
    });
  });

  it("does not hide a generic server failure as provider availability", () => {
    expect(classifyIdentifyApiIssue({ status: 500, text: "Internal Server Error" })).toBeNull();
  });
});

describe("password QA account configuration", () => {
  it("requires both account fields without exposing them in status output", () => {
    expect(getQaPasswordCredentials({ DEEPSPEC_AUTH_TEST_EMAIL: "qa@example.test" })).toBeNull();
    expect(getQaPasswordCredentials({
      DEEPSPEC_AUTH_TEST_EMAIL: " qa@example.test ",
      DEEPSPEC_AUTH_TEST_PASSWORD: " test-password ",
    })).toEqual({ email: "qa@example.test", password: " test-password " });
  });

  it("reads the documented secondary QA credential prefix", () => {
    expect(getQaPasswordCredentials({
      DEEPSPEC_AUTH_TEST_OTHER_EMAIL: " other@example.test ",
      DEEPSPEC_AUTH_TEST_OTHER_PASSWORD: " other pass ",
    }, "DEEPSPEC_AUTH_TEST_OTHER")).toEqual({
      email: "other@example.test",
      password: " other pass ",
    });
  });

  it.each([undefined, "", " \t "])("rejects missing or blank secondary passwords: %j", (password) => {
    expect(getQaPasswordCredentials({
      DEEPSPEC_AUTH_TEST_OTHER_EMAIL: "other@example.test",
      DEEPSPEC_AUTH_TEST_OTHER_PASSWORD: password,
      DEEPSPEC_AUTH_TEST_EMAIL: "primary@example.test",
      DEEPSPEC_AUTH_TEST_PASSWORD: "primary password",
    }, "DEEPSPEC_AUTH_TEST_OTHER")).toBeNull();
  });

  it("passes significant secondary password bytes all the way to the login form", async () => {
    const credentials = getQaPasswordCredentials({
      DEEPSPEC_AUTH_TEST_OTHER_EMAIL: " other@example.test ",
      DEEPSPEC_AUTH_TEST_OTHER_PASSWORD: " \tSëcond Pass!\t ",
      DEEPSPEC_AUTH_TEST_PASSWORD: "primary password",
      DEEPSPEC_AUTH_TEST_PASSWORD_SECONDARY: "obsolete password",
    }, "DEEPSPEC_AUTH_TEST_OTHER");
    const email = { fill: vi.fn() };
    const password = { fill: vi.fn() };
    const page = {
      goto: vi.fn(),
      getByRole: vi.fn(() => ({ click: vi.fn() })),
      locator: vi.fn((selector) => selector === 'input[name="email"]' ? email : password),
      waitForURL: vi.fn(),
    };
    await signInWithQaPassword(page, "https://app.example.test/", credentials);
    expect(email.fill).toHaveBeenCalledWith("other@example.test");
    expect(password.fill).toHaveBeenCalledWith(" \tSëcond Pass!\t ");
    expect(page.waitForURL.mock.calls[0][0](new URL("https://app.example.test/scan"))).toBe(true);
    expect(page.waitForURL.mock.calls[0][0](new URL("https://app.example.test/auth"))).toBe(false);
  });
});
