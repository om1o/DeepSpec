import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAccountEntitlementResponse,
  createCheckoutResponse,
  createPortalResponse,
  createWebhookResponse,
  listConfiguredPlans,
} from "./billing.shared";

const supabaseMock = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => supabaseMock);

describe("billing shared", () => {
  afterEach(() => {
    supabaseMock.createClient.mockReset();
    vi.unstubAllGlobals();
  });

  it("fails closed when Stripe checkout is not configured", async () => {
    await expect(createCheckoutResponse({ planId: "plus_monthly" }, {})).resolves.toMatchObject({
      status: 500,
      body: {
        error: {
          code: "not_configured",
        },
      },
    });
  });

  it("rejects unknown plans before contacting Stripe", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(createCheckoutResponse({ planId: "fake" }, {})).resolves.toMatchObject({
      status: 400,
      body: {
        error: {
          code: "invalid_plan",
        },
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("creates Stripe Checkout sessions with the configured price", async () => {
    supabaseMock.createClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "user-1" } },
          error: null,
        })),
      },
    });
    vi.stubGlobal("fetch", vi.fn(async (_url, init: { method?: string; body?: unknown }) => {
      expect(init.method).toBe("POST");
      expect(String(init.body)).toContain("mode=subscription");
      expect(String(init.body)).toContain("line_items%5B0%5D%5Bprice%5D=price_plus");
      expect(String(init.body)).toContain("client_reference_id=user-1");
      expect(String(init.body)).toContain("metadata%5Bsupabase_user_id%5D=user-1");
      return new Response(JSON.stringify({ url: "https://checkout.stripe.test/session" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    await expect(createCheckoutResponse(
      { planId: "plus_monthly", origin: "https://deepspec.app" },
      {
        BILLING_PROVIDER: "stripe",
        STRIPE_SECRET_KEY: "sk_test",
        STRIPE_PRICE_DEEPSPEC_PLUS_MONTHLY: "price_plus",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
        SUPABASE_URL: "https://deep-spec.supabase.co",
      },
      { authorization: "Bearer verified-token" },
    )).resolves.toEqual({
      status: 200,
      body: { url: "https://checkout.stripe.test/session" },
    });
  });

  it("requires a verified session before creating a configured checkout", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(createCheckoutResponse(
      { planId: "plus_monthly", origin: "https://deepspec.app" },
      {
        BILLING_PROVIDER: "stripe",
        STRIPE_SECRET_KEY: "sk_test",
        STRIPE_PRICE_DEEPSPEC_PLUS_MONTHLY: "price_plus",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
        SUPABASE_URL: "https://deep-spec.supabase.co",
      },
    )).resolves.toMatchObject({
      status: 401,
      body: {
        error: {
          code: "missing_session",
        },
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires a customer id for the customer portal", async () => {
    await expect(createPortalResponse({}, { BILLING_PROVIDER: "stripe", STRIPE_SECRET_KEY: "sk_test" })).resolves.toMatchObject({
      status: 400,
      body: {
        error: {
          code: "missing_customer",
        },
      },
    });
  });

  it("reports configured plan price ids without exposing secrets", () => {
    expect(listConfiguredPlans({
      STRIPE_SECRET_KEY: "sk_test",
      STRIPE_PRICE_DEEPSPEC_PLUS_MONTHLY: "price_plus",
    })).toContainEqual({ id: "plus_monthly", configured: true });
    expect(listConfiguredPlans({})).toContainEqual({ id: "plus_monthly", configured: false });
  });

  it("fails closed when account entitlement verification is not configured", async () => {
    await expect(createAccountEntitlementResponse({}, {})).resolves.toMatchObject({
      status: 500,
      body: {
        error: {
          code: "not_configured",
        },
      },
    });
  });

  it("requires a verified bearer token before reading account entitlement", async () => {
    await expect(createAccountEntitlementResponse({}, {
      SUPABASE_URL: "https://deep-spec.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
    })).resolves.toMatchObject({
      status: 401,
      body: {
        error: {
          code: "missing_session",
        },
      },
    });
  });

  it("returns active entitlement only from the server entitlement table", async () => {
    supabaseMock.createClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "user-1" } },
          error: null,
        })),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: {
                current_period_end: "2026-07-01T00:00:00.000Z",
                plan_id: "plus_monthly",
                scan_allowance: 100,
                scans_used: 12,
                status: "active",
              },
              error: null,
            })),
          })),
        })),
      })),
    });

    await expect(createAccountEntitlementResponse(
      { authorization: "Bearer verified-token" },
      {
        SUPABASE_URL: "https://deep-spec.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
      },
    )).resolves.toMatchObject({
      status: 200,
      body: {
        entitlement: {
          planId: "plus_monthly",
          planName: "DeepSpec Plus",
          scanAllowance: 100,
          scansUsed: 12,
          status: "active",
        },
      },
    });
  });

  it("fails closed when Stripe webhook verification is not configured", async () => {
    await expect(createWebhookResponse("{}", {}, {})).resolves.toMatchObject({
      status: 500,
      body: {
        error: {
          code: "not_configured",
        },
      },
    });
    expect(supabaseMock.createClient).not.toHaveBeenCalled();
  });

  it("rejects Stripe webhooks with an invalid signature before writing entitlements", async () => {
    const table = createBillingTableMock();
    supabaseMock.createClient.mockReturnValue({ from: table.from });

    await expect(createWebhookResponse("{}", { "stripe-signature": "t=1,v1=bad" }, webhookEnv())).resolves.toMatchObject({
      status: 400,
      body: {
        error: {
          code: "invalid_signature",
        },
      },
    });
    expect(supabaseMock.createClient).not.toHaveBeenCalled();
    expect(table.upsert).not.toHaveBeenCalled();
  });

  it("activates entitlement rows from completed Checkout sessions", async () => {
    const table = createBillingTableMock({ existingRow: { scan_allowance: 100, scans_used: 4 } });
    supabaseMock.createClient.mockReturnValue({ from: table.from });
    const body = JSON.stringify({
      data: {
        object: {
          customer: "cus_123",
          id: "cs_123",
          metadata: {
            deepspec_plan_id: "plus_monthly",
            supabase_user_id: "user-1",
          },
          payment_status: "paid",
          subscription: "sub_123",
        },
      },
      type: "checkout.session.completed",
    });

    await expect(createWebhookResponse(
      body,
      { "stripe-signature": signStripeBody(body) },
      webhookEnv(),
    )).resolves.toMatchObject({
      status: 200,
      body: {
        eventType: "checkout.session.completed",
        handled: true,
        received: true,
      },
    });

    expect(table.upsert).toHaveBeenCalledWith(expect.objectContaining({
      plan_id: "plus_monthly",
      scan_allowance: 100,
      scans_used: 4,
      status: "active",
      stripe_checkout_session_id: "cs_123",
      stripe_customer_id: "cus_123",
      stripe_subscription_id: "sub_123",
      provider_checkout_id: "cs_123",
      provider_customer_id: "cus_123",
      provider_subscription_id: "sub_123",
      user_id: "user-1",
    }), { onConflict: "user_id" });
  });

  it("adds one-time scan pack credits to an existing entitlement", async () => {
    const table = createBillingTableMock({ existingRow: { scan_allowance: 5, scans_used: 2 } });
    supabaseMock.createClient.mockReturnValue({ from: table.from });
    const body = JSON.stringify({
      data: {
        object: {
          client_reference_id: "user-1",
          customer: "cus_123",
          id: "cs_pack",
          metadata: {
            deepspec_plan_id: "scan_pack",
          },
          payment_status: "paid",
        },
      },
      type: "checkout.session.completed",
    });

    await createWebhookResponse(body, { "stripe-signature": signStripeBody(body) }, webhookEnv());

    expect(table.upsert).toHaveBeenCalledWith(expect.objectContaining({
      plan_id: "scan_pack",
      scan_allowance: 25,
      scans_used: 2,
      status: "active",
      user_id: "user-1",
    }), { onConflict: "user_id" });
  });

  it("updates entitlement status from later subscription events without trusting the browser", async () => {
    const table = createBillingTableMock();
    supabaseMock.createClient.mockReturnValue({ from: table.from });
    const body = JSON.stringify({
      data: {
        object: {
          customer: "cus_123",
          current_period_end: 1782000000,
          id: "sub_123",
          status: "canceled",
        },
      },
      type: "customer.subscription.deleted",
    });

    await expect(createWebhookResponse(
      body,
      { "stripe-signature": signStripeBody(body) },
      webhookEnv(),
    )).resolves.toMatchObject({
      status: 200,
      body: {
        eventType: "customer.subscription.deleted",
        handled: true,
        received: true,
      },
    });

    expect(table.update).toHaveBeenCalledWith(expect.objectContaining({
      current_period_end: "2026-06-21T00:00:00.000Z",
      billing_provider: "stripe",
      provider_customer_id: "cus_123",
      provider_subscription_id: "sub_123",
      status: "canceled",
      stripe_customer_id: "cus_123",
      stripe_subscription_id: "sub_123",
    }));
    expect(table.updateEq).toHaveBeenCalledWith("provider_subscription_id", "sub_123");
  });
});

function webhookEnv() {
  return {
    BILLING_PROVIDER: "stripe",
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    SUPABASE_URL: "https://deep-spec.supabase.co",
  };
}

function signStripeBody(body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", webhookEnv().STRIPE_WEBHOOK_SECRET)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function createBillingTableMock({ existingRow = null }: { existingRow?: Record<string, unknown> | null } = {}) {
  const maybeSingle = vi.fn(async () => ({ data: existingRow, error: null }));
  const selectEq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq: selectEq }));
  const upsert = vi.fn(async () => ({ error: null }));
  const updateEq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const from = vi.fn(() => ({
    select,
    update,
    upsert,
  }));

  return {
    from,
    select,
    selectEq,
    maybeSingle,
    update,
    updateEq,
    upsert,
  };
}
