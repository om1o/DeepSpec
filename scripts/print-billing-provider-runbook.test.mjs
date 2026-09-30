import { describe, expect, it } from "vitest";
import { buildBillingProviderRunbook } from "./print-billing-provider-runbook.mjs";

const VALID_POLAR_ENV = {
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

describe("buildBillingProviderRunbook", () => {
  it("prints a kid-safe Polar sandbox runbook", () => {
    const runbook = buildBillingProviderRunbook({}, { provider: "polar" });

    expect(runbook).toContain("Recommended setup now: Polar sandbox.");
    expect(runbook).toContain("Dad Owns");
    expect(runbook).toContain("Kid Can Do");
    expect(runbook).toContain("npm run verify:billing-provider -- --provider polar");
    expect(runbook).toContain("npm run verify:billing-checkout -- --provider polar --url <preview-url> --plan scan_pack");
    expect(runbook).toContain("npm run verify:billing-sandbox-readiness -- --provider polar");
    expect(runbook).toContain("npm run billing:evidence -- --provider polar");
    expect(runbook).toContain("Live payments now: no.");
  });

  it("does not print configured provider secret values", () => {
    const runbook = buildBillingProviderRunbook(VALID_POLAR_ENV, { provider: "polar" });

    expect(runbook).not.toContain(VALID_POLAR_ENV.POLAR_ACCESS_TOKEN);
    expect(runbook).not.toContain(VALID_POLAR_ENV.POLAR_WEBHOOK_SECRET);
    expect(runbook).not.toContain(VALID_POLAR_ENV.POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY);
    expect(runbook).toContain("sandbox config ready for provider checks");
  });

  it("redacts invalid provider values embedded in verifier issues", () => {
    const runbook = buildBillingProviderRunbook({
      ...VALID_POLAR_ENV,
      POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY: "prod_fake_secret",
    }, { provider: "polar" });

    expect(runbook).toContain("<redacted POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY>");
    expect(runbook).not.toContain("prod_fake_secret");
  });

  it("prints the Stripe webhook replay command for the legacy Stripe path", () => {
    const runbook = buildBillingProviderRunbook({
      BILLING_PROVIDER: "stripe",
      STRIPE_PRICE_DEEPSPEC_PLUS_MONTHLY: "price_plus_monthly",
      STRIPE_PRICE_DEEPSPEC_PLUS_YEARLY: "price_plus_yearly",
      STRIPE_PRICE_DEEPSPEC_SCAN_PACK: "price_scan_pack",
      STRIPE_PRICE_DEEPSPEC_PRO_BETA: "price_pro_beta",
      STRIPE_SECRET_KEY: "sk_test_secret",
      STRIPE_WEBHOOK_SECRET: "whsec_secret",
    }, { provider: "stripe" });

    expect(runbook).toContain("npm run verify:billing-webhook-replay -- --provider stripe");
    expect(runbook).toContain("--url <preview-url>");
    expect(runbook).not.toContain("sk_test_secret");
  });
});
