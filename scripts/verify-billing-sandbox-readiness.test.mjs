import { describe, expect, it } from "vitest";
import { classifyBillingSandboxReadiness } from "./verify-billing-sandbox-readiness.mjs";

const VALID_POLAR_SANDBOX_ENV = {
  BILLING_PROVIDER: "polar",
  DEEPSPEC_ENABLE_LIVE_BILLING: "false",
  DEEPSPEC_PUBLIC_URL: "https://deepspec.app",
  POLAR_ACCESS_TOKEN: "polar_oat_test",
  POLAR_ENVIRONMENT: "sandbox",
  POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY: "11111111-1111-4111-8111-111111111111",
  POLAR_PRODUCT_DEEPSPEC_PLUS_YEARLY: "22222222-2222-4222-8222-222222222222",
  POLAR_PRODUCT_DEEPSPEC_SCAN_PACK: "33333333-3333-4333-8333-333333333333",
  POLAR_PRODUCT_DEEPSPEC_PRO_BETA: "44444444-4444-4444-8444-444444444444",
  POLAR_WEBHOOK_SECRET: `whsec_${Buffer.from("polar-webhook-secret").toString("base64")}`,
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

describe("classifyBillingSandboxReadiness", () => {
  it("passes when provider config, checkout, replay, and portal evidence pass", () => {
    const result = classifyBillingSandboxReadiness({
      checkoutSummary: PASSING_CHECKOUT_SUMMARY,
      env: VALID_POLAR_SANDBOX_ENV,
      webhookReplaySummary: PASSING_REPLAY_SUMMARY,
    });

    expect(result.ok).toBe(true);
    expect(result.recommendation).toBe("billing_sandbox_ready");
    expect(result.blockers).toEqual([]);
  });

  it("blocks when provider env is missing even if artifacts exist", () => {
    const result = classifyBillingSandboxReadiness({
      checkoutSummary: PASSING_CHECKOUT_SUMMARY,
      env: {},
      options: { provider: "polar" },
      webhookReplaySummary: PASSING_REPLAY_SUMMARY,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join("\n")).toContain("Missing POLAR_ACCESS_TOKEN");
  });

  it("blocks when checkout evidence is missing", () => {
    const result = classifyBillingSandboxReadiness({
      env: VALID_POLAR_SANDBOX_ENV,
      webhookReplaySummary: PASSING_REPLAY_SUMMARY,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join("\n")).toContain("Billing checkout summary is missing");
  });

  it("blocks when replay evidence is missing", () => {
    const result = classifyBillingSandboxReadiness({
      checkoutSummary: PASSING_CHECKOUT_SUMMARY,
      env: VALID_POLAR_SANDBOX_ENV,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join("\n")).toContain("Billing webhook replay summary is missing");
  });

  it("blocks when live billing is enabled during sandbox verification", () => {
    const result = classifyBillingSandboxReadiness({
      checkoutSummary: PASSING_CHECKOUT_SUMMARY,
      env: {
        ...VALID_POLAR_SANDBOX_ENV,
        DEEPSPEC_ENABLE_LIVE_BILLING: "true",
      },
      webhookReplaySummary: PASSING_REPLAY_SUMMARY,
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join("\n")).toContain("only allowed with --allow-production");
  });
});
