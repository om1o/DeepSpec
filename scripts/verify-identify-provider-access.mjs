import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_JSON_PATH = "artifacts/release-gates/identify-provider-access.json";
const DEFAULT_MARKDOWN_PATH = "artifacts/release-gates/identify-provider-access.md";
const DEFAULT_MIN_CLOUD_ROUTES = 3;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_GROQ_MODEL = "qwen/qwen3.8-27b";
const DEFAULT_HF_MODEL = "Qwen/Qwen2.5-VL-7B-Instruct";
const DEFAULT_HF_ENDPOINT = "https://router.huggingface.co/v1/chat/completions";

loadLocalEnv(".env.local");
loadLocalEnv(".env");

export async function verifyIdentifyProviderAccess({
  env = {},
  fetchImpl = fetch,
  generatedAt = new Date().toISOString(),
  minCloudRoutes = DEFAULT_MIN_CLOUD_ROUTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const routes = await Promise.all([
    probeGemini(env, fetchImpl, timeoutMs),
    probeGroq(env, fetchImpl, timeoutMs),
    probeHfAdapter(env, fetchImpl, timeoutMs),
  ]);
  const accessibleRoutes = routes.filter((route) => route.accessible);
  const requiredRoutes = parsePositiveInteger(minCloudRoutes, "minCloudRoutes");
  const ok = accessibleRoutes.length >= requiredRoutes;
  const evidence = {
    accessibleRouteCount: accessibleRoutes.length,
    generatedAt,
    minCloudRoutes: requiredRoutes,
    ok,
    recommendation: ok ? "provider_access_verified" : "configure_or_repair_provider_access",
    routes,
  };

  return { evidence, markdown: renderMarkdown(evidence) };
}

async function probeGemini(env, fetchImpl, timeoutMs) {
  const model = cleanModel(env.GEMINI_MODEL, DEFAULT_GEMINI_MODEL);
  const key = clean(env.GEMINI_API_KEY);
  if (!key) return unavailable("gemini", "Gemini", model, "https://generativelanguage.googleapis.com", "not_configured");

  const { body, status } = await requestJson(
    fetchImpl,
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`,
    { "x-goog-api-key": key },
    timeoutMs,
  );
  const credentialAccepted = status !== 401 && status !== 403 && status !== "network_error";
  const modelAvailable = status === 200
    && body?.name === `models/${model}`
    && Array.isArray(body?.supportedGenerationMethods)
    && body.supportedGenerationMethods.includes("generateContent");
  return routeResult("gemini", "Gemini", model, "https://generativelanguage.googleapis.com", credentialAccepted, modelAvailable, status);
}

async function probeGroq(env, fetchImpl, timeoutMs) {
  const model = cleanModel(env.GROQ_IDENTIFY_MODEL, DEFAULT_GROQ_MODEL);
  const key = clean(env.GROQ_API_KEY);
  const enabled = env.DEEPSPEC_ENABLE_GROQ_IDENTIFY_FALLBACK === "true";
  if (!enabled || !key) return unavailable("groq", "Groq", model, "https://api.groq.com", "not_configured");

  const { body, status } = await requestJson(
    fetchImpl,
    "https://api.groq.com/openai/v1/models",
    { Authorization: `Bearer ${key}` },
    timeoutMs,
  );
  const credentialAccepted = status !== 401 && status !== 403 && status !== "network_error";
  const modelAvailable = status === 200
    && Array.isArray(body?.data)
    && body.data.some((item) => item?.id === model && item?.active !== false);
  return routeResult("groq", "Groq", model, "https://api.groq.com", credentialAccepted, modelAvailable, status);
}

async function probeHfAdapter(env, fetchImpl, timeoutMs) {
  const model = cleanModel(env.HF_IDENTIFY_MODEL, DEFAULT_HF_MODEL);
  const token = clean(env.HF_TOKEN) || clean(env.HF_API_TOKEN) || clean(env.HUGGINGFACE_API_KEY);
  const enabled = env.DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK === "true" || env.DEEPSPEC_FORCE_HF_IDENTIFY === "true";
  const endpoint = allowedHfEndpoint(env.HF_IDENTIFY_ENDPOINT_URL);
  const name = endpoint?.hostname === "openrouter.ai" ? "OpenRouter/HF adapter" : "Hugging Face";
  const providerId = endpoint?.hostname === "openrouter.ai" ? "openrouter" : "huggingface";
  const origin = endpoint?.origin ?? safeOrigin(env.HF_IDENTIFY_ENDPOINT_URL, DEFAULT_HF_ENDPOINT);
  if (!enabled || !token) return unavailable(providerId, name, model, origin, "not_configured");
  if (!endpoint) return unavailable(providerId, name, model, origin, "endpoint_not_allowed");

  if (endpoint.hostname === "openrouter.ai") {
    const [keyResult, modelResult] = await Promise.all([
      requestJson(fetchImpl, "https://openrouter.ai/api/v1/key", { Authorization: `Bearer ${token}` }, timeoutMs),
      requestJson(fetchImpl, `https://openrouter.ai/api/v1/model/${encodeModelPath(model)}`, { Authorization: `Bearer ${token}` }, timeoutMs),
    ]);
    const credentialAccepted = keyResult.status === 200;
    const modelAvailable = modelResult.status === 200 && Boolean(modelResult.body?.data || modelResult.body?.id || modelResult.body?.name);
    return routeResult(providerId, name, model, origin, credentialAccepted, modelAvailable, `key:${keyResult.status},model:${modelResult.status}`);
  }

  const [keyResult, modelResult] = await Promise.all([
    requestJson(fetchImpl, "https://huggingface.co/api/whoami-v2", { Authorization: `Bearer ${token}` }, timeoutMs),
    requestJson(fetchImpl, `https://huggingface.co/api/models/${encodeModelPath(model)}`, { Authorization: `Bearer ${token}` }, timeoutMs),
  ]);
  const credentialAccepted = keyResult.status === 200;
  const modelAvailable = modelResult.status === 200 && (modelResult.body?.id === model || modelResult.body?.modelId === model);
  return routeResult(providerId, name, model, origin, credentialAccepted, modelAvailable, `key:${keyResult.status},model:${modelResult.status}`);
}

async function requestJson(fetchImpl, url, headers, timeoutMs) {
  try {
    const response = await fetchImpl(url, { headers, method: "GET", redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    return { body: response.ok ? await response.json().catch(() => null) : null, status: response.status };
  } catch {
    return { body: null, status: "network_error" };
  }
}

function routeResult(providerId, name, model, origin, credentialAccepted, modelAvailable, status) {
  return { accessible: credentialAccepted && modelAvailable, credentialAccepted, model, modelAvailable, name, origin, providerId, status };
}

function unavailable(providerId, name, model, origin, status) {
  return routeResult(providerId, name, model, origin, false, false, status);
}

function allowedHfEndpoint(rawValue) {
  try {
    const url = new URL(clean(rawValue) || DEFAULT_HF_ENDPOINT);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    return new Set(["openrouter.ai", "router.huggingface.co"]).has(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

function safeOrigin(rawValue, fallback) {
  try {
    return new URL(clean(rawValue) || fallback).origin;
  } catch {
    return "invalid";
  }
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanModel(value, fallback) {
  return clean(value) || fallback;
}

function encodeModelPath(model) {
  return model.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function renderMarkdown(evidence) {
  return [
    "# DeepSpec Identify Provider Access",
    "",
    "## Executive Summary",
    `- Provider access verified: ${evidence.ok ? "yes" : "no"}`,
    `- Accessible online routes: ${evidence.accessibleRouteCount}/${evidence.minCloudRoutes} required`,
    `- Recommendation: ${evidence.recommendation}`,
    `- Generated at: ${evidence.generatedAt}`,
    "",
    "## Routes",
    ...evidence.routes.map((route) => `- ${route.name}: ${route.accessible ? "accessible" : "blocked"}; model ${route.model}; origin ${route.origin}; status ${route.status}`),
    "",
    "This verifier performs metadata-only GET requests. It does not send an image, run inference, or print credential/account details.",
    "",
  ].join("\n");
}

function parseArgs(args) {
  const options = { jsonPath: DEFAULT_JSON_PATH, markdownPath: DEFAULT_MARKDOWN_PATH, minCloudRoutes: DEFAULT_MIN_CLOUD_ROUTES };
  for (let index = 0; index < args.length; index += 1) {
    const [name, inlineValue] = args[index].split("=");
    const value = inlineValue ?? args[index + 1];
    if (name === "--json") options.jsonPath = value;
    else if (name === "--markdown") options.markdownPath = value;
    else if (name === "--min-cloud-routes") options.minCloudRoutes = parsePositiveInteger(value, name);
    else if (name === "--help") {
      console.log("Usage: npm run identify:access -- [--min-cloud-routes 3] [--json path] [--markdown path]");
      process.exit(0);
    } else throw new Error(`Unknown option: ${args[index]}`);
    if (!inlineValue && name !== "--help") index += 1;
  }
  return options;
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function writeText(path, text) {
  const fullPath = join(process.cwd(), path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, text);
}

function loadLocalEnv(filename) {
  const path = join(process.cwd(), filename);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const options = parseArgs(process.argv.slice(2));
  const { evidence, markdown } = await verifyIdentifyProviderAccess({ env: process.env, minCloudRoutes: options.minCloudRoutes });
  writeText(options.jsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
  writeText(options.markdownPath, markdown);
  console.log(markdown);
  console.log(`Wrote ${options.markdownPath}`);
  console.log(`Wrote ${options.jsonPath}`);
  if (!evidence.ok) process.exitCode = 1;
}
