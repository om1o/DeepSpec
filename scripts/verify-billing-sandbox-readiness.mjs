import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyBillingProviderConfig } from "./verify-billing-provider.mjs";
import {
  classifyCheckoutSummary,
  classifyWebhookReplaySummary,
} from "./verify-paid-launch-readiness.mjs";

const DEFAULT_CHECKOUT_SUMMARY = "artifacts/release-gates/billing-checkout-summary.json";
const DEFAULT_WEBHOOK_REPLAY_SUMMARY = "artifacts/release-gates/billing-webhook-replay-summary.json";
const DEFAULT_SUMMARY_PATH = "artifacts/release-gates/billing-sandbox-readiness-summary.json";

loadLocalEnv(".env.local");
loadLocalEnv(".env");

export function classifyBillingSandboxReadiness({
  checkoutSummary = null,
  env = {},
  options = {},
  webhookReplaySummary = null,
} = {}) {
  const provider = String(options.provider ?? env.BILLING_PROVIDER ?? "").trim().toLowerCase();
  const blockers = [];
  const checks = [];
  const warnings = [];

  const billing = verifyBillingProviderConfig(env, {
    allowProduction: false,
    provider,
    strictPublicUrl: false,
  });
  checks.push(...billing.checks.map((check) => `Billing: ${check}`));
  warnings.push(...billing.warnings.map((warning) => `Billing: ${warning}`));
  if (!billing.ok) {
    blockers.push(...billing.issues.map((issue) => `Billing provider: ${issue}`));
  }

  const checkout = classifyCheckoutSummary(checkoutSummary, provider);
  if (checkout.ok) {
    checks.push(checkout.message);
  } else {
    blockers.push(checkout.message);
  }

  const replay = classifyWebhookReplaySummary(webhookReplaySummary, provider);
  if (replay.ok) {
    checks.push(replay.message);
  } else {
    blockers.push(replay.message);
  }

  return {
    blockers,
    checks,
    ok: blockers.length === 0,
    provider: provider || "unconfigured",
    recommendation: blockers.length === 0 ? "billing_sandbox_ready" : "billing_sandbox_blocked",
    warnings,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const checkoutSummary = readJson(options.checkoutSummaryPath);
  const webhookReplaySummary = readJson(options.webhookReplaySummaryPath);
  const result = classifyBillingSandboxReadiness({
    checkoutSummary,
    env: process.env,
    options,
    webhookReplaySummary,
  });
  const summary = {
    ...result,
    checkoutSummaryPath: options.checkoutSummaryPath,
    webhookReplaySummaryPath: options.webhookReplaySummaryPath,
    verifiedAt: new Date().toISOString(),
  };

  console.log(`[0/4] Provider: ${result.provider}`);
  console.log(`[1/4] Recommendation: ${result.recommendation}`);
  for (const check of result.checks) {
    console.log(`      OK: ${check}`);
  }
  for (const warning of result.warnings) {
    console.warn(`      WARN: ${warning}`);
  }

  writeSummary(options.summaryPath, summary);

  if (!result.ok) {
    console.error("[2/4] Billing sandbox readiness blocked.");
    for (const blocker of result.blockers) {
      console.error(`      BLOCKED: ${blocker}`);
    }
    console.error("[3/4] Decision: billing sandbox is not ready. Do not test live checkout.");
    process.exit(1);
  }

  console.log("[2/4] Billing sandbox readiness passed.");
  console.log("[3/4] Decision: billing sandbox may continue. Live charging still requires `verify:paid-launch-readiness -- --target live`.");
}

function parseArgs(args) {
  const options = {
    checkoutSummaryPath: DEFAULT_CHECKOUT_SUMMARY,
    provider: "",
    summaryPath: DEFAULT_SUMMARY_PATH,
    webhookReplaySummaryPath: DEFAULT_WEBHOOK_REPLAY_SUMMARY,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split("=");
    const value = inlineValue ?? args[index + 1];

    if (name === "--provider") {
      options.provider = value;
      if (!inlineValue) index += 1;
    } else if (name === "--checkout-summary") {
      options.checkoutSummaryPath = value;
      if (!inlineValue) index += 1;
    } else if (name === "--webhook-replay-summary") {
      options.webhookReplaySummaryPath = value;
      if (!inlineValue) index += 1;
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
  console.log(`Verify DeepSpec billing sandbox readiness only.

This does not approve live payments. It checks provider env, checkout summary,
webhook replay, and billing portal handoff evidence.

Options:
  --provider <polar|stripe>             Override BILLING_PROVIDER.
  --checkout-summary <path>             Billing checkout summary path.
  --webhook-replay-summary <path>       Billing replay summary path.
  --summary <path>                      Output summary path.
`);
}

function readJson(path) {
  const text = readText(path);
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
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
