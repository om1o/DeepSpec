import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export function evaluateIndexingHeader(headerValue, shouldBeIndexable) {
  const hasNoIndex = String(headerValue || "").toLowerCase().split(",").some((value) => value.trim() === "noindex");
  if (shouldBeIndexable && hasNoIndex) return "Production sends X-Robots-Tag: noindex.";
  if (!shouldBeIndexable && !hasNoIndex) return "Preview does not send X-Robots-Tag: noindex.";
  return null;
}

async function inspect(url, shouldBeIndexable) {
  const origin = new URL(url).origin;
  const response = await fetch(`${origin}/robots.txt`, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${origin}/robots.txt returned HTTP ${response.status}.`);
  const headerError = evaluateIndexingHeader(response.headers.get("x-robots-tag"), shouldBeIndexable);
  if (headerError) throw new Error(`${origin}: ${headerError}`);
  if (shouldBeIndexable) {
    const sitemap = await fetch(`${origin}/sitemap.xml`, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    if (!sitemap.ok) throw new Error(`${origin}/sitemap.xml returned HTTP ${sitemap.status}.`);
  }
  console.log(`${shouldBeIndexable ? "Production" : "Preview"} indexing header is correct: ${origin}`);
}

async function run() {
  const { values } = parseArgs({ options: { production: { type: "string" }, preview: { type: "string" } } });
  if (!values.production) throw new Error("Pass --production=https://<project>.vercel.app.");
  await inspect(values.production, true);
  if (values.preview) await inspect(values.preview, false);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
