import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findMissingPublicTargets } from "./verify-public-assets.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("findMissingPublicTargets", () => {
  it("reports missing same-origin assets referenced by built public documents", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "deepspec-public-assets-"));
    temporaryDirectories.push(root);
    await mkdir(path.join(root, "articles"));
    await mkdir(path.join(root, "brand"));
    await writeFile(
      path.join(root, "index.html"),
      '<meta property="og:image" content="https://deepspec.app/brand/missing.png"><a href="/articles/guide.html">Guide</a><a href="/articles/missing.html">Missing guide</a>',
    );
    await writeFile(path.join(root, "articles", "guide.html"), '<a href="/">Home</a>');
    await writeFile(path.join(root, "articles", "guide.md"), "Related: https://deepspec.app/articles/guide.html\n");
    await writeFile(path.join(root, "manifest.webmanifest"), '{"start_url":"/","icons":[]}');
    await writeFile(path.join(root, "robots.txt"), "Sitemap: https://deepspec.app/sitemap.xml\n");
    await writeFile(
      path.join(root, "sitemap.xml"),
      "<urlset><url><loc>https://deepspec.app/</loc></url><url><loc>https://deepspec.app/articles/guide.html</loc></url></urlset>",
    );

    await expect(findMissingPublicTargets(root)).resolves.toEqual([
      {
        source: "index.html",
        reference: "/articles/missing.html",
        target: "articles/missing.html",
      },
      {
        source: "index.html",
        reference: "https://deepspec.app/brand/missing.png",
        target: "brand/missing.png",
      },
    ]);
  });
});
