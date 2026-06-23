import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const DEFAULT_BASE_URL = "http://127.0.0.1:5175";
const EXTERNAL_IMAGE_DIR = path.resolve("artifacts", "qa", "external-images-20260616");

const CASES = [
  {
    slug: "hf-parts-car-100",
    localImage: path.join(EXTERNAL_IMAGE_DIR, "hf-parts-car-100.png"),
    expectedLabels: ["door", "car door"],
    forbiddenPatterns: [],
  },
  {
    slug: "hf-parts-car-1031",
    localImage: path.join(EXTERNAL_IMAGE_DIR, "hf-parts-car-1031.jpg"),
    expectedLabels: ["front bumper", "bumper"],
    forbiddenPatterns: [],
  },
  {
    slug: "hf-damage-101",
    localImage: path.join(EXTERNAL_IMAGE_DIR, "hf-damage-101.png"),
    expectedLabels: ["front bumper", "bumper", "damage"],
    forbiddenPatterns: [],
  },
  {
    slug: "hf-damage-102",
    localImage: path.join(EXTERNAL_IMAGE_DIR, "hf-damage-102.jpg"),
    expectedLabels: ["front passenger side door", "front door", "door", "fender"],
    forbiddenPatterns: ["quarter[- ]panel", "^dent$"],
  },
];

const baseUrl = process.env.QA_BASE_URL?.trim() || DEFAULT_BASE_URL;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.resolve("artifacts", "qa", `external-public-ar-${stamp}`);
const screenshotDir = path.join(outputDir, "screenshots");

await mkdir(screenshotDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const testCase of CASES) {
    results.push(await runCase(browser, testCase));
  }
} finally {
  await browser.close();
}

const passed = results.filter((result) => result.passed).length;
const summary = {
  baseUrl,
  generatedAt: new Date().toISOString(),
  grade: Math.round((passed / results.length) * 10),
  outputDir,
  passed,
  results,
  total: results.length,
};

await writeFile(path.join(outputDir, "external-public-ar-qa.json"), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(path.join(outputDir, "external-public-ar-qa.md"), renderMarkdown(summary));

console.log(JSON.stringify({
  failures: results
    .filter((result) => !result.passed)
    .map((result) => ({
      error: result.error,
      firstLabel: result.firstLabel,
      forbidden: result.forbidden,
      identifyResponses: result.identifyResponses,
      matchedLabels: result.matchedLabels,
      overlayIsSpecific: result.overlayIsSpecific,
      slug: result.slug,
    })),
  grade: summary.grade,
  outputDir,
  passed,
  total: results.length,
}, null, 2));

process.exitCode = passed === results.length ? 0 : 1;

async function runCase(browserInstance, testCase) {
  const page = await browserInstance.newPage({
    isMobile: true,
    viewport: { height: 915, width: 412 },
  });
  const identifyResponses = [];
  const started = Date.now();

  page.on("response", (response) => {
    if (response.url().includes("/api/identify")) {
      identifyResponses.push({
        method: response.request().method(),
        status: response.status(),
        url: response.url(),
      });
    }
  });

  try {
    await enterNoEmailSession(page);
    await page.getByLabel("Upload photo").setInputFiles(testCase.localImage);
    await page.waitForSelector("[data-testid=\"lens-primary-label\"]", { timeout: 60_000 });
    await page.waitForSelector("[data-testid=\"lens-part-overlay-0\"]", { timeout: 10_000 });
    await page.waitForSelector("[data-testid=\"lens-context-overlay\"]", { timeout: 10_000 });

    const screenshot = path.join(screenshotDir, `${testCase.slug}.png`);
    await page.screenshot({ fullPage: true, path: screenshot });

    const firstLabel = (await page.locator("[data-testid=\"lens-primary-label\"]").first().innerText()).trim();
    const text = await page.locator("body").innerText();
    const textLower = text.toLowerCase();
    const forbiddenPatterns = testCase.forbiddenPatterns.map((pattern) => new RegExp(pattern, "i"));
    const matchedLabels = testCase.expectedLabels.filter((label) => textLower.includes(label.toLowerCase()));
    const forbidden = forbiddenPatterns.some((pattern) => pattern.test(firstLabel) || pattern.test(text));
    const partBox = await page.locator("[data-testid=\"lens-part-overlay-0\"]").boundingBox();
    const contextBox = await page.locator("[data-testid=\"lens-context-overlay\"]").boundingBox();
    const hasGenericBad = /^(unidentified|unknown component|vehicle component)|^deep spec\s+/i.test(firstLabel);
    const overlayIsSpecific = isSpecificOverlay(partBox, contextBox);
    const passed = identifyResponses.some((response) => response.status === 200)
      && matchedLabels.length > 0
      && !forbidden
      && !hasGenericBad
      && overlayIsSpecific;

    return {
      ...testCase,
      elapsedMs: Date.now() - started,
      firstLabel,
      forbidden,
      hasGenericBad,
      identifyResponses,
      matchedLabels,
      overlayIsSpecific,
      partBox,
      contextBox,
      passed,
      screenshot,
      text,
    };
  } catch (error) {
    const screenshot = path.join(screenshotDir, `${testCase.slug}-error.png`);
    await page.screenshot({ fullPage: true, path: screenshot }).catch(() => undefined);
    const partialState = await getPartialState(page).catch(() => ({}));

    return {
      ...testCase,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
      identifyResponses,
      ...partialState,
      passed: false,
      screenshot,
    };
  } finally {
    await page.close();
  }
}

async function getPartialState(page) {
  const firstLabel = await page.locator("[data-testid=\"lens-primary-label\"]").first().innerText({ timeout: 500 }).catch(() => undefined);
  const text = await page.locator("body").innerText({ timeout: 500 }).catch(() => undefined);
  const partBox = await page.locator("[data-testid=\"lens-part-overlay-0\"]").boundingBox({ timeout: 500 }).catch(() => null);
  const contextBox = await page.locator("[data-testid=\"lens-context-overlay\"]").boundingBox({ timeout: 500 }).catch(() => null);
  return {
    ...(firstLabel ? { firstLabel: firstLabel.trim() } : {}),
    ...(text ? { text } : {}),
    partBox,
    contextBox,
    overlayIsSpecific: isSpecificOverlay(partBox, contextBox),
  };
}

async function enterNoEmailSession(page) {
  await page.goto(`${baseUrl}/auth`, { timeout: 45_000, waitUntil: "domcontentloaded" });
  await page.getByText("No email", { exact: true }).click({ timeout: 45_000 });
  await page.getByRole("button", { name: /continue without email/i }).click({ timeout: 45_000 });
  await page.waitForSelector("input[type=\"file\"]", { timeout: 45_000 });
}

function isSpecificOverlay(partBox, contextBox) {
  if (!partBox || !contextBox) {
    return false;
  }

  const partArea = partBox.width * partBox.height;
  const contextArea = contextBox.width * contextBox.height;
  return partBox.width > 24 && partBox.height > 24 && contextArea > partArea * 1.4;
}

function renderMarkdown(summary) {
  const rows = summary.results.map((result) => [
    result.slug,
    result.passed ? "pass" : "fail",
    result.firstLabel ?? "",
    (result.matchedLabels ?? []).join(", ") || "none",
    result.overlayIsSpecific ? "yes" : "no",
    result.forbidden ? "yes" : "no",
    result.screenshot,
  ]);

  return [
    "# DeepSpec External AR QA",
    "",
    `- Base URL: ${summary.baseUrl}`,
    `- Generated: ${summary.generatedAt}`,
    `- Grade: ${summary.grade}/10`,
    `- Passed: ${summary.passed}/${summary.total}`,
    `- Output: ${summary.outputDir}`,
    "",
    "| Image | Status | First label | Matched labels | Specific AR overlay | Forbidden text | Screenshot |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.map(escapeTableCell).join(" | ")} |`),
    "",
  ].join("\n");
}

function escapeTableCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}
