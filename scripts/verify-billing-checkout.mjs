import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SUMMARY_PATH = "artifacts/release-gates/billing-checkout-summary.json";
const PLAN_IDS = new Set(["plus_monthly", "plus_yearly", "scan_pack", "pro_beta"]);

loadLocalEnv(".env.local");
loadLocalEnv(".env");

export function classifyCheckoutUrl(url, provider) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      message: "Checkout response did not contain a valid URL.",
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (provider === "polar" && !isExpectedProviderHost(hostname, "polar.sh")) {
    return {
      ok: false,
      message: `Expected a Polar checkout URL, got ${parsed.origin}.`,
    };
  }

  if (provider === "stripe" && !isExpectedProviderHost(hostname, "stripe.com")) {
    return {
      ok: false,
      message: `Expected a Stripe checkout URL, got ${parsed.origin}.`,
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      message: "Checkout URL must use https.",
    };
  }

  return {
    ok: true,
    origin: parsed.origin,
  };
}

function isExpectedProviderHost(hostname, expectedHostSuffix) {
  return hostname === expectedHostSuffix || hostname.endsWith(`.${expectedHostSuffix}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baseUrl = options.url || process.env.QA_BASE_URL || process.env.DEEPSPEC_PUBLIC_URL || "http://127.0.0.1:5175";
  const env = readRequiredEnv();

  console.log(`[0/4] Target: ${baseUrl}`);
  console.log("      This verifier creates a synthetic anonymous Supabase session and asks DeepSpec for a sandbox checkout URL. It does not make a payment.");

  if (env.liveBillingEnabled && !options.allowLiveCheckoutUrl) {
    throw new Error("Refusing to create a checkout URL while DEEPSPEC_ENABLE_LIVE_BILLING=true. Pass --allow-live-checkout-url only for an intentional production dry run.");
  }

  const publicClient = createClient(env.supabaseUrl, env.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  console.log("[1/4] Creating synthetic anonymous test session...");
  const { data, error } = await publicClient.auth.signInAnonymously();
  if (error || !data.user || !data.session?.access_token) {
    throw new Error(`Anonymous sign-in failed: ${error?.message ?? "No user/session returned."}`);
  }

  console.log("[2/4] Requesting checkout URL through /api/billing-checkout...");
  const response = await postJson(`${baseUrl.replace(/\/$/, "")}/api/billing-checkout`, {
    origin: baseUrl.replace(/\/$/, ""),
    planId: options.planId,
  }, {
    Authorization: `Bearer ${data.session.access_token}`,
  });
  if (!response.ok || typeof response.body?.url !== "string") {
    throw new Error(`Checkout request failed: HTTP ${response.status} ${response.bodyText}`);
  }

  const checkoutUrl = classifyCheckoutUrl(response.body.url, env.provider);
  if (!checkoutUrl.ok) {
    throw new Error(checkoutUrl.message);
  }

  console.log("[3/4] Checkout URL verified.");
  console.log(`      Provider=${env.provider} plan=${options.planId} checkoutOrigin=${checkoutUrl.origin}`);
  writeSummary(options.summaryPath, {
    baseUrl,
    checkoutOrigin: checkoutUrl.origin,
    ok: true,
    planId: options.planId,
    provider: env.provider,
    verifiedAt: new Date().toISOString(),
  });
}

function readRequiredEnv() {
  const provider = String(process.env.BILLING_PROVIDER ?? "").trim().toLowerCase();
  if (provider !== "polar" && provider !== "stripe") {
    throw new Error("Set BILLING_PROVIDER to polar or stripe before running checkout verification.");
  }

  const supabaseUrl = String(process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
  const publishableKey = String(process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  const missing = [
    ["VITE_SUPABASE_URL or SUPABASE_URL", supabaseUrl],
    ["VITE_SUPABASE_PUBLISHABLE_KEY", publishableKey],
  ].filter(([, value]) => !value);

  if (missing.length) {
    throw new Error(`Missing required env: ${missing.map(([key]) => key).join(", ")}`);
  }

  return {
    liveBillingEnabled: process.env.DEEPSPEC_ENABLE_LIVE_BILLING === "true",
    provider,
    publishableKey,
    supabaseUrl,
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

function parseJson(bodyText) {
  try {
    return bodyText ? JSON.parse(bodyText) : null;
  } catch {
    return null;
  }
}

function parseArgs(args) {
  const options = {
    allowLiveCheckoutUrl: false,
    planId: "scan_pack",
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
    } else if (name === "--plan") {
      if (!PLAN_IDS.has(value)) {
        throw new Error(`--plan must be one of ${Array.from(PLAN_IDS).join(", ")}.`);
      }
      options.planId = value;
      if (!inlineValue) index += 1;
    } else if (name === "--summary") {
      options.summaryPath = value;
      if (!inlineValue) index += 1;
    } else if (name === "--allow-live-checkout-url") {
      options.allowLiveCheckoutUrl = true;
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
  console.log(`Verify DeepSpec billing checkout URL creation.

Options:
  --url <base-url>                 App base URL. Default: QA_BASE_URL, DEEPSPEC_PUBLIC_URL, or http://127.0.0.1:5175.
  --plan <plan-id>                 Plan to create checkout for. Default: scan_pack.
  --summary <path>                 Summary artifact path. Default: ${DEFAULT_SUMMARY_PATH}.
  --allow-live-checkout-url        Permit checkout URL creation while DEEPSPEC_ENABLE_LIVE_BILLING=true.
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
