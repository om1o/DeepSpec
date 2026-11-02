import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { preview } from "vite";

// Isolated guest build + browser contexts, synthetic records, no external API calls.
// This checks UI integration, not real authentication, AI accuracy or cloud RLS.
const artifactDir = join(process.cwd(), "artifacts", "browser-smoke");
mkdirSync(artifactDir, { recursive: true });
const report = { mode: "synthetic guest UI", checks: [], errors: [], passed: false };
let server;
let browser;
try {
  const build = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--configLoader", "native", "--outDir", "artifacts/browser-smoke/dist"], {
    stdio: "inherit",
    env: { ...process.env, DEEPSPEC_GUEST_PREVIEW: "true", VERCEL_ENV: "preview", VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" },
  });
  assert.equal(build.status, 0, "Isolated smoke build must succeed");
  server = await preview({ configFile: false, build: { outDir: "artifacts/browser-smoke/dist" }, preview: { host: "127.0.0.1", port: 0 } });
  const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: "block" });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on("pageerror", (error) => report.errors.push(error.message));
    // Prevent the test from spending credits, fetching model weights or touching a real account.
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (["data:", "blob:"].includes(url.protocol)) return route.continue();
      if (url.origin !== baseUrl) return route.abort();
      if (url.pathname.startsWith("/api/")) {
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "service_unavailable", message: "Synthetic UI test: live services are not enabled." } }) });
      }
      return route.continue();
    });
    try {
      await page.goto(`${baseUrl}/scan`);
      await page.getByRole("heading", { name: "Turn on the camera", exact: true }).waitFor();
      assert.ok(await page.getByRole("button", { name: "Upload photo", exact: true }).first().isVisible(), "Camera denial must retain upload fallback");
      await capture(page, viewport, "scanner");

      const lookup = fixtureLookup();
      await page.evaluate((record) => {
        const id = localStorage.getItem("deep-spec:guest-preview:browser-id");
        if (!id) throw new Error("Smoke build did not create an isolated guest namespace");
        const prefix = `deep-spec:guest-preview:${encodeURIComponent(id)}:`;
        localStorage.setItem(prefix + "deep-spec:lookups", JSON.stringify([record]));
        // This unrelated latest scan must NEVER appear for a missing saved ID.
        sessionStorage.setItem(prefix + "deep-spec:latest-scan-state", JSON.stringify({ frame: record.frame, result: { ...record.result, partName: "Unrelated latest scan" } }));
      }, lookup);
      await page.goto(`${baseUrl}/history`);
      await page.getByRole("heading", { name: "Saved scans", exact: true }).waitFor();
      await page.getByRole("link", { name: /UI fixture alternator/ }).first().click();
      await page.getByRole("heading", { level: 1, name: "UI fixture alternator", exact: true }).waitFor();
      await page.reload();
      await page.getByRole("heading", { level: 1, name: "UI fixture alternator", exact: true }).waitFor();
      assert.equal(await page.getByRole("img", { name: "Captured car part", exact: true }).getAttribute("src"), lookup.frame.imageBase64);
      await page.getByRole("button", { name: "Why or why not", exact: true }).click();
      assert.equal(await page.evaluate(() => {
        const id = localStorage.getItem("deep-spec:guest-preview:browser-id");
        return JSON.parse(localStorage.getItem(`deep-spec:guest-preview:${encodeURIComponent(id)}:deep-spec:lookups`))[0].rating;
      }), null, "Opening a note must not record a negative rating");
      await capture(page, viewport, "result");
      await page.getByRole("button", { name: "Incorrect", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "Incorrect", exact: true }).getAttribute("aria-pressed"), "true");
      await page.getByRole("button", { name: "Correct", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "Correct", exact: true }).getAttribute("aria-pressed"), "true");
      await page.getByRole("tab", { name: "Text output", exact: true }).click();
      await page.getByRole("region", { name: "Text output", exact: true }).waitFor();
      await page.getByRole("tab", { name: "Sources", exact: true }).click();
      await page.getByRole("tabpanel", { name: "Sources", exact: true }).waitFor();
      await page.goto(`${baseUrl}/result/${lookup.id}/chat`);
      await page.getByRole("heading", { name: "Ask DeepSpec", exact: true }).waitFor();
      await page.getByRole("heading", { name: lookup.result.partName, exact: true }).waitFor();
      assert.equal(await page.getByRole("img", { name: `Saved photo of ${lookup.result.partName}`, exact: true }).getAttribute("src"), lookup.frame.imageBase64);
      await capture(page, viewport, "chat");

      await page.goto(`${baseUrl}/result/missing-ui-fixture`);
      await page.getByRole("heading", { name: /saved scan.*(?:not found|unavailable)|scan not found|open a saved scan/i }).waitFor();
      assert.equal(await page.getByRole("heading", { name: "Unrelated latest scan", exact: true }).count(), 0);
      assert.equal(await page.getByRole("img", { name: "Captured car part", exact: true }).count(), 0);
      await capture(page, viewport, "missing-result");

      for (const route of ["early-access", "account", "pricing", "shop/new"]) {
        await page.goto(`${baseUrl}/${route}`);
        await page.locator("h1").waitFor();
        await capture(page, viewport, route.replaceAll("/", "-"));
      }
      report.checks.push({ viewport, status: "passed", coverage: "camera-denial upload fallback availability, device history, saved result reload/image, neutral and explicit feedback, result tabs, exact chat photo/context, missing-ID isolation, customer routes, horizontal overflow" });
    } catch (error) {
      await page.screenshot({ path: join(artifactDir, `${viewport.width}-failure.png`), fullPage: true }).catch(() => {});
      throw error;
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(report.errors, [], "Browser must not emit uncaught JavaScript errors");
  report.passed = true;
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
  writeFileSync(join(artifactDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Browser smoke ${report.passed ? "passed" : "failed"}; evidence: ${artifactDir}`);
}

async function capture(page, viewport, name) {
  const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth + 1);
  assert.equal(overflow, false, `${name} must not overflow at ${viewport.width}px`);
  await page.screenshot({ path: join(artifactDir, `${viewport.width}-${name}.png`), fullPage: true });
}

function fixtureLookup() {
  const now = new Date().toISOString();
  return {
    id: "ui-smoke-fixture", createdAt: now,
    frame: { imageBase64: `data:image/jpeg;base64,${readFileSync("public/test-fixtures/engine-scan-test.jpg").toString("base64")}`, capturedAt: now },
    result: {
      partName: "UI fixture alternator", confidence: "low", scanCategory: "electrical", candidateMatches: [],
      whatItDoes: "Synthetic display fixture, not a live identification.", visibleObservations: ["Fixture photo"], evidenceRegions: [],
      concerns: [], safetyTriage: "can_help", isSafetyCritical: false, nextAction: "Check the visible label.", needsBetterPhoto: false,
      evidence: ["Synthetic UI test record"], sourceLinks: [],
    },
    rating: null, correction: null, notes: "", scanCategory: "electrical", trainingLabel: "UI fixture alternator",
    trainingStatus: "raw_unreviewed", chatHistory: [], provenance: { analysisSource: "ai_detection", captureMode: "upload", savedAt: now },
  };
}
