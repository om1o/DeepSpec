import { describe, expect, it } from "vitest";
import { verifyBillingProviderConfig } from "./verify-billing-provider.mjs";

const VALID_POLAR_ENV = {
  BILLING_PROVIDER: "polar",
  DEEPSPEC_PUBLIC_URL: "https://deepspec.app",
  POLAR_ACCESS_TOKEN: "polar_oat_test",
  POLAR_ENVIRONMENT: "sandbox",
  POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY: "11111111-1111-4111-8111-111111111111",
  POLAR_PRODUCT_DEEPSPEC_PLUS_YEARLY: "22222222-2222-4222-8222-222222222222",
  POLAR_PRODUCT_DEEPSPEC_SCAN_PACK: "33333333-3333-4333-8333-333333333333",
  POLAR_PRODUCT_DEEPSPEC_PRO_BETA: "44444444-4444-4444-8444-444444444444",
  POLAR_WEBHOOK_SECRET: `whsec_${Buffer.from("polar-webhook-secret").toString("base64")}`,
};

describe("verifyBillingProviderConfig", () => {
  it("fails closed when no billing provider is configured", () => {
    const result = verifyBillingProviderConfig({});

    expect(result.ok).toBe(false);
    expect(result.issues.join("\n")).toContain("BILLING_PROVIDER");
  });

  it("accepts a complete Polar sandbox setup", () => {
    const result = verifyBillingProviderConfig(VALID_POLAR_ENV);

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("polar");
    expect(result.issues).toEqual([]);
  });

  it("blocks Polar production checks unless explicitly allowed", () => {
    const result = verifyBillingProviderConfig({
      ...VALID_POLAR_ENV,
      POLAR_ENVIRONMENT: "production",
    });

    expect(result.ok).toBe(false);
    expect(result.issues.join("\n")).toContain("--allow-production");
  });

  it("rejects Polar product ids that are not UUIDs", () => {
    const result = verifyBillingProviderConfig({
      ...VALID_POLAR_ENV,
      POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY: "prod_plus",
    });

    expect(result.ok).toBe(false);
    expect(result.issues.join("\n")).toContain("must be a Polar product UUID");
  });

  it("fails when provider secrets are exposed through Vite env variables", () => {
    const result = verifyBillingProviderConfig({
      ...VALID_POLAR_ENV,
      VITE_POLAR_ACCESS_TOKEN: "leaked",
    });

    expect(result.ok).toBe(false);
    expect(result.issues.join("\n")).toContain("VITE_POLAR_ACCESS_TOKEN must not exist");
  });

  it("accepts a complete Stripe test setup", () => {
    const result = verifyBillingProviderConfig({
      BILLING_PROVIDER: "stripe",
      DEEPSPEC_PUBLIC_URL: "https://deepspec.app",
      STRIPE_PRICE_DEEPSPEC_PLUS_MONTHLY: "price_plus_monthly",
      STRIPE_PRICE_DEEPSPEC_PLUS_YEARLY: "price_plus_yearly",
      STRIPE_PRICE_DEEPSPEC_SCAN_PACK: "price_scan_pack",
      STRIPE_PRICE_DEEPSPEC_PRO_BETA: "price_pro_beta",
      STRIPE_SECRET_KEY: "sk_test_123",
      STRIPE_WEBHOOK_SECRET: "whsec_test",
    });

    expect(result.ok).toBe(true);
    expect(result.provider).toBe("stripe");
  });
});
