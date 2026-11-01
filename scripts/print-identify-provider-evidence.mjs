import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyIdentifyEvalSummary } from "./verify-identify-eval-summary.mjs";

const DEFAULT_IDENTIFY_SUMMARY = ".deepspec-eval/identify-summary.json";
const DEFAULT_MARKDOWN_PATH = "artifacts/release-gates/identify-provider-evidence.md";
const DEFAULT_JSON_PATH = "artifacts/release-gates/identify-provider-evidence.json";
const DEFAULT_MIN_SAMPLE_SIZE = 50;
const DEFAULT_MAX_EVAL_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

loadLocalEnv(".env.local");
loadLocalEnv(".env");

export function buildIdentifyProviderEvidence({
  env = {},
  generatedAt = new Date().toISOString(),
  identifySummary = null,
  options = {},
} = {}) {
  const readiness = classifyIdentifyProviderReadiness({
    env,
    identifySummary,
    options: { ...options, now: options.now ?? generatedAt },
  });
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
  const maxEvalAgeMs = Number(options.maxEvalAgeMs ?? DEFAULT_MAX_EVAL_AGE_MS);
  const providers = buildProviderStatuses(env);
  const release = classifyIdentifyEvalSummary(identifySummary, { minSampleSize });
  const checks = [];
  const warnings = [];
  const blockers = [];

  const productionCloudRoutes = providers.filter((provider) => provider.productionRoute === true);
  const readyProductionRoutes = productionCloudRoutes.filter((provider) => provider.ready);
  const activeProductionRoute = ["groq", "gemini", "huggingface"]
    .map((providerId) => readyProductionRoutes.find((provider) => provider.providerId === providerId))
    .find(Boolean);
  const readyCloudBackups = providers.filter((provider) => provider.ready && provider.cloudBackup === true);

  if (readyProductionRoutes.length > 0) {
    checks.push(`Identify provider route configured: ${readyProductionRoutes.map((provider) => provider.name).join(", ")}.`);
  } else {
    blockers.push("No production cloud identify route is configured. Configure a supported server-side identify provider.");
  }

  for (const provider of providers) {
    if (provider.enabled && provider.requiresToken && !provider.tokenPresent) {
      warnings.push(`${provider.name} is enabled but missing ${provider.tokenNames.join(" or ")}.`);
    }

    if (provider.enabled && !provider.endpointAllowed) {
      warnings.push(`${provider.name} endpoint must use HTTPS on an explicitly supported provider host.`);
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

  const evalEvidence = classifyEvalRouteEvidence({
    activeProductionRoute,
    identifySummary,
    maxEvalAgeMs,
    minSampleSize,
    now: options.now,
  });
  if (release.ok && evalEvidence.ok) {
    checks.push(`Release eval: ${release.message} ${evalEvidence.message}`);
  } else if (release.ok) {
    blockers.push(`Release eval evidence: ${evalEvidence.message}`);
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
      evidence: evalEvidence,
      summary: summaryDetails,
    },
    warnings,
  };
}

function buildProviderStatuses(env) {
  const geminiKeyPresent = hasValue(env.GEMINI_API_KEY);
  const groqEnabled = env.DEEPSPEC_ENABLE_GROQ_IDENTIFY_FALLBACK === "true";
  const groqTokenPresent = hasValue(env.GROQ_API_KEY);
  const hfFallbackEnabled = env.DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK === "true";
  const hfEnabled = hfFallbackEnabled || env.DEEPSPEC_FORCE_HF_IDENTIFY === "true";
  const hfTokenPresent = hasValue(env.HF_TOKEN) || hasValue(env.HF_API_TOKEN) || hasValue(env.HUGGINGFACE_API_KEY);
  const ollamaEnabled = env.DEEPSPEC_ENABLE_OLLAMA_IDENTIFY_FALLBACK === "true";

  return [
    {
      cloudBackup: false,
      enabled: true,
      endpointOrigin: "https://generativelanguage.googleapis.com",
      endpointRoute: "https://generativelanguage.googleapis.com/v1beta/models/:model:generateContent",
      endpointAllowed: true,
      localOnly: false,
      model: env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
      name: "Gemini",
      providerId: "gemini",
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
      endpointRoute: chatCompletionsRoute(env.GROQ_IDENTIFY_ENDPOINT_URL, "https://api.groq.com/openai/v1/chat/completions"),
      endpointAllowed: isAllowedProviderEndpoint("groq", env.GROQ_IDENTIFY_ENDPOINT_URL, "https://api.groq.com/openai/v1/chat/completions"),
      localOnly: false,
      model: env.GROQ_IDENTIFY_MODEL?.trim() || "qwen/qwen3.8-27b",
      name: "Groq",
      providerId: "groq",
      productionRoute: groqEnabled,
      ready: groqEnabled && groqTokenPresent && isAllowedProviderEndpoint("groq", env.GROQ_IDENTIFY_ENDPOINT_URL, "https://api.groq.com/openai/v1/chat/completions"),
      requiresToken: true,
      role: "cloud route",
      tokenNames: ["GROQ_API_KEY"],
      tokenPresent: groqTokenPresent,
    },
    {
      cloudBackup: true,
      enabled: hfEnabled,
      endpointOrigin: originFor(env.HF_IDENTIFY_ENDPOINT_URL, "https://router.huggingface.co"),
      endpointRoute: chatCompletionsRoute(env.HF_IDENTIFY_ENDPOINT_URL, "https://router.huggingface.co/v1/chat/completions"),
      endpointAllowed: isAllowedProviderEndpoint("huggingface", env.HF_IDENTIFY_ENDPOINT_URL, "https://router.huggingface.co/v1/chat/completions"),
      localOnly: false,
      model: env.HF_IDENTIFY_MODEL?.trim() || "Qwen/Qwen2.5-VL-7B-Instruct",
      name: isOpenRouterEndpoint(env.HF_IDENTIFY_ENDPOINT_URL) ? "OpenRouter/HF adapter" : "Hugging Face",
      providerId: "huggingface",
      productionRoute: hfFallbackEnabled,
      ready: hfEnabled && hfTokenPresent && isAllowedProviderEndpoint("huggingface", env.HF_IDENTIFY_ENDPOINT_URL, "https://router.huggingface.co/v1/chat/completions"),
      requiresToken: true,
      role: hfFallbackEnabled && !geminiKeyPresent ? "cloud route" : "cloud fallback",
      tokenNames: ["HF_TOKEN", "HF_API_TOKEN", "HUGGINGFACE_API_KEY"],
      tokenPresent: hfTokenPresent,
    },
    {
      cloudBackup: false,
      enabled: ollamaEnabled,
      endpointOrigin: originFor(env.OLLAMA_BASE_URL, "http://127.0.0.1:11434"),
      endpointRoute: originFor(env.OLLAMA_BASE_URL, "http://127.0.0.1:11434"),
      endpointAllowed: true,
      localOnly: true,
      model: env.OLLAMA_IDENTIFY_MODEL?.trim() || "llava:latest",
      name: "Ollama",
      providerId: "ollama",
      productionRoute: false,
      ready: ollamaEnabled,
      requiresToken: false,
      role: "local fallback",
      tokenNames: [],
      tokenPresent: true,
    },
  ];
}

function classifyEvalRouteEvidence({ activeProductionRoute, identifySummary, maxEvalAgeMs, minSampleSize, now }) {
  const generatedAtMs = Date.parse(identifySummary?.generatedAt ?? "");
  const nowMs = Date.parse(now ?? new Date().toISOString());
  if (!Number.isFinite(generatedAtMs) || !Number.isFinite(nowMs)) {
    return { ok: false, message: "The passing eval has no valid generatedAt timestamp." };
  }

  const ageMs = nowMs - generatedAtMs;
  if (ageMs < -MAX_FUTURE_CLOCK_SKEW_MS || ageMs > maxEvalAgeMs) {
    return { ok: false, message: `The passing eval is stale or outside the allowed clock skew (maximum age ${Math.round(maxEvalAgeMs / 3_600_000)} hours).` };
  }

  if (!activeProductionRoute) {
    return { ok: false, message: "No active production route is available to match against the eval." };
  }

  const evaluatedRoutes = Array.isArray(identifySummary?.modelConfig?.evaluatedRoutes)
    ? identifySummary.modelConfig.evaluatedRoutes
    : [];
  const matchingRoute = evaluatedRoutes.find((route) =>
    route?.provider === activeProductionRoute.providerId
      && route?.model === activeProductionRoute.model
      && route?.endpointRoute === activeProductionRoute.endpointRoute,
  );
  if (!matchingRoute) {
    return {
      ok: false,
      message: `The passing eval does not match the active ${activeProductionRoute.name} provider, model, and endpoint route.`,
    };
  }

  const attemptedCount = Number(matchingRoute.attemptedCount ?? 0);
  const passCount = Number(matchingRoute.passCount ?? 0);
  const failureCount = Number(matchingRoute.failureCount ?? 0);
  if (attemptedCount < minSampleSize || passCount < minSampleSize || failureCount !== 0 || passCount !== attemptedCount) {
    return {
      ok: false,
      message: `The active ${activeProductionRoute.name} route has ${passCount}/${attemptedCount} passing samples and ${failureCount} failures; it requires at least ${minSampleSize} attempts, every attempt passing, and zero failures.`,
    };
  }

  return {
    ok: true,
    message: `Evidence is fresh and ${passCount}/${attemptedCount} active-route samples pass for ${activeProductionRoute.name} (${activeProductionRoute.model}, ${activeProductionRoute.endpointRoute}).`,
  };
}

function chatCompletionsRoute(rawValue, fallback) {
  const raw = rawValue?.trim() || fallback;
  const endpoint = raw.endsWith("/chat/completions") ? raw : `${raw.replace(/\/$/, "")}/v1/chat/completions`;
  try {
    const url = new URL(endpoint);
    return `${url.origin}${url.pathname}`;
  } catch {
    return endpoint;
  }
}

function isAllowedProviderEndpoint(provider, rawValue, fallback) {
  const allowedHosts = provider === "groq"
    ? new Set(["api.groq.com"])
    : new Set(["openrouter.ai", "router.huggingface.co"]);
  try {
    const url = new URL(rawValue?.trim() || fallback);
    return url.protocol === "https:"
      && url.port === ""
      && url.username === ""
      && url.password === ""
      && allowedHosts.has(url.hostname);
  } catch {
    return false;
  }
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
    "## Credentialed Endpoint Policy",
    "- Image and bearer-token requests require HTTPS, the default port, no embedded URL credentials, and an exact supported host.",
    "- Identify hosts: generativelanguage.googleapis.com, api.groq.com, router.huggingface.co, openrouter.ai.",
    "- OCR host: api-inference.huggingface.co. Subdomains and lookalike suffixes are not accepted.",
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
