import { readFileSync } from "node:fs";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("SEO assets", () => {
  it("adds search and social metadata to the app shell", () => {
    const html = read("index.html");

    expect(html).toContain("Deep Spec - AI Car Part Finding Helper");
    expect(html).toContain("AI car part finding");
    expect(html).toContain("application/ld+json");
    expect(html).toContain("https://deepspec.app/icon-512.png");
    expect(html).toContain("/articles/ai-car-part-finding.html");
  });

  it("exposes crawler and sitemap files", () => {
    const robots = read("public/robots.txt");
    const sitemap = read("public/sitemap.xml");
    const llms = read("public/llms.txt");

    expect(robots).toContain("User-agent: OAI-SearchBot");
    expect(robots).toContain("User-agent: ClaudeBot");
    expect(robots).toContain("User-agent: PerplexityBot");
    expect(sitemap).toContain("https://deepspec.app/articles/ai-car-part-finding.html");
    expect(llms).toContain("AI car part finding");
  });

  it("publishes an article and markdown version for AI-readable discovery", () => {
    const article = read("public/articles/ai-car-part-finding.html");
    const markdown = read("public/articles/ai-car-part-finding.md");

    expect(article).toContain("Can AI tools save time for engineers and car owners?");
    expect(article).toContain("Try the Deep Spec scanner");
    expect(article).toContain('"@type": "FAQPage"');
    expect(markdown).toContain("AI carpart finding");
    expect(markdown).toContain("https://deepspec.app/");
  });
});
