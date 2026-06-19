import { describe, expect, it } from "vitest";
import { classifyPaidLaunchReadiness } from "./verify-paid-launch-readiness.mjs";

const VALID_POLAR_ENV = {
  BILLING_PROVIDER: "polar",
  DEEPSPEC_ENABLE_LIVE_BILLING: "true",
  DEEPSPEC_PUBLIC_URL: "https://deepspec.app",
  POLAR_ACCESS_TOKEN: "polar_oat_test",
  POLAR_ENVIRONMENT: "production",
  POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY: "11111111-1111-4111-8111-111111111111",
  POLAR_PRODUCT_DEEPSPEC_PLUS_YEARLY: "22222222-2222-4222-8222-222222222222",
  POLAR_PRODUCT_DEEPSPEC_SCAN_PACK: "33333333-3333-4333-8333-333333333333",
  POLAR_PRODUCT_DEEPSPEC_PRO_BETA: "44444444-4444-4444-8444-444444444444",
  POLAR_WEBHOOK_SECRET: `whsec_${Buffer.from("polar-webhook-secret").toString("base64")}`,
};

const PASSING_IDENTIFY_SUMMARY = {
  attemptedCount: 50,
  failureCount: 0,
  passCount: 50,
  providerFailureCount: 0,
  providerStatus: "available",
  sampleSize: 50,
  skippedCount: 0,
};

const BLOCKED_IDENTIFY_SUMMARY = {
  attemptedCount: 1,
  passCount: 0,
  providerFailureCount: 1,
  providerStatus: "blocked",
  sampleSize: 50,
  skippedCount: 49,
  stoppedEarlyReason: "provider_availability",
};

const PASSING_REPLAY_SUMMARY = {
  ok: true,
  planId: "scan_pack",
  provider: "polar",
  scanAllowance: 20,
  verifiedAt: "2026-06-19T00:00:00.000Z",
};

const PASSING_QA_REPORT = `# DeepSpec Real Website QA Report

## What Passed
- billing-provider-fail-closed

## What Failed
- None
`;

describe("classifyPaidLaunchReadiness", () => {
  it("blocks live launch when identify release is provider-blocked", () => {
    const result = classifyPaidLaunchReadiness({
      env: VALID_POLAR_ENV,
      identifySummary: BLOCKED_IDENTIFY_SUMMARY,
      options: { target: "live" },
      websiteQaReportText: PASSING_QA_REPORT,
      webhookReplaySummary: PASSING_REPLAY_SUMMARY,
    });

    expect(result.ok).toBe(false);
    expect(result.recommendation).toBe("sandbox_only");
    expect(result.blockers.join("\n")).toContain("Provider unavailable");
  });

  it("blocks live launch when the billing replay summary is missing", () => {
    const result = classifyPaidLaunchReadiness({
      env: VALID_POLAR_ENV,
      identifySummary: PASSING_IDENTIFY_SUMMARY,
      options: { target: "live" },
      websiteQaReportText: PASSING_QA_REPORT,
      webhookReplaySummary: null,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join("\n")).toContain("Billing webhook replay summary is missing");
  });

  it("blocks sandbox readiness when the live flag is enabled", () => {
    const result = classifyPaidLaunchReadiness({
      env: {
        ...VALID_POLAR_ENV,
        POLAR_ENVIRONMENT: "sandbox",
      },
      identifySummary: PASSING_IDENTIFY_SUMMARY,
      options: { target: "sandbox" },
      websiteQaReportText: PASSING_QA_REPORT,
      webhookReplaySummary: PASSING_REPLAY_SUMMARY,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join("\n")).toContain("DEEPSPEC_ENABLE_LIVE_BILLING=true");
  });

  it("allows live launch only when billing, identify, replay, and QA evidence all pass", () => {
    const result = classifyPaidLaunchReadiness({
      env: VALID_POLAR_ENV,
      identifySummary: PASSING_IDENTIFY_SUMMARY,
      options: { target: "live" },
      websiteQaReportText: PASSING_QA_REPORT,
      webhookReplaySummary: PASSING_REPLAY_SUMMARY,
    });

    expect(result.ok).toBe(true);
    expect(result.recommendation).toBe("live_allowed");
    expect(result.blockers).toEqual([]);
  });
});
