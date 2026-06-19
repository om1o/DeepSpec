import { describe, expect, it } from "vitest";
import { classifyCheckoutUrl } from "./verify-billing-checkout.mjs";

describe("classifyCheckoutUrl", () => {
  it("accepts Polar checkout URLs", () => {
    expect(classifyCheckoutUrl("https://polar.sh/checkout/session", "polar")).toEqual({
      ok: true,
      origin: "https://polar.sh",
    });
  });

  it("accepts Stripe checkout URLs", () => {
    expect(classifyCheckoutUrl("https://checkout.stripe.com/c/pay/session", "stripe")).toEqual({
      ok: true,
      origin: "https://checkout.stripe.com",
    });
  });

  it("rejects non-https checkout URLs", () => {
    expect(classifyCheckoutUrl("http://polar.sh/checkout/session", "polar")).toMatchObject({
      ok: false,
    });
  });

  it("rejects provider mismatches", () => {
    expect(classifyCheckoutUrl("https://checkout.stripe.com/c/pay/session", "polar")).toMatchObject({
      ok: false,
      message: expect.stringContaining("Expected a Polar checkout URL"),
    });
  });
});
