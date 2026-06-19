import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const PLAN_ALLOWANCE = {
  plus_monthly: 100,
  plus_yearly: 1200,
  scan_pack: 20,
  pro_beta: 500,
};

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
  const env = readRequiredEnv();

  console.log(`[0/5] Target: ${baseUrl}`);
  console.log("      This verifier creates a synthetic anonymous Supabase user and cleans up only that user's synthetic billing entitlement.");

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
  try {
    console.log("[1/5] Creating synthetic anonymous test user...");
    const { data, error } = await publicClient.auth.signInAnonymously();
    if (error || !data.user || !data.session?.access_token) {
      throw new Error(`Anonymous sign-in failed: ${error?.message ?? "No user/session returned."}`);
    }
    userId = data.user.id;

    console.log("[2/5] Posting signed synthetic Polar order.paid webhook...");
    const testId = `billing-replay-${randomUUID()}`;
    const payload = buildPolarOrderPaidPayload({
      planId: options.planId,
      testId,
      userId,
    });
    const rawBody = JSON.stringify(payload);
    const webhookHeaders = signStandardWebhookBody(rawBody, env.polarWebhookSecret, {
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
      entitlement?.billingProvider !== "polar"
    ) {
      throw new Error(`Account entitlement mismatch: ${JSON.stringify(entitlement)}`);
    }

    console.log("[4/5] Entitlement replay verified.");
    console.log(`      Plan=${entitlement.planId} allowance=${entitlement.scanAllowance} provider=${entitlement.billingProvider}`);
  } finally {
    if (userId && !options.keepEntitlement) {
      await adminClient.from("billing_entitlements").delete().eq("user_id", userId);
      console.log("[5/5] Cleaned up synthetic billing entitlement row.");
    } else if (userId) {
      console.log("[5/5] Kept synthetic billing entitlement row because --keep-entitlement was set.");
    }
  }
}

function readRequiredEnv() {
  const billingProvider = String(process.env.BILLING_PROVIDER ?? "").trim().toLowerCase();
  if (billingProvider !== "polar") {
    throw new Error("Set BILLING_PROVIDER=polar before running the Polar webhook replay.");
  }

  const supabaseUrl = String(process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
  const publishableKey = String(process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const polarWebhookSecret = String(process.env.POLAR_WEBHOOK_SECRET ?? "").trim();

  const missing = [
    ["VITE_SUPABASE_URL or SUPABASE_URL", supabaseUrl],
    ["VITE_SUPABASE_PUBLISHABLE_KEY", publishableKey],
    ["SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey],
    ["POLAR_WEBHOOK_SECRET", polarWebhookSecret],
  ].filter(([, value]) => !value);

  if (missing.length) {
    throw new Error(`Missing required env: ${missing.map(([key]) => key).join(", ")}`);
  }

  if (!decodeStandardWebhookSecret(polarWebhookSecret)) {
    throw new Error("POLAR_WEBHOOK_SECRET is not a valid Standard Webhooks base64 secret.");
  }

  return {
    polarWebhookSecret,
    publishableKey,
    serviceRoleKey,
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
    planId: "scan_pack",
    url: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split("=");
    const value = inlineValue ?? args[index + 1];

    if (name === "--url") {
      options.url = value;
      if (!inlineValue) index += 1;
    } else if (name === "--plan") {
      if (!PLAN_ALLOWANCE[value]) {
        throw new Error(`--plan must be one of ${Object.keys(PLAN_ALLOWANCE).join(", ")}.`);
      }
      options.planId = value;
      if (!inlineValue) index += 1;
    } else if (name === "--keep-entitlement") {
      options.keepEntitlement = true;
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
  console.log(`Replay a signed synthetic Polar billing webhook through DeepSpec.

Options:
  --url <base-url>          App base URL. Default: QA_BASE_URL, DEEPSPEC_PUBLIC_URL, or http://127.0.0.1:5175.
  --plan <plan-id>          Plan to activate. Default: scan_pack.
  --keep-entitlement        Do not delete the synthetic billing entitlement row after verification.
`);
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
