import { describe, expect, it } from "vitest";

import { classifyIdentifyApiIssue } from "./qa-utils.mjs";

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
