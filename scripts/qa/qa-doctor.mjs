import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  QA_ARTIFACT_DIR,
  bulletList,
  getConfiguredBaseUrl,
  isMainModule,
  loadLocalEnv,
  markdownTable,
  repoRelative,
  writeJsonFile,
  writeTextFile,
} from "./qa-shared.mjs";

const OUTPUT_MD = join(QA_ARTIFACT_DIR, "qa-doctor.md");
const OUTPUT_JSON = join(QA_ARTIFACT_DIR, "qa-doctor.json");
const DOCTOR_SCREENSHOT = join(QA_ARTIFACT_DIR, "screenshots", "qa-doctor-page.png");
const FAILURE_CLASSIFICATIONS = [
  "real product bug",
  "test bug",
  "stale environment",
  "missing env",
  "auth/session issue",
  "browser/VNC/screenshot failure",
  "network/transient issue",
  "unknown",
];

if (isMainModule(import.meta.url)) {
  const result = await runDoctor();
  console.log(`Wrote ${repoRelative(OUTPUT_MD)}`);
  console.log(`Wrote ${repoRelative(OUTPUT_JSON)}`);
  console.log(`QA doctor: ${result.overall} (${result.primaryClassification})`);
  if (result.overall !== "passed") {
    process.exitCode = 1;
  }
}

export async function runDoctor(options = {}) {
  loadLocalEnv(".env.local", ".env");

  const startedAt = new Date().toISOString();
  const checks = [];
  const browserState = {
    browser: null,
    page: null,
    playwright: null,
  };
  const base = getConfiguredBaseUrl();
  const supabase = getSupabaseConfig();

  checks.push(checkResult(
    "local/staging URL is configured",
    base.configured,
    base.configured ? `Using ${base.baseUrl}.` : `DEEPSPEC_QA_BASE_URL, QA_BASE_URL, PLAYWRIGHT_BASE_URL, or VITE_QA_BASE_URL is not set. Falling back to ${base.baseUrl} for reachability only.`,
    "missing env",
  ));

  checks.push(await checkAppServer(base.baseUrl));
  checks.push(checkRequiredEnv(supabase));
  checks.push(await checkDatabaseReachable(supabase));
  checks.push(checkTestAccountConfigured());
  checks.push(await checkAuthSession(supabase));
  checks.push(await checkPlaywrightInstalled(browserState));
  checks.push(await checkBrowserLaunch(browserState));
  checks.push(await checkPageLoad(browserState, base.baseUrl));
  checks.push(await checkScreenshot(browserState));
  checks.push(checkCapturedConsole(browserState));
  checks.push(checkCapturedNetwork(browserState));
  checks.push(await checkSelectors(browserState));

  if (browserState.browser) {
    await browserState.browser.close();
  }

  const result = {
    generatedAt: new Date().toISOString(),
    startedAt,
    baseUrl: base.baseUrl,
    baseUrlConfigured: base.configured,
    requiredFailureClassifications: FAILURE_CLASSIFICATIONS,
    checks,
    overall: checks.some((check) => check.status === "failed") ? "failed" : "passed",
    primaryClassification: getPrimaryClassification(checks),
  };

  if (options.writeReports !== false) {
    writeTextFile(OUTPUT_MD, renderDoctorMarkdown(result));
    writeJsonFile(OUTPUT_JSON, result);
  }

  return result;
}

function getSupabaseConfig() {
  return {
    key: process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || "",
    url: process.env.VITE_SUPABASE_URL?.trim() || "",
  };
}

function checkResult(name, passed, details, classification, extra = {}) {
  return {
    name,
    status: passed ? "passed" : "failed",
    classification: passed ? "none" : classification,
    details,
    ...extra,
  };
}

async function checkAppServer(baseUrl) {
  try {
    const response = await fetchWithTimeout(baseUrl, { method: "GET" }, 30_000);
    return checkResult(
      "app server reachable",
      response.ok,
      response.ok ? `HTTP ${response.status} from ${baseUrl}.` : `HTTP ${response.status} from ${baseUrl}.`,
      response.status >= 500 ? "real product bug" : "stale environment",
    );
  } catch (error) {
    return checkResult(
      "app server reachable",
      false,
      `Could not reach ${baseUrl}: ${formatError(error)}.`,
      "stale environment",
    );
  }
}

function checkRequiredEnv(config) {
  const missing = [];
  if (!config.url) missing.push("VITE_SUPABASE_URL");
  if (!config.key) missing.push("VITE_SUPABASE_PUBLISHABLE_KEY");

  return checkResult(
    "required env vars exist",
    missing.length === 0,
    missing.length ? `Missing ${missing.join(", ")}.` : "Supabase URL and publishable key are configured.",
    "missing env",
    { missing },
  );
}

async function checkDatabaseReachable(config) {
  if (!config.url || !config.key) {
    return checkResult(
      "database reachable",
      false,
      "Skipped because Supabase env vars are missing.",
      "missing env",
    );
  }

  try {
    const response = await fetchWithTimeout(`${config.url.replace(/\/$/, "")}/rest/v1/`, {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
      },
    });

    return checkResult(
      "database reachable",
      response.status < 500,
      `Supabase REST endpoint returned HTTP ${response.status}.`,
      response.status >= 500 ? "stale environment" : "auth/session issue",
    );
  } catch (error) {
    return checkResult(
      "database reachable",
      false,
      `Supabase REST endpoint could not be reached: ${formatError(error)}.`,
      "network/transient issue",
    );
  }
}

function checkTestAccountConfigured() {
  const hasPasswordAccount = Boolean(process.env.DEEPSPEC_AUTH_TEST_EMAIL?.trim() && process.env.DEEPSPEC_AUTH_TEST_PASSWORD?.trim());
  const usesAnonymous = process.env.DEEPSPEC_QA_AUTH_MODE?.trim().toLowerCase() !== "password";

  return checkResult(
    "test account exists or is configured",
    hasPasswordAccount || usesAnonymous,
    hasPasswordAccount
      ? "DEEPSPEC_AUTH_TEST_EMAIL and DEEPSPEC_AUTH_TEST_PASSWORD are configured."
      : usesAnonymous
        ? "Using DeepSpec no-email Supabase auth for QA."
        : "Set DEEPSPEC_AUTH_TEST_EMAIL and DEEPSPEC_AUTH_TEST_PASSWORD, or use the supported no-email QA path.",
    "missing env",
    { authMode: usesAnonymous ? "anonymous" : hasPasswordAccount ? "password" : "missing" },
  );
}

async function checkAuthSession(config) {
  if (!config.url || !config.key) {
    return checkResult(
      "auth/session is valid",
      false,
      "Skipped because Supabase env vars are missing.",
      "missing env",
    );
  }

  const client = createClient(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  const authMode = process.env.DEEPSPEC_QA_AUTH_MODE?.trim().toLowerCase() || "anonymous";
  const email = process.env.DEEPSPEC_AUTH_TEST_EMAIL?.trim();
  const password = process.env.DEEPSPEC_AUTH_TEST_PASSWORD?.trim();

  try {
    const result = authMode === "anonymous"
      ? await client.auth.signInAnonymously()
      : email && password
        ? await client.auth.signInWithPassword({ email, password })
        : { error: new Error("No QA auth mode or test credentials configured."), data: null };

    if (result.error || !result.data?.user || !result.data?.session) {
      return checkResult(
        "auth/session is valid",
        false,
        result.error?.message || "Supabase did not return a user session.",
        result.error?.message?.includes("configured") ? "missing env" : "auth/session issue",
      );
    }

    await client.auth.signOut();
    return checkResult("auth/session is valid", true, `Verified ${authMode === "anonymous" ? "anonymous" : "password"} Supabase session.`, "auth/session issue");
  } catch (error) {
    return checkResult(
      "auth/session is valid",
      false,
      `Auth check failed: ${formatError(error)}.`,
      "auth/session issue",
    );
  }
}

async function checkPlaywrightInstalled(state) {
  try {
    state.playwright = await import("@playwright/test");
    return checkResult("Playwright installed", true, "@playwright/test is importable.", "test bug");
  } catch {
    try {
      state.playwright = await import("playwright");
      return checkResult("Playwright installed", true, "playwright is importable.", "test bug");
    } catch (error) {
      return checkResult(
        "Playwright installed",
        false,
        `Could not import Playwright: ${formatError(error)}.`,
        "test bug",
      );
    }
  }
}

async function checkBrowserLaunch(state) {
  if (!state.playwright) {
    return checkResult(
      "browser can launch",
      false,
      "Skipped because Playwright is not installed.",
      "browser/VNC/screenshot failure",
    );
  }

  try {
    state.browser = await state.playwright.chromium.launch({ headless: true });
    state.page = await state.browser.newPage({ viewport: { width: 390, height: 844 } });
    state.consoleErrors = [];
    state.networkErrors = [];
    state.page.on("console", (message) => {
      if (message.type() === "error") {
        state.consoleErrors.push(message.text());
      }
    });
    state.page.on("requestfailed", (request) => {
      state.networkErrors.push({
        url: request.url(),
        method: request.method(),
        failure: request.failure()?.errorText || "request failed",
      });
    });
    state.page.on("response", (response) => {
      if (response.status() >= 400) {
        state.networkErrors.push({
          url: response.url(),
          status: response.status(),
          statusText: response.statusText(),
        });
      }
    });
    return checkResult("browser can launch", true, "Chromium launched headlessly.", "browser/VNC/screenshot failure");
  } catch (error) {
    return checkResult(
      "browser can launch",
      false,
      `Chromium launch failed: ${formatError(error)}.`,
      "browser/VNC/screenshot failure",
    );
  }
}

async function checkPageLoad(state, baseUrl) {
  if (!state.page) {
    return checkResult(
      "page loads successfully",
      false,
      "Skipped because no browser page is available.",
      "browser/VNC/screenshot failure",
    );
  }

  try {
    const response = await state.page.goto(`${baseUrl}/auth`, {
      waitUntil: "commit",
      timeout: 30_000,
    });
    await waitForAuthSurface(state.page);

    const status = response?.status() || 0;
    return checkResult(
      "page loads successfully",
      Boolean(response) && status < 500,
      response ? `/auth returned HTTP ${status}.` : "No navigation response was returned.",
      status >= 500 ? "real product bug" : "stale environment",
    );
  } catch (error) {
    return checkResult(
      "page loads successfully",
      false,
      `Could not load /auth: ${formatError(error)}.`,
      "stale environment",
    );
  }
}

async function checkScreenshot(state) {
  if (!state.page) {
    return checkResult(
      "screenshot is not blank",
      false,
      "Skipped because no browser page is available.",
      "browser/VNC/screenshot failure",
    );
  }

  try {
    await state.page.screenshot({ path: DOCTOR_SCREENSHOT, fullPage: true });
    const visibleState = await state.page.evaluate(() => ({
      textLength: globalThis.document.body?.innerText?.trim().length || 0,
      visibleElements: [...globalThis.document.body.querySelectorAll("*")].filter((element) => {
        const style = globalThis.window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      }).length,
    }));

    const notBlank = visibleState.textLength > 0 && visibleState.visibleElements > 0;
    return checkResult(
      "screenshot is not blank",
      notBlank,
      notBlank
        ? `Captured ${repoRelative(DOCTOR_SCREENSHOT)} with visible page content.`
        : `Captured ${repoRelative(DOCTOR_SCREENSHOT)}, but the page appears blank.`,
      "browser/VNC/screenshot failure",
      { screenshot: repoRelative(DOCTOR_SCREENSHOT), visibleState },
    );
  } catch (error) {
    return checkResult(
      "screenshot is not blank",
      false,
      `Screenshot check failed: ${formatError(error)}.`,
      "browser/VNC/screenshot failure",
    );
  }
}

function checkCapturedConsole(state) {
  if (!state.page) {
    return checkResult(
      "console errors are captured",
      false,
      "Skipped because no browser page is available.",
      "browser/VNC/screenshot failure",
    );
  }

  const errors = state.consoleErrors || [];
  return checkResult(
    "console errors are captured",
    errors.length === 0,
    errors.length ? `Captured ${errors.length} console error(s): ${errors.slice(0, 3).join(" | ")}` : "Console instrumentation is active and no console errors were captured.",
    "real product bug",
    { errors },
  );
}

function checkCapturedNetwork(state) {
  if (!state.page) {
    return checkResult(
      "network errors are captured",
      false,
      "Skipped because no browser page is available.",
      "browser/VNC/screenshot failure",
    );
  }

  const errors = state.networkErrors || [];
  const actionableErrors = errors.filter((error) => !isBenignNetworkNoise(error));
  const ignoredErrors = errors.filter((error) => isBenignNetworkNoise(error));
  return checkResult(
    "network errors are captured",
    actionableErrors.length === 0,
    actionableErrors.length
      ? `Captured ${actionableErrors.length} failed or HTTP 4xx/5xx request(s).`
      : ignoredErrors.length
        ? `Only ignored Vite dev-server aborted requests were captured (${ignoredErrors.length}).`
        : "Network instrumentation is active and no network errors were captured.",
    "network/transient issue",
    { errors: actionableErrors, ignoredErrors },
  );
}

function isBenignNetworkNoise(error) {
  if (error.failure !== "net::ERR_ABORTED") {
    return false;
  }

  return /\/node_modules\/\.vite\/deps\//.test(error.url ?? "")
    || /https:\/\/fonts\.gstatic\.com\//.test(error.url ?? "");
}

async function checkSelectors(state) {
  if (!state.page) {
    return checkResult(
      "selectors are not stale",
      false,
      "Skipped because no browser page is available.",
      "browser/VNC/screenshot failure",
    );
  }

  try {
    await waitForAuthSurface(state.page);
    const selectorState = await state.page.evaluate(() => {
      const text = globalThis.document.body.innerText;
      return {
        hasEmailInput: Boolean(globalThis.document.querySelector("input[name='email']")),
        hasPrimarySubmit: text.includes("Sign in to scanner") || text.includes("Continue without email"),
        hasNoEmailPath: text.includes("No email"),
      };
    });
    const passed = selectorState.hasEmailInput && selectorState.hasPrimarySubmit && selectorState.hasNoEmailPath;

    return checkResult(
      "selectors are not stale",
      passed,
      passed ? "Auth selectors used by browser QA are present." : `Auth selector check failed: ${JSON.stringify(selectorState)}.`,
      "test bug",
      { selectorState },
    );
  } catch (error) {
    return checkResult(
      "selectors are not stale",
      false,
      `Selector check failed: ${formatError(error)}.`,
      "test bug",
    );
  }
}

async function waitForAuthSurface(page) {
  await page.waitForFunction(() => {
    const text = globalThis.document.body?.innerText ?? "";
    return Boolean(globalThis.document.querySelector("input[name='email']"))
      && text.includes("Sign in")
      && text.includes("No email");
  }, { timeout: 30_000 });
}

function getPrimaryClassification(checks) {
  const failed = checks.filter((check) => check.status === "failed");
  if (!failed.length) {
    return "passed";
  }

  const priority = [
    "missing env",
    "stale environment",
    "auth/session issue",
    "browser/VNC/screenshot failure",
    "network/transient issue",
    "test bug",
    "real product bug",
    "unknown",
  ];

  return priority.find((classification) => failed.some((check) => check.classification === classification)) || "unknown";
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8_000) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function formatError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/[^\t\n\r -~]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function renderDoctorMarkdown(result) {
  const rows = result.checks.map((check) => [
    check.name,
    check.status,
    check.classification,
    check.details,
  ]);
  const failures = result.checks.filter((check) => check.status === "failed");

  return `# QA Doctor

## Summary

- Overall: ${result.overall}
- Primary classification: ${result.primaryClassification}
- Base URL: ${result.baseUrl}${result.baseUrlConfigured ? "" : " (default fallback; not explicitly configured)"}
- Generated: ${result.generatedAt}

## Failure Classifications

${bulletList(FAILURE_CLASSIFICATIONS)}

## Checks

${markdownTable(["Check", "Status", "Classification", "Details"], rows)}

## Blocking Failures

${failures.length ? failures.map((check) => `- ${check.name}: ${check.classification} - ${check.details}`).join("\n") : "- None"}

## Rule

Before any user-impact QA runner claims "bug found," it must include this doctor result and use the doctor classification to separate product bugs from test, auth, browser, network, and stale-environment failures.
`;
}
