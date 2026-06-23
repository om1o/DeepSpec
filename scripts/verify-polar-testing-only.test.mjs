import { describe, expect, it } from "vitest";
import { classifyPolarTestingOnly } from "./verify-polar-testing-only.mjs";

const VALID_POLAR_ENV = {
  BILLING_PROVIDER: "polar",
  DEEPSPEC_ENABLE_LIVE_BILLING: "false",
  DEEPSPEC_PUBLIC_URL: "https://deepspec-preview.vercel.app",
  POLAR_ACCESS_TOKEN: "polar_oat_test",
  POLAR_ENVIRONMENT: "sandbox",
  POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY: "11111111-1111-4111-8111-111111111111",
  POLAR_PRODUCT_DEEPSPEC_PLUS_YEARLY: "22222222-2222-4222-8222-222222222222",
  POLAR_PRODUCT_DEEPSPEC_SCAN_PACK: "33333333-3333-4333-8333-333333333333",
  POLAR_PRODUCT_DEEPSPEC_PRO_BETA: "44444444-4444-4444-8444-444444444444",
  POLAR_WEBHOOK_SECRET: `whsec_${Buffer.from("polar-webhook-secret").toString("base64")}`,
};

describe("classifyPolarTestingOnly", () => {
  it("accepts complete Polar sandbox config with live billing off", () => {
    const result = classifyPolarTestingOnly(VALID_POLAR_ENV);

    expect(result.ok).toBe(true);
    expect(result.recommendation).toBe("polar_testing_ready");
    expect(result.checks.join("\n")).toContain("No Stripe env values are present");
  });

  it("blocks Stripe env values even when Polar is configured", () => {
    const result = classifyPolarTestingOnly({
      ...VALID_POLAR_ENV,
      STRIPE_SECRET_KEY: "sk_test_not_allowed",
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join("\n")).toContain("Remove Stripe env values");
  });

  it("blocks live billing during Polar testing", () => {
    const result = classifyPolarTestingOnly({
      ...VALID_POLAR_ENV,
      DEEPSPEC_ENABLE_LIVE_BILLING: "true",
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join("\n")).toContain("must stay false");
  });

  it("requires BILLING_PROVIDER=polar", () => {
    const result = classifyPolarTestingOnly({
      ...VALID_POLAR_ENV,
      BILLING_PROVIDER: "",
    });

    expect(result.ok).toBe(false);
    expect(result.blockers.join("\n")).toContain("BILLING_PROVIDER=polar");
  });
});
