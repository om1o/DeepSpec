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
    vi.useRealTimers();
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

  it("rejects unknown plans before contacting the billing provider", async () => {
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
          data: { user: { id: "user-1", email_confirmed_at: "2026-07-01T00:00:00.000Z" } },
          error: null,
        })),
      },
    });
    vi.stubGlobal("fetch", vi.fn(async (_url, init: { method?: string; body?: unknown; signal?: AbortSignal }) => {
      expect(init.method).toBe("POST");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const params = new URLSearchParams(String(init.body));
      expect(params.get("mode")).toBe("subscription");
      expect(params.get("line_items[0][price]")).toBe("price_plus");
      expect(params.get("client_reference_id")).toBe("user-1");
      expect(params.get("metadata[supabase_user_id]")).toBe("user-1");
      expect(params.get("success_url")).toBe("https://deepspec.app/account?checkout=success");
      expect(params.get("cancel_url")).toBe("https://deepspec.app/pricing?checkout=cancelled");
      expect(String(init.body)).not.toContain("attacker.example");
      return new Response(JSON.stringify({ url: "https://checkout.stripe.test/session" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    await expect(createCheckoutResponse(
      { planId: "plus_monthly", origin: "https://attacker.example" },
      {
        BILLING_PROVIDER: "stripe",
        DEEPSPEC_PUBLIC_URL: "https://deepspec.app/",
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

  it("creates Polar checkout sessions with provider products and metadata", async () => {
    supabaseMock.createClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "user-1", email_confirmed_at: "2026-07-01T00:00:00.000Z" } },
          error: null,
        })),
      },
    });
    vi.stubGlobal("fetch", vi.fn(async (url, init: { body?: unknown; headers?: Record<string, string>; method?: string; signal?: AbortSignal }) => {
      expect(url).toBe("https://sandbox-api.polar.sh/v1/checkouts/");
      expect(init.method).toBe("POST");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.headers?.Authorization).toBe("Bearer polar-token");
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({
        allow_discount_codes: true,
        external_customer_id: "user-1",
        products: ["polar-product-plus"],
        metadata: {
          deepspec_plan_id: "plus_monthly",
          scan_allowance: 100,
          supabase_user_id: "user-1",
        },
      });
      expect(body.success_url).toContain("checkout_id={CHECKOUT_ID}");
      expect(body.success_url).toBe("https://deepspec.app/account?checkout=success&checkout_id={CHECKOUT_ID}");
      expect(body.return_url).toBe("https://deepspec.app/pricing?checkout=cancelled");
      expect(JSON.stringify(body)).not.toContain("attacker.example");
      return new Response(JSON.stringify({ url: "https://polar.sh/checkout/session" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }));

    await expect(createCheckoutResponse(
      { planId: "plus_monthly", origin: "https://attacker.example" },
      {
        BILLING_PROVIDER: "polar",
        DEEPSPEC_PUBLIC_URL: "https://deepspec.app",
        POLAR_ACCESS_TOKEN: "polar-token",
        POLAR_ENVIRONMENT: "sandbox",
        POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY: "polar-product-plus",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
        SUPABASE_URL: "https://deep-spec.supabase.co",
      },
      { authorization: "Bearer verified-token" },
    )).resolves.toEqual({
      status: 200,
      body: { url: "https://polar.sh/checkout/session" },
    });
  });

  it("blocks Polar production checkout unless live billing is explicitly enabled", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(createCheckoutResponse(
      { planId: "plus_monthly", origin: "https://deepspec.app" },
      {
        BILLING_PROVIDER: "polar",
        DEEPSPEC_PUBLIC_URL: "https://deepspec.app",
        POLAR_ACCESS_TOKEN: "polar-token",
        POLAR_ENVIRONMENT: "production",
        POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY: "polar-product-plus",
      },
      { authorization: "Bearer verified-token" },
    )).resolves.toMatchObject({
      status: 403,
      body: {
        error: {
          code: "live_billing_disabled",
        },
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(supabaseMock.createClient).not.toHaveBeenCalled();
  });

  it("allows Polar production checkout only behind the live billing flag", async () => {
    supabaseMock.createClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "user-1", email_confirmed_at: "2026-07-01T00:00:00.000Z" } },
          error: null,
        })),
      },
    });
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      expect(url).toBe("https://api.polar.sh/v1/checkouts/");
      return new Response(JSON.stringify({ url: "https://polar.sh/checkout/live-session" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }));

    await expect(createCheckoutResponse(
      { planId: "plus_monthly", origin: "https://deepspec.app" },
      {
        BILLING_PROVIDER: "polar",
        DEEPSPEC_PUBLIC_URL: "https://deepspec.app",
        DEEPSPEC_ENABLE_LIVE_BILLING: "true",
        POLAR_ACCESS_TOKEN: "polar-token",
        POLAR_ENVIRONMENT: "production",
        POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY: "polar-product-plus",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
        SUPABASE_URL: "https://deep-spec.supabase.co",
      },
      { authorization: "Bearer verified-token" },
    )).resolves.toEqual({
      status: 200,
      body: { url: "https://polar.sh/checkout/live-session" },
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

  it("blocks Stripe live checkout unless live billing is explicitly enabled", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(createCheckoutResponse(
      { planId: "plus_monthly", origin: "https://deepspec.app" },
      {
        BILLING_PROVIDER: "stripe",
        STRIPE_SECRET_KEY: "sk_live_123",
      },
      { authorization: "Bearer verified-token" },
    )).resolves.toMatchObject({
      status: 403,
      body: {
        error: {
          code: "live_billing_disabled",
        },
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(supabaseMock.createClient).not.toHaveBeenCalled();
  });

  it("requires a verified session before opening a billing portal", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(createPortalResponse({}, {
      BILLING_PROVIDER: "stripe",
      STRIPE_SECRET_KEY: "sk_test",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_URL: "https://deep-spec.supabase.co",
    })).resolves.toMatchObject({
      status: 401,
      body: {
        error: {
          code: "missing_session",
        },
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("opens a Stripe customer portal only from the server entitlement customer", async () => {
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
                billing_provider: "stripe",
                provider_customer_id: "cus_server",
                stripe_customer_id: "cus_legacy",
              },
              error: null,
            })),
          })),
        })),
      })),
    });
    vi.stubGlobal("fetch", vi.fn(async (_url, init: { body?: unknown; signal?: AbortSignal }) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const params = new URLSearchParams(String(init.body));
      expect(params.get("customer")).toBe("cus_server");
      expect(params.get("return_url")).toBe("https://deepspec.app/account");
      expect(String(init.body)).not.toContain("cus_attacker");
      expect(String(init.body)).not.toContain("attacker.example");
      return new Response(JSON.stringify({ url: "https://billing.stripe.test/session" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }));

    await expect(createPortalResponse(
      { origin: "https://attacker.example", stripeCustomerId: "cus_attacker" },
      {
        BILLING_PROVIDER: "stripe",
        DEEPSPEC_PUBLIC_URL: "https://deepspec.app",
        STRIPE_SECRET_KEY: "sk_test",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
        SUPABASE_URL: "https://deep-spec.supabase.co",
      },
      { authorization: "Bearer verified-token" },
    )).resolves.toMatchObject({
      status: 200,
      body: { url: "https://billing.stripe.test/session" },
    });
  });

  it("opens a Polar customer portal from the verified account", async () => {
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
                billing_provider: "polar",
                provider_customer_id: "polar-customer-1",
              },
              error: null,
            })),
          })),
        })),
      })),
    });
    vi.stubGlobal("fetch", vi.fn(async (url, init: { body?: unknown; headers?: Record<string, string>; method?: string; signal?: AbortSignal }) => {
      expect(url).toBe("https://sandbox-api.polar.sh/v1/customer-sessions/");
      expect(init.method).toBe("POST");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.headers?.Authorization).toBe("Bearer polar-token");
      expect(JSON.parse(String(init.body))).toMatchObject({
        customer_id: "polar-customer-1",
        return_url: "https://deepspec.app/account",
      });
      return new Response(JSON.stringify({ customer_portal_url: "https://polar.sh/customer-portal/session" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }));

    await expect(createPortalResponse(
      { origin: "https://attacker.example" },
      {
        BILLING_PROVIDER: "polar",
        DEEPSPEC_PUBLIC_URL: "https://deepspec.app",
        POLAR_ACCESS_TOKEN: "polar-token",
        POLAR_ENVIRONMENT: "sandbox",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
        SUPABASE_URL: "https://deep-spec.supabase.co",
      },
      { authorization: "Bearer verified-token" },
    )).resolves.toEqual({
      status: 200,
      body: { url: "https://polar.sh/customer-portal/session" },
    });
  });

  it.each([
    ["Stripe", {
      BILLING_PROVIDER: "stripe",
      DEEPSPEC_PUBLIC_URL: "https://deepspec.app",
      STRIPE_PRICE_DEEPSPEC_PLUS_MONTHLY: "price_plus",
      STRIPE_SECRET_KEY: "sk_test",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_URL: "https://deep-spec.supabase.co",
    }],
    ["Polar", {
      BILLING_PROVIDER: "polar",
      DEEPSPEC_PUBLIC_URL: "https://deepspec.app",
      POLAR_ACCESS_TOKEN: "polar-token",
      POLAR_ENVIRONMENT: "sandbox",
      POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY: "polar-product-plus",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_URL: "https://deep-spec.supabase.co",
    }],
  ])("bounds %s billing provider requests with a timeout", async (_provider, env) => {
    vi.useFakeTimers();
    supabaseMock.createClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "user-1", email_confirmed_at: "2026-07-01T00:00:00.000Z" } },
          error: null,
        })),
      },
    });
    vi.stubGlobal("fetch", vi.fn((_url, init: { signal?: AbortSignal }) => new Promise<Response>((_resolve, reject) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      init.signal?.addEventListener("abort", () => reject(new DOMException("upstream detail", "AbortError")), { once: true });
    })));

    const response = createCheckoutResponse(
      { planId: "plus_monthly" },
      env,
      { authorization: "Bearer verified-token" },
    );
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(response).resolves.toEqual({
      status: 504,
      body: {
        error: {
          code: "provider_timeout",
          message: "The billing provider took too long to respond.",
        },
      },
    });
  });

  it.each([
    ["Stripe", {
      BILLING_PROVIDER: "stripe",
      DEEPSPEC_PUBLIC_URL: "https://deepspec.app",
      STRIPE_PRICE_DEEPSPEC_PLUS_MONTHLY: "price_plus",
      STRIPE_SECRET_KEY: "sk_test",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_URL: "https://deep-spec.supabase.co",
    }, { error: { message: "raw Stripe account diagnostic" } }, "stripe_error"],
    ["Polar", {
      BILLING_PROVIDER: "polar",
      DEEPSPEC_PUBLIC_URL: "https://deepspec.app",
      POLAR_ACCESS_TOKEN: "polar-token",
      POLAR_ENVIRONMENT: "sandbox",
      POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY: "polar-product-plus",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
      SUPABASE_URL: "https://deep-spec.supabase.co",
    }, { detail: "raw Polar account diagnostic" }, "polar_error"],
  ])("sanitizes %s billing provider errors", async (_provider, env, providerBody, errorCode) => {
    supabaseMock.createClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "user-1", email_confirmed_at: "2026-07-01T00:00:00.000Z" } },
          error: null,
        })),
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(providerBody), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })));

    const response = await createCheckoutResponse(
      { planId: "plus_monthly" },
      env,
      { authorization: "Bearer verified-token" },
    );

    expect(response).toEqual({
      status: 400,
      body: {
        error: {
          code: errorCode,
          message: "The billing provider could not create a billing session.",
        },
      },
    });
    expect(JSON.stringify(response)).not.toContain("account diagnostic");
  });

  it("rejects client redirect origins when hosted billing has no server-owned public URL", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    supabaseMock.createClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "user-1", email_confirmed_at: "2026-07-01T00:00:00.000Z" } },
          error: null,
        })),
      },
    });

    await expect(createCheckoutResponse(
      { planId: "plus_monthly", origin: "https://attacker.example" },
      {
        BILLING_PROVIDER: "stripe",
        STRIPE_SECRET_KEY: "sk_test",
        STRIPE_PRICE_DEEPSPEC_PLUS_MONTHLY: "price_plus",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
        SUPABASE_URL: "https://deep-spec.supabase.co",
        VERCEL_ENV: "production",
      },
      { authorization: "Bearer verified-token" },
    )).resolves.toMatchObject({
      status: 500,
      body: { error: { code: "redirect_not_configured" } },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires a provider customer id for the Stripe customer portal", async () => {
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
                billing_provider: "stripe",
              },
              error: null,
            })),
          })),
        })),
      })),
    });

    await expect(createPortalResponse(
      {},
      {
        BILLING_PROVIDER: "stripe",
        STRIPE_SECRET_KEY: "sk_test",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
        SUPABASE_URL: "https://deep-spec.supabase.co",
      },
      { authorization: "Bearer verified-token" },
    )).resolves.toMatchObject({
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
      BILLING_PROVIDER: "stripe",
      STRIPE_SECRET_KEY: "sk_test",
      STRIPE_PRICE_DEEPSPEC_PLUS_MONTHLY: "price_plus",
    })).toContainEqual({ id: "plus_monthly", configured: true });
    expect(listConfiguredPlans({
      BILLING_PROVIDER: "polar",
      POLAR_ACCESS_TOKEN: "polar-token",
      POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY: "polar-plus",
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
          data: { user: { id: "user-1", email_confirmed_at: "2026-07-01T00:00:00.000Z" } },
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

  it("rejects an unverified account before contacting the checkout provider", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    supabaseMock.createClient.mockReturnValue({
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: "anonymous-user", is_anonymous: true } },
          error: null,
        })),
      },
    });

    await expect(createCheckoutResponse(
      { planId: "plus_monthly", origin: "https://deepspec.app" },
      {
        BILLING_PROVIDER: "stripe",
        STRIPE_SECRET_KEY: "sk_test",
        STRIPE_PRICE_DEEPSPEC_PLUS_MONTHLY: "price_plus",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
        SUPABASE_URL: "https://deep-spec.supabase.co",
      },
      { authorization: "Bearer anonymous-token" },
    )).resolves.toMatchObject({
      status: 403,
      body: { error: { code: "verification_required" } },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires a permanent confirmed identity before reporting account access", async () => {
    for (const user of [
      { id: "anonymous-user", is_anonymous: true },
      { id: "unconfirmed-user", is_anonymous: false },
    ]) {
      const from = vi.fn();
      supabaseMock.createClient.mockReturnValue({
        auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
        from,
      });

      await expect(createAccountEntitlementResponse(
        { authorization: "Bearer unverified-token" },
        {
          SUPABASE_URL: "https://deep-spec.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "service-role",
        },
      )).resolves.toMatchObject({
        status: 200,
        body: { entitlement: { status: "verification_required" } },
      });
      expect(from).not.toHaveBeenCalled();
    }
  });

  it("reports lifetime free usage from the server for a second device", async () => {
    supabaseMock.createClient.mockReturnValue({
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "user-1", email_confirmed_at: "2026-07-01T00:00:00.000Z" } }, error: null })) },
      from: vi.fn((table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === "free_scan_usage" ? { scans_used: 5 } : null, error: null }) }) }) })),
    });
    await expect(createAccountEntitlementResponse({ authorization: "Bearer token" }, {
      SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role",
    })).resolves.toMatchObject({ status: 200, body: { entitlement: { status: "free", scanAllowance: 5, scansUsed: 5 } } });
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

  it("blocks signed live Stripe webhooks unless live billing is explicitly enabled", async () => {
    const body = JSON.stringify({
      data: {
        object: {
          id: "cs_live",
        },
      },
      livemode: true,
      type: "checkout.session.completed",
    });

    await expect(createWebhookResponse(
      body,
      { "stripe-signature": signStripeBody(body) },
      webhookEnv(),
    )).resolves.toMatchObject({
      status: 403,
      body: {
        error: {
          code: "live_billing_disabled",
        },
      },
    });
    expect(supabaseMock.createClient).not.toHaveBeenCalled();
  });

  it("activates entitlement rows from completed Checkout sessions", async () => {
    const table = createBillingTableMock({ existingRow: { scan_allowance: 100, scans_used: 4 } });
    supabaseMock.createClient.mockReturnValue({ from: table.from, rpc: table.rpc });
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

    expect(table.rpc).toHaveBeenCalledWith("apply_billing_purchase", {
      p_additive: false,
      p_billing_provider: "stripe",
      p_current_period_end: null,
      p_event_key: "cs_123",
      p_plan_id: "plus_monthly",
      p_provider_checkout_id: "cs_123",
      p_provider_customer_id: "cus_123",
      p_provider_subscription_id: "sub_123",
      p_scan_allowance: 100,
      p_status: "active",
      p_user_id: "user-1",
    });
  });

  it("rejects Polar webhooks with an invalid signature before writing entitlements", async () => {
    const table = createBillingTableMock();
    supabaseMock.createClient.mockReturnValue({ from: table.from });

    await expect(createWebhookResponse(
      "{}",
      {
        "webhook-id": "msg_bad",
        "webhook-signature": "v1,bad",
        "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
      },
      polarWebhookEnv(),
    )).resolves.toMatchObject({
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

  it("blocks Polar production webhooks unless live billing is explicitly enabled", async () => {
    const body = JSON.stringify({
      data: {
        customer_id: "polar-customer-1",
        metadata: {
          deepspec_plan_id: "scan_pack",
          supabase_user_id: "user-1",
        },
        paid: true,
      },
      type: "order.paid",
    });

    await expect(createWebhookResponse(
      body,
      signStandardWebhookBody(body),
      {
        ...polarWebhookEnv(),
        POLAR_ENVIRONMENT: "production",
      },
    )).resolves.toMatchObject({
      status: 403,
      body: {
        error: {
          code: "live_billing_disabled",
        },
      },
    });
    expect(supabaseMock.createClient).not.toHaveBeenCalled();
  });

  it("activates entitlement rows from paid Polar orders", async () => {
    const table = createBillingTableMock({ existingRow: { scan_allowance: 5, scans_used: 2 } });
    supabaseMock.createClient.mockReturnValue({ from: table.from, rpc: table.rpc });
    const body = JSON.stringify({
      data: {
        checkout_id: "polar-checkout-1",
        customer: {
          external_id: "user-1",
          id: "polar-customer-1",
        },
        customer_id: "polar-customer-1",
        id: "polar-order-1",
        metadata: {
          deepspec_plan_id: "scan_pack",
          supabase_user_id: "user-1",
        },
        paid: true,
      },
      timestamp: "2026-06-19T00:00:00Z",
      type: "order.paid",
    });

    await expect(createWebhookResponse(
      body,
      signStandardWebhookBody(body),
      polarWebhookEnv(),
    )).resolves.toMatchObject({
      status: 200,
      body: {
        eventType: "order.paid",
        handled: true,
        received: true,
      },
    });

    expect(table.rpc).toHaveBeenCalledWith("apply_billing_purchase", {
      p_additive: true,
      p_billing_provider: "polar",
      p_current_period_end: null,
      p_event_key: "polar-order-1",
      p_plan_id: "scan_pack",
      p_provider_checkout_id: "polar-checkout-1",
      p_provider_customer_id: "polar-customer-1",
      p_provider_subscription_id: null,
      p_scan_allowance: 20,
      p_status: "active",
      p_user_id: "user-1",
    });
  });

  it("updates entitlement rows from Polar subscription lifecycle events", async () => {
    const table = createBillingTableMock();
    supabaseMock.createClient.mockReturnValue({ from: table.from });
    const body = JSON.stringify({
      data: {
        customer_id: "polar-customer-1",
        current_period_end: "2026-07-19T00:00:00Z",
        id: "polar-subscription-1",
        product_id: "polar-product-pro",
      },
      timestamp: "2026-06-19T00:00:00Z",
      type: "subscription.revoked",
    });

    await expect(createWebhookResponse(
      body,
      signStandardWebhookBody(body),
      {
        ...polarWebhookEnv(),
        POLAR_PRODUCT_DEEPSPEC_PRO_BETA: "polar-product-pro",
      },
    )).resolves.toMatchObject({
      status: 200,
      body: {
        eventType: "subscription.revoked",
        handled: true,
        received: true,
      },
    });

    expect(table.update).toHaveBeenCalledWith(expect.objectContaining({
      billing_provider: "polar",
      current_period_end: "2026-07-19T00:00:00.000Z",
      plan_id: "pro_beta",
      provider_customer_id: "polar-customer-1",
      provider_subscription_id: "polar-subscription-1",
      scan_allowance: 500,
      status: "canceled",
    }));
    expect(table.updateEq).toHaveBeenCalledWith("provider_subscription_id", "polar-subscription-1");
  });

  it("adds one-time scan pack credits to an existing entitlement", async () => {
    const table = createBillingTableMock({ existingRow: { scan_allowance: 5, scans_used: 2 } });
    supabaseMock.createClient.mockReturnValue({ from: table.from, rpc: table.rpc });
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

    expect(table.rpc).toHaveBeenCalledWith("apply_billing_purchase", expect.objectContaining({
      p_additive: true,
      p_billing_provider: "stripe",
      p_event_key: "cs_pack",
      p_plan_id: "scan_pack",
      p_scan_allowance: 20,
      p_user_id: "user-1",
    }));
  });

  it("fails closed when the atomic purchase RPC cannot record the entitlement", async () => {
    const table = createBillingTableMock();
    table.rpc.mockResolvedValueOnce({ data: null, error: { message: "Database unavailable" } });
    supabaseMock.createClient.mockReturnValue({ from: table.from, rpc: table.rpc });
    const body = JSON.stringify({
      data: { object: {
        client_reference_id: "user-1",
        customer: "cus_failed",
        id: "cs_failed",
        metadata: { deepspec_plan_id: "scan_pack" },
        payment_status: "paid",
      } },
      type: "checkout.session.completed",
    });

    await expect(createWebhookResponse(
      body,
      { "stripe-signature": signStripeBody(body) },
      webhookEnv(),
    )).resolves.toMatchObject({
      status: 502,
      body: { error: { code: "entitlement_write_failed" } },
    });
    expect(table.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ["stripe", "sequential"],
    ["stripe", "concurrent"],
    ["polar", "sequential"],
    ["polar", "concurrent"],
  ] as const)("grants one scan pack for duplicate %s deliveries received %sly", async (provider, delivery) => {
    const atomic = createAtomicBillingRpcMock(5);
    const table = createBillingTableMock();
    supabaseMock.createClient.mockReturnValue({ from: table.from, rpc: atomic.rpc });
    const body = provider === "stripe"
      ? JSON.stringify({
          data: { object: {
            client_reference_id: "user-1",
            customer: "cus_duplicate",
            id: "cs_duplicate",
            metadata: { deepspec_plan_id: "scan_pack" },
            payment_status: "paid",
          } },
          type: "checkout.session.completed",
        })
      : JSON.stringify({
          data: {
            checkout_id: "polar-checkout-duplicate",
            customer_id: "polar-customer-duplicate",
            id: "polar-order-duplicate",
            metadata: { deepspec_plan_id: "scan_pack", supabase_user_id: "user-1" },
            paid: true,
          },
          type: "order.paid",
        });
    const deliver = () => provider === "stripe"
      ? createWebhookResponse(body, { "stripe-signature": signStripeBody(body) }, webhookEnv())
      : createWebhookResponse(body, signStandardWebhookBody(body), polarWebhookEnv());

    const responses = delivery === "concurrent"
      ? await Promise.all([deliver(), deliver()])
      : [await deliver(), await deliver()];

    expect(responses).toEqual([
      expect.objectContaining({ status: 200, body: expect.objectContaining({ handled: true }) }),
      expect.objectContaining({ status: 200, body: expect.objectContaining({ handled: true }) }),
    ]);
    expect(atomic.allowance()).toBe(25);
    expect(atomic.applied()).toBe(1);
    expect(atomic.rpc).toHaveBeenCalledTimes(2);
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
    expect(table.updateSelect).toHaveBeenCalledWith("user_id");
  });

  it("returns a retryable error when a signed subscription event matches no entitlement", async () => {
    const table = createBillingTableMock({ updatedRows: [] });
    supabaseMock.createClient.mockReturnValue({ from: table.from });
    const body = JSON.stringify({
      data: {
        object: {
          customer: "cus_missing",
          id: "sub_missing",
          status: "canceled",
        },
      },
      type: "customer.subscription.deleted",
    });

    await expect(createWebhookResponse(
      body,
      { "stripe-signature": signStripeBody(body) },
      webhookEnv(),
    )).resolves.toEqual({
      status: 503,
      body: {
        error: {
          code: "entitlement_update_missed",
          message: "DeepSpec could not match the billing event to exactly one paid-access record.",
        },
      },
    });

    expect(table.updateEq).toHaveBeenCalledWith("provider_subscription_id", "sub_missing");
    expect(table.updateSelect).toHaveBeenCalledWith("user_id");
  });

  describe("Polar webhook secrets created before the Standard Webhooks switch", () => {
    // Polar HMAC scheme: the raw secret string itself is the signing key (Polar's docs say to
    // base64-encode it before handing it to a Standard Webhooks library, which decodes it back).
    const legacySecret = "polar_whs_legacy-secret";
    const legacyEnv = () => ({ ...polarWebhookEnv(), POLAR_WEBHOOK_SECRET: legacySecret });
    const body = JSON.stringify({ data: {}, type: "customer.created" });

    it("verifies a webhook signed with the raw legacy secret", async () => {
      supabaseMock.createClient.mockReturnValue({ from: createBillingTableMock().from });

      await expect(createWebhookResponse(
        body,
        signStandardWebhookBody(body, undefined, Buffer.from(legacySecret)),
        legacyEnv(),
      )).resolves.toMatchObject({ status: 200, body: { handled: false, received: true } });
    });

    it("still rejects a webhook signed with some other secret", async () => {
      supabaseMock.createClient.mockReturnValue({ from: createBillingTableMock().from });

      await expect(createWebhookResponse(
        body,
        signStandardWebhookBody(body, undefined, Buffer.from("someone-elses-secret")),
        legacyEnv(),
      )).resolves.toMatchObject({ status: 400, body: { error: { code: "invalid_signature" } } });
    });

    it("keeps verifying whsec_ secrets the Standard Webhooks way", async () => {
      supabaseMock.createClient.mockReturnValue({ from: createBillingTableMock().from });

      await expect(createWebhookResponse(body, signStandardWebhookBody(body), polarWebhookEnv()))
        .resolves.toMatchObject({ status: 200, body: { handled: false, received: true } });
    });

    it("never accepts a signature made with an empty key", async () => {
      supabaseMock.createClient.mockReturnValue({ from: createBillingTableMock().from });

      // "!!!" is not base64, so it decodes to zero bytes — an HMAC with an empty key anyone can compute.
      await expect(createWebhookResponse(
        body,
        signStandardWebhookBody(body, undefined, Buffer.alloc(0)),
        { ...polarWebhookEnv(), POLAR_WEBHOOK_SECRET: "!!!" },
      )).resolves.toMatchObject({ status: 400, body: { error: { code: "invalid_signature" } } });
    });
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

function polarWebhookEnv() {
  return {
    BILLING_PROVIDER: "polar",
    POLAR_ENVIRONMENT: "sandbox",
    POLAR_WEBHOOK_SECRET: `whsec_${Buffer.from("polar-webhook-secret").toString("base64")}`,
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

function signStandardWebhookBody(
  body: string,
  timestamp = Math.floor(Date.now() / 1000),
  key: Buffer = Buffer.from("polar-webhook-secret"),
) {
  const webhookId = "msg_test";
  const signature = createHmac("sha256", key)
    .update(`${webhookId}.${timestamp}.${body}`, "utf8")
    .digest("base64");
  return {
    "webhook-id": webhookId,
    "webhook-signature": `v1,${signature}`,
    "webhook-timestamp": String(timestamp),
  };
}

function createBillingTableMock({
  existingRow = null,
  updatedRows = [{ user_id: "user-1" }],
}: {
  existingRow?: Record<string, unknown> | null;
  updatedRows?: Array<Record<string, unknown>>;
} = {}) {
  const maybeSingle = vi.fn(async () => ({ data: existingRow, error: null }));
  const selectEq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq: selectEq }));
  const upsert = vi.fn(async (values: Record<string, unknown>) => {
    expect(values).not.toHaveProperty("scans_used");
    return { error: null };
  });
  const updateSelect = vi.fn(async () => ({ data: updatedRows, error: null }));
  const updateEq = vi.fn(() => ({ select: updateSelect }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const from = vi.fn(() => ({
    select,
    update,
    upsert,
  }));
  const rpc = vi.fn(async () => ({ data: true, error: null }));

  return {
    from,
    rpc,
    select,
    selectEq,
    maybeSingle,
    update,
    updateEq,
    updateSelect,
    upsert,
  };
}

function createAtomicBillingRpcMock(initialAllowance: number) {
  const eventKeys = new Set<string>();
  let scanAllowance = initialAllowance;
  let appliedEvents = 0;
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    expect(name).toBe("apply_billing_purchase");
    const eventKey = `${String(args.p_billing_provider)}:${String(args.p_event_key)}`;
    if (eventKeys.has(eventKey)) return { data: false, error: null };
    eventKeys.add(eventKey);
    await Promise.resolve();
    scanAllowance = args.p_additive
      ? scanAllowance + Number(args.p_scan_allowance)
      : Number(args.p_scan_allowance);
    appliedEvents += 1;
    return { data: true, error: null };
  });
  return {
    allowance: () => scanAllowance,
    applied: () => appliedEvents,
    rpc,
  };
}
