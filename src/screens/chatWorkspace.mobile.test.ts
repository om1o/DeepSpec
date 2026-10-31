import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("mobile chat workspace", () => {
  it("lets the chat shell shrink with the phone keyboard", () => {
    const css = read("src/screens/chatWorkspace.css");
    const mobileCss = css.slice(
      css.indexOf("@media (max-width: 900px)"),
      css.indexOf("@media (prefers-reduced-motion"),
    );

    expect(mobileCss).toMatch(/\.ds-chat-shell\s*\{[^}]*min-height:\s*0/);
  });

  it("keeps mobile composer controls at an iOS-safe font size", () => {
    const css = read("src/screens/chatWorkspace.css");
    const mobileCss = css.slice(
      css.indexOf("@media (max-width: 900px)"),
      css.indexOf("@media (prefers-reduced-motion"),
    );

    expect(mobileCss).toMatch(/\.ds-chat-input[^}]*font-size:\s*16px/);
    expect(mobileCss).toMatch(/\.ds-chat-reference-input[^}]*font-size:\s*16px/);
  });
});

describe("install manifests", () => {
  it("keeps intro and app install behavior consistent", () => {
    const appManifest = JSON.parse(read("public/manifest.webmanifest"));
    const introManifest = JSON.parse(read("public/intro/site.webmanifest"));

    for (const field of ["name", "short_name", "description", "display", "orientation", "start_url", "scope"]) {
      expect(introManifest[field], field).toBe(appManifest[field]);
    }

    expect(introManifest.icons.map(({ sizes, type, purpose }: Record<string, string>) => ({ sizes, type, purpose })))
      .toEqual(appManifest.icons.map(({ sizes, type, purpose }: Record<string, string>) => ({ sizes, type, purpose })));
  });
});
