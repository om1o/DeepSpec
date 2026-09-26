import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEEPSPEC_QA_SCENARIOS,
  classifyIdentifyApiIssue,
  classifyQaTransportError,
  getAuthDependencyBlocker,
  ensureDir,
  fetchWithTimeout,
  formatError,
  loadQaEnv,
  parseQaArgs,
  resolveQaArtifactDir,
  resolveQaBaseUrl,
  sanitizeFilename,
  writeJson,
  writeText,
} from "./qa-utils.mjs";

class QaIssue extends Error {
  constructor(category, message, options = {}) {
    super(message);
    this.name = "QaIssue";
    this.category = category;
    this.status = options.status ?? (["environment", "missing_env"].includes(category) ? "blocked" : "fail");
    this.likelyFiles = options.likelyFiles ?? [];
    this.suggestedFix = options.suggestedFix ?? "";
  }
}

loadQaEnv();

const parsedArgs = parseQaArgs(process.argv.slice(2));
const baseUrl = resolveQaBaseUrl(parsedArgs);
const artifactDir = resolveQaArtifactDir();
const screenshotDir = join(artifactDir, "screenshots");
const htmlDir = join(artifactDir, "html");
const videoDir = join(artifactDir, "videos");
const tracePath = join(artifactDir, "trace.zip");
const scenarioOrder = getScenarioOrder(parsedArgs.scenarios);
const viewportProfile = resolveViewportProfile(parsedArgs);
const startedAt = new Date().toISOString();
const results = [];
const consoleLogs = [];
const networkLogs = [];
const pageErrors = [];
const hasSupabaseConfig = Boolean(process.env.VITE_SUPABASE_URL?.trim() && process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim());
const QA_SHOP_ORG_ID = "00000000-0000-4000-8000-000000000001";
const QA_SHOP_JOB_ID = "11111111-1111-4111-8111-111111111111";

let browser;
let context;
let page;
let authAttempted = false;
let authEstablished = false;
let authFailure = null;

const scenarioHandlers = {
  "api-cloud-health": runApiCloudHealth,
  "auth-login": runAuthLogin,
  "early-access": runEarlyAccess,
  "result-chat": runResultChat,
  "result-detail": runResultDetail,
  "inspection-save-recovery": runInspectionSaveRecovery,
  "account-entitlements": runAccountEntitlements,
  "add-vin-after-result": runAddVinAfterResult,
  "billing-provider-fail-closed": runBillingProviderFailClosed,
  checkout: runCheckout,
  "create-job": runCreateJob,
  "customer-report-export": runCustomerReportExport,
  "job-result-correction": runJobResultCorrection,
  "job-scan": runJobScan,
  "org-member-permissions": runOrgMemberPermissions,
  pricing: runPricing,
  "second-angle-refinement": runSecondAngleRefinement,
  "scanner-ai-engine": runScannerAiEngine,
  "scanner-quality-retake": runScannerQualityRetake,
  "shared-device-account-switch": runSharedDeviceAccountSwitch,
  "device-storage-capacity": runDeviceStorageCapacity,
  "cloud-save-receipt": runCloudSaveReceipt,
  "auth-restore-no-upload": runAuthRestoreNoUpload,
  "saved-history": runSavedHistory,
  scanner: runScanner,
  "shop-history-search": runShopHistorySearch,
  "shop-onboarding": runShopOnboarding,
};

ensureDir(screenshotDir);
ensureDir(htmlDir);
ensureDir(videoDir);

try {
  const { chromium } = await import("playwright");
  const headless = parsedArgs.headless || !parsedArgs.headed;

  browser = await chromium.launch({ headless });
  context = await browser.newContext({
    recordVideo: {
      dir: videoDir,
      size: viewportProfile.viewport,
    },
    isMobile: viewportProfile.isMobile,
    hasTouch: viewportProfile.hasTouch,
    viewport: viewportProfile.viewport,
  });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  page = await context.newPage();
  attachLoggers(page);

  const reachability = await checkBaseUrlReachability();
  if (!reachability.ok) {
    addEnvironmentBlockedResults(reachability);
  } else {
    for (const scenario of scenarioOrder) {
      await runScenario(scenario);
    }
  }
} catch (error) {
  results.push({
    category: "environment",
    details: `Real website tester could not start: ${formatError(error)}`,
    evidence: {},
    likelyFiles: ["package.json", "scripts/qa/real-website-tester.mjs"],
    name: "qa-runner-startup",
    status: "fail",
    suggestedFix: "Install Playwright browsers with `npx playwright install chromium` and make sure a headed browser can open on this machine.",
  });
} finally {
  if (context) {
    try {
      await context.tracing.stop({ path: tracePath });
    } catch (error) {
      pageErrors.push({ message: `Could not save Playwright trace: ${formatError(error)}` });
    }
  }

  if (page) {
    try {
      await page.close();
    } catch {
      // Page may already be closed after a fatal browser failure.
    }
  }

  if (context) {
    try {
      await context.close();
    } catch {
      // Context may already be closed after a fatal browser failure.
    }
  }

  if (browser) {
    try {
      await browser.close();
    } catch {
      // Browser may already be closed after a fatal launch failure.
    }
  }

  await writeRunReports();
}

async function checkBaseUrlReachability() {
  try {
    const response = await fetchWithTimeout(baseUrl, { method: "GET" }, 30_000);
    if (response.status >= 500) {
      return {
        details: `GET ${baseUrl} returned HTTP ${response.status}.`,
        ok: false,
        type: "backend",
      };
    }

    return {
      details: `GET ${baseUrl} returned HTTP ${response.status}.`,
      ok: true,
      type: "environment",
    };
  } catch (error) {
    return {
      details: `The app is not reachable at ${baseUrl}: ${formatError(error)}.`,
      ok: false,
      type: "environment",
    };
  }
}

function addEnvironmentBlockedResults(reachability) {
  const category = reachability.type === "backend" ? "backend" : "environment";
  const suggestedFix = category === "backend"
    ? "Fix the server error at the configured QA_BASE_URL, then rerun `npm run qa:doctor` before calling any scenario a product bug."
    : "Start DeepSpec at the configured QA_BASE_URL or set QA_BASE_URL to the running app URL, then rerun `npm run qa:doctor` before product triage.";

  results.push({
    category,
    details: reachability.details,
    evidence: {},
    likelyFiles: category === "backend" ? ["vite.config.ts", "api/identify.shared.ts", "api/chat.shared.ts"] : [],
    name: "environment-preflight",
    status: "fail",
    suggestedFix,
    finishedAt: new Date().toISOString(),
    startedAt,
  });

  for (const scenario of scenarioOrder) {
    results.push({
      category,
      details: `${scenario} was not run because the app server is not reachable. ${reachability.details}`,
      evidence: {},
      likelyFiles: [],
      name: scenario,
      status: "blocked",
      suggestedFix,
      finishedAt: new Date().toISOString(),
      startedAt,
    });
  }
}

async function runScenario(scenario) {
  const started = new Date().toISOString();
  let result;

  try {
    const handler = scenarioHandlers[scenario];
    if (!handler) {
      throw new QaIssue(
        "test_bug",
        `Unknown DeepSpec QA scenario: ${scenario}`,
        {
          likelyFiles: ["scripts/qa/real-website-tester.mjs", "AGENTS.md"],
          suggestedFix: "Use one of the DeepSpec scenario names in AGENTS.md.",
        },
      );
    }

    const handlerResult = await handler();
    result = {
      category: handlerResult.category ?? "frontend",
      details: handlerResult.details ?? "Scenario completed.",
      likelyFiles: handlerResult.likelyFiles ?? [],
      name: scenario,
      status: handlerResult.status ?? "pass",
      suggestedFix: handlerResult.suggestedFix ?? "",
    };
  } catch (error) {
    if (error instanceof QaIssue) {
      result = {
        category: error.category,
        details: error.message,
        likelyFiles: error.likelyFiles,
        name: scenario,
        status: error.status,
        suggestedFix: error.suggestedFix,
      };
    } else {
      result = classifyQaTransportError(error) ? {
        ...classifyQaTransportError(error), name: scenario,
      } : {
        category: "frontend",
        details: formatError(error),
        likelyFiles: likelyFilesForScenario(scenario),
        name: scenario,
        status: "fail",
        suggestedFix: "Reproduce the route manually with the saved trace and screenshot, then fix the first visible UI or runtime error.",
      };
    }
  } finally {
    if (scenario === "auth-login" && result?.status !== "pass") authFailure = result;
    const evidence = await captureEvidence(scenario);
    results.push({
      ...result,
      evidence,
      finishedAt: new Date().toISOString(),
      startedAt: started,
    });
  }
}

async function runAuthLogin() {
  authAttempted = true;
  await gotoPath("/auth");
  await expectText(/Sign in/i, "auth heading", "frontend", ["src/screens/Auth.tsx"]);
  await expectVisible('input[name="email"]', "email input", "frontend", ["src/screens/Auth.tsx"]);

  if (!hasSupabaseConfig) {
    throw new QaIssue(
      "missing_env",
      "Supabase auth config is missing, so DeepSpec cannot prove login.",
      {
        likelyFiles: [".env.local", ".env.example", "src/services/auth.ts"],
        suggestedFix: "Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, then rerun `npm run test:website`.",
      },
    );
  }

  await selectTabIfNeeded(/Account/i, "account auth tab");
  await clickByRole("button", /^No email$/i, "no-email auth mode");
  await clickByRole("button", /Continue without email/i, "continue without email");

  try {
    await page.waitForURL((url) => url.pathname === "/scan", { timeout: 20_000 });
  } catch {
    const alertText = await getOptionalTextByRole("alert");
    const bodyText = await getBodyText();
    const failureText = alertText || bodyText.slice(0, 500);

    throw new QaIssue(
      /not configured|missing/i.test(failureText) ? "missing_env" : "auth/session",
      `No-email Supabase auth did not reach /scan. Visible failure: ${failureText}`,
      {
        likelyFiles: ["src/screens/Auth.tsx", "src/services/auth.ts", "scripts/verify-auth-flows.mjs", "supabase/migrations"],
        suggestedFix: "Run `npm run verify:auth` and inspect Supabase Auth logs for anonymous sign-in failures before changing frontend code.",
      },
    );
  }

  authEstablished = true;
  await seedSavedScans();

  return {
    category: "auth/session",
    details: "DeepSpec no-email Supabase auth reached the protected scanner.",
    likelyFiles: ["src/screens/Auth.tsx", "src/services/auth.ts"],
    status: "pass",
  };
}

async function runSharedDeviceAccountSwitch() {
  await requireAuthForProtectedRoute("shared-device-account-switch");
  await seedSavedScans();
  const readUserId = () => page.evaluate(() => {
    const key = Object.keys(localStorage).find((entry) => /^sb-.+-auth-token$/.test(entry));
    return key ? JSON.parse(localStorage.getItem(key)).user?.id : null;
  });
  const firstUser = await readUserId();
  const firstPrefix = await qaStoragePrefix();
  await gotoPath("/history");
  await page.getByRole("link", { name: /QA Alternator/ }).waitFor({ state: "visible" });
  await page.reload();
  await page.getByRole("link", { name: /QA Alternator/ }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/auth");
  authEstablished = false;
  await selectTabIfNeeded(/Account/i, "account auth tab");
  await clickByRole("button", /^No email$/i, "no-email auth mode");
  await clickByRole("button", /Continue without email/i, "continue without email");
  await page.waitForURL((url) => ["/scan", "/history"].includes(url.pathname), { timeout: 20_000 });
  const secondUser = await readUserId();
  if (!firstUser || !secondUser || firstUser === secondUser) throw new QaIssue("auth/session", "Could not establish distinct QA accounts for shared-device isolation.");
  authEstablished = true;
  await gotoPath("/history");
  await page.getByRole("heading", { name: "Saved scans", exact: true }).waitFor({ state: "visible" });
  if (await page.getByRole("link", { name: /QA Alternator/ }).count()) {
    throw new QaIssue("auth/session", "A second QA account can see the first account's device-saved scan after signing out and back in on the same browser profile.", { likelyFiles: ["src/services/auth.ts", "src/services/storage.ts", "src/App.tsx"], suggestedFix: "Scope private device records to the verified account while preserving existing data; verify account switching and in-flight work." });
  }
  const firstRecordsRetained = await page.evaluate((prefix) => JSON.parse(localStorage.getItem(prefix + "deep-spec:lookups") ?? "[]").some((lookup) => lookup.id === "qa-alternator-1"), firstPrefix);
  if (!firstRecordsRetained) throw new QaIssue("frontend", "Account switching removed the first account's saved QA evidence.");
  return { status: "pass", details: "Two distinct QA accounts used one browser profile; reload retained the first account's history, switching hid it from the second account, and the original stored record remained intact." };
}

async function runScanner() {
  await requireAuthForProtectedRoute("scanner");
  const startedAtMs = Date.now();
  await gotoPath("/scan");
  await waitForAny([
    page.getByRole("button", { name: /Scan now/i }),
    getUploadPhotoButton(),
  ], "scanner controls");
  const controlsReadyMs = Date.now() - startedAtMs;

  if (controlsReadyMs > 5_000) {
    throw new QaIssue(
      "frontend",
      `Scanner controls took ${controlsReadyMs}ms to become usable; expected <= 5000ms.`,
      {
        likelyFiles: ["src/screens/Scanner.tsx", "src/components/scanner/IdentifyButton.tsx"],
        suggestedFix: "Profile scanner route startup, camera fallback state, and heavy client modules before adding scanner UI scope.",
      },
    );
  }

  return {
    details: `Scanner route rendered scan/upload controls in ${controlsReadyMs}ms.`,
    likelyFiles: ["src/screens/Scanner.tsx", "src/components/scanner/IdentifyButton.tsx"],
    status: "pass",
  };
}

async function runDeviceStorageCapacity() {
  await requireAuthForProtectedRoute("device-storage-capacity");
  const prefix = await qaStoragePrefix();
  const base = createSeedLookups()[0];
  const records = Array.from({ length: 50 }, (_, index) => ({
    ...base, id: "qa-capacity-" + index, notes: "Retain generated intake notes " + index,
    result: { ...base.result, partName: "QA Capacity " + index },
  }));
  await page.evaluate(({ prefix, records }) => localStorage.setItem(prefix + "deep-spec:lookups", JSON.stringify(records)), { prefix, records });
  const readRecords = () => page.evaluate((prefix) => JSON.parse(localStorage.getItem(prefix + "deep-spec:lookups") ?? "[]"), prefix);
  const dataUrl = await page.evaluate(() => {
    const canvas = globalThis.document.createElement("canvas"); canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "black"; ctx.fillRect(0, 0, 320, 240);
    return canvas.toDataURL("image/png");
  });
  const fixture = { name: "capacity-check.png", mimeType: "image/png", buffer: Buffer.from(dataUrl.split(",")[1], "base64") };
  let identifyRequests = 0;
  let observingRemoval = false;
  let cloudDeletes = 0;
  const onRequest = (request) => {
    if (new URL(request.url()).pathname === "/api/identify") identifyRequests += 1;
    if (observingRemoval && request.method() === "DELETE") cloudDeletes += 1;
  };
  page.on("request", onRequest);
  try {
    await gotoPath("/scan");
    await page.getByLabel("Upload photo", { exact: true }).setInputFiles(fixture);
    await page.getByText(/Device limit reached/).waitFor({ state: "visible" });
    if (JSON.stringify(await readRecords()) !== JSON.stringify(records) || identifyRequests) throw new QaIssue("frontend", "Full-device upload changed prior records or called identification.");
    await gotoPath("/history");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export JSON", exact: true }).click();
    const exportPath = join(artifactDir, "capacity-export.json");
    await (await downloadPromise).saveAs(exportPath);
    const exported = JSON.parse(readFileSync(exportPath, "utf8"));
    if (exported.length !== 50 || exported.find((row) => row.id === "qa-capacity-0")?.notes !== records[0].notes || !exported[0].chatHistory.length) throw new QaIssue("frontend", "Capacity export lost generated records, notes or chat.");
    const remove = page.getByRole("button", { name: "Remove QA Capacity 0 from this device", exact: true });
    observingRemoval = true;
    page.once("dialog", (dialog) => dialog.dismiss());
    await remove.click();
    if ((await readRecords()).length !== 50) throw new QaIssue("frontend", "Canceled removal changed device records.");
    page.once("dialog", (dialog) => dialog.accept());
    await remove.click();
    await page.waitForFunction((prefix) => JSON.parse(localStorage.getItem(prefix + "deep-spec:lookups") ?? "[]").length === 49, prefix);
    observingRemoval = false;
    if (cloudDeletes) throw new QaIssue("backend", "Removing a device record issued a cloud deletion.");
    await gotoPath("/scan");
    await page.getByLabel("Upload photo", { exact: true }).setInputFiles(fixture);
    await page.getByRole("button", { name: "Upload one retake", exact: true }).waitFor({ state: "visible" });
    const after = await readRecords();
    if (after.length !== 50 || after.some((row) => row.id === "qa-capacity-0") || !after.some((row) => row.id === "qa-capacity-49") || !after.some((row) => row.errorCode === "quality_rejected") || identifyRequests) throw new QaIssue("frontend", "Freeing device space did not allow a new saved photo while retaining earlier evidence.");
    return { status: "pass", details: "50 generated records preserved at capacity; identification blocked; downloaded export retained notes/chat; cancellation retained data; explicit device removal issued no cloud DELETE; a new rejected photo saved after freeing space." };
  } finally {
    page.off("request", onRequest);
  }
}

async function runAuthRestoreNoUpload() {
  await requireAuthForProtectedRoute("auth-restore-no-upload");
  const prefix = await qaStoragePrefix();
  const records = createSeedLookups();
  const stored = JSON.stringify(records);
  await page.evaluate(({ prefix, stored }) => localStorage.setItem(prefix + "deep-spec:lookups", stored), { prefix, stored });
  let writes = 0;
  const cloudPaths = /\/(?:storage\/v1\/object\/scan-images\/|rest\/v1\/(?:scan_lookups|scan_candidates|scan_evidence|scan_corrections|scan_model_runs|sync_events)(?:\?|$))/;
  const preventReplay = async (route) => {
    if (["POST", "PATCH", "DELETE", "PUT"].includes(route.request().method())) { writes += 1; await route.abort("failed"); }
    else await route.continue();
  };
  await page.route(cloudPaths, preventReplay);
  try {
    await gotoPath("/auth");
    await page.waitForURL(/\/scan(?:\?|$)/);
    const retained = await page.evaluate((prefix) => localStorage.getItem(prefix + "deep-spec:lookups"), prefix);
    if (retained !== stored || writes) throw new QaIssue("frontend", "Restoring a verified session replayed or rewrote older device records.", { likelyFiles: ["src/screens/Auth.tsx"] });
    return { status: "pass", details: "Restored a verified QA session with generated device records, reached the scanner, retained exact device bytes and observed no automatic cloud record/image writes. Cloud write interception prevented unintended replay during this check." };
  } finally {
    await page.unroute(cloudPaths, preventReplay);
  }
}

async function runCloudSaveReceipt() {
  await requireAuthForProtectedRoute("cloud-save-receipt");
  const prefix = await qaStoragePrefix();
  const originalIds = await page.evaluate((prefix) => JSON.parse(localStorage.getItem(prefix + "deep-spec:lookups") ?? "[]").map((row) => row.id), prefix);
  const failUpload = async (route) => route.request().method() === "POST" ? route.abort("failed") : route.continue();
  await page.route("**/storage/v1/object/scan-images/**", failUpload);
  try {
    await gotoPath("/scan");
    const dataUrl = await page.evaluate(() => {
      const canvas = globalThis.document.createElement("canvas"); canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "black"; ctx.fillRect(0, 0, 320, 240);
      return canvas.toDataURL("image/png");
    });
    await page.getByLabel("Upload photo", { exact: true }).setInputFiles({ name: "receipt-test.png", mimeType: "image/png", buffer: Buffer.from(dataUrl.split(",")[1], "base64") });
    await page.waitForFunction(({ prefix, originalIds }) => JSON.parse(localStorage.getItem(prefix + "deep-spec:lookups") ?? "[]").some((row) => !originalIds.includes(row.id) && row.cloudSave?.status === "failed"), { prefix, originalIds }, { timeout: 30_000 });
    await gotoPath("/history");
    await page.getByText("Device copy · Cloud save failed or timed out; retry required", { exact: true }).first().waitFor({ state: "visible" });
    await page.reload();
    await page.getByText("Device copy · Cloud save failed or timed out; retry required", { exact: true }).first().waitFor({ state: "visible" });
    await page.screenshot({ path: join(screenshotDir, "cloud-save-failure-reloaded.png"), fullPage: true });
    await page.unroute("**/storage/v1/object/scan-images/**", failUpload);
    const savedId = await page.evaluate(({ prefix, originalIds }) => JSON.parse(localStorage.getItem(prefix + "deep-spec:lookups") ?? "[]").find((row) => !originalIds.includes(row.id) && row.cloudSave?.status === "failed")?.id, { prefix, originalIds });
    const card = page.locator(`a[href="/result/${savedId}"]`).locator("..");
    await card.getByRole("button", { name: /^Save .+ to cloud$/ }).click();
    await card.getByText("Last cloud save acknowledged", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    await page.reload();
    await page.locator(`a[href="/result/${savedId}"]`).locator("..").getByText("Last cloud save acknowledged", { exact: true }).waitFor({ state: "visible" });
    return { status: "pass", details: "Generated rejected photo retained after deliberately blocked upload; failed receipt survived reload. Restored network, explicitly retried from Saved scans, observed live acknowledgement without navigating, then reloaded and retained acknowledgement. Controlled initial fault, followed by real cloud save." };
  } finally {
    await page.unroute("**/storage/v1/object/scan-images/**", failUpload);
  }
}

async function runScannerQualityRetake() {
  await requireAuthForProtectedRoute("scanner-quality-retake");
  await gotoPath("/scan");
  const dataUrl = await page.evaluate(() => {
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  });
  const fixture = { name: "covered-lens.png", mimeType: "image/png", buffer: Buffer.from(dataUrl.split(",")[1], "base64") };
  const prefix = await qaStoragePrefix();
  const originalIds = await page.evaluate((prefix) => JSON.parse(localStorage.getItem(prefix + "deep-spec:lookups") ?? "[]").map((scan) => scan.id), prefix);
  let identifyRequests = 0;
  const onRequest = (request) => { if (new URL(request.url()).pathname === "/api/identify") identifyRequests += 1; };
  page.on("request", onRequest);
  try {
    await page.getByLabel("Upload photo", { exact: true }).setInputFiles(fixture);
    const retake = page.getByRole("button", { name: "Upload one retake", exact: true });
    await retake.waitFor({ state: "visible" });
    await retake.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(screenshotDir, "quality-first-capture.png"), fullPage: true });
    const chooserPromise = page.waitForEvent("filechooser");
    await retake.click();
    await (await chooserPromise).setFiles(fixture);
    await page.getByText("Guided retake used. Review the evidence or start a separate scan when ready.", { exact: true }).waitFor({ state: "visible" });
    const saved = await page.evaluate(({ ids, prefix }) => JSON.parse(localStorage.getItem(prefix + "deep-spec:lookups") ?? "[]").filter((scan) => !ids.includes(scan.id)), { ids: originalIds, prefix });
    if (saved.length !== 2 || saved.some((scan) => scan.errorCode !== "quality_rejected" || scan.scanQuality?.accepted !== false || !scan.frame.imageBase64) || identifyRequests !== 0 || await retake.count()) {
      throw new QaIssue("frontend", "Quality retake did not preserve two rejected captures or exceeded its one-retake/zero-identification limit.", { likelyFiles: ["src/screens/Scanner.tsx", "src/services/storage.ts"] });
    }
    await page.screenshot({ path: join(screenshotDir, "quality-retake-exhausted.png"), fullPage: true });
    await gotoPath(`/result/${saved[0].id}`);
    await expectText(/Identity unresolved/i, "reloaded unresolved identity", "frontend", ["src/lib/intakeReview.ts"]);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const exportedPath = join(artifactDir, "quality-retake-report.txt");
    await (await downloadPromise).saveAs(exportedPath);
    const report = readFileSync(exportedPath, "utf8");
    if (!report.includes("Guided retake used") || !report.includes("Photo quality was insufficient; identification was not run.") || report.includes("Run identification again")) {
      throw new QaIssue("frontend", "Downloaded report lost the rejection reason or retake outcome.", { likelyFiles: ["src/lib/intakeDraft.ts", "src/services/report.ts"] });
    }
    return { status: "pass", details: "Two generated covered-lens uploads preserved as unresolved records; one guided retake offered; zero identify requests; reload and actual text download retained the reason and retake outcome." };
  } finally {
    page.off("request", onRequest);
  }
}

async function runScannerAiEngine() {
  await requireAuthForProtectedRoute("scanner-ai-engine");
  const routeStartedAtMs = Date.now();
  await gotoPath("/scan");
  await getUploadPhotoButton().waitFor({ state: "visible", timeout: 7_000 });
  const uploadInput = page.getByLabel(/Upload photo/i);
  await uploadInput.waitFor({ state: "attached", timeout: 7_000 });
  const controlsReadyMs = Date.now() - routeStartedAtMs;
  const fixture = await createEngineFixture();
  const documentStartedAt = await page.evaluate(() => globalThis.performance.timeOrigin);
  const developmentPage = await page.locator('script[src*="/@vite/client"]').count() > 0;

  const uploadStartedAtMs = Date.now();
  await uploadInput.setInputFiles(fixture.path);
  const outcome = await waitForScannerAiOutcome(documentStartedAt);
  const analysisMs = Date.now() - uploadStartedAtMs;
  const lastIdentifyResponse = getLastNetworkResponse("/api/identify");
  const timingSummary = `scanner controls=${controlsReadyMs}ms, engine upload+AI=${analysisMs}ms, /api/identify=${lastIdentifyResponse?.status ?? "not observed"}`;

  if (outcome.type === "reloaded") {
    throw new QaIssue(developmentPage ? "environment" : "frontend",
      `The page reloaded during the engine scan; this attempt cannot establish AI or save behavior. ${timingSummary}.`, {
        likelyFiles: developmentPage ? [] : ["src/screens/Scanner.tsx"],
        suggestedFix: developmentPage
          ? "Use the built app via npm run qa:serve-production for a stable run, or resolve development-server reloads before repeating the scan."
          : "Inspect the trace for the unexpected document navigation before judging identification or persistence.",
      });
  }

  if (controlsReadyMs > 5_000) {
    throw new QaIssue(
      "frontend",
      `Scanner controls were slow before AI upload: ${timingSummary}.`,
      {
        likelyFiles: ["src/screens/Scanner.tsx"],
        suggestedFix: "Profile scanner route startup and camera fallback work; keep upload controls usable quickly even when camera setup is slow.",
      },
    );
  }

  const identifyApiIssue = classifyIdentifyApiIssue({
    status: lastIdentifyResponse?.status,
    text: outcome.text,
  });

  if (identifyApiIssue?.category === "missing_env") {
    throw new QaIssue(
      "missing_env",
      `Engine scan could not reach configured AI. ${identifyApiIssue.reason} Fixture=${fixture.source}. ${timingSummary}. Visible state: ${outcome.text}`,
      {
        likelyFiles: [".env.local", ".env.example", "api/identify.shared.ts"],
        suggestedFix: "Set the server-side AI provider key and rerun `npm run qa:doctor` before judging scanner model quality.",
      },
    );
  }

  if (identifyApiIssue?.category === "environment" && outcome.type !== "result") {
    throw new QaIssue(
      "environment",
      `Engine scan was blocked by provider availability. ${identifyApiIssue.reason} Fixture=${fixture.source}. ${timingSummary}. Visible state: ${outcome.text}`,
      {
        likelyFiles: [],
        suggestedFix: "Retry when the provider is healthy, or review provider fallback order if this happens repeatedly.",
      },
    );
  }

  if (outcome.type === "result") {
    const cloudSync = await waitForScannerCloudSyncOutcome();
    if (analysisMs > 90_000) {
      throw new QaIssue(
        "backend",
        `Engine scan completed but was too slow: ${timingSummary}. Visible result: ${outcome.text}`,
        {
          likelyFiles: ["src/screens/Scanner.tsx", "src/services/aiService.ts", "api/identify.shared.ts"],
          suggestedFix: "Profile /api/identify provider latency, image payload size, fallback model order, and scanner save/render work.",
        },
      );
    }

    if (cloudSync.status === "failed") {
      throw new QaIssue(
        "backend",
        `Engine scan produced a result but scan data did not sync. Fixture=${fixture.source}. ${timingSummary}. Visible result: ${cloudSync.text}`,
        {
          likelyFiles: ["src/screens/Scanner.tsx", "src/services/cloudSync.ts", "supabase/migrations"],
          suggestedFix: "Fix Supabase scan lookup/detail writes, schema cache, or cloud sync error handling before treating scanner data persistence as production-ready.",
        },
      );
    }

    if (cloudSync.status === "pending") {
      throw new QaIssue(
        "backend",
        `Engine scan produced a result but cloud sync did not finish within the QA window. Fixture=${fixture.source}. ${timingSummary}. Visible result: ${cloudSync.text}`,
        {
          likelyFiles: ["src/screens/Scanner.tsx", "src/services/cloudSync.ts"],
          suggestedFix: "Wait for and surface a final scan-save state, or fix slow Supabase sync before treating scanner data persistence as production-ready.",
        },
      );
    }

    if (cloudSync.status === "unknown") {
      throw new QaIssue(
        "frontend",
        `Engine scan produced a result but did not expose a final scan data state. Fixture=${fixture.source}. ${timingSummary}. Visible result: ${cloudSync.text}`,
        {
          likelyFiles: ["src/screens/Scanner.tsx", "src/services/cloudSync.ts"],
          suggestedFix: "Expose a final saved, disabled, or failed scan-data state before treating scanner persistence as production-ready.",
        },
      );
    }

    if (isEngineRecognitionMiss(outcome.text)) {
      throw new QaIssue(
        "backend",
        `Engine scan completed but returned a generic or low-confidence result. Fixture=${fixture.source}. ${timingSummary}. Visible result: ${outcome.text}`,
        {
          likelyFiles: ["api/identify.shared.ts", "src/services/systemPrompts.ts", "src/services/aiService.ts"],
          suggestedFix: "Tune the identify prompt, dataset grounding, or provider fallback so a clear engine-bay fixture returns a specific engine-related part with usable confidence.",
        },
      );
    }

    return {
      details: `Engine fixture uploaded through scanner, produced a usable AI result, and completed scan data sync. Fixture=${fixture.source}. ${timingSummary}. Visible result: ${cloudSync.text}`,
      likelyFiles: ["src/screens/Scanner.tsx", "src/services/aiService.ts", "api/identify.shared.ts", "src/services/cloudSync.ts"],
      status: "pass",
    };
  }

  if (outcome.type === "quality") {
    throw new QaIssue(
      "test_bug",
      `Engine fixture was rejected before AI analysis. Fixture=${fixture.source}. ${timingSummary}. Visible state: ${outcome.text}`,
      {
        likelyFiles: ["scripts/qa/real-website-tester.mjs", "src/lib/imageQuality.ts"],
        suggestedFix: "Improve the engine fixture or scan-quality gate so a clear real engine-bay photo can reach AI analysis.",
      },
    );
  }

  throw new QaIssue(
    "backend",
    `Engine scan did not produce a usable AI result. Fixture=${fixture.source}. ${timingSummary}. Visible state: ${outcome.text}`,
    {
      likelyFiles: ["src/screens/Scanner.tsx", "src/services/aiService.ts", "api/identify.shared.ts"],
      suggestedFix: "Use the saved trace, network log, and HTML snapshot to inspect the upload, /api/identify response, and result-card render path.",
    },
  );
}

async function runSavedHistory() {
  await requireAuthForProtectedRoute("saved-history");
  await seedSavedScans();
  await gotoPath("/history");
  await expectText(/Saved scans/i, "history heading", "frontend", ["src/screens/History.tsx"]);
  const headingContrast = await page.getByRole("heading", { name: "Saved scans", exact: true }).evaluate((heading) => {
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const luminance = (color) => {
      // Canvas converts CSS colors (including Tailwind's OKLCH) to sRGB bytes.
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const channels = Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const foreground = luminance(globalThis.getComputedStyle(heading).color);
    const background = luminance(globalThis.getComputedStyle(heading.closest("main")).backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  if (headingContrast < 4.5) throw new QaIssue("frontend", `History heading contrast is only ${headingContrast.toFixed(2)}:1 against the page background.`, { likelyFiles: ["src/screens/History.tsx"], suggestedFix: "Use the page foreground color for the heading while preserving dark text inside white cards." });
  await expectText(/QA Alternator/i, "seeded saved scan", "frontend", ["src/screens/History.tsx", "src/services/storage.ts"]);

  return {
    details: `Saved scan history rendered seeded local QA scans; heading contrast ${headingContrast.toFixed(2)}:1.`,
    likelyFiles: ["src/screens/History.tsx", "src/services/storage.ts"],
    status: "pass",
  };
}

async function runResultDetail() {
  await requireAuthForProtectedRoute("result-detail");
  await seedSavedScans();
  await gotoPath("/result/qa-alternator-1");
  await expectText(/QA Alternator/i, "result part label", "frontend", ["src/screens/Result.tsx", "src/services/storage.ts"]);
  await expectText(/\bAsk\b/i, "chat entry action", "frontend", ["src/screens/Result.tsx"]);
  await expectText(/Automatic intake draft/i, "automatic intake draft", "frontend", ["src/components/result/IntakeDraft.tsx", "src/screens/Result.tsx"]);
  await expectText(/Identity awaiting review/i, "identity review status", "frontend", ["src/lib/intakeReview.ts"]);
  await expectText(/AI suggestion — not verified/i, "unverified intake identity", "frontend", ["src/lib/intakeDraft.ts"]);
  await expectText(/Verify vehicle fitment against a trusted catalog/i, "fitment check", "frontend", ["src/lib/intakeDraft.ts"]);

  await page.getByText("Human inspection — optional", { exact: true }).click();
  await page.getByLabel("Visible condition notes", { exact: true }).fill("QA draft: housing scratch; identity not checked.");
  await expectText(/Unsaved inspection changes/, "unsaved inspection warning", "frontend", ["src/components/result/PartInspectionForm.tsx"]);
  const draftDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download draft", exact: true }).click();
  const downloadedDraft = await draftDownload;
  const draftPath = join(artifactDir, "inspection-draft.txt");
  await downloadedDraft.saveAs(draftPath);
  const draftText = readFileSync(draftPath, "utf8");
  if (!draftText.includes("UNSAVED INSPECTION DRAFT")
    || !draftText.includes("QA draft: housing scratch; identity not checked.")
    || !draftText.includes("Functional test: not tested")) {
    throw new QaIssue("frontend", "Inspection recovery download lost notes or its draft/untested labels.", {
      likelyFiles: ["src/components/result/PartInspectionForm.tsx"],
      suggestedFix: "Export the current form values with explicit unsaved-draft and functional-test status.",
    });
  }
  await page.getByRole("complementary", { name: "Inspection draft recovery" }).scrollIntoViewIfNeeded();
  const draftWarningReadable = await page.getByText("Unsaved inspection changes", { exact: true }).evaluate((label) => {
    const rect = label.getBoundingClientRect();
    const visibleElement = label.ownerDocument.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return label === visibleElement || label.contains(visibleElement);
  });
  if (!draftWarningReadable) throw new QaIssue("frontend", "The inspection draft warning is covered by another result panel.", {
    likelyFiles: ["src/screens/Result.tsx"], suggestedFix: "Keep the result summary in document flow so it cannot cover inspection controls while scrolling.",
  });
  await page.getByRole("complementary", { name: "Inspection draft recovery" }).screenshot({ path: join(screenshotDir, "inspection-draft-recovery.png") });

  return {
    details: "Saved result detail rendered the answer, Ask action, automatic intake draft, unverified identity and fitment check. Unfinished inspection notes downloaded with unsaved/untested labels; no inspection save or AI request was submitted.",
    likelyFiles: ["src/screens/Result.tsx", "src/services/storage.ts"],
    status: "pass",
  };
}

async function runInspectionSaveRecovery() {
  await requireAuthForProtectedRoute("inspection-save-recovery");
  await seedSavedScans();
  const prefix = await qaStoragePrefix();
  const lookupId = "qa-alternator-1";
  const likelyFiles = ["src/components/result/PartInspectionForm.tsx", "src/services/storage.ts", "src/services/report.ts"];
  const draft = {
    confirmedPartName: "QA inspected alternator", partNumber: "QA-ALT-0042",
    identityEvidence: "QA fictional fixture label; not a real catalog match.",
    visibleCondition: "no_visible_damage", visibleNotes: "QA visual note: housing examined; no functional test performed.",
    functionalStatus: "not_tested", functionalNotes: "", inspectorName: "QA inspector",
  };
  const labels = {
    confirmedPartName: "Confirmed part name", partNumber: "Part number",
    identityEvidence: "Identity evidence (label, catalog, or other check)",
    visibleCondition: "Visible condition", visibleNotes: "Visible condition notes",
    functionalStatus: "Functional test", functionalNotes: "Test method and result",
    inspectorName: "Inspector name (self-reported)",
  };
  const cloudPaths = /\/(?:rest|storage)\/v1\//;
  let blockedCloudWrites = 0;
  let secondPage;
  const preventCloudWrites = async (route) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(route.request().method())) {
      blockedCloudWrites += 1;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "QA controlled cloud failure. No cloud write was sent." }) });
    } else await route.continue();
  };
  const readLookup = () => page.evaluate(({ prefix, lookupId }) => JSON.parse(localStorage.getItem(prefix + "deep-spec:lookups") ?? "[]").find((lookup) => lookup.id === lookupId), { prefix, lookupId });
  const openInspection = async (target) => {
    const summary = target.getByText(/^Human inspection — (?:optional|saved|draft available)$/);
    await summary.waitFor({ state: "visible", timeout: 10_000 });
    const panel = summary.locator("..");
    if (await panel.getAttribute("open") === null) await summary.click();
    return panel;
  };
  const inspectionField = (panel, key) => {
    const name = new RegExp("^" + labels[key].replaceAll("(", "\\(").replaceAll(")", "\\)"));
    return panel.getByRole(key === "visibleCondition" || key === "functionalStatus" ? "combobox" : "textbox", { name });
  };
  const assertFields = async (panel, expected) => {
    for (const [key, value] of Object.entries(expected)) {
      if (await inspectionField(panel, key).inputValue() !== value) {
        throw new QaIssue("frontend", `Saved inspection field ${key} did not survive reload.`, { likelyFiles });
      }
    }
  };
  await context.route(cloudPaths, preventCloudWrites);
  try {
    await gotoPath(`/result/${lookupId}`);
    let panel = await openInspection(page);
    // Use real reloads and close/reopen navigation. Network is disabled only
    // while editing: a fresh offline app load is not promised by this feature.
    const incompleteNote = "QA unfinished draft with no inspector or completed test";
    await context.setOffline(true);
    await inspectionField(panel, "visibleNotes").fill(incompleteNote);
    await panel.getByText("Draft kept on this device. It is not a saved inspection or a cloud backup.", { exact: true }).waitFor();
    await context.setOffline(false);
    await page.close();
    page = await context.newPage();
    attachLoggers(page);
    await page.goto(new URL(`/result/${lookupId}`, baseUrl).toString(), { waitUntil: "domcontentloaded" });
    panel = await openInspection(page);
    if (await inspectionField(panel, "visibleNotes").inputValue() !== "" || (await readLookup()).inspection) {
      throw new QaIssue("frontend", "An unfinished draft silently changed the inspection on reload.", { likelyFiles });
    }
    await panel.getByRole("button", { name: "Restore draft", exact: true }).click();
    if (await inspectionField(panel, "visibleNotes").inputValue() !== incompleteNote) throw new QaIssue("frontend", "Draft restore lost the unfinished notes.", { likelyFiles });
    await panel.screenshot({ path: join(screenshotDir, "inspection-draft-restored.png") });
    await panel.getByRole("button", { name: "Discard draft", exact: true }).click();
    await page.reload({ waitUntil: "domcontentloaded" });
    panel = await openInspection(page);
    if (await inspectionField(panel, "visibleNotes").inputValue() !== "" || await panel.getByRole("button", { name: "Restore draft", exact: true }).count()) {
      throw new QaIssue("frontend", "Discarded notes reappeared after reload.", { likelyFiles });
    }
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      globalThis.__qaRestoreDraftStorage = () => { Storage.prototype.setItem = original; delete globalThis.__qaRestoreDraftStorage; };
      Storage.prototype.setItem = function(key, value) {
        if (key.includes(":inspection-draft:")) throw new DOMException("QA simulated quota", "QuotaExceededError");
        return original.call(this, key, value);
      };
    });
    try {
      await inspectionField(panel, "visibleNotes").fill("QA storage-failure notes retained in the form");
      await panel.getByText("Draft could not be kept on this device. Download a copy before leaving this page.", { exact: true }).waitFor();
      const failedDownload = page.waitForEvent("download");
      await panel.getByRole("button", { name: "Download draft", exact: true }).click();
      const failedPath = join(artifactDir, "inspection-storage-failure-draft.txt");
      await (await failedDownload).saveAs(failedPath);
      if (!readFileSync(failedPath, "utf8").includes("QA storage-failure notes retained in the form")) {
        throw new QaIssue("frontend", "Device-storage failure lost the current draft's export.", { likelyFiles });
      }
    } finally { await page.evaluate(() => globalThis.__qaRestoreDraftStorage?.()); }
    await panel.getByRole("button", { name: "Discard draft", exact: true }).click();
    await panel.getByRole("button", { name: "Save inspection", exact: true }).click();
    await panel.getByRole("status").filter({ hasText: "Enter the inspector's name." }).waitFor({ state: "visible" });
    await inspectionField(panel, "inspectorName").fill(draft.inspectorName);
    await inspectionField(panel, "partNumber").fill(draft.partNumber);
    await panel.getByRole("button", { name: "Save inspection", exact: true }).click();
    await panel.getByRole("status").filter({ hasText: "Describe how you confirmed the identity or part number." }).waitFor({ state: "visible" });
    if ((await readLookup()).inspection || blockedCloudWrites) throw new QaIssue("frontend", "Invalid inspection attempted a save or cloud write.", { likelyFiles });

    for (const [key, value] of Object.entries(draft)) {
      const field = inspectionField(panel, key);
      if (key === "visibleCondition" || key === "functionalStatus") await field.selectOption(value);
      else await field.fill(value);
    }
    await panel.getByRole("button", { name: "Save inspection", exact: true }).click();
    await panel.getByRole("status").filter({ hasText: "Saved on this device. Cloud sync failed:" }).waitFor({ state: "visible", timeout: 30_000 });
    const saved = await readLookup();
    if (!blockedCloudWrites || saved.cloudSave?.status !== "failed" || Object.entries(draft).some(([key, value]) => saved.inspection?.[key] !== value)
      || !Number.isFinite(Date.parse(saved.inspection?.inspectedAt))) {
      throw new QaIssue("frontend", "Controlled cloud failure did not retain an exact dated device inspection and failed save receipt.", { likelyFiles });
    }
    await panel.screenshot({ path: join(screenshotDir, "inspection-device-saved-cloud-failed.png") });

    await page.reload({ waitUntil: "domcontentloaded" });
    panel = await openInspection(page);
    await assertFields(panel, draft);
    if ((await readLookup()).cloudSave?.status !== "failed") throw new QaIssue("frontend", "Inspection cloud-failure receipt was lost on reload.", { likelyFiles });
    await panel.screenshot({ path: join(screenshotDir, "inspection-saved-reloaded.png") });
    const reportDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const reportPath = join(artifactDir, "inspection-saved-report.txt");
    await (await reportDownload).saveAs(reportPath);
    const report = readFileSync(reportPath, "utf8");
    const exactLines = [
      "Deep Spec Scan Report", "AI scan summary:", "Human inspection (self-reported, separate from AI):",
      `Inspector: ${draft.inspectorName}`, `Confirmed part: ${draft.confirmedPartName}`, `Part number: ${draft.partNumber}`,
      `Identity evidence: ${draft.identityEvidence}`, "Visible condition: no visible damage", `Visible notes: ${draft.visibleNotes}`,
      "Functional test: not tested", "Test method and result: None recorded",
      "No visible damage does not establish function. Recorded tests are not safety certification.", "QA seeded saved scan.",
    ];
    if (exactLines.some((line) => !report.split(/\r?\n/).includes(line)) || report.includes("UNSAVED INSPECTION DRAFT")) {
      throw new QaIssue("frontend", "Completed inspection report lost exact notes, untested status or separation from AI.", { likelyFiles });
    }

    secondPage = await context.newPage();
    attachLoggers(secondPage);
    await secondPage.goto(new URL(`/result/${lookupId}`, baseUrl).toString(), { waitUntil: "domcontentloaded" });
    const otherPanel = await openInspection(secondPage);
    const secondNote = "QA second tab: newer receiving note retained.";
    const staleNote = "QA first tab: unsaved draft must not overwrite newer work.";
    await inspectionField(panel, "visibleNotes").fill(staleNote);
    await inspectionField(otherPanel, "visibleNotes").fill(secondNote);
    await otherPanel.getByRole("button", { name: "Save inspection", exact: true }).click();
    await otherPanel.getByRole("status").filter({ hasText: "Saved on this device. Cloud sync failed:" }).waitFor({ state: "visible", timeout: 30_000 });
    const newest = JSON.stringify(await readLookup());
    const writesBeforeStaleSave = blockedCloudWrites;
    await panel.getByRole("button", { name: "Save inspection", exact: true }).click();
    await panel.getByRole("status").filter({ hasText: "Inspection changed or was removed since you opened this form." }).waitFor({ state: "visible" });
    if (JSON.stringify(await readLookup()) !== newest || blockedCloudWrites !== writesBeforeStaleSave
      || await inspectionField(panel, "visibleNotes").inputValue() !== staleNote) {
      throw new QaIssue("frontend", "A stale inspection form overwrote a newer device record, sent a cloud write or lost its draft.", { likelyFiles });
    }
    const draftDownload = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Download draft", exact: true }).click();
    const draftPath = join(artifactDir, "inspection-stale-draft.txt");
    await (await draftDownload).saveAs(draftPath);
    const recovery = readFileSync(draftPath, "utf8");
    if (!recovery.includes("UNSAVED INSPECTION DRAFT") || !recovery.includes(`Visible notes: ${staleNote}`) || !recovery.includes("Functional test: not tested")) {
      throw new QaIssue("frontend", "Blocked stale-form recovery download lost the unsaved notes or untested label.", { likelyFiles });
    }
    await panel.screenshot({ path: join(screenshotDir, "inspection-stale-form-protected.png") });
    await page.reload({ waitUntil: "domcontentloaded" });
    panel = await openInspection(page);
    await assertFields(panel, { ...draft, visibleNotes: secondNote });
    if (!await panel.getByRole("button", { name: "Restore draft", exact: true }).isDisabled()) {
      throw new QaIssue("frontend", "Old recovery notes could replace a newer saved inspection.", { likelyFiles });
    }
    const recoveredDownload = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Download recovery copy", exact: true }).click();
    const recoveredPath = join(artifactDir, "inspection-reloaded-stale-draft.txt");
    await (await recoveredDownload).saveAs(recoveredPath);
    if (!readFileSync(recoveredPath, "utf8").includes(staleNote)) throw new QaIssue("frontend", "Reload lost the stale draft's recovery copy.", { likelyFiles });
    await panel.screenshot({ path: join(screenshotDir, "inspection-stale-recovery-choice.png") });
    await panel.getByRole("button", { name: "Discard draft", exact: true }).click();
    const hitTargets = [];
    for (const key of Object.keys(labels)) {
      const field = inspectionField(panel, key);
      await field.scrollIntoViewIfNeeded();
      const target = await field.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = element.ownerDocument.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          unobstructed: hit === element || element.contains(hit),
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
          coveringElement: hit ? { tag: hit.tagName, className: hit.className, text: hit.textContent?.slice(0, 160) } : null,
        };
      });
      hitTargets.push({ field: key, ...target });
      if (!target.unobstructed || key === "confirmedPartName") {
        await page.screenshot({ path: join(screenshotDir, `inspection-${key}-viewport.png`) });
      }
    }
    writeJson(join(artifactDir, "inspection-hit-targets.json"), { viewport: viewportProfile, hitTargets });
    const obstructed = hitTargets.filter((target) => !target.unobstructed).map((target) => target.field);
    if (obstructed.length) throw new QaIssue("frontend", `Result overlays cover inspection controls after scrolling: ${obstructed.join(", ")}. Viewport screenshots and elementFromPoint evidence confirm this is not screenshot stitching.`, {
      likelyFiles: ["src/screens/Result.tsx"], suggestedFix: "Keep the result summary in normal document flow so it cannot cover inspection controls while scrolling.",
    });
    writeJson(join(artifactDir, "inspection-save-recovery.json"), {
      syntheticFixture: true, liveAuth: true, controlledCloudFailure: true, liveCloudPersistenceVerified: false,
      blockedCloudWrites, validation: ["inspector required", "identity evidence required"],
      deviceSaveAndReload: "pass", completedReportExactLines: "pass", staleTwoTabProtection: "pass", staleDraftRecovery: "pass", inspectionHitTargets: "pass",
      offlineEditThenTabCloseReopenRestore: "pass", explicitDiscardAndReload: "pass", storageFailureDownload: "pass", staleRecoveryRestoreBlocked: "pass", recoveredPath,
      reportPath, draftPath,
    });
    return { status: "pass", details: `Offline editing kept an incomplete device draft; reload required explicit restore, and discard survived another reload. Synthetic inspection rejected invalid fields; device save survived ${blockedCloudWrites} deliberately intercepted cloud writes and reload; downloaded report preserved exact notes and untested labels. A second tab saved newer work; the stale form retained a downloadable draft across reload and was blocked from restoring over the new inspection. All ${hitTargets.length} inspection controls were unobstructed after scrolling. Live QA auth, controlled cloud failure; no live cloud inspection persistence was tested.` };
  } catch (error) {
    if (error?.name === "TimeoutError") throw new QaIssue("test_bug", `Inspection QA could not complete a UI wait: ${formatError(error)}`, {
      likelyFiles: ["scripts/qa/real-website-tester.mjs"], suggestedFix: "Inspect the trace and current UI before classifying this selector or timing failure as a product defect.",
    });
    throw error;
  } finally {
    await context.setOffline(false);
    if (secondPage) await secondPage.close();
    await context.unroute(cloudPaths, preventCloudWrites);
  }
}

async function runResultChat() {
  await requireAuthForProtectedRoute("result-chat");
  await seedSavedScans();
  await gotoPath("/result/qa-alternator-1/chat");
  await expectText(/Ask about this scan/i, "chat heading", "frontend", ["src/screens/Chat.tsx"]);
  await page.getByLabel(/Ask a follow-up question/i).fill("What should I check next?");

  return {
    details: "Chat route loaded from the saved scan. The tester typed a question but did not submit it, so no provider quota was spent.",
    likelyFiles: ["src/screens/Chat.tsx", "src/services/aiService.ts", "api/chat.shared.ts"],
    status: "pass",
  };
}

async function runEarlyAccess() {
  await requireAuthForProtectedRoute("early-access");
  await gotoPath("/early-access");
  await expectText(/Early access/i, "early access heading", "frontend", ["src/screens/EarlyAccess.tsx"]);
  await expectText(/Join the waitlist/i, "waitlist section", "frontend", ["src/screens/EarlyAccess.tsx"]);
  await expectText(/Send product feedback/i, "feedback section", "frontend", ["src/screens/EarlyAccess.tsx"]);
  await expectText(/Save waitlist entry/i, "waitlist save control", "frontend", ["src/screens/EarlyAccess.tsx"]);
  await expectText(/Save feedback/i, "feedback save control", "frontend", ["src/screens/EarlyAccess.tsx"]);

  return {
    details: "Early access, waitlist, and feedback controls rendered. The tester did not submit forms to avoid creating real cloud data.",
    likelyFiles: ["src/screens/EarlyAccess.tsx", "src/services/cloudSync.ts"],
    status: "pass",
  };
}

async function runPricing() {
  await requireAuthForProtectedRoute("pricing");
  await gotoPath("/pricing");
  await expectText(/DeepSpec Auto paid beta/i, "pricing heading", "frontend", ["src/screens/Pricing.tsx"]);
  await expectText(/DeepSpec Plus/i, "plus plan", "frontend", ["src/screens/Pricing.tsx", "src/services/revenue.ts"]);
  await expectText(/\$9\.99/i, "monthly price", "frontend", ["src/screens/Pricing.tsx", "src/services/revenue.ts"]);
  await expectText(/Scan Pack/i, "scan pack", "frontend", ["src/screens/Pricing.tsx", "src/services/revenue.ts"]);
  await expectText(/fake certainty/i, "uncertainty copy", "frontend", ["src/screens/Pricing.tsx"]);
  await expectText(/Polar sandbox/i, "polar sandbox path", "frontend", ["src/screens/Pricing.tsx"]);

  return {
    details: "Pricing rendered Plus, yearly, scan-pack, and Pro paid-beta offers with uncertainty-safe copy and Polar sandbox positioning.",
    likelyFiles: ["src/screens/Pricing.tsx", "src/services/revenue.ts"],
    status: "pass",
  };
}

async function runCheckout() {
  await requireAuthForProtectedRoute("checkout");
  await gotoPath("/pricing");
  const status = await page.evaluate(async () => {
    const response = await fetch("/api/billing-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "fake-plan", origin: globalThis.location.origin }),
    });
    const body = await response.json().catch(() => null);
    return {
      body,
      status: response.status,
    };
  });

  if (status.status !== 400 || status.body?.error?.code !== "invalid_plan") {
    throw new QaIssue(
      "backend",
      `Checkout did not fail closed for an invalid plan. HTTP ${status.status}.`,
      {
        likelyFiles: ["api/billing.shared.ts", "src/services/revenue.ts"],
        suggestedFix: "Reject invalid checkout plan ids before contacting the billing provider or redirecting a user.",
      },
    );
  }

  return {
    category: "backend",
    details: "Checkout endpoint rejected an invalid plan without creating a provider session or redirect.",
    likelyFiles: ["api/billing.shared.ts", "src/screens/Pricing.tsx"],
    status: "pass",
  };
}

async function runAccountEntitlements() {
  await requireAuthForProtectedRoute("account-entitlements");
  await seedSavedScans();
  await gotoPath("/account");
  await expectText(/Your DeepSpec access/i, "account heading", "frontend", ["src/screens/Account.tsx"]);
  await expectText(/Free preview/i, "default entitlement", "frontend", ["src/screens/Account.tsx", "src/services/revenue.ts"]);
  await expectText(/Paid (?:access|scans) stay(?:s)? locked until verified/i, "unverified paid access stays locked", "frontend", ["src/screens/Account.tsx"]);

  return {
    details: "Account entitlements rendered the free preview state and fail-closed paid-access copy.",
    likelyFiles: ["src/screens/Account.tsx", "src/services/revenue.ts"],
    status: "pass",
  };
}

async function runShopOnboarding() {
  await requireAuthForProtectedRoute("shop-onboarding");
  await seedShopData();
  await gotoPath("/shop");
  await expectText(/Work queue/i, "shop queue heading", "frontend", ["src/screens/Shop.tsx"]);
  await expectText(/QA alternator RO/i, "seeded shop job", "frontend", ["src/screens/Shop.tsx", "src/services/shop.ts"]);
  await expectText(/Accuracy feedback/i, "shop accuracy dashboard", "frontend", ["src/screens/Shop.tsx"]);

  return {
    details: "Shop mode rendered the work queue, seeded job, and accuracy dashboard.",
    likelyFiles: ["src/screens/Shop.tsx", "src/services/shop.ts"],
    status: "pass",
  };
}

async function runCreateJob() {
  await requireAuthForProtectedRoute("create-job");
  await gotoPath("/shop/new");
  await page.getByLabel(/Job title/i).fill("QA starter complaint");
  await page.getByLabel(/Technician/i).fill("QA Tech");
  await page.getByLabel(/^Year/i).fill("2016");
  await page.getByLabel(/Make/i).fill("Honda");
  await page.getByLabel(/Model/i).fill("Civic");
  await page.getByLabel(/Symptom/i).fill("No crank after sitting overnight.");
  await clickByRole("button", /Start scan/i, "start shop scan");
  await page.waitForURL((url) => url.pathname === "/scan" && url.searchParams.has("jobId"), { timeout: 10_000 });
  await expectText(/Shop job/i, "shop scan banner", "frontend", ["src/screens/Scanner.tsx", "src/services/shop.ts"]);

  return {
    details: "Technician intake created a job and routed directly into job-scoped scanning.",
    likelyFiles: ["src/screens/ShopNewJob.tsx", "src/screens/Scanner.tsx", "src/services/shop.ts"],
    status: "pass",
  };
}

async function runJobScan() {
  await requireAuthForProtectedRoute("job-scan");
  await seedShopData();
  await gotoPath(`/scan?jobId=${QA_SHOP_JOB_ID}`);
  await expectText(/Shop job/i, "shop scan banner", "frontend", ["src/screens/Scanner.tsx"]);
  await expectText(/QA alternator RO/i, "active job title", "frontend", ["src/screens/Scanner.tsx", "src/services/shop.ts"]);

  return {
    details: "Scanner rendered an active shop job context before scan.",
    likelyFiles: ["src/screens/Scanner.tsx", "src/services/shop.ts"],
    status: "pass",
  };
}

async function runJobResultCorrection() {
  await requireAuthForProtectedRoute("job-result-correction");
  await seedShopData();
  await gotoPath("/result/qa-alternator-1");
  await expectText(/Best match/i, "simple result heading", "frontend", ["src/screens/Result.tsx"]);
  await clickByRole("button", /Why or why not/i, "open scan feedback");
  const correction = "QA correction: verify the connector before identifying this alternator.";
  await page.getByLabel("Why or why not", { exact: true }).fill(correction);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByLabel("Why or why not", { exact: true }).waitFor({ state: "visible" });
  if (await page.getByLabel("Why or why not", { exact: true }).inputValue() !== correction) {
    throw new QaIssue("frontend", "Scan feedback did not persist after reload.", { likelyFiles: ["src/screens/Result.tsx", "src/services/storage.ts"] });
  }

  return {
    details: "Job result accepted correction feedback and preserved its exact text after reload. This verifies feedback persistence, not part identity or model training permission.",
    likelyFiles: ["src/screens/Result.tsx", "src/services/storage.ts"],
    status: "pass",
  };
}

async function runAddVinAfterResult() {
  await requireAuthForProtectedRoute("add-vin-after-result");
  await seedShopData();
  await gotoPath(`/shop/jobs/${QA_SHOP_JOB_ID}`);
  await page.getByLabel(/^VIN$/i).fill("1HGCM82633A004352");
  await clickByRole("button", /Save job/i, "save job vin");
  await expectText(/Job updated/i, "vin update confirmation", "frontend", ["src/screens/ShopJob.tsx", "src/services/shop.ts"]);

  return {
    details: "Shop job allowed VIN to be added after result creation.",
    likelyFiles: ["src/screens/ShopJob.tsx", "src/services/shop.ts"],
    status: "pass",
  };
}

async function runSecondAngleRefinement() {
  await requireAuthForProtectedRoute("second-angle-refinement");
  await seedShopData();
  await gotoPath("/result/qa-alternator-1");
  await expectText(/Best match/i, "simple result answer", "frontend", ["src/screens/Result.tsx"]);
  const text = await getBodyText();
  if (/Add second angle|Capture another angle|More evidence/i.test(text)) {
    throw new Error("Default result still exposes second-angle guidance.");
  }

  return {
    details: "Result kept second-angle guidance out of the default simple answer.",
    likelyFiles: ["src/screens/Result.tsx", "src/screens/Scanner.tsx"],
    status: "pass",
  };
}

async function runShopHistorySearch() {
  await requireAuthForProtectedRoute("shop-history-search");
  await seedShopData();
  await gotoPath("/history");
  await page.getByPlaceholder(/Search saved scans/i).fill("QA RO-77");
  await expectText(/QA Alternator/i, "shop-context history result", "frontend", ["src/screens/History.tsx", "src/services/storage.ts"]);

  return {
    details: "Saved history found a scan by shop RO context.",
    likelyFiles: ["src/screens/History.tsx", "src/services/storage.ts"],
    status: "pass",
  };
}

async function runCustomerReportExport() {
  await requireAuthForProtectedRoute("customer-report-export");
  await seedShopData();
  await gotoPath(`/shop/jobs/${QA_SHOP_JOB_ID}`);
  await expectText(/Export report/i, "customer report export control", "frontend", ["src/screens/ShopJob.tsx", "src/services/shop.ts"]);

  return {
    details: "Shop job exposed customer report export without creating a public link.",
    likelyFiles: ["src/screens/ShopJob.tsx", "src/services/shop.ts"],
    status: "pass",
  };
}

async function runOrgMemberPermissions() {
  await requireAuthForProtectedRoute("org-member-permissions");
  await seedShopData();
  await gotoPath("/shop");
  await expectText(/Shop corrections stay private/i, "shop privacy copy", "frontend", ["src/screens/Shop.tsx", "src/services/shop.ts"]);

  return {
    details: "Shop dashboard defaulted correction learning to private until explicit opt-in.",
    likelyFiles: ["src/screens/Shop.tsx", "src/services/shop.ts", "supabase/migrations"],
    status: "pass",
  };
}

async function runBillingProviderFailClosed() {
  await requireAuthForProtectedRoute("billing-provider-fail-closed");
  const status = await page.evaluate(async () => {
    const response = await fetch("/api/billing-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: "pro_beta", origin: globalThis.location.origin }),
    });
    const body = await response.json().catch(() => null);
    return { body, status: response.status };
  });

  if (status.status === 200 || !status.body?.error) {
    throw new QaIssue(
      "backend",
      `Billing provider checkout did not fail closed. HTTP ${status.status}.`,
      {
        likelyFiles: ["api/billing.shared.ts", "src/screens/Pricing.tsx"],
        suggestedFix: "Require a configured provider adapter and verified session before returning any checkout URL.",
      },
    );
  }

  return {
    category: "backend",
    details: `Billing provider checkout failed closed with ${status.body.error.code}.`,
    likelyFiles: ["api/billing.shared.ts", "src/screens/Pricing.tsx"],
    status: "pass",
  };
}

async function runApiCloudHealth() {
  const failures = [];
  const identifyStatus = await getStatus(`${baseUrl}/api/identify`);
  const chatStatus = await getStatus(`${baseUrl}/api/chat`);
  const checkoutStatus = await getStatus(`${baseUrl}/api/billing-checkout`);
  const portalStatus = await getStatus(`${baseUrl}/api/billing-portal`);

  if (identifyStatus !== 405) {
    failures.push(`/api/identify returned HTTP ${identifyStatus}; expected 405 for safe GET.`);
  }

  if (chatStatus !== 405) {
    failures.push(`/api/chat returned HTTP ${chatStatus}; expected 405 for safe GET.`);
  }

  if (checkoutStatus !== 405) {
    failures.push(`/api/billing-checkout returned HTTP ${checkoutStatus}; expected 405 for safe GET.`);
  }

  if (portalStatus !== 405) {
    failures.push(`/api/billing-portal returned HTTP ${portalStatus}; expected 405 for safe GET.`);
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim();
  const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!supabaseUrl || !supabaseKey) {
    return {
      category: "missing_env",
      details: "API method guards were checked, but Supabase database health is blocked by missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.",
      likelyFiles: [".env.local", ".env.example", "src/services/cloudSync.ts"],
      status: failures.length ? "fail" : "blocked",
      suggestedFix: "Set Supabase public config and rerun `npm run test:website`.",
    };
  }

  const authSettings = await fetchSupabaseAuthSettings(supabaseUrl, supabaseKey);
  if (!authSettings.ok) {
    failures.push(authSettings.message);
  }

  const schemaHealth = await fetchSupabaseSchemaHealth(supabaseUrl, supabaseKey);
  if (!schemaHealth.ok) {
    failures.push(schemaHealth.message);
  }

  if (failures.length) {
    const transportOnly = failures.every((message) => classifyQaTransportError(message));
    throw new QaIssue(
      transportOnly ? "environment" : "backend",
      failures.join(" "),
      {
        likelyFiles: transportOnly ? [] : ["api/identify.shared.ts", "api/chat.shared.ts", "src/services/cloudSync.ts", "scripts/verify-supabase-sync.mjs", "supabase/migrations"],
        suggestedFix: transportOnly ? "Retry Supabase reachability after network and local resource pressure recover." : "Fix API method guards or Supabase schema/Auth health, then rerun `npm run qa:doctor` before calling it a product bug.",
      },
    );
  }

  return {
    category: "backend",
    details: "Safe API method guards, Supabase Auth settings, and Supabase REST schema reachability passed.",
    likelyFiles: ["api/identify.shared.ts", "api/chat.shared.ts", "src/services/cloudSync.ts"],
    status: "pass",
  };
}

async function requireAuthForProtectedRoute(scenario) {
  if (!authAttempted) {
    await runAuthLogin();
  }

  if (!authEstablished) {
    const blocker = getAuthDependencyBlocker(scenario, authFailure);
    throw new QaIssue(blocker.category, blocker.message, blocker);
  }
}

async function gotoPath(path) {
  const target = new URL(path, `${baseUrl}/`).toString();
  const response = await page.goto(target, { timeout: 30_000, waitUntil: "domcontentloaded" });

  if (response?.status() >= 500) {
    throw new QaIssue(
      "backend",
      `${path} returned HTTP ${response.status()}.`,
      {
        likelyFiles: ["vite.config.ts", "api/identify.shared.ts", "api/chat.shared.ts"],
        suggestedFix: "Fix the server error visible in the saved trace/network log.",
      },
    );
  }

  if (response?.status() === 404) {
    throw new QaIssue(
      "frontend",
      `${path} returned HTTP 404.`,
      {
        likelyFiles: ["src/App.tsx", "vite.config.ts"],
        suggestedFix: "Check the React route and deployment rewrite behavior.",
      },
    );
  }
}

async function expectText(pattern, label, category, likelyFiles) {
  try {
    await page.getByText(pattern).first().waitFor({ state: "visible", timeout: 7_000 });
  } catch {
    throw new QaIssue(
      category,
      `Expected visible ${label}, but it was not found.`,
      {
        likelyFiles,
        suggestedFix: "Open the saved screenshot and HTML snapshot to confirm whether this is a UI regression or stale QA expectation.",
      },
    );
  }
}

async function expectVisible(selector, label, category, likelyFiles) {
  try {
    await page.locator(selector).first().waitFor({ state: "visible", timeout: 7_000 });
  } catch {
    throw new QaIssue(
      category,
      `Expected visible ${label} using selector ${selector}, but it was not found.`,
      {
        likelyFiles,
        suggestedFix: "Open the saved screenshot and HTML snapshot to confirm whether this is a UI regression or stale QA expectation.",
      },
    );
  }
}

async function clickByRole(role, name, label) {
  try {
    await page.getByRole(role, { name }).click({ timeout: 7_000 });
  } catch (error) {
    throw new QaIssue(
      "test_bug",
      `Could not click ${label}: ${formatError(error)}`,
      {
        likelyFiles: ["scripts/qa/real-website-tester.mjs"],
        suggestedFix: "Confirm the selector against the saved HTML before changing product code.",
      },
    );
  }
}

async function selectTabIfNeeded(name, label) {
  try {
    const tab = page.getByRole("tab", { name }).first();
    await tab.waitFor({ state: "visible", timeout: 7_000 });
    if (await tab.getAttribute("aria-selected") !== "true") {
      await tab.click({ timeout: 7_000 });
    }
  } catch (error) {
    throw new QaIssue(
      "test_bug",
      `Could not select ${label}: ${formatError(error)}`,
      {
        likelyFiles: ["scripts/qa/real-website-tester.mjs"],
        suggestedFix: "Confirm the selector against the saved HTML before changing product code.",
      },
    );
  }
}

async function waitForAny(locators, label) {
  const attempts = locators.map((locator) => locator.waitFor({ state: "visible", timeout: 7_000 }));
  try {
    await Promise.any(attempts);
  } catch {
    throw new QaIssue(
      "frontend",
      `Expected one of the ${label}, but none were visible.`,
      {
        likelyFiles: ["src/screens/Scanner.tsx", "src/components/scanner/IdentifyButton.tsx"],
        suggestedFix: "Check whether protected scanner controls are hidden, overlapped, disabled, or renamed.",
      },
    );
  }
}

function getUploadPhotoButton() {
  return page.locator("button", { hasText: /Upload photo/i }).first();
}

async function captureEvidence(scenario) {
  if (!page) return {};

  const safeName = sanitizeFilename(scenario);
  const screenshotPath = join(screenshotDir, `${safeName}.png`);
  const htmlPath = join(htmlDir, `${safeName}.html`);
  const textPath = join(htmlDir, `${safeName}.txt`);
  const evidence = {};

  try {
    await page.screenshot({ fullPage: true, path: screenshotPath });
    evidence.screenshot = screenshotPath;
  } catch (error) {
    evidence.screenshotError = formatError(error);
  }

  try {
    writeText(htmlPath, await page.content());
    evidence.html = htmlPath;
  } catch (error) {
    evidence.htmlError = formatError(error);
  }

  try {
    writeText(textPath, await getBodyText());
    evidence.text = textPath;
  } catch (error) {
    evidence.textError = formatError(error);
  }

  return evidence;
}

async function createEngineFixture() {
  const fixtureDir = join(artifactDir, "fixtures");
  const sourcePath = join(process.cwd(), "public", "test-fixtures", "engine-scan-test.jpg");
  if (existsSync(sourcePath)) {
    ensureDir(fixtureDir);
    const path = join(fixtureDir, "engine-scan-test.jpg");
    copyFileSync(sourcePath, path);
    return { path, source: "public/test-fixtures/engine-scan-test.jpg" };
  }

  return createGeneratedEngineFixture();
}

async function createGeneratedEngineFixture() {
  const dataUrl = await page.evaluate(() => {
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 900;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas context is not available.");
    }

    context.fillStyle = "#f7fafc";
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = "#e5e7eb";
    context.fillRect(120, 110, 1040, 640);
    context.strokeStyle = "#111827";
    context.lineWidth = 18;
    context.strokeRect(120, 110, 1040, 640);

    context.fillStyle = "#374151";
    roundRect(context, 270, 240, 740, 280, 42);
    context.fill();
    context.stroke();

    context.fillStyle = "#111827";
    for (let index = 0; index < 6; index += 1) {
      const x = 330 + index * 106;
      roundRect(context, x, 190, 62, 120, 16);
      context.fill();
    }

    context.fillStyle = "#6b7280";
    for (let index = 0; index < 4; index += 1) {
      const x = 360 + index * 145;
      roundRect(context, x, 390, 98, 86, 18);
      context.fill();
      context.stroke();
    }

    context.beginPath();
    context.arc(230, 385, 86, 0, Math.PI * 2);
    context.fillStyle = "#1f2937";
    context.fill();
    context.stroke();
    context.beginPath();
    context.arc(230, 385, 42, 0, Math.PI * 2);
    context.fillStyle = "#f9fafb";
    context.fill();
    context.stroke();

    context.strokeStyle = "#2563eb";
    context.lineWidth = 16;
    context.beginPath();
    context.moveTo(170, 650);
    context.bezierCurveTo(360, 560, 720, 590, 1060, 650);
    context.stroke();

    context.fillStyle = "#111827";
    context.font = "700 64px Arial";
    context.fillText("QA GENERATED ENGINE", 285, 645);
    context.font = "700 38px Arial";
    context.fillText("V6 intake, pulley, valve cover, hoses", 312, 700);

    return canvas.toDataURL("image/png");

    function roundRect(ctx, x, y, width, height, radius) {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    }
  });
  const [, base64 = ""] = dataUrl.split(",");
  const buffer = Buffer.from(base64, "base64");
  const fixtureDir = join(artifactDir, "fixtures");
  const path = join(fixtureDir, "generated-engine.png");
  ensureDir(fixtureDir);
  writeFileSync(path, buffer);
  return { path, source: "generated-fallback" };
}

async function waitForScannerAiOutcome(documentStartedAt) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await page.evaluate(() => globalThis.performance.timeOrigin) !== documentStartedAt) {
      return { text: compactText(await getBodyText()), type: "reloaded" };
    }
    const text = await getBodyText();
    if (/Best match|Identified|Visible issue|Item view|Tell me more|What this is|Next step/i.test(text)) {
      return { text: compactText(text), type: "result" };
    }

    if (/Retake guide|Add light|Steady photo|Soft photo|Fill the frame|too dark|too bright|too blurry|too small/i.test(text)) {
      return { text: compactText(text), type: "quality" };
    }

    if (classifyIdentifyApiIssue({ text }) || /unreadable|could not analyze|could not complete|Try again later|Scan again to identify this/i.test(text)) {
      return { text: compactText(text), type: "error" };
    }

    await page.waitForTimeout(500);
  }

  return { text: compactText(await getBodyText()), type: "timeout" };
}

async function waitForScannerCloudSyncOutcome() {
  // Allow the service's 20-second timeout to settle and render a final state.
  const deadline = Date.now() + 25_000;
  const statusNotice = page.getByTestId("scan-save-status");
  let latestText = "";

  while (Date.now() < deadline) {
    // Read the notice itself: truncating the whole page can remove a valid
    // save acknowledgement after a long identification answer.
    const text = await statusNotice.innerText({ timeout: 500 }).catch(() => "");
    latestText = text;

    if (/Cloud sync failed|Scan saved to cloud|Cloud sync is off|Cloud sync is not configured/i.test(text)) {
      const visible = await statusNotice.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const front = element.ownerDocument.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return rect.width > 0 && rect.height > 0 && front !== null && element.contains(front);
      }).catch(() => false);
      if (!visible) return { status: "unknown", text: `Save status is missing, outside the viewport, or covered by another element. ${text}` };
    }

    if (/Cloud sync failed/i.test(text)) {
      return { status: "failed", text };
    }

    if (/Scan saved to cloud/i.test(text)) {
      return { status: "saved", text };
    }

    if (/Cloud sync is off|Cloud sync is not configured/i.test(text)) {
      return { status: "disabled", text };
    }

    await page.waitForTimeout(500);
  }

  return /Saving scan/i.test(latestText)
    ? { status: "pending", text: latestText }
    : { status: "unknown", text: latestText };
}

async function qaStoragePrefix() {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith("sb-") && key.endsWith("-auth-token"));
    const userId = key && JSON.parse(localStorage.getItem(key) ?? "null")?.user?.id;
    if (!userId) throw new Error("QA fixture requires an authenticated account.");
    return "deep-spec:account:" + encodeURIComponent(userId) + ":";
  });
}

async function seedSavedScans() {
  const prefix = await qaStoragePrefix();
  await page.evaluate(({ lookups, prefix }) => {
    for (const lookup of lookups) localStorage.removeItem(prefix + `inspection-draft:${encodeURIComponent(lookup.id)}`);
    localStorage.setItem(prefix + "deep-spec:lookups", JSON.stringify(lookups));
    localStorage.setItem(prefix + `deep-spec:chat:${lookups[0].id}`, JSON.stringify(lookups[0].chatHistory));
  }, { lookups: createSeedLookups(), prefix });
}

async function seedShopData() {
  const prefix = await qaStoragePrefix();
  await page.evaluate(({ jobId, orgId, lookups, prefix }) => {
    const capturedAt = new Date().toISOString();
    const shopLookups = lookups.map((lookup, index) => index === 0
      ? {
          ...lookup,
          customerVisibleReport: {
            generatedAt: capturedAt,
            summary: "2014 Toyota Camry: battery light and belt noise. Latest DeepSpec result: QA Alternator.",
            title: "QA alternator RO customer report",
          },
          jobId,
          orgId,
          reviewStatus: "needs_review",
          result: {
            ...lookup.result,
            candidateParts: [
              {
                confidence: "high",
                evidence: ["Vented housing", "Pulley face"],
                partName: "QA Alternator",
                scanCategory: "electrical",
              },
              {
                confidence: "medium",
                evidence: ["Nearby cylindrical housing"],
                partName: "Starter motor",
                scanCategory: "electrical",
                whyNotPrimary: "Starter mounting and pulley clues do not match.",
              },
            ],
            fitmentConfidence: "needs_vehicle_context",
            primaryPart: {
              confidence: "high",
              evidence: ["Vented housing and pulley face are visible."],
              partName: "QA Alternator",
              scanCategory: "electrical",
            },
            requiredNextEvidence: ["VIN", "label photo", "second angle"],
          },
          vehicleContext: {
            bayOrRo: "QA RO-77",
            customerName: "QA Customer",
            jobTitle: "QA alternator RO",
            make: "Toyota",
            model: "Camry",
            symptom: "Battery light and belt noise.",
            technicianName: "QA Tech",
            year: "2014",
          },
        }
      : lookup);
    localStorage.setItem(prefix + "deep-spec:lookups", JSON.stringify(shopLookups));
    localStorage.setItem(prefix + `deep-spec:chat:${shopLookups[0].id}`, JSON.stringify(shopLookups[0].chatHistory));
    localStorage.setItem(prefix + "deep-spec:shop:organization", JSON.stringify({
      createdAt: capturedAt,
      id: orgId,
      name: "QA Repair Shop",
      ownerUserId: "qa-owner",
      slug: "qa-repair-shop",
    }));
    localStorage.setItem(prefix + "deep-spec:shop:feedback-permission", JSON.stringify({
      learningOptIn: false,
      orgId,
      updatedAt: capturedAt,
    }));
    localStorage.setItem(prefix + "deep-spec:shop:jobs", JSON.stringify([
      {
        bayOrRo: "QA RO-77",
        createdAt: capturedAt,
        createdByUserId: "qa-owner",
        customerName: "QA Customer",
        engine: "2.5L",
        id: jobId,
        make: "Toyota",
        mileage: "142000",
        model: "Camry",
        notes: "QA seeded shop job.",
        orgId,
        plate: "QA123",
        reviewStatus: "needs_review",
        scanIds: ["qa-alternator-1"],
        status: "in_progress",
        symptom: "Battery light and belt noise.",
        technicianName: "QA Tech",
        title: "QA alternator RO",
        updatedAt: capturedAt,
        vin: "",
        year: "2014",
      },
    ]));
  }, { prefix, jobId: QA_SHOP_JOB_ID, orgId: QA_SHOP_ORG_ID, lookups: createSeedLookups() });
}

function createSeedLookups() {
  const capturedAt = new Date().toISOString();
  const imageBase64 = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w==";

  return [
    {
      analyzedAt: capturedAt,
      chatHistory: [
        {
          content: "The alternator charges the battery while the engine is running.",
          id: "qa-chat-1",
          role: "assistant",
          timestamp: capturedAt,
        },
      ],
      correction: null,
      createdAt: capturedAt,
      frame: {
        capturedAt,
        imageBase64,
      },
      id: "qa-alternator-1",
      notes: "QA seeded saved scan.",
      rating: null,
      result: {
        candidateMatches: [
          {
            confidence: "medium",
            partName: "Starter motor",
            reason: "Similar metal housing, but starter location and wiring differ.",
            scanCategory: "electrical",
          },
        ],
        confidence: "high",
        confidenceRange: { high: 90, low: 78 },
        confidenceScore: 84,
        concerns: ["Confirm pulley alignment before ordering parts."],
        evidence: ["Vented housing", "Pulley face", "Electrical connector"],
        evidenceRegions: [
          {
            label: "Pulley",
            observation: "Round front pulley is visible.",
            regionLabel: "front face",
          },
        ],
        isSafetyCritical: false,
        needsBetterPhoto: false,
        nextAction: "Compare connector shape and pulley offset against the vehicle.",
        partName: "QA Alternator",
        safetyTriage: "can_help",
        scanCategory: "electrical",
        sourceLinks: [],
        visibleObservations: ["Aluminum vented housing and front pulley are visible."],
        whatItDoes: "Charges the battery and powers electrical systems while the engine runs.",
      },
      scanCategory: "electrical",
      trainingLabel: "QA Alternator",
      trainingStatus: "raw_unreviewed",
    },
    {
      analyzedAt: capturedAt,
      chatHistory: [],
      correction: null,
      createdAt: capturedAt,
      frame: {
        capturedAt,
        imageBase64,
      },
      id: "qa-brake-caliper-1",
      notes: "QA second saved scan.",
      rating: "up",
      result: {
        candidateMatches: [],
        confidence: "medium",
        confidenceRange: { high: 80, low: 64 },
        confidenceScore: 72,
        concerns: ["Brake components need professional inspection if leaking or damaged."],
        evidence: ["Caliper body", "Brake hose"],
        evidenceRegions: [],
        isSafetyCritical: true,
        needsBetterPhoto: false,
        nextAction: "Inspect pads, rotor, hose, and mounting hardware.",
        partName: "QA Brake Caliper",
        safetyTriage: "needs_professional",
        scanCategory: "brakes",
        sourceLinks: [],
        visibleObservations: ["Caliper-like body is visible behind the wheel."],
        whatItDoes: "Clamps brake pads against the rotor to slow the vehicle.",
      },
      scanCategory: "brakes",
      trainingLabel: "QA Brake Caliper",
      trainingStatus: "user_confirmed",
    },
  ];
}

async function getStatus(url) {
  try {
    const response = await fetchWithTimeout(url, { method: "GET" }, 8_000);
    return response.status;
  } catch {
    return 0;
  }
}

async function fetchSupabaseAuthSettings(supabaseUrl, supabaseKey) {
  try {
    const response = await fetchWithTimeout(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/settings`, {
      headers: { apikey: supabaseKey },
      method: "GET",
    }, 10_000);
    const body = await response.json().catch(() => null);
    const anonymousEnabled = body?.external?.anonymous_users === true;

    return response.ok && anonymousEnabled
      ? { ok: true, message: "Supabase anonymous sign-ins are enabled." }
      : { ok: false, message: `Supabase anonymous sign-ins are not healthy. HTTP ${response.status}.` };
  } catch (error) {
    return { ok: false, message: `Could not read Supabase Auth settings: ${formatError(error)}` };
  }
}

async function fetchSupabaseSchemaHealth(supabaseUrl, supabaseKey) {
  try {
    const response = await fetchWithTimeout(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/scan_lookups?select=local_id&limit=1`, {
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        apikey: supabaseKey,
      },
      method: "GET",
    }, 10_000);
    const bodyText = await response.text();
    const missingSchema = response.status === 404 || /PGRST205|schema cache|Could not find/i.test(bodyText);

    return missingSchema || response.status >= 500
      ? { ok: false, message: `Supabase scan_lookups schema is not healthy. HTTP ${response.status}: ${bodyText}` }
      : { ok: true, message: `Supabase scan_lookups REST reached HTTP ${response.status}.` };
  } catch (error) {
    return { ok: false, message: `Could not reach Supabase REST: ${formatError(error)}` };
  }
}

async function getOptionalTextByRole(role) {
  try {
    return (await page.getByRole(role).textContent({ timeout: 1_500 }))?.trim() ?? "";
  } catch {
    return "";
  }
}

async function getBodyText() {
  try {
    return await page.locator("body").innerText({ timeout: 2_000 });
  } catch {
    return "";
  }
}

function attachLoggers(activePage) {
  activePage.on("console", (message) => {
    consoleLogs.push({
      location: message.location(),
      text: message.text(),
      type: message.type(),
    });
  });

  activePage.on("pageerror", (error) => {
    pageErrors.push({
      message: error.message,
      stack: error.stack,
    });
  });

  activePage.on("requestfailed", (request) => {
    networkLogs.push({
      failure: request.failure()?.errorText ?? "",
      method: request.method(),
      type: "requestfailed",
      url: request.url(),
    });
  });

  activePage.on("response", (response) => {
    networkLogs.push({
      method: response.request().method(),
      status: response.status(),
      type: "response",
      url: response.url(),
    });
  });
}

function getLastNetworkResponse(path) {
  return networkLogs
    .filter((entry) => entry.type === "response" && entry.url.includes(path))
    .at(-1);
}

async function writeRunReports() {
  const finishedAt = new Date().toISOString();
  const report = buildReport(finishedAt);

  writeJson(join(artifactDir, "console.json"), consoleLogs);
  writeJson(join(artifactDir, "network.json"), networkLogs);
  writeJson(join(artifactDir, "page-errors.json"), pageErrors);
  writeJson(join(artifactDir, "report.json"), report);
  writeText(join(artifactDir, "report.md"), renderMarkdownReport(report));

  console.log(`Real website QA report: ${join(artifactDir, "report.md")}`);

  if (results.some((result) => result.status !== "pass")) {
    process.exitCode = 1;
  }
}

function buildReport(finishedAt) {
  const grouped = {
    authSessionBugs: collectProblems("auth/session"),
    backendBugs: collectProblems("backend"),
    environmentIssues: [
      ...collectProblems("environment"),
      ...collectProblems("missing_env"),
    ],
    frontendBugs: collectProblems("frontend"),
    testBugs: collectProblems("test_bug"),
  };
  const suggestedFixes = unique(results.map((result) => result.suggestedFix).filter(Boolean));
  const likelyFiles = unique(results
    .filter((result) => result.status !== "pass")
    .flatMap((result) => result.likelyFiles ?? []));

  return {
    artifactDir,
    baseUrl,
    consoleLogPath: join(artifactDir, "console.json"),
    evidencePath: artifactDir,
    finishedAt,
    grouped,
    htmlPath: htmlDir,
    likelyFiles,
    networkLogPath: join(artifactDir, "network.json"),
    pageErrorsPath: join(artifactDir, "page-errors.json"),
    passed: results.filter((result) => result.status === "pass").map((result) => result.name),
    results,
    screenshotPath: screenshotDir,
    startedAt,
    suggestedFixes,
    tracePath,
    videoPath: videoDir,
    viewport: viewportProfile,
    failed: results.filter((result) => result.status !== "pass").map((result) => ({
      category: result.category,
      details: result.details,
      name: result.name,
      status: result.status,
    })),
  };
}

function renderMarkdownReport(report) {
  return [
    "# DeepSpec Real Website QA Report",
    "",
    `- Report path: ${join(artifactDir, "report.md")}`,
    `- Base URL: ${report.baseUrl}`,
    `- Viewport: ${report.viewport.name} (${report.viewport.viewport.width} x ${report.viewport.viewport.height})`,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    `- Screenshots/evidence path: ${report.evidencePath}`,
    `- Trace path: ${report.tracePath}`,
    `- Video path: ${report.videoPath}`,
    "",
    "## What Passed",
    renderList(report.passed),
    "",
    "## What Failed",
    renderFailureList(report.failed),
    "",
    "## Frontend Bugs",
    renderProblemList(report.grouped.frontendBugs),
    "",
    "## Backend Bugs",
    renderProblemList(report.grouped.backendBugs),
    "",
    "## Auth/Session Bugs",
    renderProblemList(report.grouped.authSessionBugs),
    "",
    "## Environment Issues",
    renderProblemList(report.grouped.environmentIssues),
    "",
    "## Test Bugs",
    renderProblemList(report.grouped.testBugs),
    "",
    "## Suggested Fixes",
    renderList(report.suggestedFixes),
    "",
    "## Likely Files To Edit",
    renderList(report.likelyFiles),
    "",
    "## Scenario Details",
    "",
    "| Scenario | Status | Category | Details |",
    "| --- | --- | --- | --- |",
    ...report.results.map((result) => `| ${result.name} | ${result.status} | ${result.category} | ${escapeMarkdownTable(result.details)} |`),
    "",
  ].join("\n");
}

function collectProblems(category) {
  return results
    .filter((result) => result.category === category && result.status !== "pass")
    .map((result) => ({
      details: result.details,
      name: result.name,
      suggestedFix: result.suggestedFix,
    }));
}

function resolveViewportProfile(args) {
  const requested = (args.viewport || process.env.QA_VIEWPORT || "desktop").trim().toLowerCase();
  if (requested === "mobile" || requested === "phone") {
    return {
      hasTouch: true,
      isMobile: true,
      name: "mobile-emulated",
      viewport: { height: 844, width: 390 },
    };
  }

  return {
    hasTouch: false,
    isMobile: false,
    name: "desktop",
    viewport: { height: 900, width: 1440 },
  };
}

function getScenarioOrder(requestedScenarios) {
  return requestedScenarios.length > 0 ? requestedScenarios : DEEPSPEC_QA_SCENARIOS;
}

function likelyFilesForScenario(scenario) {
  const mapping = {
    "api-cloud-health": ["api/identify.shared.ts", "api/chat.shared.ts", "src/services/cloudSync.ts", "supabase/migrations"],
    "auth-login": ["src/screens/Auth.tsx", "src/services/auth.ts"],
    "early-access": ["src/screens/EarlyAccess.tsx", "src/services/cloudSync.ts"],
    "result-chat": ["src/screens/Chat.tsx", "api/chat.shared.ts"],
    "result-detail": ["src/screens/Result.tsx", "src/services/storage.ts"],
    "inspection-save-recovery": ["src/components/result/PartInspectionForm.tsx", "src/services/storage.ts", "src/services/report.ts"],
    "saved-history": ["src/screens/History.tsx", "src/services/storage.ts"],
    "shop-onboarding": ["src/screens/Shop.tsx", "src/services/shop.ts"],
    "create-job": ["src/screens/ShopNewJob.tsx", "src/screens/Scanner.tsx", "src/services/shop.ts"],
    "job-scan": ["src/screens/Scanner.tsx", "src/services/shop.ts"],
    "job-result-correction": ["src/screens/Result.tsx", "src/services/storage.ts"],
    "add-vin-after-result": ["src/screens/ShopJob.tsx", "src/services/shop.ts"],
    "second-angle-refinement": ["src/screens/Result.tsx", "src/screens/Scanner.tsx"],
    "shop-history-search": ["src/screens/History.tsx", "src/services/storage.ts"],
    "customer-report-export": ["src/screens/ShopJob.tsx", "src/services/shop.ts"],
    "org-member-permissions": ["src/screens/Shop.tsx", "src/services/shop.ts", "supabase/migrations"],
    "billing-provider-fail-closed": ["api/billing.shared.ts", "src/screens/Pricing.tsx"],
    scanner: ["src/screens/Scanner.tsx"],
    "scanner-ai-engine": ["src/screens/Scanner.tsx", "src/services/aiService.ts", "api/identify.shared.ts"],
  };

  return mapping[scenario] ?? ["scripts/qa/real-website-tester.mjs"];
}

function renderList(items) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function renderFailureList(items) {
  return items.length
    ? items.map((item) => `- ${item.name} (${item.category}): ${item.details}`).join("\n")
    : "- None";
}

function renderProblemList(items) {
  return items.length
    ? items.map((item) => `- ${item.name}: ${item.details}${item.suggestedFix ? ` Suggested fix: ${item.suggestedFix}` : ""}`).join("\n")
    : "- None";
}

function unique(items) {
  return [...new Set(items)];
}

function compactText(value) {
  return value.replace(/\s+/g, " ").trim().slice(0, 600);
}

function isEngineRecognitionMiss(text) {
  const lower = text.toLowerCase();
  if (
    /\b(unknown component|unidentified|vehicle component|placeholder|does not depict a real car part|please upload a clear photograph)\b/.test(lower)
    || /\b(20-40%|25-40%|low confidence)\b/.test(lower)
  ) {
    return true;
  }

  return !/\b(engine|motor|alternator|intake|manifold|oil cap|valve cover|serpentine|pulley|engine bay)\b/.test(lower);
}

function escapeMarkdownTable(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
