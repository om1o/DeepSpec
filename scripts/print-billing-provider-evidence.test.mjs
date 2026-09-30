import { describe, expect, it } from "vitest";
import { buildBillingProviderEvidence } from "./print-billing-provider-evidence.mjs";

const VALID_POLAR_SANDBOX_ENV = {
  BILLING_PROVIDER: "polar",
  DEEPSPEC_ENABLE_LIVE_BILLING: "false",
  DEEPSPEC_PUBLIC_URL: "https://deepspec.app",
  POLAR_ACCESS_TOKEN: "polar_oat_secret_test",
  POLAR_ENVIRONMENT: "sandbox",
  POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY: "11111111-1111-4111-8111-111111111111",
  POLAR_PRODUCT_DEEPSPEC_PLUS_YEARLY: "22222222-2222-4222-8222-222222222222",
  POLAR_PRODUCT_DEEPSPEC_SCAN_PACK: "33333333-3333-4333-8333-333333333333",
  POLAR_PRODUCT_DEEPSPEC_PRO_BETA: "44444444-4444-4444-8444-444444444444",
  POLAR_WEBHOOK_SECRET: `whsec_${Buffer.from("polar-webhook-secret").toString("base64")}`,
};

const LIVE_POLAR_ENV = {
  ...VALID_POLAR_SANDBOX_ENV,
  DEEPSPEC_ENABLE_LIVE_BILLING: "true",
  POLAR_ENVIRONMENT: "production",
};

const PASSING_CHECKOUT_SUMMARY = {
  checkoutOrigin: "https://polar.sh",
  ok: true,
  planId: "scan_pack",
  provider: "polar",
  verifiedAt: "2026-06-19T00:00:00.000Z",
};

const PASSING_REPLAY_SUMMARY = {
  ok: true,
  planId: "scan_pack",
  portalOrigin: "https://polar.sh",
  portalVerified: true,
  provider: "polar",
  scanAllowance: 20,
  verifiedAt: "2026-06-19T00:00:00.000Z",
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

const PASSING_QA_REPORT = `# DeepSpec Real Website QA Report

## What Passed
- billing-provider-fail-closed

## What Failed
- None
`;

describe("buildBillingProviderEvidence", () => {
  it("reports billing sandbox ready while live payments remain blocked", () => {
    const { evidence, markdown } = buildBillingProviderEvidence({
      checkoutSummary: PASSING_CHECKOUT_SUMMARY,
      env: VALID_POLAR_SANDBOX_ENV,
      generatedAt: "2026-06-19T00:00:00.000Z",
      identifySummary: PASSING_IDENTIFY_SUMMARY,
      options: { provider: "polar" },
      websiteQaReportText: PASSING_QA_REPORT,
      webhookReplaySummary: PASSING_REPLAY_SUMMARY,
    });

    expect(evidence.sandboxBillingReady).toBe(true);
    expect(evidence.livePaymentsAllowed).toBe(false);
    expect(evidence.recommendation).toBe("billing_sandbox_ready_live_blocked");
    expect(markdown).toContain("Billing sandbox ready: yes");
    expect(markdown).toContain("Live payments allowed: no");
  });

  it("reports live payments allowed only when the live gate passes", () => {
    const { evidence } = buildBillingProviderEvidence({
      checkoutSummary: PASSING_CHECKOUT_SUMMARY,
      env: LIVE_POLAR_ENV,
      generatedAt: "2026-06-19T00:00:00.000Z",
      identifySummary: PASSING_IDENTIFY_SUMMARY,
      options: { provider: "polar" },
      websiteQaReportText: PASSING_QA_REPORT,
      webhookReplaySummary: PASSING_REPLAY_SUMMARY,
    });

    expect(evidence.livePaymentsAllowed).toBe(true);
    expect(evidence.recommendation).toBe("live_payments_allowed");
  });

  it("redacts provider secret and product values from generated evidence", () => {
    const invalidProduct = "prod_fake_secret";
    const { markdown } = buildBillingProviderEvidence({
      checkoutSummary: PASSING_CHECKOUT_SUMMARY,
      env: {
        ...VALID_POLAR_SANDBOX_ENV,
        POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY: invalidProduct,
      },
      generatedAt: "2026-06-19T00:00:00.000Z",
      identifySummary: PASSING_IDENTIFY_SUMMARY,
      options: { provider: "polar" },
      websiteQaReportText: PASSING_QA_REPORT,
      webhookReplaySummary: PASSING_REPLAY_SUMMARY,
    });

    expect(markdown).not.toContain(VALID_POLAR_SANDBOX_ENV.POLAR_ACCESS_TOKEN);
    expect(markdown).not.toContain(VALID_POLAR_SANDBOX_ENV.POLAR_WEBHOOK_SECRET);
    expect(markdown).not.toContain(invalidProduct);
    expect(markdown).toContain("<redacted POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY>");
  });
});
