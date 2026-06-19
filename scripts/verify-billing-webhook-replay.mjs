import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const PLAN_ALLOWANCE = {
  plus_monthly: 100,
  plus_yearly: 1200,
  scan_pack: 20,
  pro_beta: 500,
};
const DEFAULT_SUMMARY_PATH = "artifacts/release-gates/billing-webhook-replay-summary.json";

loadLocalEnv(".env.local");
loadLocalEnv(".env");

export function buildPolarOrderPaidPayload({
  customerId,
  planId = "scan_pack",
  testId = randomUUID(),
  timestamp = new Date().toISOString(),
  userId,
}) {
  if (!userId) {
    throw new Error("userId is required.");
  }

  const scanAllowance = PLAN_ALLOWANCE[planId];
  if (!scanAllowance) {
    throw new Error(`Unsupported plan id: ${planId}`);
  }

  const safeTestId = testId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const providerCustomerId = customerId || `polar-customer-${safeTestId}`;

  return {
    data: {
      checkout_id: `polar-checkout-${safeTestId}`,
      customer: {
        external_id: userId,
        id: providerCustomerId,
      },
      customer_id: providerCustomerId,
      id: `polar-order-${safeTestId}`,
      metadata: {
        deepspec_plan_id: planId,
        scan_allowance: scanAllowance,
        supabase_user_id: userId,
      },
      paid: true,
    },
    timestamp,
    type: "order.paid",
  };
}

export function buildStripeCheckoutCompletedPayload({
  customerId,
  planId = "scan_pack",
  subscriptionId = "",
  testId = randomUUID(),
  timestamp = Math.floor(Date.now() / 1000),
  userId,
}) {
  if (!userId) {
    throw new Error("userId is required.");
  }

  const scanAllowance = PLAN_ALLOWANCE[planId];
  if (!scanAllowance) {
    throw new Error(`Unsupported plan id: ${planId}`);
  }

  const safeTestId = testId.replace(/[^a-zA-Z0-9_-]/g, "-");
  const providerCustomerId = customerId || `cus_${safeTestId}`;

  return {
    created: timestamp,
    data: {
      object: {
        client_reference_id: userId,
        customer: providerCustomerId,
        current_period_end: timestamp + 30 * 24 * 60 * 60,
        id: `cs_test_${safeTestId}`,
        metadata: {
          deepspec_plan_id: planId,
          scan_allowance: scanAllowance,
          supabase_user_id: userId,
        },
        payment_status: "paid",
        subscription: subscriptionId || null,
      },
    },
    livemode: false,
    type: "checkout.session.completed",
  };
}

export function signStripeWebhookBody(rawBody, webhookSecret, options = {}) {
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");

  return {
    "stripe-signature": `t=${timestamp},v1=${signature}`,
  };
}

export function signStandardWebhookBody(rawBody, webhookSecret, options = {}) {
  const webhookId = options.webhookId || `msg_${randomUUID()}`;
  const webhookTimestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const secret = decodeStandardWebhookSecret(webhookSecret);
  if (!secret) {
    throw new Error("POLAR_WEBHOOK_SECRET is not a valid Standard Webhooks base64 secret.");
  }

  const signature = createHmac("sha256", secret)
    .update(`${webhookId}.${webhookTimestamp}.${rawBody}`, "utf8")
    .digest("base64");

  return {
    "webhook-id": webhookId,
    "webhook-signature": `v1,${signature}`,
    "webhook-timestamp": webhookTimestamp,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baseUrl = options.url || process.env.QA_BASE_URL || process.env.DEEPSPEC_PUBLIC_URL || "http://127.0.0.1:5175";
  const env = readRequiredEnv(options);

  console.log(`[0/5] Target: ${baseUrl}`);
  console.log(`      Provider: ${env.provider}`);
  console.log("      This verifier creates a synthetic anonymous Supabase user and cleans up only that user's synthetic billing entitlement.");
  if (env.provider === "stripe") {
    console.log("      Stripe mode also creates and deletes one test-mode Stripe customer. It does not make a payment.");
  }

  const publicClient = createClient(env.supabaseUrl, env.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const adminClient = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  let userId = "";
  let providerCustomerId = "";
  try {
    console.log("[1/5] Creating synthetic anonymous test user...");
    const { data, error } = await publicClient.auth.signInAnonymously();
    if (error || !data.user || !data.session?.access_token) {
      throw new Error(`Anonymous sign-in failed: ${error?.message ?? "No user/session returned."}`);
    }
    userId = data.user.id;

    console.log(`[2/5] Posting signed synthetic ${env.provider} webhook...`);
    const testId = `billing-replay-${randomUUID()}`;
    if (env.provider === "stripe") {
      const customer = await createStripeTestCustomer(env.stripeSecretKey, {
        testId,
        userId,
      });
      providerCustomerId = customer.id;
    }

    const payload = env.provider === "stripe"
      ? buildStripeCheckoutCompletedPayload({
          customerId: providerCustomerId,
          planId: options.planId,
          testId,
          userId,
        })
      : buildPolarOrderPaidPayload({
          planId: options.planId,
          testId,
          userId,
        });
    const rawBody = JSON.stringify(payload);
    const webhookHeaders = env.provider === "stripe"
      ? signStripeWebhookBody(rawBody, env.stripeWebhookSecret, { timestamp: payload.created })
      : signStandardWebhookBody(rawBody, env.polarWebhookSecret, {
          webhookId: `msg_${testId}`,
        });
    const webhookResponse = await postJsonAsRawText(`${baseUrl.replace(/\/$/, "")}/api/billing-webhook`, rawBody, webhookHeaders);
    if (!webhookResponse.ok || webhookResponse.body?.received !== true || webhookResponse.body?.handled !== true) {
      throw new Error(`Webhook replay failed: HTTP ${webhookResponse.status} ${webhookResponse.bodyText}`);
    }

    console.log("[3/5] Verifying account entitlement through public account API...");
    const entitlementResponse = await fetchJson(`${baseUrl.replace(/\/$/, "")}/api/account-entitlement`, {
      Authorization: `Bearer ${data.session.access_token}`,
    });
    if (!entitlementResponse.ok) {
      throw new Error(`Account entitlement check failed: HTTP ${entitlementResponse.status} ${entitlementResponse.bodyText}`);
    }

    const entitlement = entitlementResponse.body?.entitlement;
    const expectedAllowance = PLAN_ALLOWANCE[options.planId];
    if (
      entitlement?.status !== "active" ||
      entitlement?.planId !== options.planId ||
      Number(entitlement?.scanAllowance) !== expectedAllowance ||
      entitlement?.billingProvider !== env.provider
    ) {
      throw new Error(`Account entitlement mismatch: ${JSON.stringify(entitlement)}`);
    }

    console.log("[4/5] Verifying billing portal handoff from server entitlement...");
    const portalResponse = await postJson(`${baseUrl.replace(/\/$/, "")}/api/billing-portal`, {
      origin: baseUrl,
    }, {
      Authorization: `Bearer ${data.session.access_token}`,
    });
    if (!portalResponse.ok) {
      throw new Error(`Billing portal check failed: HTTP ${portalResponse.status} ${portalResponse.bodyText}`);
    }

    const portal = classifyProviderPortalUrl(portalResponse.body?.url, entitlement.billingProvider);
    if (!portal.ok) {
      throw new Error(portal.message);
    }

    console.log("      Portal handoff verified.");
    console.log("[5/5] Entitlement replay verified.");
    console.log(`      Plan=${entitlement.planId} allowance=${entitlement.scanAllowance} provider=${entitlement.billingProvider}`);
    writeSummary(options.summaryPath, {
      baseUrl,
      ok: true,
      planId: entitlement.planId,
      portalOrigin: portal.origin,
      portalVerified: true,
      provider: entitlement.billingProvider,
      scanAllowance: entitlement.scanAllowance,
      verifiedAt: new Date().toISOString(),
    });
  } finally {
    if (providerCustomerId && env.provider === "stripe" && !options.keepProviderCustomer) {
      await deleteStripeTestCustomer(env.stripeSecretKey, providerCustomerId);
      console.log("[cleanup] Deleted synthetic Stripe test customer.");
    } else if (providerCustomerId && env.provider === "stripe") {
      console.log("[cleanup] Kept synthetic Stripe test customer because --keep-provider-customer was set.");
    }

    if (userId && !options.keepEntitlement) {
      await adminClient.from("billing_entitlements").delete().eq("user_id", userId);
      console.log("[cleanup] Cleaned up synthetic billing entitlement row.");
    } else if (userId) {
      console.log("[cleanup] Kept synthetic billing entitlement row because --keep-entitlement was set.");
    }
  }
}

function readRequiredEnv(options) {
  const billingProvider = String(options.provider || process.env.BILLING_PROVIDER || "").trim().toLowerCase();
  if (billingProvider !== "polar" && billingProvider !== "stripe") {
    throw new Error("Set BILLING_PROVIDER to polar or stripe before running the billing webhook replay.");
  }

  const supabaseUrl = String(process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
  const publishableKey = String(process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const polarWebhookSecret = String(process.env.POLAR_WEBHOOK_SECRET ?? "").trim();
  const stripeSecretKey = String(process.env.STRIPE_SECRET_KEY ?? "").trim();
  const stripeWebhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();

  const missing = [
    ["VITE_SUPABASE_URL or SUPABASE_URL", supabaseUrl],
    ["VITE_SUPABASE_PUBLISHABLE_KEY", publishableKey],
    ["SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey],
    ...(billingProvider === "polar"
      ? [["POLAR_WEBHOOK_SECRET", polarWebhookSecret]]
      : [
          ["STRIPE_SECRET_KEY", stripeSecretKey],
          ["STRIPE_WEBHOOK_SECRET", stripeWebhookSecret],
        ]),
  ].filter(([, value]) => !value);

  if (missing.length) {
    throw new Error(`Missing required env: ${missing.map(([key]) => key).join(", ")}`);
  }

  if (billingProvider === "polar" && !decodeStandardWebhookSecret(polarWebhookSecret)) {
    throw new Error("POLAR_WEBHOOK_SECRET is not a valid Standard Webhooks base64 secret.");
  }

  if (billingProvider === "stripe" && !stripeSecretKey.startsWith("sk_test_")) {
    throw new Error("Stripe webhook replay requires a test-mode STRIPE_SECRET_KEY. Do not run synthetic replay against live Stripe.");
  }

  if (billingProvider === "stripe" && !stripeWebhookSecret.startsWith("whsec_")) {
    throw new Error("STRIPE_WEBHOOK_SECRET must use the expected whsec_ prefix.");
  }

  return {
    polarWebhookSecret,
    provider: billingProvider,
    publishableKey,
    serviceRoleKey,
    stripeSecretKey,
    stripeWebhookSecret,
    supabaseUrl,
  };
}

async function postJsonAsRawText(url, rawBody, headers) {
  const response = await fetch(url, {
    body: rawBody,
    headers: {
      ...headers,
      "Content-Type": "text/plain; charset=utf-8",
    },
    method: "POST",
  });
  const bodyText = await response.text();
  return {
    body: parseJson(bodyText),
    bodyText,
    ok: response.ok,
    status: response.status,
  };
}

async function postJson(url, body, headers) {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const bodyText = await response.text();
  return {
    body: parseJson(bodyText),
    bodyText,
    ok: response.ok,
    status: response.status,
  };
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  const bodyText = await response.text();
  return {
    body: parseJson(bodyText),
    bodyText,
    ok: response.ok,
    status: response.status,
  };
}

async function createStripeTestCustomer(secretKey, { testId, userId }) {
  const response = await fetch("https://api.stripe.com/v1/customers", {
    body: new URLSearchParams({
      description: `DeepSpec synthetic billing replay ${testId}`,
      "metadata[deepspec_test_id]": testId,
      "metadata[supabase_user_id]": userId,
    }),
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
  const bodyText = await response.text();
  const body = parseJson(bodyText);
  if (!response.ok || typeof body?.id !== "string") {
    throw new Error(`Stripe test customer creation failed: HTTP ${response.status} ${bodyText}`);
  }

  return {
    id: body.id,
  };
}

async function deleteStripeTestCustomer(secretKey, customerId) {
  const response = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
    method: "DELETE",
  }).catch(() => null);

  if (!response?.ok) {
    const bodyText = response ? await response.text() : "network_error";
    console.warn(`[cleanup] Stripe test customer cleanup failed for ${customerId}: ${bodyText}`);
  }
}

export function classifyProviderPortalUrl(rawUrl, provider) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    return {
      ok: false,
      message: "Billing portal response did not include a provider URL.",
      origin: "",
    };
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      ok: false,
      message: "Billing portal response URL is invalid.",
      origin: "",
    };
  }

  if (url.protocol !== "https:") {
    return {
      ok: false,
      message: "Billing portal response URL must use HTTPS.",
      origin: "",
    };
  }

  const providerHostSuffixes = {
    polar: "polar.sh",
    stripe: "stripe.com",
  };
  const expectedHostSuffix = providerHostSuffixes[String(provider ?? "").trim().toLowerCase()];
  if (expectedHostSuffix && !isExpectedProviderHost(url.hostname, expectedHostSuffix)) {
    return {
      ok: false,
      message: `Billing portal response host mismatch: expected ${expectedHostSuffix}, got ${url.hostname}.`,
      origin: "",
    };
  }

  return {
    ok: true,
    message: "Billing portal response URL is provider-owned and HTTPS.",
    origin: url.origin,
  };
}

function isExpectedProviderHost(hostname, expectedHostSuffix) {
  return hostname === expectedHostSuffix || hostname.endsWith(`.${expectedHostSuffix}`);
}

function decodeStandardWebhookSecret(webhookSecret) {
  const secret = webhookSecret.startsWith("whsec_") ? webhookSecret.slice("whsec_".length) : webhookSecret;
  try {
    const decoded = Buffer.from(secret, "base64");
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

function parseJson(bodyText) {
  try {
    return bodyText ? JSON.parse(bodyText) : null;
  } catch {
    return null;
  }
}

function parseArgs(args) {
  const options = {
    keepEntitlement: false,
    keepProviderCustomer: false,
    planId: "scan_pack",
    provider: "",
    summaryPath: DEFAULT_SUMMARY_PATH,
    url: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split("=");
    const value = inlineValue ?? args[index + 1];

    if (name === "--url") {
      options.url = value;
      if (!inlineValue) index += 1;
    } else if (name === "--provider") {
      if (value !== "polar" && value !== "stripe") {
        throw new Error("--provider must be polar or stripe.");
      }
      options.provider = value;
      if (!inlineValue) index += 1;
    } else if (name === "--plan") {
      if (!PLAN_ALLOWANCE[value]) {
        throw new Error(`--plan must be one of ${Object.keys(PLAN_ALLOWANCE).join(", ")}.`);
      }
      options.planId = value;
      if (!inlineValue) index += 1;
    } else if (name === "--keep-entitlement") {
      options.keepEntitlement = true;
    } else if (name === "--keep-provider-customer") {
      options.keepProviderCustomer = true;
    } else if (name === "--summary") {
      options.summaryPath = value;
      if (!inlineValue) index += 1;
    } else if (name === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Replay a signed synthetic billing webhook through DeepSpec.

Options:
  --url <base-url>          App base URL. Default: QA_BASE_URL, DEEPSPEC_PUBLIC_URL, or http://127.0.0.1:5175.
  --provider <polar|stripe> Provider to replay. Default: BILLING_PROVIDER.
  --plan <plan-id>          Plan to activate. Default: scan_pack.
  --summary <path>          Summary artifact path. Default: ${DEFAULT_SUMMARY_PATH}.
  --keep-entitlement        Do not delete the synthetic billing entitlement row after verification.
  --keep-provider-customer  Stripe only: do not delete the synthetic Stripe test customer after verification.
`);
}

function writeSummary(path, summary) {
  const fullPath = join(process.cwd(), path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`      Wrote ${path}`);
}

function loadLocalEnv(filename) {
  const path = join(process.cwd(), filename);
  let contents;

  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key]) continue;

    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function isDirectRun(url) {
  return process.argv[1] && fileURLToPath(url) === process.argv[1];
}

if (isDirectRun(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
