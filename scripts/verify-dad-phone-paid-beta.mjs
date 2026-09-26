import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyBillingSandboxReadiness } from "./verify-billing-sandbox-readiness.mjs";
import { classifyIdentifyEvalSummary } from "./verify-identify-eval-summary.mjs";

const DEFAULT_IDENTIFY_SUMMARY = ".deepspec-eval/identify-summary.json";
const DEFAULT_CHECKOUT_SUMMARY = "artifacts/release-gates/billing-checkout-summary.json";
const DEFAULT_WEBHOOK_REPLAY_SUMMARY = "artifacts/release-gates/billing-webhook-replay-summary.json";
const DEFAULT_QA_ROOT = "artifacts/qa";
const DEFAULT_SUMMARY_PATH = "artifacts/release-gates/dad-phone-paid-beta-summary.json";
const DEFAULT_MARKDOWN_PATH = "artifacts/release-gates/dad-phone-paid-beta-summary.md";

loadLocalEnv(".env.local");
loadLocalEnv(".env");

export function classifyDadPhonePaidBetaReadiness({
  billingSandbox = null,
  identifyRelease = null,
  options = {},
  phoneEvidence = null,
  publicUrl = "",
  websiteQa = null,
} = {}) {
  const target = options.target === "paid-beta" ? "paid-beta" : "dad-test";
  const blockers = [];
  const checks = [];
  const warnings = [];

  const url = classifyPublicPhoneUrl(publicUrl);
  if (url.ok) {
    checks.push(`Phone URL is public HTTPS: ${url.host}.`);
  } else {
    blockers.push(url.message);
  }

  if (websiteQa?.ok) {
    checks.push(`Website QA passed for ${websiteQa.viewport || "unknown viewport"}.`);
  } else {
    blockers.push(websiteQa?.message || "Website QA report is missing. Run `npm run test:website -- --url <preview-url> --headless --viewport phone`.");
  }

  if (target === "dad-test") {
    warnings.push("Real physical phone scan is still manual evidence. Use `npm run qa:phone-card` after setting QA_BASE_URL to the preview URL.");
  } else {
    const phoneGrade = Number(phoneEvidence?.grade ?? options.phoneGrade ?? 0);
    if (Number.isFinite(phoneGrade) && phoneGrade >= 8) {
      checks.push(`Real phone QA grade is ${phoneGrade}/10.`);
    } else {
      blockers.push("Real phone QA must be graded at least 8/10 with camera, AR placement, upload, result, history, and chat evidence.");
    }

    if (billingSandbox?.ok) {
      checks.push(`${billingSandbox.provider || "Provider"} billing sandbox passed provider config, checkout, webhook replay, and portal handoff.`);
    } else {
      blockers.push(...(billingSandbox?.blockers || ["Billing sandbox readiness is missing or blocked."]));
      warnings.push(...(billingSandbox?.warnings || []));
    }

    if (identifyRelease?.ok) {
      checks.push(identifyRelease.message);
    } else {
      blockers.push(`Identify release gate: ${identifyRelease?.message || "missing identify release summary"}`);
    }
  }

  return {
    blockers,
    checks,
    ok: blockers.length === 0,
    recommendation: blockers.length === 0
      ? target === "paid-beta" ? "paid_beta_may_continue" : "dad_phone_test_may_continue"
      : target === "paid-beta" ? "paid_beta_blocked" : "dad_phone_test_blocked",
    target,
    warnings,
  };
}

export function classifyPublicPhoneUrl(value) {
  if (!value) {
    return {
      ok: false,
      message: "Set QA_BASE_URL or pass `--url` with the public Vercel Preview HTTPS URL before Dad phone testing.",
      type: "missing",
    };
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return {
      ok: false,
      message: "Dad phone URL is not a valid URL.",
      type: "invalid",
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      message: "Dad phone testing requires HTTPS so mobile camera APIs can run in a secure context.",
      type: "not_https",
    };
  }

  if (/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(parsed.hostname)) {
    return {
      ok: false,
      message: "Dad phone testing cannot use localhost or 127.0.0.1 because those point at the phone itself.",
      type: "loopback",
    };
  }

  return {
    host: parsed.hostname,
    ok: true,
    message: "Public HTTPS URL is suitable for Dad phone testing.",
    type: "public_https",
  };
}

export function classifyWebsiteQa(report) {
  if (!report || typeof report !== "object") {
    return {
      ok: false,
      message: "Website QA report JSON is missing or unreadable.",
    };
  }

  const failed = Array.isArray(report.failed) ? report.failed : [];
  const passed = Array.isArray(report.passed) ? report.passed : [];
  if (failed.length > 0) {
    return {
      ok: false,
      message: `Website QA has failures: ${failed.join(", ")}.`,
    };
  }

  const required = [
    "auth-login",
    "scanner",
    "scanner-ai-engine",
    "saved-history",
    "result-detail",
    "result-chat",
    "shop-onboarding",
    "billing-provider-fail-closed",
  ];
  const missing = required.filter((scenario) => !passed.includes(scenario));
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Website QA is missing required scenarios: ${missing.join(", ")}.`,
    };
  }

  return {
    ok: true,
    message: "Website QA passed required Dad-phone scenarios.",
    viewport: report.viewport?.name,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const websiteQaJsonPath = options.websiteQaJsonPath || findLatestWebsiteQaJson(DEFAULT_QA_ROOT);
  const websiteQa = classifyWebsiteQa(readJson(websiteQaJsonPath));
  const phoneEvidence = readJson(options.phoneEvidencePath);
  const billingSandbox = classifyBillingSandboxReadiness({
    checkoutSummary: readJson(options.checkoutSummaryPath),
    env: process.env,
    options: { provider: options.provider },
    webhookReplaySummary: readJson(options.webhookReplaySummaryPath),
  });
  const identifyRelease = classifyIdentifyEvalSummary(readJson(options.identifySummaryPath), { minSampleSize: 50 });
  const result = classifyDadPhonePaidBetaReadiness({
    billingSandbox,
    identifyRelease,
    options,
    phoneEvidence,
    publicUrl: options.url,
    websiteQa,
  });

  const summary = {
    ...result,
    artifacts: {
      checkoutSummaryPath: options.checkoutSummaryPath,
      identifySummaryPath: options.identifySummaryPath,
      phoneEvidencePath: options.phoneEvidencePath,
      websiteQaJsonPath,
      webhookReplaySummaryPath: options.webhookReplaySummaryPath,
    },
    publicUrl: options.url,
    verifiedAt: new Date().toISOString(),
  };

  writeJson(options.summaryPath, summary);
  writeText(options.markdownPath, renderMarkdown(summary));

  console.log(`[0/4] Target: ${result.target}`);
  console.log(`[1/4] Recommendation: ${result.recommendation}`);
  for (const check of result.checks) console.log(`      OK: ${check}`);
  for (const warning of result.warnings) console.warn(`      WARN: ${warning}`);
  console.log(`      Wrote ${options.summaryPath}`);
  console.log(`      Wrote ${options.markdownPath}`);

  if (!result.ok) {
    console.error("[2/4] Blocked.");
    for (const blocker of result.blockers) console.error(`      BLOCKED: ${blocker}`);
    console.error("[3/4] Decision: do not call this ready until the blockers above are fixed.");
    process.exit(1);
  }

  console.log("[2/4] Gate passed.");
  console.log("[3/4] Decision: continue to the next release step.");
}

function renderMarkdown(summary) {
  return [
    "# DeepSpec Dad Phone / Paid Beta Gate",
    "",
    "## Executive Summary",
    `- Target: ${summary.target}`,
    `- Recommendation: ${summary.recommendation}`,
    `- Public URL: ${summary.publicUrl || "not set"}`,
    `- Verified at: ${summary.verifiedAt}`,
    "",
    "## Checks",
    formatList("OK", summary.checks),
    formatList("WARN", summary.warnings),
    formatList("BLOCKED", summary.blockers),
    "",
    "## Artifacts",
    ...Object.entries(summary.artifacts).map(([key, value]) => `- ${key}: ${value || "not found"}`),
    "",
    "## Decision Rule",
    summary.ok
      ? "This gate passed for the selected target. Keep live billing disabled unless the paid-launch gate also passes."
      : "This gate is blocked. Do not claim Dad-phone readiness or paid-beta readiness until the blocked items are fixed.",
    "",
  ].join("\n");
}

function formatList(label, values) {
  if (!values?.length) return `- ${label}: none`;
  return values.map((value) => `- ${label}: ${value}`).join("\n");
}

function parseArgs(args) {
  const options = {
    checkoutSummaryPath: DEFAULT_CHECKOUT_SUMMARY,
    identifySummaryPath: DEFAULT_IDENTIFY_SUMMARY,
    markdownPath: DEFAULT_MARKDOWN_PATH,
    phoneEvidencePath: "",
    phoneGrade: 0,
    provider: "polar",
    summaryPath: DEFAULT_SUMMARY_PATH,
    target: "dad-test",
    url: process.env.QA_BASE_URL || "",
    websiteQaJsonPath: "",
    webhookReplaySummaryPath: DEFAULT_WEBHOOK_REPLAY_SUMMARY,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split("=");
    const value = inlineValue ?? args[index + 1];

    if (name === "--target") {
      if (value !== "dad-test" && value !== "paid-beta") throw new Error("--target must be dad-test or paid-beta.");
      options.target = value;
      if (!inlineValue) index += 1;
    } else if (name === "--url") {
      options.url = value;
      if (!inlineValue) index += 1;
    } else if (name === "--provider") {
      options.provider = value;
      if (!inlineValue) index += 1;
    } else if (name === "--website-qa-json") {
      options.websiteQaJsonPath = value;
      if (!inlineValue) index += 1;
    } else if (name === "--phone-evidence") {
      options.phoneEvidencePath = value;
      if (!inlineValue) index += 1;
    } else if (name === "--phone-grade") {
      options.phoneGrade = Number(value);
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
    } else if (name === "--summary") {
      options.summaryPath = value;
      if (!inlineValue) index += 1;
    } else if (name === "--markdown") {
      options.markdownPath = value;
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
  console.log(`Verify Dad-phone or paid-beta release readiness.

Options:
  --target <dad-test|paid-beta>          Default: dad-test.
  --url <https-url>                      Public preview URL. Default: QA_BASE_URL.
  --provider <polar|stripe>              Default: polar.
  --website-qa-json <path>               Website QA report JSON. Default: latest artifacts/qa report.json.
  --phone-evidence <path>                Manual phone QA JSON with grade.
  --phone-grade <n>                      Manual phone grade override for paid-beta target.
  --identify-summary <path>              Default: ${DEFAULT_IDENTIFY_SUMMARY}
  --checkout-summary <path>              Default: ${DEFAULT_CHECKOUT_SUMMARY}
  --webhook-replay-summary <path>        Default: ${DEFAULT_WEBHOOK_REPLAY_SUMMARY}
  --summary <path>                       Default: ${DEFAULT_SUMMARY_PATH}
  --markdown <path>                      Default: ${DEFAULT_MARKDOWN_PATH}
`);
}

function findLatestWebsiteQaJson(root) {
  const qaRoot = resolve(root);
  if (!existsSync(qaRoot)) return "";

  const reports = readdirSync(qaRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(qaRoot, entry.name, "report.json"))
    .filter((path) => existsSync(path))
    .map((path) => ({ mtimeMs: statSync(path).mtimeMs, path }))
    .sort((left, right) => left.mtimeMs - right.mtimeMs);

  return reports.at(-1)?.path ?? "";
}

function readJson(path) {
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(path, value) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function loadLocalEnv(filename) {
  let contents;
  try {
    contents = readFileSync(join(process.cwd(), filename), "utf8");
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
