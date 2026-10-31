/* global document, window */
// Local-only regression QA with synthetic authentication. Never calls a model or live account.
// Start Vite with synthetic VITE_SUPABASE_URL=https://repair-fixture.supabase.co,
// VITE_SUPABASE_PUBLISHABLE_KEY=synthetic-public-key, VITE_DEEPSPEC_PROMPTABLE_SEG=false,
// VITE_DEEPSPEC_SEGMENTATION=false and VITE_ENABLE_ON_DEVICE_FALLBACK=false.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.REPAIR_QA_BASE_URL || "http://127.0.0.1:5178";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "This fixture run must stay local.");
const output = "artifacts/qa/repair-intro-auth-2026-10-29";
await mkdir(output, { recursive: true });
const user = {
  id: "00000000-0000-4000-8000-000000000001", email: "repair-fixture@example.invalid",
  aud: "authenticated", role: "authenticated", is_anonymous: false,
  app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {},
  created_at: "2026-01-01T00:00:00Z", email_confirmed_at: "2026-01-01T00:00:00Z",
};
const jwt = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"), Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated", aud: "authenticated" })).toString("base64url"), "synthetic-signature"].join(".");
const session = { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "synthetic-refresh", user };
const report = { scope: "Local Vite + Chromium with synthetic intercepted auth/API only; no live AI, hosted, phone, or real account acceptance.", checks: [], blockedExternalHosts: [], pageErrors: [] };
const browser = await chromium.launch({ executablePath: process.env.REPAIR_QA_CHROMIUM || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
try {
  for (const [width, height, reduced] of [[1440, 1000, false], [390, 844, false], [320, 740, true]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: reduced ? "reduce" : "no-preference", serviceWorkers: "block" });
    let signedIn = false;
    await context.route("**/*", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === new URL(base).origin) {
        if (url.pathname === "/api/account-entitlement") return route.fulfill({ json: { entitlement: { status: "free", scanAllowance: 5, scansUsed: 0, verifiedAt: new Date().toISOString() } } });
        if (url.pathname.startsWith("/api/")) throw new Error(`Unexpected API request ${url.pathname}`);
        return route.continue();
      }
      if (url.hostname === "repair-fixture.supabase.co") {
        if (url.pathname === "/auth/v1/token") { signedIn = true; return route.fulfill({ json: session }); }
        if (url.pathname === "/auth/v1/user") return route.fulfill(signedIn ? { json: user } : { status: 401, json: { msg: "Fixture signed out" } });
        if (url.pathname === "/auth/v1/logout") { signedIn = false; return route.fulfill({ status: 204 }); }
        if (url.pathname.startsWith("/rest/v1/")) return route.fulfill({ json: [], headers: { "content-range": "0-0/0" } });
        throw new Error(`Unexpected fixture request ${url.pathname}`);
      }
      report.blockedExternalHosts.push(url.hostname);
      return route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    page.on("pageerror", error => report.pageErrors.push({ width, message: error.message }));
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.location.pathname === "/intro/index.html");
    await page.locator("a.header-sign-in").waitFor();
    assert.equal(await page.locator("[data-entry][href='/auth']").count(), 13);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Intro horizontal overflow");
    await page.screenshot({ path: `${output}/${width}-intro.png`, fullPage: true });
    const entry = page.locator("a.header-sign-in");
    if (!reduced) {
      await entry.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape");
      assert.ok(await entry.evaluate(element => element === document.activeElement));
      assert.equal(new URL(page.url()).pathname, "/intro/index.html");
    }
    await entry.click();
    await page.waitForURL("**/auth");
    await page.getByRole("heading", { name: "Sign in to DeepSpec" }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Auth horizontal overflow");
    await page.screenshot({ path: `${output}/${width}-auth.png`, fullPage: true });
    await page.goto(`${base}/history`);
    await page.waitForURL("**/auth");
    await page.getByRole("heading", { name: "Sign in to DeepSpec" }).waitFor();
    await page.getByPlaceholder("you@example.com").fill(user.email);
    await page.getByPlaceholder("Your password").fill("synthetic-password");
    await page.getByRole("button", { name: "Sign in to scanner", exact: true }).click();
    await page.waitForURL("**/history");
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
    // Seed a labelled fixture through the real device-save API; this does not test inference/upload.
    const savedId = await page.evaluate(async () => {
      const { createLookup } = await import("/src/services/storage.ts");
      const saved = createLookup({
        frame: { imageBase64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV5kAAAAASUVORK5CYII=", capturedAt: new Date().toISOString() },
        result: { partName: "Synthetic QA brake component", confidence: "medium", scanCategory: "part", candidateMatches: [], whatItDoes: "Synthetic QA fixture only.", visibleObservations: [], concerns: [], safetyTriage: "can_help", isSafetyCritical: false, nextAction: "Review synthetic QA record.", needsBetterPhoto: false, evidence: [], sourceLinks: [], modelRun: { provider: "on-device", model: "fixture", latencyMs: 0, ocrUsed: false } },
      });
      if (!saved.ok) throw new Error(saved.message);
      return saved.value.id;
    });
    await page.reload();
    await page.getByText("Synthetic QA brake component", { exact: true }).first().waitFor();
    await page.goto(`${base}/result/${savedId}`);
    await page.getByText("Synthetic QA brake component", { exact: true }).first().waitFor();
    await page.reload();
    await page.getByText("Synthetic QA brake component", { exact: true }).first().waitFor();
    await page.screenshot({ path: `${output}/${width}-saved-result.png`, fullPage: true });
    await page.goto(base);
    await page.waitForURL("**/scan");
    await page.getByRole("button", { name: "Upload photo", exact: true }).first().waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Scanner horizontal overflow");
    await page.screenshot({ path: `${output}/${width}-scanner.png`, fullPage: true });
    await page.goto(`${base}/history`);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL("**/auth");
    await page.goto(`${base}/history`);
    await page.waitForURL("**/auth");
    assert.ok(await page.evaluate(id => localStorage.getItem(`deep-spec:account:${id}:deep-spec:lookups`)?.includes("Synthetic QA brake component"), user.id), "Sign-out must preserve account device bytes");
    report.checks.push({ width, height, reducedMotion: reduced, status: "passed", checks: ["signed-out root intro", "13 account entry links", "intro/auth/scanner no horizontal overflow", "keyboard Enter/Escape focus return (normal motion)", "intro transition to login", "direct history blocked", "synthetic password login returns to requested history", "authenticated refresh", "synthetic device fixture save/history/detail/reload", "signed-in root skips intro", "authenticated scanner", "sign out locks history"] });
    await context.close();
  }
  assert.equal(report.pageErrors.length, 0, "Unexpected browser page errors");
} catch (error) {
  report.failure = error.stack;
  process.exitCode = 1;
} finally {
  report.blockedExternalHosts = [...new Set(report.blockedExternalHosts)];
  await browser.close();
  await writeFile(`${output}/results.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
