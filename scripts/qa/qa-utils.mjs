import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const DEFAULT_QA_BASE_URL = "http://localhost:3000";

export const DEEPSPEC_QA_SCENARIOS = [
  "auth-login",
  "scanner",
  "saved-history",
  "result-detail",
  "result-chat",
  "early-access",
  "api-cloud-health",
];

const originalEnvKeys = new Set(Object.keys(process.env));

export function loadQaEnv() {
  loadEnvFile(".env");
  loadEnvFile(".env.local");
}

export function parseQaArgs(argv) {
  const parsed = {
    headed: false,
    headless: false,
    scenarios: [],
    url: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--url") {
      parsed.url = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--url=")) {
      parsed.url = arg.slice("--url=".length);
      continue;
    }

    if (arg === "--headed") {
      parsed.headed = true;
      parsed.headless = false;
      continue;
    }

    if (arg === "--headless") {
      parsed.headless = true;
      parsed.headed = false;
      continue;
    }

    if (arg === "--scenario") {
      const scenario = argv[index + 1] ?? "";
      if (scenario) parsed.scenarios.push(scenario);
      index += 1;
      continue;
    }

    if (arg.startsWith("--scenario=")) {
      parsed.scenarios.push(arg.slice("--scenario=".length));
      continue;
    }

    if (!arg.startsWith("-")) {
      parsed.scenarios.push(arg);
    }
  }

  return parsed;
}

export function resolveQaBaseUrl(parsedArgs = {}) {
  const rawValue = parsedArgs.url || process.env.QA_BASE_URL || DEFAULT_QA_BASE_URL;

  try {
    const url = new URL(rawValue);
    return url.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_QA_BASE_URL;
  }
}

export function resolveQaArtifactDir() {
  return resolve(process.env.QA_ARTIFACT_DIR || join("artifacts", "qa", createTimestamp()));
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

export function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function writeText(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, value, "utf8");
}

export function sanitizeFilename(value) {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function createTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function loadEnvFile(filename) {
  let contents;

  try {
    contents = readFileSync(resolve(filename), "utf8");
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
    if (!key || originalEnvKeys.has(key)) continue;

    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}
