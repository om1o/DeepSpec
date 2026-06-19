import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { REVENUE_PLANS, getRevenuePlan, type PlanId, type ServerEntitlement } from "../src/services/revenue";

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
      scansUsed: number;
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
type BillingProvider = "stripe" | "unconfigured";
type SupabaseRow = Record<string, unknown>;
type BillingSupabaseClient = {
  auth: {
    getUser: (token: string) => Promise<{
      data: {
        user?: {
          id: string;
        } | null;
      };
      error: unknown;
    }>;
  };
  from: (table: string) => BillingSupabaseTable;
};
type BillingSupabaseOptions = {
  auth: {
    autoRefreshToken: boolean;
    persistSession: boolean;
  };
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
  update: (values: Record<string, unknown>) => {
    eq: (column: string, value: string) => PromiseLike<{
      error: unknown;
    }>;
  };
  upsert: (values: Record<string, unknown>, options?: { onConflict?: string }) => PromiseLike<{
    error: unknown;
  }>;
};
const createBillingClient = createClient as unknown as (
  supabaseUrl: string,
  serviceRoleKey: string,
  options: BillingSupabaseOptions,
) => BillingSupabaseClient;

const STRIPE_CHECKOUT_URL = "https://api.stripe.com/v1/checkout/sessions";
const STRIPE_PORTAL_URL = "https://api.stripe.com/v1/billing_portal/sessions";
const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

const PRICE_ENV_KEYS: Record<PlanId, string> = {
  plus_monthly: "STRIPE_PRICE_DEEPSPEC_PLUS_MONTHLY",
  plus_yearly: "STRIPE_PRICE_DEEPSPEC_PLUS_YEARLY",
  scan_pack: "STRIPE_PRICE_DEEPSPEC_SCAN_PACK",
  pro_beta: "STRIPE_PRICE_DEEPSPEC_PRO_BETA",
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
  if (provider !== "stripe") {
    return errorResponse(500, "not_configured", "Billing provider checkout is not configured on this server.");
  }

  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return errorResponse(500, "not_configured", "Billing provider checkout is not configured on this server.");
  }

  const priceId = env[PRICE_ENV_KEYS[plan.id]]?.trim();
  if (!priceId) {
    return errorResponse(500, "not_configured", `Billing provider price is missing for ${plan.name}.`);
  }

  const verifiedUser = await verifyBillingUser(headers, env);
  if ("error" in verifiedUser) {
    return verifiedUser.error;
  }

  const origin = parsed.origin || env.DEEPSPEC_PUBLIC_URL || "http://localhost:5174";
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

export async function createPortalResponse(body: unknown, env: BillingEnv): Promise<BillingResponse> {
  const provider = resolveBillingProvider(env);
  if (provider !== "stripe") {
    return errorResponse(500, "not_configured", "Billing provider customer portal is not configured on this server.");
  }

  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return errorResponse(500, "not_configured", "Billing provider customer portal is not configured on this server.");
  }

  if (!isRecord(body) || typeof body.stripeCustomerId !== "string" || !body.stripeCustomerId.trim()) {
    return errorResponse(400, "missing_customer", "A provider customer id is required for the billing portal.");
  }

  const origin = typeof body.origin === "string" && body.origin.trim()
    ? body.origin.trim()
    : env.DEEPSPEC_PUBLIC_URL || "http://localhost:5174";
  const params = new URLSearchParams({
    customer: body.stripeCustomerId.trim(),
    return_url: `${origin.replace(/\/$/, "")}/account`,
  });

  return postStripeSession(STRIPE_PORTAL_URL, params, secretKey);
}

export async function createWebhookResponse(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  env: BillingEnv,
): Promise<WebhookResponse> {
  const provider = resolveBillingProvider(env);
  if (provider !== "stripe") {
    return errorResponse(500, "not_configured", "Billing provider webhook verification is not configured on this server.");
  }

  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return errorResponse(500, "not_configured", "Billing provider webhook verification is not configured on this server.");
  }

  const supabaseUrl = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse(500, "not_configured", "Server entitlement writes are not configured.");
  }

  const parsedEvent = parseSignedStripeEvent(rawBody, headers, webhookSecret);
  if ("error" in parsedEvent) {
    return parsedEvent.error;
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

export async function createAccountEntitlementResponse(
  headers: Record<string, string | string[] | undefined>,
  env: BillingEnv,
): Promise<EntitlementResponse> {
  const supabaseUrl = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
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

  const { data, error } = await supabase
    .from("billing_entitlements")
    .select("billing_provider,plan_id,status,scan_allowance,scans_used,current_period_end")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (error) {
    return entitlementErrorResponse(502, "entitlement_unavailable", "DeepSpec could not read server entitlement state.");
  }

  if (!isRecord(data) || !isPlanId(String(data.plan_id ?? ""))) {
    return {
      status: 200,
      body: {
        entitlement: {
          status: "free",
          verifiedAt: new Date().toISOString(),
        },
      },
    };
  }

  const planId = String(data.plan_id) as PlanId;
  const plan = getRevenuePlan(planId);
  return {
    status: 200,
    body: {
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
  if (env.DEEPSPEC_ENFORCE_SCAN_CREDITS !== "true") {
    return { enforced: false, ok: true };
  }

  const supabaseUrl = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return { ok: false, error: errorResponse(500, "not_configured", "Server-side scan credit enforcement is not configured.") };
  }

  const token = parseBearerToken(headers.authorization ?? headers.Authorization);
  if (!token) {
    return { ok: false, error: errorResponse(401, "missing_session", "Sign in before using paid DeepSpec scans.") };
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

  const { data, error } = await supabase
    .from("billing_entitlements")
    .select("status,scan_allowance,scans_used")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (error) {
    return { ok: false, error: errorResponse(502, "entitlement_unavailable", "DeepSpec could not read scan credit state.") };
  }

  const allowance = Number(isRecord(data) ? data.scan_allowance : 0);
  const scansUsed = Number(isRecord(data) ? data.scans_used : 0);
  const status = isRecord(data) ? data.status : "";
  if (status !== "active" || !Number.isFinite(allowance) || !Number.isFinite(scansUsed) || scansUsed >= allowance) {
    return { ok: false, error: errorResponse(402, "scan_limit_reached", "No verified paid scan credits are available.") };
  }

  return {
    enforced: true,
    ok: true,
    scansUsed,
    userId: userData.user.id,
  };
}

export async function consumeReservedScanCredit(reservation: ScanCreditReservation, env: BillingEnv) {
  if (!reservation.ok || !reservation.enforced) {
    return;
  }

  const supabaseUrl = env.SUPABASE_URL?.trim() || env.VITE_SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return;
  }

  const supabase = createBillingClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  await supabase
    .from("billing_entitlements")
    .update({
      scans_used: reservation.scansUsed + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", reservation.userId);
}

export function listConfiguredPlans(env: BillingEnv) {
  return REVENUE_PLANS.map((plan) => ({
    id: plan.id,
    configured: Boolean(env[PRICE_ENV_KEYS[plan.id]]?.trim()),
  }));
}

async function handleStripeEvent(
  event: { data?: { object?: unknown }; type: string },
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

  const existing = await readExistingEntitlement(supabase, userId);
  if ("error" in existing) {
    return existing;
  }

  const currentAllowance = Math.max(0, Number(existing.row?.scan_allowance ?? 0));
  const currentScansUsed = Math.max(0, Number(existing.row?.scans_used ?? 0));
  const scanAllowance = plan.billingMode === "payment" && Number.isFinite(currentAllowance)
    ? currentAllowance + plan.scanAllowance
    : plan.scanAllowance;

  const { error } = await supabase
    .from("billing_entitlements")
    .upsert({
      current_period_end: getStripeTimestampIso(session.current_period_end),
      billing_provider: "stripe",
      plan_id: plan.id,
      provider_checkout_id: getStringValue(session.id) || null,
      provider_customer_id: customerId,
      provider_subscription_id: getStringValue(session.subscription) || null,
      scan_allowance: scanAllowance,
      scans_used: Number.isFinite(currentScansUsed) ? currentScansUsed : 0,
      status: getCheckoutStatus(session),
      stripe_checkout_session_id: getStringValue(session.id) || null,
      stripe_customer_id: customerId,
      stripe_subscription_id: getStringValue(session.subscription) || null,
      updated_at: new Date().toISOString(),
      user_id: userId,
    }, { onConflict: "user_id" });

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

    const currentScansUsed = Math.max(0, Number(existing.row?.scans_used ?? 0));
    const { error } = await supabase
      .from("billing_entitlements")
      .upsert({
        ...updatePayload,
        billing_provider: "stripe",
        plan_id: plan.id,
        provider_customer_id: customerId,
        provider_subscription_id: subscriptionId || undefined,
        scan_allowance: plan.scanAllowance,
        scans_used: Number.isFinite(currentScansUsed) ? currentScansUsed : 0,
        stripe_customer_id: customerId,
        user_id: userId,
      }, { onConflict: "user_id" });

    if (error) {
      return { error: errorResponse(502, "entitlement_write_failed", "DeepSpec could not update paid access.") };
    }

    return { handled: true };
  }

  const updateResult = await updateEntitlementByStripeKey(supabase, subscriptionId, customerId, updatePayload);
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

async function updateEntitlementByStripeKey(
  supabase: BillingSupabaseClient,
  subscriptionId: string,
  customerId: string,
  payload: Record<string, unknown>,
): Promise<{ handled: boolean } | { error: BillingErrorResponse }> {
  const table = supabase.from("billing_entitlements");
  const query = subscriptionId
    ? table.update(payload).eq("provider_subscription_id", subscriptionId)
    : table.update(payload).eq("provider_customer_id", customerId);
  const { error } = await query;

  if (error) {
    return { error: errorResponse(502, "entitlement_write_failed", "DeepSpec could not update paid access.") };
  }

  return { handled: true };
}

function parseCheckoutBody(body: unknown): { planId: PlanId; origin: string } | { error: BillingErrorResponse } {
  if (!isRecord(body) || typeof body.planId !== "string") {
    return { error: errorResponse(400, "invalid_input", "Choose a DeepSpec plan before checkout.") };
  }

  if (!isPlanId(body.planId)) {
    return { error: errorResponse(400, "invalid_plan", "Choose a valid DeepSpec plan.") };
  }

  return {
    planId: body.planId,
    origin: typeof body.origin === "string" ? body.origin.trim().slice(0, 200) : "",
  };
}

function parseSignedStripeEvent(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  webhookSecret: string,
): { event: { data?: { object?: unknown }; type: string } } | { error: BillingErrorResponse } {
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
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
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

  return {
    userId: data.user.id,
  };
}

function resolveBillingProvider(env: BillingEnv): BillingProvider {
  const configured = env.BILLING_PROVIDER?.trim().toLowerCase();
  return configured === "stripe" ? "stripe" : "unconfigured";
}

function isServerEntitlementStatus(value: unknown): value is ServerEntitlement["status"] {
  return value === "active" || value === "past_due" || value === "canceled" || value === "inactive" || value === "free";
}

async function postStripeSession(url: string, params: URLSearchParams, secretKey: string): Promise<BillingResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  }).catch(() => null);

  if (!response) {
    return errorResponse(502, "provider_unreachable", "DeepSpec could not reach the billing provider.");
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || !isRecord(payload) || typeof payload.url !== "string") {
    const message = getStripeErrorMessage(payload);
    return errorResponse(response.status, "stripe_error", message);
  }

  return {
    status: 200,
    body: {
      url: payload.url,
    },
  };
}

function resolvePlanIdFromStripeObject(value: SupabaseRow, env: BillingEnv) {
  const metadataPlanId = getStringValue(getMetadata(value).deepspec_plan_id);
  if (isPlanId(metadataPlanId)) {
    return metadataPlanId;
  }

  const priceId = getNestedStripePriceId(value);
  const match = REVENUE_PLANS.find((plan) => env[PRICE_ENV_KEYS[plan.id]]?.trim() === priceId);
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

function getStripeTimestampIso(value: unknown) {
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return new Date(seconds * 1000).toISOString();
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

function getStripeErrorMessage(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.error) || typeof payload.error.message !== "string") {
    return "The billing provider could not create a billing session.";
  }

  return payload.error.message;
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
