import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyBillingProviderConfig } from "./verify-billing-provider.mjs";

const POLAR_ENV_KEYS = [
  "BILLING_PROVIDER",
  "DEEPSPEC_ENABLE_LIVE_BILLING",
  "POLAR_ENVIRONMENT",
  "POLAR_ACCESS_TOKEN",
  "POLAR_WEBHOOK_SECRET",
  "POLAR_PRODUCT_DEEPSPEC_PLUS_MONTHLY",
  "POLAR_PRODUCT_DEEPSPEC_PLUS_YEARLY",
  "POLAR_PRODUCT_DEEPSPEC_SCAN_PACK",
  "POLAR_PRODUCT_DEEPSPEC_PRO_BETA",
  "DEEPSPEC_PUBLIC_URL",
];

const STRIPE_ENV_KEYS = [
  "BILLING_PROVIDER",
  "DEEPSPEC_ENABLE_LIVE_BILLING",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_DEEPSPEC_PLUS_MONTHLY",
  "STRIPE_PRICE_DEEPSPEC_PLUS_YEARLY",
  "STRIPE_PRICE_DEEPSPEC_SCAN_PACK",
  "STRIPE_PRICE_DEEPSPEC_PRO_BETA",
  "DEEPSPEC_PUBLIC_URL",
];

const PRODUCT_NAMES = [
  "DeepSpec Plus Monthly",
  "DeepSpec Plus Yearly",
  "Scan Pack",
  "DeepSpec Pro Beta",
];

export function buildBillingProviderRunbook(env = {}, options = {}) {
  const provider = resolveProvider(env, options.provider);
  const verification = verifyBillingProviderConfig(env, { provider });
  const publicUrl = resolvePublicUrl(env);
  const envKeys = provider === "stripe" ? STRIPE_ENV_KEYS : POLAR_ENV_KEYS;
  const providerName = provider === "stripe" ? "Stripe" : "Polar";
  const providerCommand = provider === "stripe" ? "stripe" : "polar";
  const liveBlocked = env.DEEPSPEC_ENABLE_LIVE_BILLING !== "true";

  return [
    "# DeepSpec Billing Provider Setup Runbook",
    "",
    "## Executive Summary",
    `- Recommended setup now: ${providerName} sandbox.`,
    "- Live payments now: no.",
    `- Current config status: ${verification.ok ? "sandbox config ready for provider checks" : "blocked / fail-closed"}.`,
    `- Live billing switch: ${liveBlocked ? "off" : "on - production-only and must be justified by the live gate"}.`,
    "- Final live decision must come from `npm run verify:paid-launch-readiness -- --target live`.",
    "",
    "## Dad Owns",
    "- Legal business identity, bank details, tax forms, refunds, disputes, production keys, and live dashboard access.",
    "- Provider account creation and webhook/product setup.",
    "- Turning on `DEEPSPEC_ENABLE_LIVE_BILLING=true` only after the live gate passes.",
    "",
    "## Kid Can Do",
    "- Copy `.env.example` to `.env.local`.",
    "- Run the commands below.",
    "- Paste non-secret product or price IDs only if Dad says it is okay.",
    "- Do not handle production API keys, webhook secrets, bank/tax information, refunds, or disputes.",
    "",
    "## Sandbox Products",
    ...PRODUCT_NAMES.map((name) => `- ${name}`),
    "",
    "## Required Server Env",
    ...envKeys.map((key) => `- ${key}`),
    "",
    "## Commands",
    "1. Check the provider env without touching the provider API:",
    `   npm run verify:billing-provider -- --provider ${providerCommand}`,
    "2. After Dad creates sandbox products, run the read-only provider lookup:",
    `   npm run verify:billing-provider -- --provider ${providerCommand} --network`,
    "3. After the app server or preview deployment is running, create a sandbox checkout URL:",
    `   npm run verify:billing-checkout -- --provider ${providerCommand} --url ${publicUrl} --plan scan_pack`,
    provider === "polar"
      ? "4. Replay a signed synthetic sandbox webhook and portal handoff:"
      : "4. Replay a signed synthetic legacy Stripe sandbox webhook and portal handoff:",
    provider === "polar"
      ? `   npm run verify:billing-webhook-replay -- --provider polar --url ${publicUrl} --plan scan_pack`
      : `   npm run verify:billing-webhook-replay -- --provider stripe --url ${publicUrl} --plan scan_pack`,
    "5. Verify billing sandbox readiness without judging model quality:",
    `   npm run verify:billing-sandbox-readiness -- --provider ${providerCommand}`,
    "6. Print the no-secret evidence bundle Dad can share back:",
    `   npm run billing:evidence -- --provider ${providerCommand}`,
    "7. Final live go/no-go:",
    "   npm run verify:paid-launch-readiness -- --target live",
    "",
    "## Current Config Check",
    formatList("OK", verification.checks),
    formatList("WARN", verification.warnings.map((warning) => redactSensitiveValues(warning, env))),
    formatList("BLOCKED", verification.issues.map((issue) => redactSensitiveValues(issue, env))),
    "",
    "## Decision Rule",
    verification.ok
      ? "Sandbox setup may continue. Live charging is still blocked until the paid-launch readiness gate returns `live_allowed`."
      : "Do not start checkout testing yet. Fill the blocked env items first, then rerun the provider verifier.",
    "Never start live payments from this runbook alone.",
  ].join("\n");
}

function resolveProvider(env, providerInput) {
  const provider = String(providerInput ?? env.BILLING_PROVIDER ?? "polar").trim().toLowerCase();
  return provider === "stripe" ? "stripe" : "polar";
}

function resolvePublicUrl(env) {
  const publicUrl = String(env.DEEPSPEC_PUBLIC_URL ?? "").trim();
  return publicUrl || "<preview-url>";
}

function formatList(label, values) {
  if (!values.length) {
    return `- ${label}: none`;
  }

  return values.map((value) => `- ${label}: ${value}`).join("\n");
}

function redactSensitiveValues(message, env) {
  let redacted = message;
  for (const [key, rawValue] of Object.entries(env)) {
    if (!isSensitiveKey(key)) continue;
    const value = String(rawValue ?? "");
    if (value.length < 4) continue;
    redacted = redacted.split(value).join(`<redacted ${key}>`);
  }
  return redacted;
}

function isSensitiveKey(key) {
  return /(?:TOKEN|SECRET|KEY|PRODUCT|PRICE)/i.test(key);
}

function parseArgs(args) {
  const options = {
    provider: "",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split("=");
    const value = inlineValue ?? args[index + 1];

    if (name === "--provider") {
      options.provider = value;
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
  console.log(`Print a no-secret DeepSpec billing provider setup runbook.

Options:
  --provider <polar|stripe>   Provider setup path to print. Default: BILLING_PROVIDER or polar.
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
  loadLocalEnv(".env.local");
  loadLocalEnv(".env");

  const options = parseArgs(process.argv.slice(2));
  console.log(buildBillingProviderRunbook(process.env, options));
}
