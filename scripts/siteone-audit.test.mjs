import assert from "node:assert/strict";
import test from "node:test";
import { buildSiteOneArgs } from "./siteone-audit.mjs";

test("SiteOne audit stays free and writes all reports locally", () => {
  const args = buildSiteOneArgs("artifacts/seo/siteone-test/siteone-urls.txt", "artifacts/seo/siteone-test", true);
  assert.ok(args.includes("--ci"));
  assert.ok(args.includes("--ci-min-score=7.0"));
  assert.ok(args.some((arg) => arg.startsWith("--url-list=")));
  assert.ok(args.includes("--ci-min-pages=1"));
  assert.ok(args.includes("--ci-min-assets=0"));
  assert.ok(args.includes("--browser"));
  assert.ok(args.some((arg) => arg.startsWith("--output-html-report=")));
  assert.ok(args.some((arg) => arg.startsWith("--output-json-file=")));
  assert.ok(args.every((arg) => !arg.startsWith("--ai-")));
});
