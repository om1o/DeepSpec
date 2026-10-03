import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { JSDOM } from "jsdom";

export function buildSiteOneArgs(urlListPath, outputDirectory, useBrowser = true) {
  const output = resolve(outputDirectory);
  return [
    `--url-list=${resolve(urlListPath)}`,
    "--ci",
    "--ci-min-score=7.0",
    "--ci-min-pages=1",
    "--ci-min-assets=0",
    ...(useBrowser ? ["--browser"] : []),
    `--output-html-report=${resolve(output, "siteone-report.html")}`,
    `--output-json-file=${resolve(output, "siteone-report.json")}`,
    `--output-text-file=${resolve(output, "siteone-report.txt")}`,
  ];
}

async function run() {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      output: { type: "string" },
      binary: { type: "string" },
      browser: { type: "boolean", default: true },
    },
  });
  if (!values.url) throw new Error("Pass the deployed site with --url=https://example.vercel.app.");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const output = values.output || `artifacts/seo/siteone-${timestamp}`;
  await mkdir(output, { recursive: true });
  const baseUrl = new URL(values.url);
  const sitemapResponse = await fetch(new URL("/sitemap.xml", baseUrl), { signal: AbortSignal.timeout(15_000) });
  if (!sitemapResponse.ok) throw new Error(`Could not read sitemap.xml: HTTP ${sitemapResponse.status}`);
  const sitemap = new JSDOM(await sitemapResponse.text(), { contentType: "application/xml" }).window.document;
  const targetUrls = [...sitemap.querySelectorAll("loc")]
    .map((node) => node.textContent?.trim())
    .filter(Boolean)
    .map((url) => new URL(new URL(url).pathname, baseUrl.origin).toString());
  if (!targetUrls.length) throw new Error("sitemap.xml contains no URLs.");
  const urlListPath = resolve(output, "siteone-urls.txt");
  await writeFile(urlListPath, `${targetUrls.join("\n")}\n`);
  const binary = values.binary || process.env.SITEONE_CRAWLER_BIN || (process.platform === "win32" ? "siteone-crawler.exe" : "siteone-crawler");
  const child = spawn(binary, buildSiteOneArgs(urlListPath, output, values.browser), { stdio: "inherit", shell: false });
  child.on("error", (error) => {
    console.error(`Could not start SiteOne Crawler (${binary}): ${error.message}`);
    console.error("Install the MIT-licensed binary from https://github.com/janreges/siteone-crawler/releases or set SITEONE_CRAWLER_BIN.");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
