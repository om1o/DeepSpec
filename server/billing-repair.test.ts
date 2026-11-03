import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCheckoutResponse, createWebhookResponse } from "./billing.shared";

const supabaseMock = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => supabaseMock);

const env = {
  BILLING_PROVIDER: "stripe", STRIPE_WEBHOOK_SECRET: "fixture-webhook-secret",
  SUPABASE_URL: "https://billing-fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-role",
};
const checkout = (status: unknown, id = "cs_fixture") => ({
  id, customer: "cus_fixture", mode: "payment", payment_status: status,
  metadata: { deepspec_plan_id: "scan_pack", supabase_user_id: "fixture-user" },
});
async function stripe(type: string, object: Record<string, unknown>) {
  const body = JSON.stringify({ type, livemode: false, data: { object } });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest("hex");
  return createWebhookResponse(body, { "stripe-signature": `t=${timestamp},v1=${signature}` }, env);
}
async function polar(object: Record<string, unknown>) {
  const body = JSON.stringify({ type: "subscription.revoked", data: object });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = "fixture-polar-secret";
  const signature = createHmac("sha256", secret).update(`fixture-event.${timestamp}.${body}`).digest("base64");
  return createWebhookResponse(body, { "webhook-id": "fixture-event", "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` }, { ...env, BILLING_PROVIDER: "polar", POLAR_ENVIRONMENT: "sandbox", POLAR_WEBHOOK_SECRET: secret });
}

// A model of the existing atomic RPC contract, not a database concurrency test.
function purchaseStore() {
  const receipts = new Set<string>();
  const state = { allowance: 5, used: 2, status: "active" };
  let failNext = false;
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    expect(name).toBe("apply_billing_purchase");
    if (failNext) { failNext = false; return { data: null, error: { message: "fixture write failure" } }; }
    const key = `${args.p_billing_provider}:${args.p_event_key}`;
    if (receipts.has(key)) return { data: false, error: null };
    receipts.add(key);
    state.allowance = args.p_additive ? state.allowance + Number(args.p_scan_allowance) : Number(args.p_scan_allowance);
    state.status = String(args.p_status);
    return { data: true, error: null };
  });
  supabaseMock.createClient.mockReturnValue({ rpc });
  return { state, receipts, rpc, failOnce() { failNext = true; } };
}

type Row = Record<string, unknown>;
function subscriptionStore(rows: Row[], beforeUpdate?: () => void) {
  const matches = (row: Row, filters: Array<[string, unknown]>) => filters.every(([key, value]) => row[key] === value);
  const select = vi.fn(() => {
    const filters: Array<[string, unknown]> = [];
    const query = {
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      async maybeSingle() {
        const found = rows.filter(row => matches(row, filters));
        return found.length > 1
          ? { data: null, error: { code: "PGRST116", message: "Multiple rows" } }
          : { data: found[0] ? { user_id: found[0].user_id } : null, error: null };
      },
    };
    return query;
  });
  const update = vi.fn((values: Row) => {
    beforeUpdate?.();
    const filters: Array<[string, unknown]> = [];
    const query = {
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      async select() {
        const found = rows.filter(row => matches(row, filters));
        for (const row of found) Object.assign(row, values);
        return { data: found.map(row => ({ user_id: row.user_id })), error: null };
      },
    };
    return query;
  });
  supabaseMock.createClient.mockReturnValue({ from: () => ({ select, update }) });
  return { select, update };
}

describe("reconstructed hosted billing repairs", () => {
  afterEach(() => { vi.unstubAllGlobals(); supabaseMock.createClient.mockReset(); });

  it.each(["unpaid", undefined, "unknown"])("does not reserve or mutate a %s Checkout purchase", async status => {
    const store = purchaseStore();
    expect(await stripe("checkout.session.completed", checkout(status))).toMatchObject({ status: 200, body: { handled: false } });
    expect(store.rpc).not.toHaveBeenCalled();
    expect(store.receipts.size).toBe(0);
    expect(store.state).toEqual({ allowance: 5, used: 2, status: "active" });
  });

  it("accepts delayed payment after unpaid completion without consuming the receipt early", async () => {
    const store = purchaseStore();
    await stripe("checkout.session.completed", checkout("unpaid"));
    expect(store.receipts.size).toBe(0);
    expect(await stripe("checkout.session.async_payment_succeeded", checkout("paid"))).toMatchObject({ status: 200, body: { handled: true } });
    expect(store.state).toEqual({ allowance: 25, used: 2, status: "active" });
    expect([...store.receipts]).toEqual(["stripe:cs_fixture"]);
  });

  it("keeps paid access when stale unpaid completion or asynchronous failure arrives later", async () => {
    const store = purchaseStore();
    await stripe("checkout.session.async_payment_succeeded", checkout("paid"));
    await stripe("checkout.session.completed", checkout("unpaid"));
    expect(await stripe("checkout.session.async_payment_failed", checkout("unpaid"))).toMatchObject({ status: 200, body: { handled: false } });
    expect(store.rpc).toHaveBeenCalledTimes(1);
    expect(store.state).toEqual({ allowance: 25, used: 2, status: "active" });
  });

  it.each(["sequential", "concurrent"])("uses one purchase key across %s completed and delayed-success deliveries", async delivery => {
    const store = purchaseStore();
    const types = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_succeeded", "checkout.session.completed"];
    const results = delivery === "concurrent"
      ? await Promise.all(types.map(type => stripe(type, checkout("paid"))))
      : await types.reduce(async (pending, type) => [...await pending, await stripe(type, checkout("paid"))], Promise.resolve([] as Awaited<ReturnType<typeof stripe>>[]));
    expect(results.every(result => result.status === 200 && "handled" in result.body && result.body.handled)).toBe(true);
    expect(store.state).toEqual({ allowance: 25, used: 2, status: "active" });
    expect(store.receipts.size).toBe(1);
    expect(store.rpc).toHaveBeenCalledTimes(4);
  });

  it("adds distinct paid scan packs while retaining existing usage", async () => {
    const store = purchaseStore();
    await stripe("checkout.session.completed", checkout("paid", "cs_first"));
    await stripe("checkout.session.async_payment_succeeded", checkout("paid", "cs_second"));
    expect(store.state).toEqual({ allowance: 45, used: 2, status: "active" });
    expect(store.receipts.size).toBe(2);
  });

  it("does not consume a failed database write and can retry the paid purchase once", async () => {
    const store = purchaseStore(); store.failOnce();
    expect(await stripe("checkout.session.async_payment_succeeded", checkout("paid"))).toMatchObject({ status: 502 });
    expect(store.receipts.size).toBe(0);
    expect(await stripe("checkout.session.async_payment_succeeded", checkout("paid"))).toMatchObject({ status: 200, body: { handled: true } });
    await stripe("checkout.session.completed", checkout("paid"));
    expect(store.state).toEqual({ allowance: 25, used: 2, status: "active" });
    expect(store.receipts.size).toBe(1);
  });

  it("retains fulfillment of a valid no-payment-required Checkout", async () => {
    const store = purchaseStore();
    expect(await stripe("checkout.session.completed", checkout("no_payment_required"))).toMatchObject({ status: 200, body: { handled: true } });
    expect(store.state.allowance).toBe(25);
  });

  it.each(["provider_subscription_id", "provider_customer_id"])("scopes Stripe updates by provider before matching %s", async key => {
    const rows = [
      { user_id: "stripe-user", billing_provider: "stripe", [key]: "shared-key", status: "active" },
      { user_id: "polar-user", billing_provider: "polar", [key]: "shared-key", status: "active" },
    ];
    subscriptionStore(rows);
    const object = key === "provider_subscription_id" ? { id: "shared-key", status: "canceled" } : { customer: "shared-key", status: "canceled" };
    expect(await stripe("customer.subscription.deleted", object)).toMatchObject({ status: 200 });
    expect(rows[0].status).toBe("canceled");
    expect(rows[1]).toEqual({ user_id: "polar-user", billing_provider: "polar", [key]: "shared-key", status: "active" });
  });

  it("scopes Polar updates without mutating an equal Stripe key", async () => {
    const rows = [
      { user_id: "stripe-user", billing_provider: "stripe", provider_subscription_id: "shared-key", status: "active" },
      { user_id: "polar-user", billing_provider: "polar", provider_subscription_id: "shared-key", status: "active" },
    ];
    subscriptionStore(rows);
    expect(await polar({ id: "shared-key", status: "revoked" })).toMatchObject({ status: 200 });
    expect(rows[0].status).toBe("active");
    expect(rows[0].billing_provider).toBe("stripe");
    expect(rows[1].status).toBe("canceled");
  });

  it.each(["provider_subscription_id", "provider_customer_id"])("rejects ambiguous %s before any mutation", async key => {
    const rows = [
      { user_id: "user-a", billing_provider: "stripe", [key]: "ambiguous", status: "active" },
      { user_id: "user-b", billing_provider: "stripe", [key]: "ambiguous", status: "active" },
    ];
    const store = subscriptionStore(rows);
    const object = key === "provider_subscription_id" ? { id: "ambiguous", status: "canceled" } : { customer: "ambiguous", status: "canceled" };
    expect(await stripe("customer.subscription.deleted", object)).toMatchObject({ status: 503 });
    expect(store.update).not.toHaveBeenCalled();
    expect(rows.every(row => row.status === "active")).toBe(true);
  });

  it.each(["provider", "key"])("rechecks the verified %s when the row changes before update", async field => {
    const rows = [{ user_id: "user-a", billing_provider: "stripe", provider_subscription_id: "sub_old", status: "active" }];
    subscriptionStore(rows, () => {
      if (field === "provider") rows[0].billing_provider = "polar";
      else rows[0].provider_subscription_id = "sub_new";
    });
    expect(await stripe("customer.subscription.deleted", { id: "sub_old", status: "canceled" })).toMatchObject({ status: 503 });
    expect(rows[0]).toEqual({ user_id: "user-a", billing_provider: field === "provider" ? "polar" : "stripe", provider_subscription_id: field === "key" ? "sub_new" : "sub_old", status: "active" });
  });

  it("does not write when the only matching key belongs to another provider", async () => {
    const rows = [{ user_id: "polar-user", billing_provider: "polar", provider_subscription_id: "shared-key", status: "active" }];
    const store = subscriptionStore(rows);
    expect(await stripe("customer.subscription.deleted", { id: "shared-key", status: "canceled" })).toMatchObject({ status: 503 });
    expect(store.update).not.toHaveBeenCalled();
    expect(rows[0].billing_provider).toBe("polar");
    expect(rows[0].status).toBe("active");
  });

  it("returns a retryable read error without attempting a subscription mutation", async () => {
    const update = vi.fn();
    const query = { eq: vi.fn(), maybeSingle: async () => ({ data: null, error: { code: "fixture_unavailable" } }) };
    query.eq.mockReturnValue(query);
    supabaseMock.createClient.mockReturnValue({ from: () => ({ select: () => query, update }) });
    expect(await stripe("customer.subscription.deleted", { id: "sub_fixture", status: "canceled" })).toMatchObject({ status: 502, body: { error: { code: "entitlement_read_failed" } } });
    expect(update).not.toHaveBeenCalled();
  });

  it.each([["scan_pack", "payment", "always"], ["plus_monthly", "subscription", null]])("creates %s Checkout with a compatible customer policy", async (planId, mode, customerCreation) => {
    supabaseMock.createClient.mockReturnValue({ auth: { getUser: async () => ({ data: { user: { id: "fixture-user", email_confirmed_at: "2026-01-01T00:00:00Z" } }, error: null }) } });
    const fetchMock = vi.fn(async (_url, init: RequestInit) => {
      const form = new URLSearchParams(String(init.body));
      expect(form.get("mode")).toBe(mode);
      expect(form.get("customer_creation")).toBe(customerCreation);
      return new Response(JSON.stringify({ url: "https://checkout.stripe.test/fixture" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await createCheckoutResponse({ planId }, { ...env, STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_PRICE_DEEPSPEC_SCAN_PACK: "price_pack", STRIPE_PRICE_DEEPSPEC_PLUS_MONTHLY: "price_plus", DEEPSPEC_PUBLIC_URL: "https://deepspec.test" }, { authorization: "Bearer fixture-session" })).toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
