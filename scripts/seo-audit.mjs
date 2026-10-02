import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { JSDOM } from "jsdom";

const DEFAULT_BASE_URL = process.env.SEO_BASE_URL || "http://localhost:4174";
const REQUEST_TIMEOUT_MS = 15_000;

export function auditHtml(html, pageUrl, status = 200) {
  const document = new JSDOM(html).window.document;
  const title = document.querySelector("title")?.textContent?.trim() ?? "";
  const description = document.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() ?? "";
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href")?.trim() ?? "";
  const robots = document.querySelector('meta[name="robots"]')?.getAttribute("content")?.toLowerCase() ?? "";
  const headings = [...document.querySelectorAll("h1")];
  const errors = [];
  const warnings = [];

  if (status !== 200) errors.push(`HTTP status is ${status}.`);
  if (!title) errors.push("Missing title.");
  else if (title.length < 15 || title.length > 65) warnings.push(`Title length is ${title.length}; target 15-65.`);
  if (!description) errors.push("Missing meta description.");
  else if (description.length < 70 || description.length > 170) warnings.push(`Description length is ${description.length}; target 70-170.`);
  if (!canonical) errors.push("Missing canonical URL.");
  if (robots.includes("noindex")) errors.push("Page is marked noindex.");
  if (headings.length !== 1) errors.push(`Expected exactly one H1; found ${headings.length}.`);
  if (!document.querySelector('meta[property="og:title"]')) warnings.push("Missing og:title.");
  if (!document.querySelector('meta[property="og:image"]')) warnings.push("Missing og:image.");
  if (!document.querySelector('meta[name="twitter:card"]')) warnings.push("Missing twitter:card.");

  const invalidJsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .filter((script) => {
      try { JSON.parse(script.textContent || ""); return false; } catch { return true; }
    }).length;
  if (invalidJsonLd) errors.push(`${invalidJsonLd} JSON-LD block(s) contain invalid JSON.`);

  const missingAlt = [...document.querySelectorAll("img")].filter((image) => !image.hasAttribute("alt")).length;
  if (missingAlt) warnings.push(`${missingAlt} image(s) are missing alt text.`);

  const textWords = (document.body?.textContent ?? "").trim().split(/\s+/).filter(Boolean).length;
  if (textWords < 120) warnings.push(`Only ${textWords} visible words; verify this page is useful without client rendering.`);

  return {
    url: pageUrl,
    status,
    title,
    description,
    canonical,
    h1: headings[0]?.textContent?.trim() ?? "",
    wordCount: textWords,
    errors,
    warnings,
  };
}

export function findDuplicateMetadata(pages) {
  const issues = [];
  for (const field of ["title", "description", "canonical"]) {
    const seen = new Map();
    for (const page of pages) {
      const value = page[field];
      if (!value) continue;
      const urls = seen.get(value) ?? [];
      urls.push(page.url);
      seen.set(value, urls);
    }
    for (const [value, urls] of seen) {
      if (urls.length > 1) issues.push({ field, value, urls });
    }
  }
  return issues;
}

export function renderMarkdown(report) {
  const lines = [
    "# DeepSpec SEO audit",
    "",
    `Generated: ${report.generatedAt}`,
    `Base URL: ${report.baseUrl}`,
    `Pages: ${report.pages.length}`,
    `Errors: ${report.errorCount}`,
    `Warnings: ${report.warningCount}`,
    "",
    "| Page | Status | Errors | Warnings | Words |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...report.pages.map((page) => `| ${page.url} | ${page.status} | ${page.errors.length} | ${page.warnings.length} | ${page.wordCount} |`),
  ];

  for (const page of report.pages) {
    if (!page.errors.length && !page.warnings.length) continue;
    lines.push("", `## ${page.url}`);
    for (const error of page.errors) lines.push(`- ERROR: ${error}`);
    for (const warning of page.warnings) lines.push(`- WARN: ${warning}`);
  }

  if (report.duplicates.length) {
    lines.push("", "## Duplicate metadata");
    for (const duplicate of report.duplicates) {
      lines.push(`- ${duplicate.field}: ${duplicate.urls.join(", ")}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  return { body: await response.text(), status: response.status };
}

async function run() {
  const { values } = parseArgs({
    options: {
      url: { type: "string", default: DEFAULT_BASE_URL },
      output: { type: "string" },
    },
  });
  const baseUrl = new URL(values.url).toString().replace(/\/$/, "");
  const sitemapResponse = await fetchText(`${baseUrl}/sitemap.xml`);
  if (sitemapResponse.status !== 200) throw new Error(`Could not read sitemap.xml: HTTP ${sitemapResponse.status}`);

  const sitemap = new JSDOM(sitemapResponse.body, { contentType: "application/xml" }).window.document;
  const productionUrls = [...sitemap.querySelectorAll("loc")].map((node) => node.textContent?.trim()).filter(Boolean);
  if (!productionUrls.length) throw new Error("sitemap.xml contains no URLs");

  const pages = [];
  for (const productionUrl of productionUrls) {
    const path = new URL(productionUrl).pathname;
    const targetUrl = new URL(path, `${baseUrl}/`).toString();
    try {
      const response = await fetchText(targetUrl);
      pages.push(auditHtml(response.body, targetUrl, response.status));
    } catch (error) {
      pages.push({
        url: targetUrl, status: 0, title: "", description: "", canonical: "", h1: "", wordCount: 0,
        errors: [`Request failed: ${error instanceof Error ? error.message : String(error)}`], warnings: [],
      });
    }
  }

  const duplicates = findDuplicateMetadata(pages);
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    pages,
    duplicates,
    errorCount: pages.reduce((sum, page) => sum + page.errors.length, 0) + duplicates.length,
    warningCount: pages.reduce((sum, page) => sum + page.warnings.length, 0),
  };
  const outputDir = values.output || `artifacts/seo/${report.generatedAt.replace(/[:.]/g, "-")}`;
  await mkdir(outputDir, { recursive: true });
  await writeFile(`${outputDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(`${outputDir}/report.md`, renderMarkdown(report));
  console.log(`SEO audit: ${report.errorCount} errors, ${report.warningCount} warnings`);
  console.log(`Report: ${outputDir}/report.md`);
  process.exitCode = report.errorCount ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
