import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { JSDOM } from "jsdom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const run = promisify(execFile);
let root;
let html;
let signin;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "deepspec-intro-"));
  await mkdir(path.join(root, "scripts"));
  await cp("scripts/package-intro.mjs", path.join(root, "scripts/package-intro.mjs"));
  await cp("marketing/deepspec-visual-search/dist", path.join(root, "marketing/deepspec-visual-search/dist"), { recursive: true });
  await mkdir(path.join(root, "public/intro"), { recursive: true });
  await writeFile(path.join(root, "public/intro/signin.000000000000.js"), "stale");
  await run(process.execPath, [path.join(root, "scripts/package-intro.mjs")]);
  html = await readFile(path.join(root, "public/intro/index.html"), "utf8");
  signin = await readFile(path.join(root, "public/intro/signin.js"), "utf8");
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("intro packaging", () => {
  it("keeps every canonical and packaged entry on login with a native-link fallback", async () => {
    const source = new JSDOM(await readFile("marketing/deepspec-visual-search/dist/index.html", "utf8"));
    const packaged = new JSDOM(html, { url: "https://deepspec.example/intro/index.html" });
    const sourceEntries = [...source.window.document.querySelectorAll("a[data-entry]")];
    const entries = [...packaged.window.document.querySelectorAll("a[data-entry]")];
    expect(sourceEntries).toHaveLength(13);
    expect(entries).toHaveLength(sourceEntries.length);
    expect(sourceEntries.every((entry) => new URL(entry.href).pathname === "/auth")).toBe(true);
    expect(entries.every((entry) => entry.getAttribute("href") === "/auth")).toBe(true);
    expect(signin).toContain('class="signin-continue" href="/auth"');
    expect(signin).toContain("Continue to sign in");
    source.window.close();
    packaged.window.close();
  });

  it("preserves the authored animation and assets with reproducible, fresh fingerprints", async () => {
    const intro = await readFile("marketing/deepspec-visual-search/dist/intro.js", "utf8");
    expect(await readFile(path.join(root, "public/intro/intro.js"), "utf8")).toBe(intro);
    for (const [stem, extension] of [["styles", "css"], ["intro", "js"], ["signin", "css"], ["signin", "js"], ["micro", "css"], ["micro", "js"]]) {
      const content = await readFile(path.join(root, `public/intro/${stem}.${extension}`));
      const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
      expect(html).toContain(`/intro/${stem}.${hash}.${extension}`);
      expect(await readFile(path.join(root, `public/intro/${stem}.${hash}.${extension}`))).toEqual(content);
    }
    expect(await readdir(path.join(root, "public/intro"))).not.toContain("signin.000000000000.js");
    await run(process.execPath, [path.join(root, "scripts/package-intro.mjs")]);
    expect(await readFile(path.join(root, "public/intro/index.html"), "utf8")).toBe(html);
    expect(await readFile(path.join(root, "public/intro/assets/blue-glass-mark.svg"))).toEqual(await readFile("marketing/deepspec-visual-search/dist/assets/blue-glass-mark.svg"));
  });

  it.each([{ reduced: false, duration: 980 }, { reduced: true, duration: 160 }])("preserves the accessible handoff and cancellation with reduced motion=$reduced", ({ reduced, duration }) => {
    const dom = new JSDOM(html, { url: "https://deepspec.example/intro/index.html", runScripts: "outside-only" });
    const { window } = dom;
    window.matchMedia = () => ({ matches: reduced });
    window.setTimeout = vi.fn(() => 1);
    window.clearTimeout = vi.fn();
    const animate = vi.fn(() => ({ cancel: vi.fn() }));
    window.Element.prototype.animate = animate;
    window.eval(signin);
    const anchor = window.document.querySelector("a[data-entry]");
    anchor.focus();
    anchor.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    const dialog = window.document.querySelector('[role="dialog"]');
    const overlay = window.document.querySelector("#signin-transition");
    expect(overlay.hidden).toBe(false);
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(window.document.activeElement).toBe(dialog);
    expect(window.document.querySelector(".signin-continue").href).toBe("https://deepspec.example/auth");
    expect(window.setTimeout).toHaveBeenCalledWith(expect.any(Function), duration);
    if (reduced) expect(animate).toHaveBeenCalledTimes(1);
    window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(overlay.hidden).toBe(true);
    expect(window.document.activeElement).toBe(anchor);
    expect(window.document.querySelector("main").inert).toBeUndefined();
    expect(window.clearTimeout).toHaveBeenCalledWith(1);
    dom.window.close();
  });
});
