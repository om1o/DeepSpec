import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const DEFAULT_BASE_URL = "http://127.0.0.1:5175";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const IMAGE_DIR = path.resolve("artifacts", "qa", "web-images-commons");
const BETWEEN_CASE_DELAY_MS = Number(process.env.QA_WEB_AR_CASE_DELAY_MS ?? 15_000);
const RETRY_DELAYS_MS = parseRetryDelays(process.env.QA_WEB_AR_RETRY_DELAYS_MS);
const SCAN_TIMEOUT_MS = parsePositiveInteger(process.env.QA_WEB_AR_SCAN_TIMEOUT_MS, 180_000);

const CASES = [
  {
    slug: "commons-fender-damage",
    fileTitle: "File:Car damage on fender observed in a parking lot.jpg",
    expectedLabels: ["fender", "front fender"],
    forbiddenPatterns: ["quarter[- ]panel", "^dent$"],
  },
  {
    slug: "commons-broken-front-bumper",
    fileTitle: "File:Broken car front bumper.jpg",
    expectedLabels: ["front bumper", "bumper"],
    forbiddenPatterns: ["quarter[- ]panel", "^damage$"],
  },
  {
    slug: "commons-car-headlamp",
    fileTitle: "File:Car headlamp.JPG",
    expectedLabels: ["headlight", "headlamp"],
    forbiddenPatterns: ["tail\\s*light", "taillight"],
  },
  {
    slug: "commons-disc-brake",
    fileTitle: "File:Disk brake dsc03682.jpg",
    expectedLabels: ["disc brake", "disk brake", "brake rotor", "brake disc", "rotor", "brake caliper"],
    forbiddenPatterns: ["wheel cover", "hubcap"],
  },
  {
    slug: "commons-broken-side-mirror",
    fileTitle: "File:Broken car side mirror with wires and parts exposed in a garage.jpg",
    expectedLabels: ["side mirror", "mirror"],
    forbiddenPatterns: ["headlight", "tail\\s*light", "taillight"],
  },
  {
    slug: "commons-broken-taillight",
    fileTitle: "File:Damaged red car with broken taillight on a gravel surface near other vehicles in a repair area.jpg",
    expectedLabels: ["tail light", "taillight", "tail lamp", "rear light"],
    forbiddenPatterns: ["headlight", "front bumper"],
  },
  {
    slug: "commons-radiator",
    fileTitle: "File:Radiateur de voiture - 2.jpg",
    expectedLabels: ["radiator"],
    forbiddenPatterns: ["grille", "bumper"],
  },
  {
    slug: "commons-engine-bay",
    fileTitle: "File:2023 Subaru Outback Limited 2.5 liter 4 cyl engine bay.jpg",
    expectedLabels: ["engine", "engine assembly", "engine bay"],
    forbiddenPatterns: ["unknown component", "vehicle component", "^radiator", "radiator in engine bay"],
  },
];

const baseUrl = process.env.QA_BASE_URL?.trim() || DEFAULT_BASE_URL;
const selectedCaseSlugs = parseSelectedCaseSlugs(process.env.QA_WEB_AR_CASES);
const selectedCases = selectedCaseSlugs.length
  ? CASES.filter((testCase) => selectedCaseSlugs.includes(testCase.slug))
  : CASES;
if (!selectedCases.length) {
  throw new Error(`No web AR cases matched QA_WEB_AR_CASES=${process.env.QA_WEB_AR_CASES}`);
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.resolve("artifacts", "qa", `web-public-ar-${stamp}`);
const screenshotDir = path.join(outputDir, "screenshots");
const downloadedDir = path.join(outputDir, "images");

await mkdir(screenshotDir, { recursive: true });
await mkdir(downloadedDir, { recursive: true });
await mkdir(IMAGE_DIR, { recursive: true });

const hydratedCases = [];
for (const testCase of selectedCases) {
  hydratedCases.push(await hydrateCase(testCase));
}

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const testCase of hydratedCases) {
    results.push(await runCaseWithRetries(browser, testCase));
    await new Promise((resolve) => setTimeout(resolve, BETWEEN_CASE_DELAY_MS));
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
  sources: hydratedCases.map(toSourceSummary),
  total: results.length,
};

await writeFile(path.join(outputDir, "web-public-ar-qa.json"), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(path.join(outputDir, "web-public-ar-qa.md"), renderMarkdown(summary));

console.log(JSON.stringify({
  failures: results
    .filter((result) => !result.passed)
    .map((result) => ({
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

async function runCaseWithRetries(browserInstance, testCase) {
  const attempts = [];
  for (const delayMs of RETRY_DELAYS_MS) {
    if (delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const result = await runCase(browserInstance, {
      ...testCase,
      slug: attempts.length ? `${testCase.slug}-retry-${attempts.length}` : testCase.slug,
    });
    attempts.push(result);
    if (result.passed || !isRetryableProviderResult(result)) {
      return attempts.length === 1 ? result : { ...result, attempts };
    }
  }

  const finalResult = attempts.at(-1);
  return { ...finalResult, attempts };
}

async function hydrateCase(testCase) {
  const source = await fetchCommonsSource(testCase.fileTitle);
  const ext = getExtension(source.mime);
  const cachedImage = path.join(IMAGE_DIR, `${testCase.slug}${ext}`);
  const localImage = path.join(downloadedDir, `${testCase.slug}${ext}`);
  const imageBytes = await getOrDownloadImage([source.thumbUrl, source.url].filter(Boolean), cachedImage);
  await writeFile(localImage, imageBytes);

  return {
    ...testCase,
    commonsPage: source.descriptionUrl,
    license: source.license,
    licenseShortName: source.licenseShortName,
    localImage,
    originalUrl: source.url,
    sourceAuthor: source.artist,
    thumbUrl: source.thumbUrl,
  };
}

async function fetchCommonsSource(fileTitle) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    iiextmetadatafilter: "License|LicenseShortName|Artist",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: "1400",
    origin: "*",
    prop: "imageinfo",
    titles: fileTitle,
  });
  const response = await fetch(`${COMMONS_API}?${params.toString()}`, {
    headers: { "User-Agent": "DeepSpec QA/1.0 (local release verification)" },
  });
  if (!response.ok) {
    throw new Error(`Commons metadata failed for ${fileTitle}: HTTP ${response.status}`);
  }

  const data = await response.json();
  const page = Object.values(data.query?.pages ?? {})[0];
  const imageInfo = page?.imageinfo?.[0];
  if (!imageInfo?.url) {
    throw new Error(`Commons metadata did not include an image URL for ${fileTitle}`);
  }

  return {
    artist: stripHtml(imageInfo.extmetadata?.Artist?.value ?? ""),
    descriptionUrl: imageInfo.descriptionurl,
    license: stripHtml(imageInfo.extmetadata?.License?.value ?? ""),
    licenseShortName: stripHtml(imageInfo.extmetadata?.LicenseShortName?.value ?? ""),
    mime: imageInfo.mime,
    thumbUrl: imageInfo.thumburl,
    url: imageInfo.url,
  };
}

async function getOrDownloadImage(urls, cachedImage) {
  try {
    return await readFile(cachedImage);
  } catch {
    let lastStatus = 0;
    for (const url of urls) {
      for (const delayMs of [0, 1_000, 3_000, 7_000]) {
        if (delayMs) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        const response = await fetch(url, {
          headers: { "User-Agent": "DeepSpec QA/1.0 (local release verification; contact local QA)" },
        });
        lastStatus = response.status;
        if (response.ok) {
          const bytes = Buffer.from(await response.arrayBuffer());
          await writeFile(cachedImage, bytes);
          return bytes;
        }

        if (response.status !== 429 && response.status < 500) {
          break;
        }
      }
    }

    throw new Error(`Image download failed: HTTP ${lastStatus}`);
  }
}

function toSourceSummary(testCase) {
  return {
    commonsPage: testCase.commonsPage,
    expectedLabels: testCase.expectedLabels,
    fileTitle: testCase.fileTitle,
    forbiddenPatterns: testCase.forbiddenPatterns,
    license: testCase.license,
    licenseShortName: testCase.licenseShortName,
    originalUrl: testCase.originalUrl,
    slug: testCase.slug,
    sourceAuthor: testCase.sourceAuthor,
    thumbUrl: testCase.thumbUrl,
  };
}

function parseSelectedCaseSlugs(value) {
  return value
    ? value.split(",").map((slug) => slug.trim()).filter(Boolean)
    : [];
}

function parseRetryDelays(value) {
  const parsed = value
    ? value.split(",").map((delay) => Number(delay.trim())).filter((delay) => Number.isFinite(delay) && delay >= 0)
    : [];
  return parsed.length ? parsed : [0, 30_000, 90_000];
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

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
    await waitForScanResultOrIssue(page);
    if (await hasScanIssue(page)) {
      throw new Error("Scan completed with a visible AI service issue.");
    }
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
    const hasGenericBad = /^(unidentified|unknown component|vehicle component|car part|body panel)|^deep spec\s+/i.test(firstLabel);
    const overlayIsSpecific = isSpecificOverlay(partBox, contextBox);
    const hasRenderedResult = Boolean(firstLabel);
    const passed = hasRenderedResult
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

async function waitForScanResultOrIssue(page) {
  await page.waitForFunction(() => {
    const hasLabel = Boolean(globalThis.document.querySelector("[data-testid=\"lens-primary-label\"]"));
    const text = globalThis.document.body?.innerText ?? "";
    return hasLabel || /SCAN ISSUE|Too many AI lookups|Could not reach the Deep Spec AI service/i.test(text);
  }, undefined, { timeout: SCAN_TIMEOUT_MS });
}

async function hasScanIssue(page) {
  const text = await page.locator("body").innerText({ timeout: 500 }).catch(() => "");
  return /SCAN ISSUE|Too many AI lookups|Could not reach the Deep Spec AI service/i.test(text);
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

function isRetryableProviderResult(result) {
  if (result.identifyResponses?.some((response) => response.status === 429 || response.status >= 500)) {
    return true;
  }

  return !result.identifyResponses?.length
    && /could not reach|too many ai lookups|timeout|network/i.test([result.error, result.text].filter(Boolean).join(" "));
}

function getExtension(mime) {
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  return ".jpg";
}

function stripHtml(value) {
  return String(value)
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function renderMarkdown(summary) {
  const sourceRows = summary.sources.map((source) => [
    source.slug,
    source.fileTitle,
    source.licenseShortName || source.license,
    source.commonsPage,
  ]);
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
    "# DeepSpec Web-Sourced AR QA",
    "",
    `- Base URL: ${summary.baseUrl}`,
    `- Generated: ${summary.generatedAt}`,
    `- Grade: ${summary.grade}/10`,
    `- Passed: ${summary.passed}/${summary.total}`,
    `- Output: ${summary.outputDir}`,
    "",
    "## Sources",
    "",
    "| Case | Wikimedia Commons file | License | Source page |",
    "| --- | --- | --- | --- |",
    ...sourceRows.map((row) => `| ${row.map(escapeTableCell).join(" | ")} |`),
    "",
    "## Results",
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
