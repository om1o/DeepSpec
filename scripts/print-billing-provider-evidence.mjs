import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyBillingSandboxReadiness } from "./verify-billing-sandbox-readiness.mjs";
import { classifyPaidLaunchReadiness } from "./verify-paid-launch-readiness.mjs";

const DEFAULT_CHECKOUT_SUMMARY = "artifacts/release-gates/billing-checkout-summary.json";
const DEFAULT_WEBHOOK_REPLAY_SUMMARY = "artifacts/release-gates/billing-webhook-replay-summary.json";
const DEFAULT_IDENTIFY_SUMMARY = ".deepspec-eval/identify-summary.json";
const DEFAULT_QA_ROOT = "artifacts/qa";
const DEFAULT_MARKDOWN_PATH = "artifacts/release-gates/billing-provider-evidence.md";
const DEFAULT_JSON_PATH = "artifacts/release-gates/billing-provider-evidence.json";

loadLocalEnv(".env.local");
loadLocalEnv(".env");

export function buildBillingProviderEvidence({
  checkoutSummary = null,
  env = {},
  generatedAt = new Date().toISOString(),
  identifySummary = null,
  options = {},
  websiteQaReportPath = "",
  websiteQaReportText = "",
  webhookReplaySummary = null,
} = {}) {
  const provider = String(options.provider ?? env.BILLING_PROVIDER ?? "unconfigured").trim().toLowerCase() || "unconfigured";
  const sandbox = classifyBillingSandboxReadiness({
    checkoutSummary,
    env,
    options: { provider },
    webhookReplaySummary,
  });
  const live = classifyPaidLaunchReadiness({
    checkoutSummary,
    env,
    identifySummary,
    options: { provider, target: "live" },
    websiteQaReportText,
    webhookReplaySummary,
  });
  const recommendation = live.ok
    ? "live_payments_allowed"
    : sandbox.ok
      ? "billing_sandbox_ready_live_blocked"
      : "billing_sandbox_blocked_live_blocked";
  const redactedSandbox = redactResult(sandbox, env);
  const redactedLive = redactResult(live, env);
  const evidence = {
    generatedAt,
    livePaymentsAllowed: live.ok,
    provider,
    recommendation,
    sandboxBillingReady: sandbox.ok,
    sourceArtifacts: {
      checkoutSummary: options.checkoutSummaryPath ?? DEFAULT_CHECKOUT_SUMMARY,
      identifySummary: options.identifySummaryPath ?? DEFAULT_IDENTIFY_SUMMARY,
      websiteQaReport: websiteQaReportPath || "missing",
      webhookReplaySummary: options.webhookReplaySummaryPath ?? DEFAULT_WEBHOOK_REPLAY_SUMMARY,
    },
    sandbox: redactedSandbox,
    live: redactedLive,
  };

  return {
    evidence,
    markdown: renderMarkdownEvidence(evidence),
  };
}

function renderMarkdownEvidence(evidence) {
  return [
    "# DeepSpec Billing Provider Evidence",
    "",
    "## Executive Summary",
    `- Provider: ${evidence.provider}`,
    `- Billing sandbox ready: ${evidence.sandboxBillingReady ? "yes" : "no"}`,
    `- Live payments allowed: ${evidence.livePaymentsAllowed ? "yes" : "no"}`,
    `- Recommendation: ${evidence.recommendation}`,
    `- Generated at: ${evidence.generatedAt}`,
    "",
    "## Source Artifacts",
    ...Object.entries(evidence.sourceArtifacts).map(([label, path]) => `- ${label}: ${path}`),
    "",
    "## Billing Sandbox Gate",
    `- Status: ${evidence.sandbox.ok ? "pass" : "blocked"}`,
    `- Recommendation: ${evidence.sandbox.recommendation}`,
    formatList("OK", evidence.sandbox.checks),
    formatList("WARN", evidence.sandbox.warnings),
    formatList("BLOCKED", evidence.sandbox.blockers),
    "",
    "## Live Paid Launch Gate",
    `- Status: ${evidence.live.ok ? "pass" : "blocked"}`,
    `- Recommendation: ${evidence.live.recommendation}`,
    formatList("OK", evidence.live.checks),
    formatList("WARN", evidence.live.warnings),
    formatList("BLOCKED", evidence.live.blockers),
    "",
    "## Decision Rule",
    evidence.livePaymentsAllowed
      ? "Live payments may be enabled from a technical gate perspective, subject to Dad owning the legal provider account and production keys."
      : "Do not start live payments. Continue sandbox/provider setup until this evidence says live payments allowed.",
    "",
  ].join("\n");
}

function redactResult(result, env) {
  return {
    ...result,
    blockers: result.blockers.map((entry) => redactSensitiveValues(entry, env)),
    checks: result.checks.map((entry) => redactSensitiveValues(entry, env)),
    warnings: result.warnings.map((entry) => redactSensitiveValues(entry, env)),
  };
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
    checkoutSummaryPath: DEFAULT_CHECKOUT_SUMMARY,
    identifySummaryPath: DEFAULT_IDENTIFY_SUMMARY,
    jsonPath: DEFAULT_JSON_PATH,
    markdownPath: DEFAULT_MARKDOWN_PATH,
    provider: "",
    websiteQaReportPath: "",
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
    } else if (name === "--identify-summary") {
      options.identifySummaryPath = value;
      if (!inlineValue) index += 1;
    } else if (name === "--website-qa-report") {
      options.websiteQaReportPath = value;
      if (!inlineValue) index += 1;
    } else if (name === "--markdown") {
      options.markdownPath = value;
      if (!inlineValue) index += 1;
    } else if (name === "--json") {
      options.jsonPath = value;
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
  console.log(`Print and write a no-secret DeepSpec billing provider evidence bundle.

Options:
  --provider <polar|stripe>             Provider to evaluate. Default: BILLING_PROVIDER.
  --checkout-summary <path>             Billing checkout summary path.
  --webhook-replay-summary <path>       Billing replay summary path.
  --identify-summary <path>             Identify eval summary path.
  --website-qa-report <path>            Website QA report path.
  --markdown <path>                     Markdown output path.
  --json <path>                         JSON output path.
`);
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

function writeText(path, text) {
  const fullPath = join(process.cwd(), path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, text);
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
  const options = parseArgs(process.argv.slice(2));
  const websiteQaReportPath = options.websiteQaReportPath || findLatestWebsiteQaReport(DEFAULT_QA_ROOT);
  const { evidence, markdown } = buildBillingProviderEvidence({
    checkoutSummary: readJson(options.checkoutSummaryPath),
    env: process.env,
    identifySummary: readJson(options.identifySummaryPath),
    options,
    websiteQaReportPath,
    websiteQaReportText: websiteQaReportPath ? readText(websiteQaReportPath) : "",
    webhookReplaySummary: readJson(options.webhookReplaySummaryPath),
  });

  writeText(options.markdownPath, `${markdown}\n`);
  writeText(options.jsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(markdown);
  console.log(`Wrote ${options.markdownPath}`);
  console.log(`Wrote ${options.jsonPath}`);

  if (!evidence.livePaymentsAllowed) {
    process.exitCode = 1;
  }
}
