import { describe, expect, it } from "vitest";
import {
  classifyDadPhonePaidBetaReadiness,
  classifyPublicPhoneUrl,
  classifyWebsiteQa,
} from "./verify-dad-phone-paid-beta.mjs";

const PASSING_WEBSITE_QA = {
  failed: [],
  passed: [
    "auth-login",
    "scanner",
    "scanner-ai-engine",
    "saved-history",
    "result-detail",
    "result-chat",
    "shop-onboarding",
    "billing-provider-fail-closed",
  ],
  viewport: { name: "mobile-emulated" },
};

const PASSING_BILLING = {
  blockers: [],
  checks: ["Billing sandbox passed."],
  ok: true,
  warnings: [],
};

const PASSING_IDENTIFY = {
  message: "Identify eval passed: 50/50 samples passed with provider available.",
  ok: true,
};

describe("classifyPublicPhoneUrl", () => {
  it("blocks localhost phone URLs", () => {
    const result = classifyPublicPhoneUrl("http://127.0.0.1:5175");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("HTTPS");
  });

  it("allows public HTTPS preview URLs", () => {
    const result = classifyPublicPhoneUrl("https://deepspec-preview.vercel.app");

    expect(result.ok).toBe(true);
    expect(result.host).toBe("deepspec-preview.vercel.app");
  });
});

describe("classifyWebsiteQa", () => {
  it("passes when the Dad-phone scenario set passed", () => {
    expect(classifyWebsiteQa(PASSING_WEBSITE_QA)).toMatchObject({ ok: true });
  });

  it("blocks when a required scenario is missing", () => {
    const result = classifyWebsiteQa({ ...PASSING_WEBSITE_QA, passed: ["auth-login"] });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("scanner-ai-engine");
  });
});

describe("classifyDadPhonePaidBetaReadiness", () => {
  it("allows Dad phone testing only after public HTTPS and website QA pass", () => {
    const result = classifyDadPhonePaidBetaReadiness({
      publicUrl: "https://deepspec-preview.vercel.app",
      websiteQa: classifyWebsiteQa(PASSING_WEBSITE_QA),
    });

    expect(result.ok).toBe(true);
    expect(result.recommendation).toBe("dad_phone_test_may_continue");
    expect(result.warnings.join("\n")).toContain("Real physical phone scan is still manual evidence");
  });

  it("blocks paid beta without real phone grade", () => {
    const result = classifyDadPhonePaidBetaReadiness({
      billingSandbox: PASSING_BILLING,
      identifyRelease: PASSING_IDENTIFY,
      options: { target: "paid-beta" },
      publicUrl: "https://deepspec-preview.vercel.app",
      websiteQa: classifyWebsiteQa(PASSING_WEBSITE_QA),
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join("\n")).toContain("Real phone QA must be graded");
  });

  it("allows paid beta only when phone, billing, identify, URL, and website QA pass", () => {
    const result = classifyDadPhonePaidBetaReadiness({
      billingSandbox: PASSING_BILLING,
      identifyRelease: PASSING_IDENTIFY,
      options: { target: "paid-beta" },
      phoneEvidence: { grade: 9 },
      publicUrl: "https://deepspec-preview.vercel.app",
      websiteQa: classifyWebsiteQa(PASSING_WEBSITE_QA),
    });

    expect(result.ok).toBe(true);
    expect(result.recommendation).toBe("paid_beta_may_continue");
  });
});
