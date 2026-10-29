import { describe, expect, it } from "vitest";
import { isGuestPreviewRequest } from "./guestPreview.shared";

const PREVIEW = { DEEPSPEC_GUEST_PREVIEW: "true", VERCEL_ENV: "preview", NODE_ENV: "production" };

describe("real guest preview request", () => {
  it("allows account-free requests only for the explicitly enabled preview", () => {
    expect(isGuestPreviewRequest({}, PREVIEW)).toBe(true);
    expect(isGuestPreviewRequest({ "x-forwarded-for": "192.0.2.1" }, PREVIEW)).toBe(true);
  });

  it.each([undefined, "false", "TRUE", " true "])("stays closed unless the exact server flag is enabled (%s)", (flag) => {
    expect(isGuestPreviewRequest({ "x-deepspec-guest-preview": "true" }, { ...PREVIEW, DEEPSPEC_GUEST_PREVIEW: flag })).toBe(false);
  });

  it.each([undefined, "production", "development", "Preview"])("never opens outside the explicit Vercel preview tier (%s)", (tier) => {
    expect(isGuestPreviewRequest({}, { ...PREVIEW, VERCEL_ENV: tier })).toBe(false);
  });

  it.each([
    { authorization: "Bearer real-session" },
    { Authorization: "Bearer invalid-session" },
    { AUTHORIZATION: "" },
    { authorization: [] },
    { authorization: "   " },
  ])("keeps any supplied authorization on the normal verification path (%j)", (headers) => {
    expect(isGuestPreviewRequest(headers, PREVIEW)).toBe(false);
  });
});
