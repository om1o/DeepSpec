import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("SEO assets", () => {
  it("adds search and social metadata to the app shell", () => {
    const html = read("index.html");

    expect(html).toContain("Deep Spec - AI Car Part Finding Helper");
    expect(html).toContain("AI car part finding");
    expect(html).toContain("AI car parts scanner");
    expect(html).toContain("identify car parts with camera");
    expect(html).toContain("application/ld+json");
    expect(html).toContain("https://deepspec.app/brand/deepspec-logo.png");
    expect(html).toContain("/articles/ai-car-part-finding.html");
    expect(html).toContain("/articles/visual-ai-inspection-tools.html");
  });

  it("exposes crawler and sitemap files", () => {
    const robots = read("public/robots.txt");
    const sitemap = read("public/sitemap.xml");
    const llms = read("public/llms.txt");

    expect(robots).toContain("User-agent: OAI-SearchBot");
    expect(robots).toContain("User-agent: ClaudeBot");
    expect(robots).toContain("User-agent: PerplexityBot");
    expect(sitemap).toContain("https://deepspec.app/articles/ai-car-part-finding.html");
    expect(sitemap).toContain("https://deepspec.app/articles/ai-car-parts-scanner.html");
    expect(sitemap).toContain("https://deepspec.app/articles/car-damage-ai-scanner.html");
    expect(sitemap).toContain("https://deepspec.app/articles/visual-ai-inspection-tools.html");
    expect(llms).toContain("AI car part finding");
    expect(llms).toContain("Follow-up chat attached to saved scans");
    expect(llms).not.toContain("AI identification is the next planned phase");
  });

  it("keeps the install manifest mobile-friendly", () => {
    const viteConfig = read("vite.config.ts");

    expect(viteConfig).toContain('display: "standalone"');
    expect(viteConfig).toContain('orientation: "portrait"');
    expect(viteConfig).toContain('purpose: "any maskable"');
    expect(viteConfig).toContain("enabled: false");
  });

  it("publishes an article and markdown version for AI-readable discovery", () => {
    const article = read("public/articles/ai-car-part-finding.html");
    const markdown = read("public/articles/ai-car-part-finding.md");

    expect(article).toContain("Can AI tools save time for engineers and car owners?");
    expect(article).toContain("Try the Deep Spec scanner");
    expect(article).toContain('"@type": "FAQPage"');
    expect(markdown).toContain("AI carpart finding");
    expect(markdown).toContain("https://deepspec.app/");
    expect(markdown).not.toContain("AI identification in the next phase");
  });

  it("publishes useful discovery articles without thin keyword pages", () => {
    const scannerArticle = read("public/articles/ai-car-parts-scanner.html");
    const damageArticle = read("public/articles/car-damage-ai-scanner.html");
    const inspectionArticle = read("public/articles/visual-ai-inspection-tools.html");
    const scannerMarkdown = read("public/articles/ai-car-parts-scanner.md");
    const damageMarkdown = read("public/articles/car-damage-ai-scanner.md");
    const inspectionMarkdown = read("public/articles/visual-ai-inspection-tools.md");

    expect(scannerArticle).toContain("AI car parts scanner");
    expect(scannerArticle).toContain("Try the Deep Spec scanner");
    expect(scannerArticle).toContain('"@type": "FAQPage"');
    expect(scannerMarkdown).toContain("identify car parts with camera");

    expect(damageArticle).toContain("Car damage AI scanner");
    expect(damageArticle).toContain("verify with a mechanic");
    expect(damageMarkdown).toContain("car damage AI scanner");

    expect(inspectionArticle).toContain("Visual AI inspection tools");
    expect(inspectionArticle).toContain("Can AI tools save time for engineers?");
    expect(inspectionMarkdown).toContain("structured scan records");
  });
});
