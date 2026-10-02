import assert from "node:assert/strict";
import test from "node:test";
import { auditHtml, findDuplicateMetadata, renderMarkdown } from "./seo-audit.mjs";

const validHtml = `<!doctype html><html><head>
  <title>DeepSpec Vehicle Part Identification Guide</title>
  <meta name="description" content="DeepSpec helps people identify visible vehicle parts, review evidence, and keep a useful record without pretending a photo proves exact fitment.">
  <meta name="robots" content="index,follow">
  <meta property="og:title" content="DeepSpec Vehicle Part Identification Guide">
  <meta property="og:image" content="https://deepspec.app/card.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="canonical" href="https://deepspec.app/guide">
  <script type="application/ld+json">{"@type":"Article"}</script>
</head><body><h1>Identify a vehicle part carefully</h1><p>${"Useful evidence and practical guidance. ".repeat(35)}</p></body></html>`;

test("auditHtml accepts complete search metadata", () => {
  const result = auditHtml(validHtml, "https://deepspec.app/guide");
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test("auditHtml reports crawl blockers and malformed structured data", () => {
  const result = auditHtml('<html><head><meta name="robots" content="noindex"><script type="application/ld+json">{bad</script></head><body><h1>A</h1><h1>B</h1></body></html>', "https://deepspec.app/bad", 404);
  assert.ok(result.errors.some((error) => error.includes("HTTP status")));
  assert.ok(result.errors.some((error) => error.includes("Missing title")));
  assert.ok(result.errors.some((error) => error.includes("noindex")));
  assert.ok(result.errors.some((error) => error.includes("JSON-LD")));
  assert.ok(result.errors.some((error) => error.includes("exactly one H1")));
});

test("duplicate metadata is surfaced in the markdown report", () => {
  const page = auditHtml(validHtml, "https://deepspec.app/a");
  const duplicate = { ...page, url: "https://deepspec.app/b" };
  const duplicates = findDuplicateMetadata([page, duplicate]);
  const markdown = renderMarkdown({ generatedAt: "2026-10-01", baseUrl: "https://deepspec.app", pages: [page, duplicate], duplicates, errorCount: duplicates.length, warningCount: 0 });
  assert.equal(duplicates.length, 3);
  assert.match(markdown, /Duplicate metadata/);
});
