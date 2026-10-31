import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Keep the opening page with the real app, generated from the tracked design.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "marketing/deepspec-visual-search/dist");
const target = path.join(root, "public/intro");
const fingerprint = (data) => createHash("sha256").update(data).digest("hex").slice(0, 12);
const prefixAssets = (text) => text
  .replaceAll('"/assets/', '"/intro/assets/')
  .replaceAll("'/assets/", "'/intro/assets/")
  .replace(/href="https:\/\/[^"\s]+\/auth"/g, 'href="/auth"')
  .replace(/url\((['"]?)\/assets\//g, "url($1/intro/assets/");

await mkdir(target, { recursive: true });
await cp(path.join(source, "assets"), path.join(target, "assets"), { recursive: true });

let html = await readFile(path.join(source, "index.html"), "utf8");
html = prefixAssets(html)
  .replace(/^\s*<link rel="canonical"[^>]*>\n/gm, "")
  .replace(/https:\/\/[^"\s]+\.chatgpt\.site\/assets\//g, "/intro/assets/")
  .replaceAll('href="/site.webmanifest"', 'href="/intro/site.webmanifest"');

const resources = [
  ["styles", "css"], ["intro", "js"], ["signin", "css"],
  ["signin", "js"], ["micro", "css"], ["micro", "js"],
];
for (const [stem, extension] of resources) {
  const text = prefixAssets(await readFile(path.join(source, `${stem}.${extension}`), "utf8"));
  for (const old of await readdir(target)) {
    if (new RegExp(`^${stem}\\.[a-f0-9]{12}\\.${extension}$`).test(old)) await rm(path.join(target, old));
  }
  const filename = `${stem}.${fingerprint(text)}.${extension}`;
  await writeFile(path.join(target, `${stem}.${extension}`), text);
  await writeFile(path.join(target, filename), text);
  html = html.replace(new RegExp(`/${stem}(?:\\.[a-f0-9]{12})?\\.${extension}`, "g"), `/intro/${filename}`);
}

const manifest = JSON.parse(await readFile(path.join(source, "site.webmanifest"), "utf8"));
manifest.start_url = "/";
manifest.icons = manifest.icons.map((icon) => ({ ...icon, src: `/intro${icon.src}` }));
await writeFile(path.join(target, "site.webmanifest"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(target, "index.html"), html);
await cp(path.join(source, "robots.txt"), path.join(target, "robots.txt"));
console.log("Intro packaged: same-origin assets, authenticated /auth entry and blue-glass handoff.");
