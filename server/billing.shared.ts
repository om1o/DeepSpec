import { createHmac, timingSafeEqual } from "node:crypto";
import { REVENUE_PLANS, getRevenuePlan, type PlanId, type ServerEntitlement } from "../src/services/revenue.js";
import { createSupabaseAdminClient, getSupabaseAdminKey } from "./supabaseAdmin.shared.js";
import { getQaScanAccess, type QaScanAccess } from "./qaScanAccess.shared.js";

type BillingErrorResponse = {
  status: number;
  body: {
    error: {
      code: string;
      message: string;
    };
  };
};

type BillingResponse =
  | {
      status: 200;
      body: {
        url: string;
      };
    }
  | BillingErrorResponse;

type EntitlementResponse =
  | {
      status: 200;
      body: {
        entitlement: ServerEntitlement;
        qaScanAccess?: QaScanAccess;
      };
    }
  | BillingErrorResponse;

type ScanCreditReservation =
  | {
      enforced: false;
      ok: true;
    }
  | {
      enforced: true;
      ok: true;
      reservationId: string | null;
      userId: string;
    }
  | {
      error: BillingErrorResponse;
      ok: false;
    };

type WebhookResponse =
  | {
      status: 200;
      body: {
        eventType: string;
        handled: boolean;
        received: true;
      };
    }
  | BillingErrorResponse;

type BillingEnv = Record<string, string | undefined>;
type BillingProvider = "polar" | "stripe" | "unconfigured";
type SupabaseRow = Record<string, unknown>;
type BillingSupabaseClient = {
  auth: {
    getUser: (token: string) => Promise<{
      data: {
        user?: {
          id: string;
          is_anonymous?: boolean;
          email_confirmed_at?: string;
          phone_confirmed_at?: string;
          app_metadata?: Record<string, unknown>;
        } | null;
      };
      error: unknown;
    }>;
  };
  from: (table: string) => BillingSupabaseTable;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};
type BillingSupabaseOptions = {
  auth: {
    autoRefreshToken: boolean;
    persistSession: boolean;
  };
};
// An update can be awaited as-is, or narrowed with more filters and asked for the rows it changed.
type BillingUpdateQuery = PromiseLike<{ error: unknown }> & {
  eq: (column: string, value: string | number) => BillingUpdateQuery;
  select: (columns: string) => PromiseLike<{ data: unknown; error: unknown }>;
};
type BillingSupabaseTable = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      maybeSingle: () => PromiseLike<{
        data: unknown;
        error: unknown;
      }>;
    };
  };
  update: (values: Record<string, unknown>) => BillingUpdateQuery;
  upsert: (values: Record<string, unknown>, options?: { onConflict?: string }) => PromiseLike<{
    error: unknown;
  }>;
};
const createBillingClient = createSupabaseAdminClient as unknown as (
  supabaseUrl: string,
  serviceRoleKey: string,
  options: BillingSupabaseOptions,
) => BillingSupabaseClient;

const STRIPE_CHECKOUT_URL = "https://api.stripe.com/v1/checkout/sessions";
const STRIPE_PORTAL_URL = "https://api.stripe.com/v1/billing_portal/sessions";
const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;
const POLAR_API_BASE_URL = "https://api.polar.sh";
const POLAR_SANDBOX_API_BASE_URL = "https://sandbox-api.polar.sh";
const BILLING_PROVIDER_TIMEOUT_MS = 10_000;
const BILLING_PROVIDER_ERROR_MESSAGE = "The billing provider could not create a billing session.";
const BILLING_PROVIDER_TIMEOUT_MESSAGE = "The billing provider took too long to respond.";
const STANDARD_WEBHOOK_TOLERANCE_SECONDS = 300;

const STRIPE_PRICE_ENV_KEYS: Record<PlanId, string> = {
  plus_monthly: "STRIPE_PRICE_DEEPSPEC_PLUS_MONTHLY",
  plus_yearly: "STRIPE_PRICE_DEEPSPEC_PLUS_YEARLY",
  scan_pack: "STRIPE_PRICE_DEEPSPEC_SCAN_PACK",
  pro_beta: "STRIPE_PRICE_DEEPSPEC_PRO_BETA",
};

const POLAR_PRODUCT_ENV_KEYS: Record<PlanId, string> = {
  plus_monthly: "POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY",
  plus_yearly: "POLAR_PRODUCT_DEEPSPEC_PLUS_YEARLY",
  scan_pack: "POLAR_PRODUCT_DEEPSPEC_SCAN_PACK",
  pro_beta: "POLAR_PRODUCT_DEEPSPEC_PRO_BETA",
};

export async function createCheckoutResponse(
  body: unknown,
  env: BillingEnv,
  headers: Record<string, string | string[] | undefined> = {},
): Promise<BillingResponse> {
  const parsed = parseCheckoutBody(body);
  if ("error" in parsed) {
    return parsed.error;
  }

  const plan = getRevenuePlan(parsed.planId);
  if (!plan) {
    return errorResponse(400, "invalid_plan", "Choose a valid DeepSpec plan.");
  }

  const provider = resolveBillingProvider(env);
  if (provider === "polar") {
    const liveGuard = blockLiveBillingUnlessEnabled(env, provider);
    if (liveGuard) {
      return liveGuard;
    }

    return createPolarCheckoutResponse(parsed.planId, env, headers);
  }

  if (provider !== "stripe") {
    return errorResponse(500, "not_configured", "Billing provider checkout is not configured on this server.");
  }

  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return errorResponse(500, "not_configured", "Billing provider checkout is not configured on this server.");
  }

  const liveGuard = blockLiveBillingUnlessEnabled(env, provider);
  if (liveGuard) {
    return liveGuard;
  }

  const priceId = env[STRIPE_PRICE_ENV_KEYS[plan.id]]?.trim();
  if (!priceId) {
    return errorResponse(500, "not_configured", `Billing provider price is missing for ${plan.name}.`);
  }

  const verifiedUser = await verifyBillingUser(headers, env);
  if ("error" in verifiedUser) {
    return verifiedUser.error;
  }

  const origin = getBillingRedirectOrigin(env);
  if (!origin) {
    return billingRedirectConfigurationError();
  }
  const params = new URLSearchParams({
    mode: plan.billingMode,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    client_reference_id: verifiedUser.userId,
    success_url: `${origin.replace(/\/$/, "")}/account?checkout=success`,
    cancel_url: `${origin.replace(/\/$/, "")}/pricing?checkout=cancelled`,
    allow_promotion_codes: "true",
    "metadata[deepspec_plan_id]": plan.id,
    "metadata[supabase_user_id]": verifiedUser.userId,
    "metadata[scan_allowance]": String(plan.scanAllowance),
  });

  return postStripeSession(STRIPE_CHECKOUT_URL, params, secretKey);
}

async function createPolarCheckoutResponse(
  planId: PlanId,
  env: BillingEnv,
  headers: Record<string, string | string[] | undefined>,
): Promise<BillingResponse> {
  const plan = getRevenuePlan(planId);
  const accessToken = env.POLAR_ACCESS_TOKEN?.trim();
  if (!plan || !accessToken) {
    return errorResponse(500, "not_configured", "Billing provider checkout is not configured on this server.");
  }

  const productId = env[POLAR_PRODUCT_ENV_KEYS[plan.id]]?.trim();
  if (!productId) {
    return errorResponse(500, "not_configured", `Billing provider product is missing for ${plan.name}.`);
  }

  const verifiedUser = await verifyBillingUser(headers, env);
  if ("error" in verifiedUser) {
    return verifiedUser.error;
  }

  const baseOrigin = getBillingRedirectOrigin(env);
  if (!baseOrigin) {
    return billingRedirectConfigurationError();
  }
  return postPolarJson(`${getPolarApiBaseUrl(env)}/v1/checkouts/`, {
    allow_discount_codes: true,
    external_customer_id: verifiedUser.userId,
    metadata: {
      deepspec_plan_id: plan.id,
      scan_allowance: plan.scanAllowance,
      supabase_user_id: verifiedUser.userId,
    },
    products: [productId],
    return_url: `${baseOrigin}/pricing?checkout=cancelled`,
    success_url: `${baseOrigin}/account?checkout=success&checkout_id={CHECKOUT_ID}`,
  }, accessToken, "url");
}

export async function createPortalResponse(
  _body: unknown,
  env: BillingEnv,
  headers: Record<string, string | string[] | undefined> = {},
): Promise<BillingResponse> {
  const provider = resolveBillingProvider(env);
  if (provider === "polar") {
    const liveGuard = blockLiveBillingUnlessEnabled(env, provider);
    if (liveGuard) {
      return liveGuard;
    }

    return createPolarPortalResponse(env, headers);
  }

  if (provider !== "stripe") {
    return errorResponse(500, "not_configured", "Billing provider customer portal is not configured on this server.");
  }

  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return errorResponse(500, "not_configured", "Billing provider customer portal is not configured on this server.");
  }

  const liveGuard = blockLiveBillingUnlessEnabled(env, provider);
  if (liveGuard) {
    return liveGuard;
  }

  const entitlement = await readVerifiedBillingEntitlement(headers, env);
  if ("error" in entitlement) {
    return entitlement.error;
  }

  const customerId = getStringValue(entitlement.row?.provider_customer_id) || getStringValue(entitlement.row?.stripe_customer_id);
  if (!customerId) {
    return errorResponse(400, "missing_customer", "A provider customer id is required for the billing portal.");
  }

  const origin = getBillingRedirectOrigin(env);
  if (!origin) {
    return billingRedirectConfigurationError();
  }
  const params = new URLSearchParams({
    customer: customerId,
    return_url: `${origin.replace(/\/$/, "")}/account`,
  });

  return postStripeSession(STRIPE_PORTAL_URL, params, secretKey);
}

async function createPolarPortalResponse(
  env: BillingEnv,
  headers: Record<string, string | string[] | undefined>,
): Promise<BillingResponse> {
  const accessToken = env.POLAR_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return errorResponse(500, "not_configured", "Billing provider customer portal is not configured on this server.");
  }

  const entitlement = await readVerifiedBillingEntitlement(headers, env);
  if ("error" in entitlement) {
    return entitlement.error;
  }

  const origin = getBillingRedirectOrigin(env);
  if (!origin) {
    return billingRedirectConfigurationError();
  }
  const returnUrl = `${origin}/account`;
  const customerId = getStringValue(entitlement.row?.provider_customer_id);
  const payload = customerId
    ? { customer_id: customerId, return_url: returnUrl }
    : { external_customer_id: entitlement.userId, return_url: returnUrl };

  return postPolarJson(`${getPolarApiBaseUrl(env)}/v1/customer-sessions/`, payload, accessToken, "customer_portal_url");
}

export async function createWebhookResponse(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  env: BillingEnv,
): Promise<WebhookResponse> {
  const provider = resolveBillingProvider(env);
  if (provider === "polar") {
    const liveGuard = blockLiveBillingUnlessEnabled(env, provider);
    if (liveGuard) {
      return liveGuard;
    }

    return createPolarWebhookResponse(rawBody, headers, env);
  }

  if (provider !== "stripe") {
    return errorResponse(500, "not_configured", "Billing provider webhook verification is not configured on this server.");
  }

  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return errorResponse(500, "not_configured", "Billing provider webhook verification is not configured on this server.");
  }

  const supabaseUrl = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim();
  const serviceRoleKey = getSupabaseAdminKey(env);
  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse(500, "not_configured", "Server entitlement writes are not configured.");
  }

  const parsedEvent = parseSignedStripeEvent(rawBody, headers, webhookSecret);
  if ("error" in parsedEvent) {
    return parsedEvent.error;
  }

  if (parsedEvent.event.livemode === true && env.DEEPSPEC_ENABLE_LIVE_BILLING !== "true") {
    return errorResponse(403, "live_billing_disabled", "Live billing is disabled on this server.");
  }

  const supabase = createBillingClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const handled = await handleStripeEvent(parsedEvent.event, supabase, env);
  if ("error" in handled) {
    return handled.error;
  }

  return {
    status: 200,
    body: {
      eventType: parsedEvent.event.type,
      handled: handled.handled,
      received: true,
    },
  };
}

async function createPolarWebhookResponse(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  env: BillingEnv,
): Promise<WebhookResponse> {
  const webhookSecret = env.POLAR_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return errorResponse(500, "not_configured", "Billing provider webhook verification is not configured on this server.");
  }

  const supabaseUrl = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim();
  const serviceRoleKey = getSupabaseAdminKey(env);
  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse(500, "not_configured", "Server entitlement writes are not configured.");
  }

  const parsedEvent = parseSignedStandardWebhookEvent(rawBody, headers, webhookSecret);
  if ("error" in parsedEvent) {
    return parsedEvent.error;
  }

  const supabase = createBillingClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const handled = await handlePolarEvent(parsedEvent.event, supabase, env);
  if ("error" in handled) {
    return handled.error;
  }

  return {
    status: 200,
    body: {
      eventType: parsedEvent.event.type,
      handled: handled.handled,
      received: true,
    },
  };
}

export async function createAccountEntitlementResponse(
  headers: Record<string, string | string[] | undefined>,
  env: BillingEnv,
): Promise<EntitlementResponse> {
  const supabaseUrl = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim();
  const serviceRoleKey = getSupabaseAdminKey(env);
  if (!supabaseUrl || !serviceRoleKey) {
    return entitlementErrorResponse(500, "not_configured", "Server entitlement verification is not configured.");
  }

  const token = parseBearerToken(headers.authorization ?? headers.Authorization);
  if (!token) {
    return entitlementErrorResponse(401, "missing_session", "Sign in before checking DeepSpec paid access.");
  }

  const supabase = createBillingClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return entitlementErrorResponse(401, "invalid_session", "DeepSpec could not verify this account session.");
  }

  if (
    userData.user.is_anonymous === true ||
    (!userData.user.email_confirmed_at && !userData.user.phone_confirmed_at)
  ) {
    return {
      status: 200,
      body: {
        entitlement: {
          status: "verification_required",
          verifiedAt: new Date().toISOString(),
        },
      },
    };
  }

  const { data, error } = await supabase
    .from("billing_entitlements")
    .select("billing_provider,plan_id,status,scan_allowance,scans_used,current_period_end")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (error) {
    return entitlementErrorResponse(502, "entitlement_unavailable", "DeepSpec could not read server entitlement state.");
  }

  if (!isRecord(data) || data.status !== "active" || !isPlanId(String(data.plan_id ?? ""))) {
    const { data: freeUsage, error: freeError } = await supabase
      .from("free_scan_usage").select("scans_used").eq("user_id", userData.user.id).maybeSingle();
    if (freeError) return entitlementErrorResponse(503, "entitlement_unavailable", "DeepSpec could not read free scan usage.");
    return {
      status: 200,
      body: { qaScanAccess: getQaScanAccess(userData.user, env), entitlement: {
        status: "free",
        scanAllowance: 5,
        scansUsed: isRecord(freeUsage) ? Number(freeUsage.scans_used ?? 0) : 0,
        verifiedAt: new Date().toISOString(),
      } },
    };
  }

  const planId = String(data.plan_id) as PlanId;
  const plan = getRevenuePlan(planId);
  return {
    status: 200,
    body: {
      qaScanAccess: getQaScanAccess(userData.user, env),
      entitlement: {
        currentPeriodEnd: typeof data.current_period_end === "string" ? data.current_period_end : undefined,
        billingProvider: typeof data.billing_provider === "string" ? data.billing_provider : undefined,
        planId,
        planName: plan?.name,
        scanAllowance: Number(data.scan_allowance ?? 0),
        scansUsed: Number(data.scans_used ?? 0),
        status: isServerEntitlementStatus(data.status) ? data.status : "inactive",
        verifiedAt: new Date().toISOString(),
      },
    },
  };
}

export async function reserveScanCredit(
  headers: Record<string, string | string[] | undefined>,
  env: BillingEnv,
): Promise<ScanCreditReservation> {
  const supabaseUrl = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim();
  const serviceRoleKey = getSupabaseAdminKey(env);
  if (!supabaseUrl || !serviceRoleKey) {
    return { ok: false, error: errorResponse(500, "not_configured", "Server-side scan credit enforcement is not configured.") };
  }

  const token = parseBearerToken(headers.authorization ?? headers.Authorization);
  if (!token) {
    return { ok: false, error: errorResponse(401, "missing_session", "Sign in before using DeepSpec scans.") };
  }

  const supabase = createBillingClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return { ok: false, error: errorResponse(401, "invalid_session", "DeepSpec could not verify this account session.") };
  }

  const user = userData.user;
  if (getQaScanAccess(user, env)) return { enforced: false, ok: true };
  const { data, error } = await supabase.rpc("reserve_scan_credit", {
    p_user_id: user.id,
    p_free_eligible: user.is_anonymous !== true && Boolean(user.email_confirmed_at || user.phone_confirmed_at),
  });
  if (error || !isRecord(data)) {
    return { ok: false, error: errorResponse(503, "entitlement_unavailable", "DeepSpec could not reserve a scan credit. Try again later.") };
  }
  if (data.ok !== true) {
    return { ok: false, error: errorResponse(402, "scan_limit_reached", "No scan credits are available. Verify your account for five free scans or check your paid allowance.") };
  }
  return {
    enforced: true,
    ok: true,
    reservationId: typeof data.reservation_id === "string" ? data.reservation_id : null,
    userId: user.id,
  };
}

// Free provider attempts are charged at reservation. Paid holds are charged only on success.
// A lost finalization keeps the paid hold in place, failing closed instead of overspending.
export async function consumeReservedScanCredit(reservation: ScanCreditReservation, env: BillingEnv, succeeded = true) {
  if (!reservation.ok || !reservation.enforced || !reservation.reservationId) return;
  const supabaseUrl = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim();
  const serviceRoleKey = getSupabaseAdminKey(env);
  if (!supabaseUrl || !serviceRoleKey) return;
  const supabase = createBillingClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await supabase.rpc("finalize_scan_credit", {
    p_user_id: reservation.userId,
    p_reservation_id: reservation.reservationId,
    p_succeeded: succeeded,
  });
  if (error) console.warn("[DeepSpec] Could not finalize a paid scan credit.");
}

export function listConfiguredPlans(env: BillingEnv) {
  const provider = resolveBillingProvider(env);
  const planEnvKeys = provider === "polar"
    ? POLAR_PRODUCT_ENV_KEYS
    : provider === "stripe"
      ? STRIPE_PRICE_ENV_KEYS
      : null;

  return REVENUE_PLANS.map((plan) => ({
    id: plan.id,
    configured: Boolean(planEnvKeys && env[planEnvKeys[plan.id]]?.trim()),
  }));
}

async function handleStripeEvent(
  event: { data?: { object?: unknown }; livemode?: boolean; type: string },
  supabase: BillingSupabaseClient,
  env: BillingEnv,
): Promise<{ handled: boolean } | { error: BillingErrorResponse }> {
  const stripeObject = isRecord(event.data?.object) ? event.data.object : null;
  if (!stripeObject) {
    return { error: errorResponse(400, "invalid_event", "Billing provider event is missing its data object.") };
  }

  if (event.type === "checkout.session.completed") {
    return writeCheckoutEntitlement(stripeObject, supabase);
  }

  if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    return updateSubscriptionEntitlement(stripeObject, supabase, env);
  }

  return { handled: false };
}

async function handlePolarEvent(
  event: { data?: unknown; type: string },
  supabase: BillingSupabaseClient,
  env: BillingEnv,
): Promise<{ handled: boolean } | { error: BillingErrorResponse }> {
  const polarObject = isRecord(event.data) ? event.data : null;
  if (!polarObject) {
    return { error: errorResponse(400, "invalid_event", "Billing provider event is missing its data object.") };
  }

  if (event.type === "order.paid") {
    return writePolarOrderEntitlement(polarObject, supabase, env);
  }

  if (
    event.type === "subscription.active" ||
    event.type === "subscription.updated" ||
    event.type === "subscription.canceled" ||
    event.type === "subscription.past_due" ||
    event.type === "subscription.revoked"
  ) {
    return updatePolarSubscriptionEntitlement(event.type, polarObject, supabase, env);
  }

  return { handled: false };
}

async function writeCheckoutEntitlement(
  session: SupabaseRow,
  supabase: BillingSupabaseClient,
): Promise<{ handled: boolean } | { error: BillingErrorResponse }> {
  const planId = getStringValue(getMetadata(session).deepspec_plan_id);
  const plan = getRevenuePlan(planId);
  if (!plan) {
    return { error: errorResponse(400, "invalid_plan", "Billing checkout session has no valid DeepSpec plan.") };
  }

  const userId = getStringValue(getMetadata(session).supabase_user_id) || getStringValue(session.client_reference_id);
  if (!userId) {
    return { error: errorResponse(400, "missing_user", "Billing checkout session has no DeepSpec user reference.") };
  }

  const customerId = getStringValue(session.customer);
  if (!customerId) {
    return { error: errorResponse(400, "missing_customer", "Billing checkout session has no customer id.") };
  }
  const checkoutId = getStringValue(session.id);
  if (!checkoutId) {
    return { error: errorResponse(400, "missing_checkout", "Billing checkout session has no checkout id.") };
  }

  return applyBillingPurchase(supabase, {
    additive: plan.billingMode === "payment",
    billingProvider: "stripe",
    currentPeriodEnd: getStripeTimestampIso(session.current_period_end),
    eventKey: checkoutId,
    planId: plan.id,
    providerCheckoutId: checkoutId,
    providerCustomerId: customerId,
    providerSubscriptionId: getStringValue(session.subscription) || null,
    scanAllowance: plan.scanAllowance,
    status: getCheckoutStatus(session),
    userId,
  });
}

async function writePolarOrderEntitlement(
  order: SupabaseRow,
  supabase: BillingSupabaseClient,
  env: BillingEnv,
): Promise<{ handled: boolean } | { error: BillingErrorResponse }> {
  if (order.paid === false) {
    return { error: errorResponse(400, "unpaid_order", "Billing order was not paid.") };
  }

  const planId = resolvePlanIdFromPolarObject(order, env);
  const plan = getRevenuePlan(planId);
  if (!plan) {
    return { error: errorResponse(400, "invalid_plan", "Billing order has no valid DeepSpec plan.") };
  }

  const customer = isRecord(order.customer) ? order.customer : null;
  const subscription = isRecord(order.subscription) ? order.subscription : null;
  const userId = getStringValue(getMetadata(order).supabase_user_id) || getStringValue(customer?.external_id);
  if (!userId) {
    return { error: errorResponse(400, "missing_user", "Billing order has no DeepSpec user reference.") };
  }

  const customerId = getStringValue(order.customer_id) || getStringValue(customer?.id);
  if (!customerId) {
    return { error: errorResponse(400, "missing_customer", "Billing order has no customer id.") };
  }
  const orderId = getStringValue(order.id);
  if (!orderId) {
    return { error: errorResponse(400, "missing_order", "Billing order has no order id.") };
  }
  const subscriptionId = getStringValue(order.subscription_id) || getStringValue(subscription?.id);

  return applyBillingPurchase(supabase, {
    additive: plan.billingMode === "payment",
    billingProvider: "polar",
    currentPeriodEnd: getIsoString(subscription?.current_period_end),
    eventKey: orderId,
    planId: plan.id,
    providerCheckoutId: getStringValue(order.checkout_id) || null,
    providerCustomerId: customerId,
    providerSubscriptionId: subscriptionId || null,
    scanAllowance: plan.scanAllowance,
    status: "active",
    userId,
  });
}

async function applyBillingPurchase(
  supabase: BillingSupabaseClient,
  purchase: {
    additive: boolean;
    billingProvider: "polar" | "stripe";
    currentPeriodEnd: string | null;
    eventKey: string;
    planId: PlanId;
    providerCheckoutId: string | null;
    providerCustomerId: string;
    providerSubscriptionId: string | null;
    scanAllowance: number;
    status: string;
    userId: string;
  },
): Promise<{ handled: boolean } | { error: BillingErrorResponse }> {
  const { error } = await supabase.rpc("apply_billing_purchase", {
    p_additive: purchase.additive,
    p_billing_provider: purchase.billingProvider,
    p_current_period_end: purchase.currentPeriodEnd,
    p_event_key: purchase.eventKey,
    p_plan_id: purchase.planId,
    p_provider_checkout_id: purchase.providerCheckoutId,
    p_provider_customer_id: purchase.providerCustomerId,
    p_provider_subscription_id: purchase.providerSubscriptionId,
    p_scan_allowance: purchase.scanAllowance,
    p_status: purchase.status,
    p_user_id: purchase.userId,
  });
  if (error) {
    return { error: errorResponse(502, "entitlement_write_failed", "DeepSpec could not activate paid access.") };
  }
  return { handled: true };
}

async function updateSubscriptionEntitlement(
  subscription: SupabaseRow,
  supabase: BillingSupabaseClient,
  env: BillingEnv,
): Promise<{ handled: boolean } | { error: BillingErrorResponse }> {
  const subscriptionId = getStringValue(subscription.id);
  const customerId = getStringValue(subscription.customer);
  if (!subscriptionId && !customerId) {
    return { error: errorResponse(400, "missing_subscription", "Billing subscription event has no subscription key.") };
  }

  const planId = resolvePlanIdFromStripeObject(subscription, env);
  const plan = planId ? getRevenuePlan(planId) : null;
  const userId = getStringValue(getMetadata(subscription).supabase_user_id);
  const updatePayload = removeUndefinedValues({
    current_period_end: getStripeTimestampIso(subscription.current_period_end),
    billing_provider: "stripe",
    plan_id: plan?.id,
    provider_customer_id: customerId || undefined,
    provider_subscription_id: subscriptionId || undefined,
    scan_allowance: plan?.scanAllowance,
    status: mapStripeSubscriptionStatus(getStringValue(subscription.status)),
    stripe_customer_id: customerId || undefined,
    stripe_subscription_id: subscriptionId || undefined,
    updated_at: new Date().toISOString(),
  });

  if (userId && plan && customerId) {
    const existing = await readExistingEntitlement(supabase, userId);
    if ("error" in existing) {
      return existing;
    }

    const { error } = await supabase
      .from("billing_entitlements")
      .upsert({
        ...updatePayload,
        billing_provider: "stripe",
        plan_id: plan.id,
        provider_customer_id: customerId,
        provider_subscription_id: subscriptionId || undefined,
        scan_allowance: plan.scanAllowance,
        stripe_customer_id: customerId,
        user_id: userId,
      }, { onConflict: "user_id" });

    if (error) {
      return { error: errorResponse(502, "entitlement_write_failed", "DeepSpec could not update paid access.") };
    }

    return { handled: true };
  }

  const updateResult = await updateEntitlementByProviderKey(supabase, subscriptionId, customerId, updatePayload);
  if ("error" in updateResult) {
    return updateResult;
  }

  return { handled: true };
}

async function updatePolarSubscriptionEntitlement(
  eventType: string,
  subscription: SupabaseRow,
  supabase: BillingSupabaseClient,
  env: BillingEnv,
): Promise<{ handled: boolean } | { error: BillingErrorResponse }> {
  const subscriptionId = getStringValue(subscription.id);
  const customer = isRecord(subscription.customer) ? subscription.customer : null;
  const customerId = getStringValue(subscription.customer_id) || getStringValue(customer?.id);
  if (!subscriptionId && !customerId) {
    return { error: errorResponse(400, "missing_subscription", "Billing subscription event has no subscription key.") };
  }

  const planId = resolvePlanIdFromPolarObject(subscription, env);
  const plan = planId ? getRevenuePlan(planId) : null;
  const userId = getStringValue(getMetadata(subscription).supabase_user_id) || getStringValue(customer?.external_id);
  const updatePayload = removeUndefinedValues({
    billing_provider: "polar",
    current_period_end: getIsoString(subscription.current_period_end),
    plan_id: plan?.id,
    provider_customer_id: customerId || undefined,
    provider_subscription_id: subscriptionId || undefined,
    scan_allowance: plan?.scanAllowance,
    status: mapPolarSubscriptionStatus(eventType, getStringValue(subscription.status)),
    updated_at: new Date().toISOString(),
  });

  if (userId && plan && customerId) {
    const existing = await readExistingEntitlement(supabase, userId);
    if ("error" in existing) {
      return existing;
    }

    const { error } = await supabase
      .from("billing_entitlements")
      .upsert({
        ...updatePayload,
        billing_provider: "polar",
        plan_id: plan.id,
        provider_customer_id: customerId,
        provider_subscription_id: subscriptionId || undefined,
        scan_allowance: plan.scanAllowance,
        user_id: userId,
      }, { onConflict: "user_id" });

    if (error) {
      return { error: errorResponse(502, "entitlement_write_failed", "DeepSpec could not update paid access.") };
    }

    return { handled: true };
  }

  const updateResult = await updateEntitlementByProviderKey(supabase, subscriptionId, customerId, updatePayload);
  if ("error" in updateResult) {
    return updateResult;
  }

  return { handled: true };
}

async function readExistingEntitlement(
  supabase: BillingSupabaseClient,
  userId: string,
): Promise<{ row: SupabaseRow | null } | { error: BillingErrorResponse }> {
  const { data, error } = await supabase
    .from("billing_entitlements")
    .select("scan_allowance,scans_used")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return { error: errorResponse(502, "entitlement_read_failed", "DeepSpec could not read existing paid access.") };
  }

  return {
    row: isRecord(data) ? data : null,
  };
}

async function updateEntitlementByProviderKey(
  supabase: BillingSupabaseClient,
  subscriptionId: string,
  customerId: string,
  payload: Record<string, unknown>,
): Promise<{ handled: boolean } | { error: BillingErrorResponse }> {
  const table = supabase.from("billing_entitlements");
  const query = subscriptionId
    ? table.update(payload).eq("provider_subscription_id", subscriptionId)
    : table.update(payload).eq("provider_customer_id", customerId);
  const { data, error } = await query.select("user_id");

  if (error) {
    return { error: errorResponse(502, "entitlement_write_failed", "DeepSpec could not update paid access.") };
  }

  if (!Array.isArray(data) || data.length !== 1) {
    return {
      error: errorResponse(
        503,
        "entitlement_update_missed",
        "DeepSpec could not match the billing event to exactly one paid-access record.",
      ),
    };
  }

  return { handled: true };
}

function parseCheckoutBody(body: unknown): { planId: PlanId } | { error: BillingErrorResponse } {
  if (!isRecord(body) || typeof body.planId !== "string") {
    return { error: errorResponse(400, "invalid_input", "Choose a DeepSpec plan before checkout.") };
  }

  if (!isPlanId(body.planId)) {
    return { error: errorResponse(400, "invalid_plan", "Choose a valid DeepSpec plan.") };
  }

  return {
    planId: body.planId,
  };
}

function getBillingRedirectOrigin(env: BillingEnv): string | null {
  const configured = env.DEEPSPEC_PUBLIC_URL?.trim();
  if (!configured) {
    return env.NODE_ENV === "production" || env.VERCEL_ENV === "production"
      ? null
      : "http://localhost:5174";
  }

  try {
    const url = new URL(configured);
    const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function billingRedirectConfigurationError(): BillingErrorResponse {
  return errorResponse(500, "redirect_not_configured", "Server billing redirects are not configured safely.");
}

function parseSignedStripeEvent(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  webhookSecret: string,
): { event: { data?: { object?: unknown }; livemode?: boolean; type: string } } | { error: BillingErrorResponse } {
  const signatureHeader = getHeaderValue(headers["stripe-signature"] ?? headers["Stripe-Signature"]);
  if (!signatureHeader) {
    return { error: errorResponse(400, "missing_signature", "Billing provider webhook signature is missing.") };
  }

  if (!isValidStripeSignature(rawBody, signatureHeader, webhookSecret)) {
    return { error: errorResponse(400, "invalid_signature", "Billing provider webhook signature could not be verified.") };
  }

  const payload = parseJson(rawBody);
  if (!isRecord(payload) || typeof payload.type !== "string") {
    return { error: errorResponse(400, "invalid_payload", "Billing provider webhook payload is invalid.") };
  }

  return {
    event: {
      data: isRecord(payload.data) ? { object: payload.data.object } : undefined,
      livemode: typeof payload.livemode === "boolean" ? payload.livemode : undefined,
      type: payload.type,
    },
  };
}

function parseSignedStandardWebhookEvent(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  webhookSecret: string,
): { event: { data?: unknown; type: string } } | { error: BillingErrorResponse } {
  const webhookId = getHeaderValue(headers["webhook-id"] ?? headers["Webhook-Id"]);
  const webhookTimestamp = getHeaderValue(headers["webhook-timestamp"] ?? headers["Webhook-Timestamp"]);
  const webhookSignature = getHeaderValue(headers["webhook-signature"] ?? headers["Webhook-Signature"]);
  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return { error: errorResponse(400, "missing_signature", "Billing provider webhook signature is missing.") };
  }

  if (!isValidStandardWebhookSignature(rawBody, webhookId, webhookTimestamp, webhookSignature, webhookSecret)) {
    return { error: errorResponse(400, "invalid_signature", "Billing provider webhook signature could not be verified.") };
  }

  const payload = parseJson(rawBody);
  if (!isRecord(payload) || typeof payload.type !== "string") {
    return { error: errorResponse(400, "invalid_payload", "Billing provider webhook payload is invalid.") };
  }

  return {
    event: {
      data: payload.data,
      type: payload.type,
    },
  };
}

function isValidStripeSignature(rawBody: string, signatureHeader: string, webhookSecret: string) {
  const parsed = parseStripeSignatureHeader(signatureHeader);
  if (!parsed || parsed.signatures.length === 0) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > STRIPE_SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const expected = createHmac("sha256", webhookSecret)
    .update(`${parsed.timestamp}.${rawBody}`, "utf8")
    .digest("hex");

  return parsed.signatures.some((signature) => secureCompareHex(signature, expected));
}

function parseStripeSignatureHeader(signatureHeader: string) {
  const pairs = signatureHeader.split(",").map((part) => part.split("="));
  const timestamp = Number(pairs.find(([key]) => key === "t")?.[1]);
  const signatures = pairs
    .filter(([key, value]) => key === "v1" && typeof value === "string")
    .map(([, value]) => value.trim())
    .filter(Boolean);

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return {
    signatures,
    timestamp,
  };
}

function secureCompareHex(candidate: string, expected: string) {
  if (!/^[0-9a-f]+$/i.test(candidate)) {
    return false;
  }

  const candidateBuffer = Buffer.from(candidate, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
}

function isValidStandardWebhookSignature(
  rawBody: string,
  webhookId: string,
  webhookTimestamp: string,
  webhookSignature: string,
  webhookSecret: string,
) {
  if (webhookId.includes(".") || webhookTimestamp.includes(".")) {
    return false;
  }

  const timestamp = Number(webhookTimestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > STANDARD_WEBHOOK_TOLERANCE_SECONDS) {
    return false;
  }

  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const candidates = webhookSignature
    .split(" ")
    .map((signature) => signature.trim())
    .filter(Boolean)
    .map((signature) => signature.split(","))
    .filter(([version]) => version === "v1")
    .map(([, value]) => value);

  return getStandardWebhookKeys(webhookSecret).some((key) => {
    const expected = createHmac("sha256", key).update(signedContent, "utf8").digest("base64");
    return candidates.some((candidate) => secureCompareBase64(candidate, expected));
  });
}

// Polar signs with one of two keys depending on when the secret was created, and its own SDKs try
// both: a whsec_ secret is base64 (Standard Webhooks), while an older secret's raw string is the key
// (Polar's docs: base64-encode it before handing it to a Standard Webhooks library).
function getStandardWebhookKeys(webhookSecret: string): Buffer[] {
  const encoded = webhookSecret.startsWith("whsec_") ? webhookSecret.slice("whsec_".length) : webhookSecret;
  // An empty key (a secret with nothing decodable in it) would let anyone compute a valid HMAC.
  return [Buffer.from(encoded, "base64"), Buffer.from(webhookSecret, "utf8")].filter((key) => key.length > 0);
}

function secureCompareBase64(candidate: string | undefined, expected: string) {
  if (!candidate) {
    return false;
  }

  let candidateBuffer: Buffer;
  let expectedBuffer: Buffer;
  try {
    candidateBuffer = Buffer.from(candidate, "base64");
    expectedBuffer = Buffer.from(expected, "base64");
  } catch {
    return false;
  }

  return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
}

function parseBearerToken(value: string | string[] | undefined) {
  const header = Array.isArray(value) ? value[0] : value;
  const match = typeof header === "string" ? header.match(/^Bearer\s+(.+)$/i) : null;
  return match?.[1]?.trim() || "";
}

async function verifyBillingUser(
  headers: Record<string, string | string[] | undefined>,
  env: BillingEnv,
): Promise<{ userId: string } | { error: BillingErrorResponse }> {
  const supabaseUrl = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim();
  const serviceRoleKey = getSupabaseAdminKey(env);
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      error: errorResponse(500, "not_configured", "Server billing user verification is not configured."),
    };
  }

  const token = parseBearerToken(headers.authorization ?? headers.Authorization);
  if (!token) {
    return {
      error: errorResponse(401, "missing_session", "Sign in before starting DeepSpec checkout."),
    };
  }

  const supabase = createBillingClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return {
      error: errorResponse(401, "invalid_session", "DeepSpec could not verify this account session."),
    };
  }

  if (data.user.is_anonymous === true || (!data.user.email_confirmed_at && !data.user.phone_confirmed_at)) {
    return {
      error: errorResponse(403, "verification_required", "Verify your DeepSpec account before starting checkout."),
    };
  }

  return {
    userId: data.user.id,
  };
}

async function readVerifiedBillingEntitlement(
  headers: Record<string, string | string[] | undefined>,
  env: BillingEnv,
): Promise<{ row: SupabaseRow | null; userId: string } | { error: BillingErrorResponse }> {
  const supabaseUrl = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim();
  const serviceRoleKey = getSupabaseAdminKey(env);
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      error: errorResponse(500, "not_configured", "Server entitlement verification is not configured."),
    };
  }

  const token = parseBearerToken(headers.authorization ?? headers.Authorization);
  if (!token) {
    return {
      error: errorResponse(401, "missing_session", "Sign in before opening DeepSpec billing."),
    };
  }

  const supabase = createBillingClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return {
      error: errorResponse(401, "invalid_session", "DeepSpec could not verify this account session."),
    };
  }

  const { data, error } = await supabase
    .from("billing_entitlements")
    .select("billing_provider,provider_customer_id,stripe_customer_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (error) {
    return {
      error: errorResponse(502, "entitlement_unavailable", "DeepSpec could not read server entitlement state."),
    };
  }

  const row = isRecord(data) ? data : null;
  const provider = resolveBillingProvider(env);
  if (row?.billing_provider && row.billing_provider !== provider) {
    return {
      error: errorResponse(400, "provider_mismatch", "This account was billed through a different provider."),
    };
  }

  return {
    row,
    userId: userData.user.id,
  };
}

function resolveBillingProvider(env: BillingEnv): BillingProvider {
  const configured = env.BILLING_PROVIDER?.trim().toLowerCase();
  if (configured === "polar") {
    return "polar";
  }

  return configured === "stripe" ? "stripe" : "unconfigured";
}

function blockLiveBillingUnlessEnabled(env: BillingEnv, provider: BillingProvider) {
  if (!isLiveBillingMode(env, provider)) {
    return null;
  }

  return env.DEEPSPEC_ENABLE_LIVE_BILLING === "true"
    ? null
    : errorResponse(403, "live_billing_disabled", "Live billing is disabled on this server.");
}

function isLiveBillingMode(env: BillingEnv, provider: BillingProvider) {
  if (provider === "polar") {
    return env.POLAR_ENVIRONMENT?.trim().toLowerCase() === "production";
  }

  if (provider === "stripe") {
    return env.STRIPE_SECRET_KEY?.trim().startsWith("sk_live_") === true;
  }

  return false;
}

function isServerEntitlementStatus(value: unknown): value is ServerEntitlement["status"] {
  return value === "active" || value === "past_due" || value === "canceled" || value === "inactive" || value === "free";
}

async function postStripeSession(url: string, params: URLSearchParams, secretKey: string): Promise<BillingResponse> {
  return withBillingProviderTimeout(async (signal) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
      signal,
    });
    const payload = await readProviderJson(response, signal);
    if (!response.ok || !isRecord(payload) || typeof payload.url !== "string") {
      return errorResponse(response.ok ? 502 : response.status, "stripe_error", BILLING_PROVIDER_ERROR_MESSAGE);
    }

    return {
      status: 200,
      body: {
        url: payload.url,
      },
    };
  });
}

async function postPolarJson(
  url: string,
  payload: Record<string, unknown>,
  accessToken: string,
  urlField: "customer_portal_url" | "url",
): Promise<BillingResponse> {
  return withBillingProviderTimeout(async (signal) => {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal,
    });
    const responseBody = await readProviderJson(response, signal);
    if (!response.ok || !isRecord(responseBody) || typeof responseBody[urlField] !== "string") {
      return errorResponse(response.ok ? 502 : response.status, "polar_error", BILLING_PROVIDER_ERROR_MESSAGE);
    }

    return {
      status: 200,
      body: {
        url: responseBody[urlField],
      },
    };
  });
}

async function withBillingProviderTimeout(
  operation: (signal: AbortSignal) => Promise<BillingResponse>,
): Promise<BillingResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BILLING_PROVIDER_TIMEOUT_MS);

  try {
    return await operation(controller.signal);
  } catch {
    return controller.signal.aborted
      ? errorResponse(504, "provider_timeout", BILLING_PROVIDER_TIMEOUT_MESSAGE)
      : errorResponse(502, "provider_unreachable", "DeepSpec could not reach the billing provider.");
  } finally {
    clearTimeout(timeout);
  }
}

async function readProviderJson(response: Response, signal: AbortSignal): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    return null;
  }
}

function getPolarApiBaseUrl(env: BillingEnv) {
  const configured = env.POLAR_API_BASE_URL?.trim().replace(/\/$/, "");
  if (configured) {
    return configured;
  }

  return env.POLAR_ENVIRONMENT?.trim().toLowerCase() === "production"
    ? POLAR_API_BASE_URL
    : POLAR_SANDBOX_API_BASE_URL;
}

function resolvePlanIdFromStripeObject(value: SupabaseRow, env: BillingEnv) {
  const metadataPlanId = getStringValue(getMetadata(value).deepspec_plan_id);
  if (isPlanId(metadataPlanId)) {
    return metadataPlanId;
  }

  const priceId = getNestedStripePriceId(value);
  const match = REVENUE_PLANS.find((plan) => env[STRIPE_PRICE_ENV_KEYS[plan.id]]?.trim() === priceId);
  return match?.id ?? "";
}

function resolvePlanIdFromPolarObject(value: SupabaseRow, env: BillingEnv) {
  const metadataPlanId = getStringValue(getMetadata(value).deepspec_plan_id);
  if (isPlanId(metadataPlanId)) {
    return metadataPlanId;
  }

  const productId = getStringValue(value.product_id) || getStringValue((isRecord(value.product) ? value.product : null)?.id);
  const match = REVENUE_PLANS.find((plan) => env[POLAR_PRODUCT_ENV_KEYS[plan.id]]?.trim() === productId);
  return match?.id ?? "";
}

function getNestedStripePriceId(value: SupabaseRow) {
  const items = isRecord(value.items) ? value.items : null;
  const data = Array.isArray(items?.data) ? items.data : [];
  for (const item of data) {
    if (!isRecord(item) || !isRecord(item.price)) {
      continue;
    }

    const priceId = getStringValue(item.price.id);
    if (priceId) {
      return priceId;
    }
  }

  return "";
}

function getMetadata(value: SupabaseRow) {
  return isRecord(value.metadata) ? value.metadata : {};
}

function getCheckoutStatus(session: SupabaseRow) {
  const paymentStatus = getStringValue(session.payment_status);
  return paymentStatus === "paid" || paymentStatus === "no_payment_required" ? "active" : "inactive";
}

function mapStripeSubscriptionStatus(status: string) {
  if (status === "active" || status === "trialing") {
    return "active";
  }

  if (status === "past_due") {
    return "past_due";
  }

  if (status === "canceled" || status === "unpaid" || status === "paused" || status === "incomplete_expired") {
    return "canceled";
  }

  return "inactive";
}

function mapPolarSubscriptionStatus(eventType: string, status: string) {
  if (eventType === "subscription.active" || status === "active" || status === "trialing") {
    return "active";
  }

  if (eventType === "subscription.past_due" || status === "past_due") {
    return "past_due";
  }

  if (
    eventType === "subscription.canceled" ||
    eventType === "subscription.revoked" ||
    status === "canceled" ||
    status === "revoked" ||
    status === "incomplete_expired"
  ) {
    return "canceled";
  }

  return status ? "inactive" : undefined;
}

function getStripeTimestampIso(value: unknown) {
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return new Date(seconds * 1000).toISOString();
}

function getIsoString(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function removeUndefinedValues(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined));
}

function getStringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isPlanId(value: string): value is PlanId {
  return value === "plus_monthly" || value === "plus_yearly" || value === "scan_pack" || value === "pro_beta";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorResponse(status: number, code: string, message: string): BillingErrorResponse {
  return {
    status,
    body: {
      error: {
        code,
        message,
      },
    },
  };
}

function entitlementErrorResponse(status: number, code: string, message: string): EntitlementResponse {
  return {
    status,
    body: {
      error: {
        code,
        message,
      },
    },
  };
}
