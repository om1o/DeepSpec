import { describe, expect, it } from "vitest";

import { classifyIdentifyApiIssue, classifyQaTransportError, getAuthDependencyBlocker } from "./qa-utils.mjs";

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
