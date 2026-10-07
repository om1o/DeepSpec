import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyIdentifyEvalSummary } from "./verify-identify-eval-summary.mjs";

const DEFAULT_IDENTIFY_SUMMARY = ".deepspec-eval/identify-summary.json";
const DEFAULT_MARKDOWN_PATH = "artifacts/release-gates/identify-provider-evidence.md";
const DEFAULT_JSON_PATH = "artifacts/release-gates/identify-provider-evidence.json";
const DEFAULT_MIN_SAMPLE_SIZE = 50;

loadLocalEnv(".env.local");
loadLocalEnv(".env");

export function buildIdentifyProviderEvidence({
  env = {},
  generatedAt = new Date().toISOString(),
  identifySummary = null,
  options = {},
} = {}) {
  const readiness = classifyIdentifyProviderReadiness({ env, identifySummary, options });
  const evidence = {
    generatedAt,
    liveIdentifyReady: readiness.ok,
    recommendation: readiness.recommendation,
    sourceArtifacts: {
      identifySummary: options.identifySummaryPath ?? DEFAULT_IDENTIFY_SUMMARY,
    },
    readiness,
  };

  return {
    evidence,
    markdown: renderMarkdownEvidence(evidence),
  };
}

export function classifyIdentifyProviderReadiness({ env = {}, identifySummary = null, options = {} } = {}) {
  const minSampleSize = Number(options.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE);
  const providers = buildProviderStatuses(env);
  const release = classifyIdentifyEvalSummary(identifySummary, { minSampleSize });
  const checks = [];
  const warnings = [];
  const blockers = [];

  const productionCloudRoutes = providers.filter((provider) => provider.productionRoute === true);
  const readyProductionRoutes = productionCloudRoutes.filter((provider) => provider.ready);
  const readyCloudBackups = providers.filter((provider) => provider.ready && provider.cloudBackup === true);

  if (readyProductionRoutes.length > 0) {
    checks.push(`Identify provider route configured: ${readyProductionRoutes.map((provider) => provider.name).join(", ")}.`);
  } else {
    blockers.push("No production cloud identify route is configured. Add GEMINI_API_KEY or enable Groq with GROQ_API_KEY.");
  }

  for (const provider of providers) {
    if (provider.enabled && provider.requiresToken && !provider.tokenPresent) {
      warnings.push(`${provider.name} is enabled but missing ${provider.tokenNames.join(" or ")}.`);
    }

    if (provider.enabled && provider.localOnly) {
      warnings.push(`${provider.name} is local-development only and does not prove production identify reliability.`);
    }

    if (provider.enabled && provider.ready) {
      checks.push(`${provider.name} ${provider.role} is ready with ${provider.model}.`);
    }
  }

  if (readyCloudBackups.length > 0) {
    checks.push(`Cloud fallback ready: ${readyCloudBackups.map((provider) => provider.name).join(", ")}.`);
  } else {
    warnings.push("No cloud fallback is ready. A single provider outage can still block paid scans.");
  }

  if (release.ok) {
    checks.push(`Release eval: ${release.message}`);
  } else {
    blockers.push(`Release eval: ${release.message}`);
  }

  const summaryDetails = summarizeIdentifySummary(identifySummary);
  const recommendation = blockers.length === 0
    ? "live_identify_ready"
    : readyProductionRoutes.length > 0
      ? "provider_config_ready_release_blocked"
      : "configure_identify_provider";

  return {
    blockers,
    checks,
    ok: blockers.length === 0,
    providers,
    recommendation,
    release: {
      ...release,
      summary: summaryDetails,
    },
    warnings,
  };
}

function buildProviderStatuses(env) {
  const geminiKeyPresent = hasValue(env.GEMINI_API_KEY);
  const groqEnabled = env.DEEPSPEC_ENABLE_GROQ_IDENTIFY_FALLBACK === "true";
  const groqTokenPresent = hasValue(env.GROQ_API_KEY);
  const hfEnabled = env.DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK === "true" || env.DEEPSPEC_FORCE_HF_IDENTIFY === "true";
  const hfTokenPresent = hasValue(env.HF_TOKEN) || hasValue(env.HF_API_TOKEN) || hasValue(env.HUGGINGFACE_API_KEY);
  const ollamaEnabled = env.DEEPSPEC_ENABLE_OLLAMA_IDENTIFY_FALLBACK === "true";

  return [
    {
      cloudBackup: false,
      enabled: true,
      endpointOrigin: "https://generativelanguage.googleapis.com",
      localOnly: false,
      model: env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
      name: "Gemini",
      productionRoute: true,
      ready: geminiKeyPresent,
      requiresToken: true,
      role: "primary",
      tokenNames: ["GEMINI_API_KEY"],
      tokenPresent: geminiKeyPresent,
    },
    {
      cloudBackup: true,
      enabled: groqEnabled,
      endpointOrigin: originFor(env.GROQ_IDENTIFY_ENDPOINT_URL, "https://api.groq.com"),
      localOnly: false,
      model: env.GROQ_IDENTIFY_MODEL?.trim() || "meta-llama/llama-4-scout-17b-16e-instruct",
      name: "Groq",
      productionRoute: groqEnabled,
      ready: groqEnabled && groqTokenPresent,
      requiresToken: true,
      role: "cloud route",
      tokenNames: ["GROQ_API_KEY"],
      tokenPresent: groqTokenPresent,
    },
    {
      cloudBackup: true,
      enabled: hfEnabled,
      endpointOrigin: originFor(env.HF_IDENTIFY_ENDPOINT_URL, "https://router.huggingface.co"),
      localOnly: false,
      model: env.HF_IDENTIFY_MODEL?.trim() || "Qwen/Qwen2.5-VL-7B-Instruct",
      name: isOpenRouterEndpoint(env.HF_IDENTIFY_ENDPOINT_URL) ? "OpenRouter/HF adapter" : "Hugging Face",
      productionRoute: false,
      ready: hfEnabled && hfTokenPresent,
      requiresToken: true,
      role: "cloud fallback",
      tokenNames: ["HF_TOKEN", "HF_API_TOKEN", "HUGGINGFACE_API_KEY"],
      tokenPresent: hfTokenPresent,
    },
    {
      cloudBackup: false,
      enabled: ollamaEnabled,
      endpointOrigin: originFor(env.OLLAMA_BASE_URL, "http://127.0.0.1:11434"),
      localOnly: true,
      model: env.OLLAMA_IDENTIFY_MODEL?.trim() || "llava:latest",
      name: "Ollama",
      productionRoute: false,
      ready: ollamaEnabled,
      requiresToken: false,
      role: "local fallback",
      tokenNames: [],
      tokenPresent: true,
    },
  ];
}

function summarizeIdentifySummary(summary) {
  if (!summary || typeof summary !== "object") {
    return {
      attemptedCount: 0,
      failureModes: {},
      lastProviderFailure: null,
      passCount: 0,
      providerFailureCount: 0,
      providerStatus: "missing",
      sampleSize: 0,
      skippedCount: 0,
    };
  }

  const results = Array.isArray(summary.results) ? summary.results : [];
  const lastProviderFailure = [...results].reverse().find((result) =>
    Array.isArray(result.failureReasons) &&
    result.failureReasons.some((reason) => ["network", "not_configured", "provider_error", "rate_limited"].includes(reason)),
  );

  return {
    attemptedCount: Number(summary.attemptedCount ?? 0),
    failureModes: summary.metrics?.failureModes ?? summary.failureModes ?? {},
    lastProviderFailure: lastProviderFailure
      ? {
          failureReasons: lastProviderFailure.failureReasons,
          imagePath: lastProviderFailure.imagePath,
          providerMs: lastProviderFailure.providerMs,
          status: lastProviderFailure.status,
          totalMs: lastProviderFailure.totalMs ?? lastProviderFailure.elapsedMs,
        }
      : null,
    modelConfig: summary.modelConfig ?? null,
    passCount: Number(summary.passCount ?? 0),
    providerFailureCount: Number(summary.providerFailureCount ?? 0),
    providerStatus: String(summary.providerStatus ?? "unknown"),
    sampleSize: Number(summary.sampleSize ?? 0),
    skippedCount: Number(summary.skippedCount ?? 0),
    stoppedEarlyReason: summary.stoppedEarlyReason ?? null,
  };
}

function renderMarkdownEvidence(evidence) {
  const releaseSummary = evidence.readiness.release.summary;
  return [
    "# DeepSpec Identify Provider Evidence",
    "",
    "## Executive Summary",
    `- Live identify ready: ${evidence.liveIdentifyReady ? "yes" : "no"}`,
    `- Recommendation: ${evidence.recommendation}`,
    `- Generated at: ${evidence.generatedAt}`,
    `- Identify summary: ${evidence.sourceArtifacts.identifySummary}`,
    "",
    "## Provider Chain",
    ...evidence.readiness.providers.map(formatProvider),
    "",
    "## Release Eval Gate",
    `- Status: ${evidence.readiness.release.ok ? "pass" : "blocked"}`,
    `- Message: ${evidence.readiness.release.message}`,
    `- Attempted: ${releaseSummary.attemptedCount}/${releaseSummary.sampleSize}`,
    `- Passed: ${releaseSummary.passCount}`,
    `- Skipped: ${releaseSummary.skippedCount}`,
    `- Provider failures: ${releaseSummary.providerFailureCount}`,
    `- Provider status: ${releaseSummary.providerStatus}`,
    `- Failure modes: ${formatObject(releaseSummary.failureModes)}`,
    `- Last provider failure: ${formatLastProviderFailure(releaseSummary.lastProviderFailure)}`,
    "",
    "## Readiness",
    formatList("OK", evidence.readiness.checks),
    formatList("WARN", evidence.readiness.warnings),
    formatList("BLOCKED", evidence.readiness.blockers),
    "",
    "## Decision Rule",
    evidence.liveIdentifyReady
      ? "The identify gate is technically ready for paid launch, subject to the rest of the paid-launch readiness gate."
      : "Do not start live payments. Keep provider setup in sandbox or setup mode until this evidence says live identify ready.",
    "",
  ].join("\n");
}

function formatProvider(provider) {
  const state = provider.ready ? "ready" : provider.enabled ? "configured incorrectly" : "disabled";
  const route = provider.productionRoute ? "production route" : provider.localOnly ? "local only" : "fallback only";
  return [
    `- ${provider.name}: ${state}; ${route}; model ${provider.model}; origin ${provider.endpointOrigin}`,
  ].join("");
}

function formatLastProviderFailure(failure) {
  if (!failure) {
    return "none";
  }

  return [
    `status ${failure.status ?? "unknown"}`,
    `reasons ${(failure.failureReasons ?? []).join(", ") || "unknown"}`,
    `providerMs ${failure.providerMs ?? "unknown"}`,
    `totalMs ${failure.totalMs ?? "unknown"}`,
    failure.imagePath ? `image ${failure.imagePath}` : "",
  ].filter(Boolean).join("; ");
}

function formatObject(value) {
  if (!value || typeof value !== "object" || Object.keys(value).length === 0) {
    return "none";
  }

  return Object.entries(value)
    .map(([key, count]) => `${key}: ${count}`)
    .join(", ");
}

function formatList(label, values) {
  if (!values.length) {
    return `- ${label}: none`;
  }

  return values.map((value) => `- ${label}: ${value}`).join("\n");
}

function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function originFor(rawValue, fallback) {
  try {
    return new URL(rawValue?.trim() || fallback).origin;
  } catch {
    return fallback;
  }
}

function isOpenRouterEndpoint(rawValue) {
  try {
    return new URL(rawValue?.trim() || "").hostname.endsWith("openrouter.ai");
  } catch {
    return false;
  }
}

function parseArgs(args) {
  const options = {
    identifySummaryPath: DEFAULT_IDENTIFY_SUMMARY,
    jsonPath: DEFAULT_JSON_PATH,
    markdownPath: DEFAULT_MARKDOWN_PATH,
    minSampleSize: DEFAULT_MIN_SAMPLE_SIZE,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split("=");
    const value = inlineValue ?? args[index + 1];

    if (name === "--identify-summary") {
      options.identifySummaryPath = value;
      if (!inlineValue) index += 1;
    } else if (name === "--min-sample-size") {
      options.minSampleSize = parseMinSampleSize(value);
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

function parseMinSampleSize(value) {
  const sampleSize = Number(value);
  if (!Number.isInteger(sampleSize) || sampleSize < 1) {
    throw new Error("--min-sample-size must be a positive integer.");
  }

  return sampleSize;
}

function printHelp() {
  console.log(`Print and write a no-secret DeepSpec identify provider evidence bundle.

Options:
  --identify-summary <path>   Identify eval summary path.
  --min-sample-size <n>       Minimum release sample size. Default: ${DEFAULT_MIN_SAMPLE_SIZE}
  --markdown <path>           Markdown output path.
  --json <path>               JSON output path.
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

function writeText(path, text) {
  const fullPath = join(process.cwd(), path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, text);
}

function loadLocalEnv(filename) {
  const path = join(process.cwd(), filename);
  if (!existsSync(path)) {
    return;
  }

  const contents = readFileSync(path, "utf8");
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
  const { evidence, markdown } = buildIdentifyProviderEvidence({
    env: process.env,
    identifySummary: readJson(options.identifySummaryPath),
    options,
  });

  writeText(options.markdownPath, `${markdown}\n`);
  writeText(options.jsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(markdown);
  console.log(`Wrote ${options.markdownPath}`);
  console.log(`Wrote ${options.jsonPath}`);

  if (!evidence.liveIdentifyReady) {
    process.exitCode = 1;
  }
}
