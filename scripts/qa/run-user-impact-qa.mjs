import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  QA_ARTIFACT_DIR,
  bulletList,
  getConfiguredBaseUrl,
  isMainModule,
  loadLocalEnv,
  markdownTable,
  nowStamp,
  repoRelative,
  slugify,
  writeJsonFile,
  writeTextFile,
} from "./qa-shared.mjs";
import { runDoctor } from "./qa-doctor.mjs";

const OUTPUT_MD = join(QA_ARTIFACT_DIR, "run-report.md");
const OUTPUT_JSON = join(QA_ARTIFACT_DIR, "run-report.json");

const SCENARIOS = {
  pricing: {
    name: "pricing",
    role: "parent",
    envPathKey: "DEEPSPEC_QA_SCENARIO_PRICING_PATH",
    defaultPath: "/quote",
    userImpactQuestion: "If this is wrong, what would a parent see or pay incorrectly?",
    expectedResult: "The quote or pricing page shows a clear total, route/date/rider assumptions, and a checkout handoff that matches the displayed price.",
    expectedText: ["quote", "pricing", "price", "total", "checkout"],
    steps: [
      "Open the configured pricing or quote route.",
      "Capture screenshot, HTML, console errors, and network failures.",
      "Check that quote, price, total, or checkout language is visible.",
    ],
  },
  "parent-tracking": {
    name: "parent-tracking",
    role: "parent",
    envPathKey: "DEEPSPEC_QA_SCENARIO_PARENT_TRACKING_PATH",
    defaultPath: "/tracking",
    userImpactQuestion: "If this is wrong, what would a parent see about their rider, route, ETA, or driver?",
    expectedResult: "The parent tracking view shows route status, ETA or location state, and clear stale/offline handling.",
    expectedText: ["tracking", "route", "eta", "driver", "location", "status"],
    steps: [
      "Open the configured parent tracking route.",
      "Capture screenshot, HTML, console errors, and network failures.",
      "Check that tracking, route, ETA, driver, location, or status language is visible.",
    ],
  },
  "driver-route": {
    name: "driver-route",
    role: "driver",
    envPathKey: "DEEPSPEC_QA_SCENARIO_DRIVER_ROUTE_PATH",
    defaultPath: "/driver/route",
    userImpactQuestion: "If this is wrong, what route or handoff problem would a driver experience?",
    expectedResult: "The driver route view shows the assigned route, stop/status state, and enough handoff detail for the driver to act safely.",
    expectedText: ["driver", "route", "handoff", "stop", "status"],
    steps: [
      "Open the configured driver route.",
      "Capture screenshot, HTML, console errors, and network failures.",
      "Check that driver, route, handoff, stop, or status language is visible.",
    ],
  },
};

if (isMainModule(import.meta.url)) {
  await main();
}

export async function main(argv = process.argv.slice(2)) {
  loadLocalEnv(".env.local", ".env");

  const options = parseArgs(argv);
  const selected = getSelectedScenarios(options.scenario);
  const runId = nowStamp();
  const base = getConfiguredBaseUrl();
  const doctor = await runDoctor({ writeReports: true });
  const reports = [];

  if (doctor.overall !== "passed") {
    for (const scenario of selected) {
      reports.push(blockedScenarioReport(runId, scenario, doctor));
    }
  } else {
    const playwright = await importPlaywright();
    const browser = await playwright.chromium.launch({ headless: true });
    try {
      for (const scenario of selected) {
        reports.push(await runScenario(browser, base.baseUrl, runId, scenario, doctor));
      }
    } finally {
      await browser.close();
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    runId,
    baseUrl: base.baseUrl,
    baseUrlConfigured: base.configured,
    selectedScenarios: selected.map((scenario) => scenario.name),
    qaDoctor: summarizeDoctor(doctor),
    scenarios: reports,
  };

  writeTextFile(OUTPUT_MD, renderRunMarkdown(payload));
  writeJsonFile(OUTPUT_JSON, payload);
  console.log(`Wrote ${repoRelative(OUTPUT_MD)}`);
  console.log(`Wrote ${repoRelative(OUTPUT_JSON)}`);
}

function parseArgs(argv) {
  const options = {
    scenario: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--scenario") {
      options.scenario = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--scenario=")) {
      options.scenario = arg.slice("--scenario=".length);
    }
  }

  return options;
}

function getSelectedScenarios(name) {
  if (!name) {
    return Object.values(SCENARIOS);
  }

  const scenario = SCENARIOS[name];
  if (!scenario) {
    throw new Error(`Unknown scenario '${name}'. Available scenarios: ${Object.keys(SCENARIOS).join(", ")}.`);
  }

  return [scenario];
}

async function importPlaywright() {
  try {
    return await import("@playwright/test");
  } catch {
    return import("playwright");
  }
}

function blockedScenarioReport(runId, scenario, doctor) {
  return {
    scenarioName: scenario.name,
    userRole: scenario.role,
    userImpactQuestion: scenario.userImpactQuestion,
    stepsExecuted: [],
    expectedResult: scenario.expectedResult,
    actualResult: `Blocked by QA doctor: ${doctor.primaryClassification}.`,
    screenshotPaths: [],
    consoleErrors: [],
    networkErrors: [],
    qaDoctorResult: summarizeDoctor(doctor),
    finalClassification: mapDoctorToFinalClassification(doctor.primaryClassification),
    artifacts: {},
    runId,
  };
}

async function runScenario(browser, baseUrl, runId, scenario, doctor) {
  const artifactBase = `${runId}-${slugify(scenario.name)}`;
  const screenshotPath = join(QA_ARTIFACT_DIR, "screenshots", `${artifactBase}.png`);
  const htmlPath = join(QA_ARTIFACT_DIR, "html", `${artifactBase}.html`);
  const consolePath = join(QA_ARTIFACT_DIR, "console", `${artifactBase}.json`);
  const networkPath = join(QA_ARTIFACT_DIR, "network", `${artifactBase}.json`);
  const logPath = join(QA_ARTIFACT_DIR, "logs", `${artifactBase}.json`);
  const consoleErrors = [];
  const networkErrors = [];
  const stepsExecuted = [];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("requestfailed", (request) => {
    networkErrors.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || "request failed",
    });
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      networkErrors.push({
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
      });
    }
  });

  try {
    await signInIfConfigured(page, baseUrl, stepsExecuted);
    const path = process.env[scenario.envPathKey]?.trim() || scenario.defaultPath;
    const targetUrl = new URL(path, baseUrl).toString();
    stepsExecuted.push(`Open ${targetUrl}.`);
    const response = await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
    stepsExecuted.push("Capture screenshot, page HTML, console errors, and network errors.");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    writeTextFile(htmlPath, await page.content());

    const pageState = await page.evaluate((expectedText) => {
      const bodyText = globalThis.document.body.innerText.toLowerCase();
      return {
        url: globalThis.window.location.href,
        title: globalThis.document.title,
        matchedText: expectedText.filter((value) => bodyText.includes(value)),
        bodyTextSample: globalThis.document.body.innerText.trim().slice(0, 500),
      };
    }, scenario.expectedText);
    const configuredPath = Boolean(process.env[scenario.envPathKey]?.trim());
    const finalClassification = classifyScenarioResult({
      configuredPath,
      pageState,
      responseStatus: response?.status() || 0,
      scenario,
      consoleErrors,
      networkErrors,
    });

    writeJsonFile(consolePath, consoleErrors);
    writeJsonFile(networkPath, networkErrors);
    writeJsonFile(logPath, { stepsExecuted, pageState, responseStatus: response?.status() || 0 });

    return {
      scenarioName: scenario.name,
      userRole: scenario.role,
      userImpactQuestion: scenario.userImpactQuestion,
      stepsExecuted,
      expectedResult: scenario.expectedResult,
      actualResult: summarizeActualResult(finalClassification, pageState, response?.status() || 0),
      screenshotPaths: [repoRelative(screenshotPath)],
      consoleErrors,
      networkErrors,
      qaDoctorResult: summarizeDoctor(doctor),
      finalClassification,
      artifacts: {
        screenshot: repoRelative(screenshotPath),
        html: repoRelative(htmlPath),
        console: repoRelative(consolePath),
        network: repoRelative(networkPath),
        log: repoRelative(logPath),
      },
      runId,
    };
  } catch (error) {
    writeJsonFile(consolePath, consoleErrors);
    writeJsonFile(networkPath, networkErrors);
    writeJsonFile(logPath, { stepsExecuted, error: formatError(error) });

    return {
      scenarioName: scenario.name,
      userRole: scenario.role,
      userImpactQuestion: scenario.userImpactQuestion,
      stepsExecuted,
      expectedResult: scenario.expectedResult,
      actualResult: `Scenario could not complete: ${formatError(error)}.`,
      screenshotPaths: [],
      consoleErrors,
      networkErrors,
      qaDoctorResult: summarizeDoctor(doctor),
      finalClassification: "inconclusive",
      artifacts: {
        console: repoRelative(consolePath),
        network: repoRelative(networkPath),
        log: repoRelative(logPath),
      },
      runId,
    };
  } finally {
    await context.close();
  }
}

async function signInIfConfigured(page, baseUrl, stepsExecuted) {
  const authMode = process.env.DEEPSPEC_QA_AUTH_MODE?.trim().toLowerCase();
  const email = process.env.DEEPSPEC_AUTH_TEST_EMAIL?.trim();
  const password = process.env.DEEPSPEC_AUTH_TEST_PASSWORD?.trim();
  if (authMode !== "anonymous" && (!email || !password)) {
    return;
  }

  stepsExecuted.push("Open /auth for QA session setup.");
  await page.goto(`${baseUrl}/auth`, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);

  if (authMode === "anonymous") {
    stepsExecuted.push("Start the no-email QA session.");
    await page.getByRole("button", { name: /no email/i }).click({ timeout: 8_000 });
    await page.getByRole("button", { name: /continue without email/i }).click({ timeout: 8_000 });
  } else {
    stepsExecuted.push("Sign in with the configured QA password account.");
    await page.getByLabel(/email address/i).fill(email);
    await page.getByLabel(/^password$/i).fill(password);
    await page.getByRole("button", { name: /sign in to scanner/i }).click();
  }

  await page.waitForURL(/\/scan(?:\?|$)/, { timeout: 15_000 }).catch(() => undefined);
}

function classifyScenarioResult({ configuredPath, pageState, responseStatus, scenario, consoleErrors, networkErrors }) {
  const landedPath = new URL(pageState.url).pathname;
  if (!configuredPath && landedPath !== scenario.defaultPath) {
    return "test issue";
  }

  if (responseStatus >= 500) {
    return "real product bug";
  }

  if (consoleErrors.length || networkErrors.some((error) => error.status >= 500)) {
    return "real product bug";
  }

  if (networkErrors.length) {
    return "environment issue";
  }

  if (pageState.matchedText.length > 0) {
    return "passed";
  }

  return configuredPath ? "real product bug" : "inconclusive";
}

function summarizeActualResult(classification, pageState, responseStatus) {
  if (classification === "passed") {
    return `Loaded HTTP ${responseStatus}; matched expected text: ${pageState.matchedText.join(", ")}.`;
  }

  if (classification === "test issue") {
    return `The default scenario path did not match this app. Landed at ${new URL(pageState.url).pathname}; configure the scenario route env var if this product has that flow.`;
  }

  if (classification === "real product bug") {
    return `Loaded HTTP ${responseStatus}, but the configured user-impact scenario did not show the expected state or emitted browser errors.`;
  }

  return `Loaded HTTP ${responseStatus}; expected scenario text was not found. Page sample: ${pageState.bodyTextSample}`;
}

function mapDoctorToFinalClassification(classification) {
  if (classification === "passed") return "passed";
  if (classification === "real product bug") return "real product bug";
  if (classification === "test bug") return "test issue";
  if (classification === "unknown") return "inconclusive";
  return "environment issue";
}

function summarizeDoctor(doctor) {
  return {
    overall: doctor.overall,
    primaryClassification: doctor.primaryClassification,
    failedChecks: doctor.checks.filter((check) => check.status === "failed").map((check) => ({
      name: check.name,
      classification: check.classification,
      details: check.details,
    })),
  };
}

function renderRunMarkdown(payload) {
  const rows = payload.scenarios.map((scenario) => [
    scenario.scenarioName,
    scenario.userRole,
    scenario.finalClassification,
    scenario.actualResult,
  ]);

  return `# User Impact QA Run Report

## Summary

- Run ID: ${payload.runId}
- Base URL: ${payload.baseUrl}${payload.baseUrlConfigured ? "" : " (default fallback; not explicitly configured)"}
- QA doctor: ${payload.qaDoctor.overall} (${payload.qaDoctor.primaryClassification})
- Scenarios: ${payload.selectedScenarios.join(", ")}

## Scenario Matrix

${markdownTable(["Scenario", "Role", "Final Classification", "Actual Result"], rows)}

## QA Doctor Result

${payload.qaDoctor.failedChecks.length ? payload.qaDoctor.failedChecks.map((check) => `- ${check.name}: ${check.classification} - ${check.details}`).join("\n") : "- Passed"}

## Scenario Details

${payload.scenarios.map(renderScenarioMarkdown).join("\n\n")}
`;
}

function renderScenarioMarkdown(scenario) {
  return `### ${scenario.scenarioName}

- Scenario name: ${scenario.scenarioName}
- User role: ${scenario.userRole}
- User-impact question: ${scenario.userImpactQuestion}
- Steps executed:
${bulletList(scenario.stepsExecuted)}
- Expected result: ${scenario.expectedResult}
- Actual result: ${scenario.actualResult}
- Screenshot paths:
${bulletList(scenario.screenshotPaths)}
- Console errors:
${bulletList(scenario.consoleErrors)}
- Network errors:
${bulletList(scenario.networkErrors.map((error) => JSON.stringify(error)))}
- QA doctor result: ${scenario.qaDoctorResult.overall} (${scenario.qaDoctorResult.primaryClassification})
- Final classification: ${scenario.finalClassification}
- Artifacts: ${Object.values(scenario.artifacts).length ? Object.values(scenario.artifacts).join(", ") : "none"}`;
}

function formatError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/[^\t\n\r -~]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function readRunReportJson() {
  return JSON.parse(readFileSync(OUTPUT_JSON, "utf8"));
}
