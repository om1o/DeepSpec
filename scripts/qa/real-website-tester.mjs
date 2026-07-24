import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEEPSPEC_QA_SCENARIOS,
  classifyIdentifyApiIssue,
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

const scenarioHandlers = {
  "api-cloud-health": runApiCloudHealth,
  "auth-login": runAuthLogin,
  "early-access": runEarlyAccess,
  "result-chat": runResultChat,
  "result-detail": runResultDetail,
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
        status: "fail",
        suggestedFix: error.suggestedFix,
      };
    } else {
      result = {
        category: "frontend",
        details: formatError(error),
        likelyFiles: likelyFilesForScenario(scenario),
        name: scenario,
        status: "fail",
        suggestedFix: "Reproduce the route manually with the saved trace and screenshot, then fix the first visible UI or runtime error.",
      };
    }
  } finally {
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

async function runScannerAiEngine() {
  await requireAuthForProtectedRoute("scanner-ai-engine");
  const routeStartedAtMs = Date.now();
  await gotoPath("/scan");
  await getUploadPhotoButton().waitFor({ state: "visible", timeout: 7_000 });
  const uploadInput = page.getByLabel(/Upload photo/i);
  await uploadInput.waitFor({ state: "attached", timeout: 7_000 });
  const controlsReadyMs = Date.now() - routeStartedAtMs;
  const fixture = await createEngineFixture();

  const uploadStartedAtMs = Date.now();
  await uploadInput.setInputFiles(fixture.path);
  const outcome = await waitForScannerAiOutcome();
  const analysisMs = Date.now() - uploadStartedAtMs;
  const lastIdentifyResponse = getLastNetworkResponse("/api/identify");
  const timingSummary = `scanner controls=${controlsReadyMs}ms, engine upload+AI=${analysisMs}ms, /api/identify=${lastIdentifyResponse?.status ?? "not observed"}`;

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
        "backend",
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
  await expectText(/QA Alternator/i, "seeded saved scan", "frontend", ["src/screens/History.tsx", "src/services/storage.ts"]);

  return {
    details: "Saved scan history rendered seeded local QA scans.",
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

  return {
    details: "Saved result detail rendered the simple answer and Ask action.",
    likelyFiles: ["src/screens/Result.tsx", "src/services/storage.ts"],
    status: "pass",
  };
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
  await expectText(/Paid access remains fail-closed/i, "fail-closed paid copy", "frontend", ["src/screens/Account.tsx"]);

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
  await expectText(/Saved scan tools/i, "collapsed saved scan tools", "frontend", ["src/screens/Result.tsx"]);

  return {
    details: "Job result rendered the simple answer first and kept saved scan tools collapsed.",
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
    throw new QaIssue(
      "backend",
      failures.join(" "),
      {
        likelyFiles: ["api/identify.shared.ts", "api/chat.shared.ts", "src/services/cloudSync.ts", "scripts/verify-supabase-sync.mjs", "supabase/migrations"],
        suggestedFix: "Fix API method guards or Supabase schema/Auth health, then rerun `npm run qa:doctor` before calling it a product bug.",
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
    throw new QaIssue(
      "auth/session",
      `${scenario} is blocked because auth-login did not establish a verified DeepSpec session.`,
      {
        likelyFiles: ["src/services/auth.ts", "src/screens/Auth.tsx", "scripts/verify-auth-flows.mjs"],
        suggestedFix: "Fix the auth-login failure first; protected DeepSpec routes should not be tested through a bypass.",
      },
    );
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

async function waitForScannerAiOutcome() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
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
  const deadline = Date.now() + 20_000;
  let latestText = compactText(await getBodyText());

  while (Date.now() < deadline) {
    const text = compactText(await getBodyText());
    latestText = text;

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

async function seedSavedScans() {
  await page.evaluate((lookups) => {
    localStorage.setItem("deep-spec:lookups", JSON.stringify(lookups));
    localStorage.setItem(`deep-spec:chat:${lookups[0].id}`, JSON.stringify(lookups[0].chatHistory));
  }, createSeedLookups());
}

async function seedShopData() {
  await page.evaluate(({ jobId, orgId, lookups }) => {
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
    localStorage.setItem("deep-spec:lookups", JSON.stringify(shopLookups));
    localStorage.setItem(`deep-spec:chat:${shopLookups[0].id}`, JSON.stringify(shopLookups[0].chatHistory));
    localStorage.setItem("deep-spec:shop:organization", JSON.stringify({
      createdAt: capturedAt,
      id: orgId,
      name: "QA Repair Shop",
      ownerUserId: "qa-owner",
      slug: "qa-repair-shop",
    }));
    localStorage.setItem("deep-spec:shop:feedback-permission", JSON.stringify({
      learningOptIn: false,
      orgId,
      updatedAt: capturedAt,
    }));
    localStorage.setItem("deep-spec:shop:jobs", JSON.stringify([
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
  }, { jobId: QA_SHOP_JOB_ID, orgId: QA_SHOP_ORG_ID, lookups: createSeedLookups() });
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
