import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE_ORIGIN = "https://deepspec.app";
const DEFAULT_DIST_DIR = "dist";

export async function findMissingPublicTargets(distDir = DEFAULT_DIST_DIR) {
  const root = path.resolve(distDir);
  const documents = await findFiles(root, (name) => name.endsWith(".html") || name.endsWith(".md"));
  const fixedDocuments = ["manifest.webmanifest", "robots.txt", "sitemap.xml"]
    .map((name) => path.join(root, name))
    .filter((file) => !documents.includes(file));
  const sources = [...documents, ...fixedDocuments];
  const missing = [];

  for (const source of sources) {
    const text = await readFile(source, "utf8").catch(() => null);
    if (text === null) continue;

    for (const reference of extractReferences(source, text)) {
      const target = resolveInternalTarget(root, source, reference);
      if (!target || (await exists(target))) continue;

      missing.push({
        source: path.relative(root, source).replaceAll("\\", "/"),
        reference,
        target: path.relative(root, target).replaceAll("\\", "/"),
      });
    }
  }

  return missing.sort((left, right) =>
    `${left.source}:${left.reference}`.localeCompare(`${right.source}:${right.reference}`),
  );
}

function extractReferences(source, text) {
  const extension = path.extname(source);
  if (extension === ".html") return extractHtmlReferences(text);
  if (extension === ".md") return extractMarkdownReferences(text);
  if (extension === ".webmanifest") return extractManifestReferences(text);
  if (path.basename(source) === "robots.txt") {
    return [...text.matchAll(/^Sitemap:\s*(\S+)/gim)].map((match) => match[1]);
  }
  if (path.basename(source) === "sitemap.xml") {
    return [...text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => decodeEntities(match[1]));
  }
  return [];
}

function extractMarkdownReferences(markdown) {
  const linked = [...markdown.matchAll(/\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)].map((match) => match[1]);
  const bare = [...markdown.matchAll(/https:\/\/deepspec\.app\/[^\s<>()\]]+/g)].map((match) =>
    match[0].replace(/[.,;:!?]+$/, ""),
  );
  return [...new Set([...linked, ...bare])];
}

function extractHtmlReferences(html) {
  const references = [];
  for (const match of html.matchAll(/<(?:a|img|link|script|source)\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    if (attributes.href) references.push(attributes.href);
    if (attributes.src) references.push(attributes.src);
    if (attributes.srcset) {
      references.push(...attributes.srcset.split(",").map((entry) => entry.trim().split(/\s+/)[0]));
    }
  }

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const key = attributes.property ?? attributes.name;
    if ((key === "og:image" || key === "twitter:image") && attributes.content) {
      references.push(attributes.content);
    }
  }

  return references;
}

function extractManifestReferences(text) {
  const manifest = JSON.parse(text);
  return [
    manifest.start_url,
    manifest.scope,
    ...collectUrls(manifest.icons),
    ...collectUrls(manifest.screenshots),
    ...(manifest.shortcuts ?? []).flatMap((shortcut) => [shortcut.url, ...collectUrls(shortcut.icons)]),
  ].filter(Boolean);
}

function collectUrls(entries = []) {
  return entries.map((entry) => entry?.src).filter(Boolean);
}

function parseAttributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map((match) => [
      match[1].toLowerCase(),
      decodeEntities(match[2]),
    ]),
  );
}

function resolveInternalTarget(root, source, reference) {
  if (!reference || reference.startsWith("#") || reference.startsWith("data:")) return null;

  const sourcePath = path.relative(root, source).replaceAll("\\", "/");
  const url = new URL(reference, new URL(`/${sourcePath}`, SITE_ORIGIN));
  if (url.origin !== SITE_ORIGIN) return null;

  const pathname = decodeURIComponent(url.pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Public reference escapes the build directory: ${reference}`);
  }
  return target;
}

function decodeEntities(value) {
  return value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#39;", "'");
}

async function findFiles(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await findFiles(file, predicate)));
    else if (predicate(entry.name)) files.push(file);
  }
  return files.sort();
}

async function exists(file) {
  return access(file).then(
    () => true,
    () => false,
  );
}

async function main() {
  const distDir = process.argv[2] ?? DEFAULT_DIST_DIR;
  const missing = await findMissingPublicTargets(distDir);
  if (missing.length === 0) {
    console.log("Public asset integrity passed: all internal links and referenced assets exist.");
    return;
  }

  console.error(`Public asset integrity failed: ${missing.length} missing target(s).`);
  for (const item of missing) {
    console.error(`- ${item.source}: ${item.reference} -> ${item.target}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
