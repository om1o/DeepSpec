import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyBillingProviderConfig } from "./verify-billing-provider.mjs";
import { classifyIdentifyEvalSummary } from "./verify-identify-eval-summary.mjs";

const DEFAULT_IDENTIFY_SUMMARY = ".deepspec-eval/identify-summary.json";
const DEFAULT_CHECKOUT_SUMMARY = "artifacts/release-gates/billing-checkout-summary.json";
const DEFAULT_WEBHOOK_REPLAY_SUMMARY = "artifacts/release-gates/billing-webhook-replay-summary.json";
const DEFAULT_QA_ROOT = "artifacts/qa";

loadLocalEnv(".env.local");
loadLocalEnv(".env");

export function classifyPaidLaunchReadiness({
  checkoutSummary = null,
  env = {},
  identifySummary = null,
  options = {},
  websiteQaReportText = "",
  webhookReplaySummary = null,
} = {}) {
  const target = options.target === "sandbox" ? "sandbox" : "live";
  const provider = String(options.provider ?? env.BILLING_PROVIDER ?? "").trim().toLowerCase();
  const blockers = [];
  const checks = [];
  const warnings = [];

  const billing = verifyBillingProviderConfig(env, {
    allowProduction: target === "live",
    provider,
    strictPublicUrl: target === "live",
  });
  checks.push(...billing.checks.map((check) => `Billing: ${check}`));
  warnings.push(...billing.warnings.map((warning) => `Billing: ${warning}`));
  if (!billing.ok) {
    blockers.push(...billing.issues.map((issue) => `Billing provider: ${issue}`));
  }

  if (target === "live") {
    addLiveProviderBlockers(env, provider, blockers);
  } else if (env.DEEPSPEC_ENABLE_LIVE_BILLING === "true") {
    blockers.push("Sandbox readiness must not run with DEEPSPEC_ENABLE_LIVE_BILLING=true.");
  }

  const identify = classifyIdentifyEvalSummary(identifySummary, {
    minSampleSize: Number(options.minIdentifySampleSize ?? 50),
  });
  if (identify.ok) {
    checks.push(`Identify: ${identify.message}`);
  } else {
    blockers.push(`Identify release gate: ${identify.message}`);
  }

  const checkout = classifyCheckoutSummary(checkoutSummary, provider);
  if (checkout.ok) {
    checks.push(checkout.message);
  } else if (target === "live") {
    blockers.push(checkout.message);
  } else {
    warnings.push(checkout.message);
  }

  const replay = classifyWebhookReplaySummary(webhookReplaySummary, provider);
  if (replay.ok) {
    checks.push(replay.message);
  } else if (target === "live") {
    blockers.push(replay.message);
  } else {
    warnings.push(replay.message);
  }

  const websiteQa = classifyWebsiteQaReport(websiteQaReportText);
  if (websiteQa.ok) {
    checks.push(websiteQa.message);
  } else if (target === "live") {
    blockers.push(websiteQa.message);
  } else {
    warnings.push(websiteQa.message);
  }

  return {
    blockers,
    checks,
    ok: blockers.length === 0,
    recommendation: blockers.length === 0 && target === "live" ? "live_allowed" : "sandbox_only",
    target,
    warnings,
  };
}

function classifyCheckoutSummary(summary, provider) {
  if (!summary || typeof summary !== "object") {
    return {
      ok: false,
      message: "Billing checkout summary is missing. Run `npm run verify:billing-checkout` after sandbox env is configured.",
    };
  }

  if (summary.ok !== true) {
    return {
      ok: false,
      message: "Billing checkout summary did not pass.",
    };
  }

  if (provider && summary.provider !== provider) {
    return {
      ok: false,
      message: `Billing checkout provider mismatch: expected ${provider}, got ${summary.provider ?? "unknown"}.`,
    };
  }

  if (typeof summary.verifiedAt !== "string" || Number.isNaN(Date.parse(summary.verifiedAt))) {
    return {
      ok: false,
      message: "Billing checkout summary is missing a valid verifiedAt timestamp.",
    };
  }

  return {
    ok: true,
    message: `Billing checkout passed for ${summary.provider} ${summary.planId ?? "unknown plan"}.`,
  };
}

function addLiveProviderBlockers(env, provider, blockers) {
  if (env.DEEPSPEC_ENABLE_LIVE_BILLING !== "true") {
    blockers.push("Live launch requires DEEPSPEC_ENABLE_LIVE_BILLING=true.");
  }

  if (provider === "polar" && String(env.POLAR_ENVIRONMENT ?? "").trim().toLowerCase() !== "production") {
    blockers.push("Live launch with Polar requires POLAR_ENVIRONMENT=production.");
  }

  if (provider === "stripe" && !String(env.STRIPE_SECRET_KEY ?? "").trim().startsWith("sk_live_")) {
    blockers.push("Live launch with Stripe requires a live STRIPE_SECRET_KEY.");
  }
}

function classifyWebhookReplaySummary(summary, provider) {
  if (!summary || typeof summary !== "object") {
    return {
      ok: false,
      message: "Billing webhook replay summary is missing. Run `npm run verify:billing-webhook-replay` after sandbox env is configured.",
    };
  }

  if (summary.ok !== true) {
    return {
      ok: false,
      message: "Billing webhook replay summary did not pass.",
    };
  }

  if (provider && summary.provider !== provider) {
    return {
      ok: false,
      message: `Billing webhook replay provider mismatch: expected ${provider}, got ${summary.provider ?? "unknown"}.`,
    };
  }

  if (typeof summary.verifiedAt !== "string" || Number.isNaN(Date.parse(summary.verifiedAt))) {
    return {
      ok: false,
      message: "Billing webhook replay summary is missing a valid verifiedAt timestamp.",
    };
  }

  if (summary.portalVerified !== true) {
    return {
      ok: false,
      message: "Billing webhook replay summary does not prove billing portal handoff. Rerun `npm run verify:billing-webhook-replay`.",
    };
  }

  const portalOrigin = classifyProviderOrigin(summary.portalOrigin, provider);
  if (!portalOrigin.ok) {
    return portalOrigin;
  }

  return {
    ok: true,
    message: `Billing webhook replay and portal handoff passed for ${summary.provider} ${summary.planId ?? "unknown plan"}.`,
  };
}

function classifyProviderOrigin(rawOrigin, provider) {
  if (typeof rawOrigin !== "string" || !rawOrigin.trim()) {
    return {
      ok: false,
      message: "Billing webhook replay summary is missing a billing portal origin.",
    };
  }

  let origin;
  try {
    origin = new URL(rawOrigin);
  } catch {
    return {
      ok: false,
      message: "Billing webhook replay summary has an invalid billing portal origin.",
    };
  }

  if (origin.protocol !== "https:") {
    return {
      ok: false,
      message: "Billing webhook replay portal origin must use HTTPS.",
    };
  }

  const expectedHostSuffixes = {
    polar: "polar.sh",
    stripe: "stripe.com",
  };
  const expectedHostSuffix = expectedHostSuffixes[String(provider ?? "").trim().toLowerCase()];
  if (expectedHostSuffix && !isExpectedProviderHost(origin.hostname, expectedHostSuffix)) {
    return {
      ok: false,
      message: `Billing webhook replay portal origin mismatch: expected ${expectedHostSuffix}, got ${origin.hostname}.`,
    };
  }

  return {
    ok: true,
    message: "Billing webhook replay portal origin is provider-owned and HTTPS.",
  };
}

function isExpectedProviderHost(hostname, expectedHostSuffix) {
  return hostname === expectedHostSuffix || hostname.endsWith(`.${expectedHostSuffix}`);
}

function classifyWebsiteQaReport(reportText) {
  if (!reportText) {
    return {
      ok: false,
      message: "Website QA report is missing. Run `npm run test:website` before live launch.",
    };
  }

  if (!/## What Passed[\s\S]*billing-provider-fail-closed/i.test(reportText)) {
    return {
      ok: false,
      message: "Website QA report does not prove billing-provider-fail-closed passed.",
    };
  }

  if (!/## What Failed\s*- None/i.test(reportText)) {
    return {
      ok: false,
      message: "Website QA report contains failures.",
    };
  }

  return {
    ok: true,
    message: "Website QA report passed with billing-provider-fail-closed.",
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const checkoutSummary = readJson(options.checkoutSummaryPath);
  const identifySummary = readJson(options.identifySummaryPath);
  const webhookReplaySummary = readJson(options.webhookReplaySummaryPath);
  const websiteQaPath = options.websiteQaReportPath || findLatestWebsiteQaReport(DEFAULT_QA_ROOT);
  const websiteQaReportText = websiteQaPath ? readText(websiteQaPath) : "";
  const result = classifyPaidLaunchReadiness({
    checkoutSummary,
    env: process.env,
    identifySummary,
    options,
    websiteQaReportText,
    webhookReplaySummary,
  });

  console.log(`[0/4] Target: ${result.target}`);
  console.log(`[1/4] Recommendation: ${result.recommendation}`);
  for (const check of result.checks) {
    console.log(`      OK: ${check}`);
  }
  for (const warning of result.warnings) {
    console.warn(`      WARN: ${warning}`);
  }

  if (!result.ok) {
    console.error("[2/4] Paid launch blocked.");
    for (const blocker of result.blockers) {
      console.error(`      BLOCKED: ${blocker}`);
    }
    console.error("[3/4] Decision: start sandbox/provider setup only. Do not enable live charging.");
    process.exit(1);
  }

  console.log("[2/4] Paid launch readiness passed.");
  console.log(result.target === "live"
    ? "[3/4] Decision: live charging may be enabled."
    : "[3/4] Decision: sandbox setup may continue; live charging remains disabled.");
}

function parseArgs(args) {
  const options = {
    identifySummaryPath: DEFAULT_IDENTIFY_SUMMARY,
    checkoutSummaryPath: DEFAULT_CHECKOUT_SUMMARY,
    minIdentifySampleSize: 50,
    provider: "",
    target: "live",
    websiteQaReportPath: "",
    webhookReplaySummaryPath: DEFAULT_WEBHOOK_REPLAY_SUMMARY,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split("=");
    const value = inlineValue ?? args[index + 1];

    if (name === "--target") {
      if (value !== "live" && value !== "sandbox") {
        throw new Error("--target must be live or sandbox.");
      }
      options.target = value;
      if (!inlineValue) index += 1;
    } else if (name === "--provider") {
      options.provider = value;
      if (!inlineValue) index += 1;
    } else if (name === "--identify-summary") {
      options.identifySummaryPath = value;
      if (!inlineValue) index += 1;
    } else if (name === "--checkout-summary") {
      options.checkoutSummaryPath = value;
      if (!inlineValue) index += 1;
    } else if (name === "--webhook-replay-summary") {
      options.webhookReplaySummaryPath = value;
      if (!inlineValue) index += 1;
    } else if (name === "--website-qa-report") {
      options.websiteQaReportPath = value;
      if (!inlineValue) index += 1;
    } else if (name === "--min-identify-sample-size") {
      options.minIdentifySampleSize = Number(value);
      if (!Number.isInteger(options.minIdentifySampleSize) || options.minIdentifySampleSize < 1) {
        throw new Error("--min-identify-sample-size must be a positive integer.");
      }
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

function findLatestWebsiteQaReport(root) {
  const qaRoot = join(process.cwd(), root);
  if (!existsSync(qaRoot)) {
    return "";
  }

  const reports = readdirSync(qaRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(qaRoot, entry.name, "report.md"))
    .filter((path) => existsSync(path))
    .filter((path) => /^# DeepSpec Real Website QA Report/m.test(readText(path)))
    .map((path) => ({
      mtimeMs: statSync(path).mtimeMs,
      path,
    }))
    .sort((left, right) => left.mtimeMs - right.mtimeMs);
  return reports.at(-1)?.path ?? "";
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

function printHelp() {
  console.log(`Verify whether DeepSpec paid launch is allowed.

Options:
  --target <live|sandbox>           Launch target. Default: live.
  --provider <polar|stripe>         Override BILLING_PROVIDER.
  --identify-summary <path>         Identify eval summary. Default: ${DEFAULT_IDENTIFY_SUMMARY}.
  --checkout-summary <path>         Billing checkout summary. Default: ${DEFAULT_CHECKOUT_SUMMARY}.
  --webhook-replay-summary <path>   Billing replay summary. Default: ${DEFAULT_WEBHOOK_REPLAY_SUMMARY}.
  --website-qa-report <path>        Website QA report. Default: latest artifacts/qa report.
  --min-identify-sample-size <n>    Minimum identify samples. Default: 50.
`);
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
