import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildPolarOrderPaidPayload,
  classifyProviderPortalUrl,
  signStandardWebhookBody,
} from "./verify-billing-webhook-replay.mjs";

describe("billing webhook replay helpers", () => {
  it("builds a paid Polar order payload with DeepSpec entitlement metadata", () => {
    const payload = buildPolarOrderPaidPayload({
      planId: "scan_pack",
      testId: "test-123",
      timestamp: "2026-06-19T00:00:00.000Z",
      userId: "00000000-0000-4000-8000-000000000001",
    });

    expect(payload).toMatchObject({
      data: {
        checkout_id: "polar-checkout-test-123",
        customer: {
          external_id: "00000000-0000-4000-8000-000000000001",
        },
        metadata: {
          deepspec_plan_id: "scan_pack",
          scan_allowance: 20,
          supabase_user_id: "00000000-0000-4000-8000-000000000001",
        },
        paid: true,
      },
      timestamp: "2026-06-19T00:00:00.000Z",
      type: "order.paid",
    });
  });

  it("signs webhook bodies with the Standard Webhooks HMAC format", () => {
    const rawBody = JSON.stringify({ data: { id: "order_1" }, type: "order.paid" });
    const secret = Buffer.from("polar-webhook-secret").toString("base64");
    const headers = signStandardWebhookBody(rawBody, `whsec_${secret}`, {
      timestamp: 1782000000,
      webhookId: "msg_test",
    });
    const expectedSignature = createHmac("sha256", Buffer.from("polar-webhook-secret"))
      .update(`msg_test.1782000000.${rawBody}`, "utf8")
      .digest("base64");

    expect(headers).toEqual({
      "webhook-id": "msg_test",
      "webhook-signature": `v1,${expectedSignature}`,
      "webhook-timestamp": "1782000000",
    });
  });

  it("rejects unsupported DeepSpec plans", () => {
    expect(() => buildPolarOrderPaidPayload({
      planId: "fake",
      userId: "00000000-0000-4000-8000-000000000001",
    })).toThrow("Unsupported plan id");
  });

  it("accepts HTTPS provider-owned Polar portal URLs", () => {
    expect(classifyProviderPortalUrl("https://polar.sh/customer-portal/session", "polar")).toEqual({
      ok: true,
      message: "Billing portal response URL is provider-owned and HTTPS.",
      origin: "https://polar.sh",
    });
  });

  it("rejects non-provider billing portal URLs", () => {
    expect(classifyProviderPortalUrl("https://example.com/customer-portal/session", "polar")).toEqual({
      ok: false,
      message: "Billing portal response host mismatch: expected polar.sh, got example.com.",
      origin: "",
    });
  });

  it("rejects lookalike provider billing portal domains", () => {
    expect(classifyProviderPortalUrl("https://fakepolar.sh/customer-portal/session", "polar")).toEqual({
      ok: false,
      message: "Billing portal response host mismatch: expected polar.sh, got fakepolar.sh.",
      origin: "",
    });
  });

  it("rejects insecure billing portal URLs", () => {
    expect(classifyProviderPortalUrl("http://polar.sh/customer-portal/session", "polar")).toEqual({
      ok: false,
      message: "Billing portal response URL must use HTTPS.",
      origin: "",
    });
  });
});
