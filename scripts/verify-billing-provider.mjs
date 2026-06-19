import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const POLAR_PRODUCT_ENV_KEYS = [
  "POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY",
  "POLAR_PRODUCT_DEEPSPEC_PLUS_YEARLY",
  "POLAR_PRODUCT_DEEPSPEC_SCAN_PACK",
  "POLAR_PRODUCT_DEEPSPEC_PRO_BETA",
];

const STRIPE_PRICE_ENV_KEYS = [
  "STRIPE_PRICE_DEEPSPEC_PLUS_MONTHLY",
  "STRIPE_PRICE_DEEPSPEC_PLUS_YEARLY",
  "STRIPE_PRICE_DEEPSPEC_SCAN_PACK",
  "STRIPE_PRICE_DEEPSPEC_PRO_BETA",
];

const POLAR_PRODUCT_NAME_BY_ENV = {
  POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY: "DeepSpec Plus Monthly",
  POLAR_PRODUCT_DEEPSPEC_PLUS_YEARLY: "DeepSpec Plus Yearly",
  POLAR_PRODUCT_DEEPSPEC_SCAN_PACK: "Scan Pack",
  POLAR_PRODUCT_DEEPSPEC_PRO_BETA: "DeepSpec Pro Beta",
};

const POLAR_SANDBOX_API_BASE_URL = "https://sandbox-api.polar.sh/v1";
const POLAR_PRODUCTION_API_BASE_URL = "https://api.polar.sh/v1";
const STRIPE_API_BASE_URL = "https://api.stripe.com/v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function verifyBillingProviderConfig(env, options = {}) {
  const provider = String(options.provider ?? env.BILLING_PROVIDER ?? "").trim().toLowerCase();
  const issues = [];
  const warnings = [];
  const checks = [];

  checks.push("Loaded billing provider configuration.");

  for (const key of Object.keys(env)) {
    if (/^VITE_(POLAR|STRIPE)_/i.test(key)) {
      issues.push(`${key} must not exist. Billing provider keys and product IDs must stay server-side.`);
    }
  }

  if (provider === "polar") {
    verifyPolar(env, options, checks, issues, warnings);
  } else if (provider === "stripe") {
    verifyStripe(env, options, checks, issues, warnings);
  } else {
    issues.push("Set BILLING_PROVIDER to `polar` or `stripe`. Use `polar` for the recommended Merchant of Record sandbox.");
  }

  return {
    checks,
    issues,
    ok: issues.length === 0,
    provider: provider || "unconfigured",
    warnings,
  };
}

async function main() {
  loadLocalEnv(".env.local");
  loadLocalEnv(".env");

  const options = parseArgs(process.argv.slice(2));
  const result = verifyBillingProviderConfig(process.env, options);

  console.log(`[0/3] Provider: ${result.provider}`);
  for (const check of result.checks) {
    console.log(`      OK: ${check}`);
  }

  for (const warning of result.warnings) {
    console.warn(`      WARN: ${warning}`);
  }

  if (!result.ok) {
    fail(["Billing provider verification blocked.", ...result.issues.map((issue) => `- ${issue}`)].join("\n"));
    return;
  }

  if (options.network) {
    console.log("[1/3] Running read-only provider API checks...");
    if (result.provider === "polar") {
      await verifyPolarProducts(process.env, options);
    } else if (result.provider === "stripe") {
      await verifyStripePrices(process.env);
    }
  } else {
    console.log("[1/3] Skipped provider API checks. Add --network after Dad creates sandbox products.");
  }

  console.log("[2/3] Billing provider setup is safe for sandbox testing.");
  console.log("      Next manual gate: checkout -> webhook -> entitlement -> account page with test payment data.");
}

function verifyPolar(env, options, checks, issues, warnings) {
  const environment = String(env.POLAR_ENVIRONMENT ?? "production").trim().toLowerCase();
  if (environment !== "sandbox" && !options.allowProduction) {
    issues.push("Set POLAR_ENVIRONMENT=sandbox. Production Polar checks require --allow-production.");
  } else {
    checks.push(`Polar environment is ${environment}.`);
  }

  const accessToken = String(env.POLAR_ACCESS_TOKEN ?? "").trim();
  if (!accessToken) {
    issues.push("Missing POLAR_ACCESS_TOKEN.");
  } else if (!accessToken.startsWith("polar_oat_")) {
    warnings.push("POLAR_ACCESS_TOKEN does not use the expected polar_oat_ prefix. Confirm Dad copied an Organization Access Token.");
  } else {
    checks.push("Polar organization access token is present.");
  }

  const webhookSecret = String(env.POLAR_WEBHOOK_SECRET ?? "").trim();
  if (!webhookSecret) {
    issues.push("Missing POLAR_WEBHOOK_SECRET.");
  } else if (!decodeStandardWebhookSecret(webhookSecret)) {
    issues.push("POLAR_WEBHOOK_SECRET is not a valid Standard Webhooks base64 secret.");
  } else {
    checks.push("Polar webhook secret decodes as a Standard Webhooks secret.");
  }

  for (const key of POLAR_PRODUCT_ENV_KEYS) {
    const productId = String(env[key] ?? "").trim();
    if (!productId) {
      issues.push(`Missing ${key} for ${POLAR_PRODUCT_NAME_BY_ENV[key]}.`);
    } else if (!UUID_PATTERN.test(productId)) {
      issues.push(`${key} must be a Polar product UUID, got ${productId}.`);
    } else {
      checks.push(`${key} is present.`);
    }
  }

  verifyPublicUrl(env, options, issues, warnings);
}

function verifyStripe(env, options, checks, issues, warnings) {
  const secretKey = String(env.STRIPE_SECRET_KEY ?? "").trim();
  if (!secretKey) {
    issues.push("Missing STRIPE_SECRET_KEY.");
  } else if (secretKey.startsWith("sk_live_") && !options.allowProduction) {
    issues.push("STRIPE_SECRET_KEY is live. Production Stripe checks require --allow-production.");
  } else {
    checks.push("Stripe secret key is present.");
  }

  const webhookSecret = String(env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!webhookSecret) {
    issues.push("Missing STRIPE_WEBHOOK_SECRET.");
  } else if (!webhookSecret.startsWith("whsec_")) {
    warnings.push("STRIPE_WEBHOOK_SECRET does not use the expected whsec_ prefix. Confirm Dad copied the endpoint signing secret.");
  } else {
    checks.push("Stripe webhook secret is present.");
  }

  for (const key of STRIPE_PRICE_ENV_KEYS) {
    const priceId = String(env[key] ?? "").trim();
    if (!priceId) {
      issues.push(`Missing ${key}.`);
    } else if (!priceId.startsWith("price_")) {
      issues.push(`${key} must be a Stripe price id, got ${priceId}.`);
    } else {
      checks.push(`${key} is present.`);
    }
  }

  verifyPublicUrl(env, options, issues, warnings);
}

function verifyPublicUrl(env, options, issues, warnings) {
  const publicUrl = String(env.DEEPSPEC_PUBLIC_URL ?? "").trim();
  if (!publicUrl) {
    warnings.push("DEEPSPEC_PUBLIC_URL is missing. Local checkout returns work, but hosted sandbox testing needs a public URL.");
    return;
  }

  let parsed;
  try {
    parsed = new URL(publicUrl);
  } catch {
    issues.push("DEEPSPEC_PUBLIC_URL must be a valid URL.");
    return;
  }

  if (parsed.protocol !== "https:" && !/^localhost$|^127\.0\.0\.1$/.test(parsed.hostname)) {
    issues.push("DEEPSPEC_PUBLIC_URL must use https outside localhost.");
  }

  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
    const message = "DEEPSPEC_PUBLIC_URL is local. This is fine for local dev, but provider-hosted checkout/webhook testing needs a public deployment URL.";
    if (options.strictPublicUrl) {
      issues.push(message);
    } else {
      warnings.push(message);
    }
  }
}

async function verifyPolarProducts(env, options) {
  const baseUrl = getPolarBaseUrl(env, options);
  const accessToken = String(env.POLAR_ACCESS_TOKEN ?? "").trim();

  for (const key of POLAR_PRODUCT_ENV_KEYS) {
    const productId = String(env[key] ?? "").trim();
    const response = await fetchJson(`${baseUrl}/products/${productId}`, {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    });

    if (!response.ok) {
      throw new Error(`${key} lookup failed: HTTP ${response.status} ${response.bodyText}`);
    }

    if (response.body?.id !== productId) {
      throw new Error(`${key} lookup returned the wrong product id.`);
    }

    if (response.body?.is_archived === true) {
      throw new Error(`${key} is archived in Polar.`);
    }

    console.log(`      OK: ${key} exists in Polar.`);
  }
}

async function verifyStripePrices(env) {
  const secretKey = String(env.STRIPE_SECRET_KEY ?? "").trim();

  for (const key of STRIPE_PRICE_ENV_KEYS) {
    const priceId = String(env[key] ?? "").trim();
    const response = await fetchJson(`${STRIPE_API_BASE_URL}/prices/${priceId}`, {
      Authorization: `Bearer ${secretKey}`,
    });

    if (!response.ok) {
      throw new Error(`${key} lookup failed: HTTP ${response.status} ${response.bodyText}`);
    }

    if (response.body?.id !== priceId) {
      throw new Error(`${key} lookup returned the wrong price id.`);
    }

    if (response.body?.active !== true) {
      throw new Error(`${key} is not active in Stripe.`);
    }

    console.log(`      OK: ${key} exists in Stripe.`);
  }
}

function getPolarBaseUrl(env, options) {
  const configured = String(env.POLAR_API_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (configured) {
    return configured.endsWith("/v1") ? configured : `${configured}/v1`;
  }

  const environment = String(env.POLAR_ENVIRONMENT ?? "production").trim().toLowerCase();
  if (environment === "sandbox") {
    return POLAR_SANDBOX_API_BASE_URL;
  }

  if (!options.allowProduction) {
    throw new Error("Production Polar API checks require --allow-production.");
  }

  return POLAR_PRODUCTION_API_BASE_URL;
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  const bodyText = await response.text();
  const body = parseJson(bodyText);

  return {
    body,
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

function decodeStandardWebhookSecret(webhookSecret) {
  const secret = webhookSecret.startsWith("whsec_") ? webhookSecret.slice("whsec_".length) : webhookSecret;
  try {
    const decoded = Buffer.from(secret, "base64");
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

function parseArgs(args) {
  const options = {
    allowProduction: false,
    network: false,
    provider: "",
    strictPublicUrl: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split("=");
    const value = inlineValue ?? args[index + 1];

    if (name === "--provider") {
      options.provider = value;
      if (!inlineValue) index += 1;
    } else if (name === "--network") {
      options.network = true;
    } else if (name === "--allow-production") {
      options.allowProduction = true;
    } else if (name === "--strict-public-url") {
      options.strictPublicUrl = true;
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
  console.log(`Verify DeepSpec billing provider setup.

Options:
  --provider <polar|stripe>   Override BILLING_PROVIDER.
  --network                   Check configured products/prices against the provider API.
  --allow-production          Permit live-provider checks. Omit for sandbox safety.
  --strict-public-url         Fail if DEEPSPEC_PUBLIC_URL is local.
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

function fail(message) {
  console.error(message);
  process.exitCode = 1;
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
