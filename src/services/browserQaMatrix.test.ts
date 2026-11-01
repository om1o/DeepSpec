import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("production browser QA matrix", () => {
  const docs = readFileSync(join(process.cwd(), "docs", "BROWSER_QA_MATRIX.md"), "utf8");

  it("covers every core browser route that production readiness depends on", () => {
    for (const route of ["/auth", "/scan", "/result/:id", "/history", "/result/:id/chat", "/early-access"]) {
      expect(docs).toContain(`| \`${route}\``);
    }
    expect(docs).toContain("Unknown route");
  });

  it("requires desktop, phone, and iPad viewport evidence", () => {
    expect(docs).toContain("390 x 844");
    expect(docs).toContain("430 x 932");
    expect(docs).toContain("375 x 667");
    expect(docs).toContain("667 x 375");
    expect(docs).toContain("768 x 1024");
    expect(docs).toContain("820 x 1180");
    expect(docs).toContain("1024 x 768");
    expect(docs).toContain("1440 x 900");
    expect(docs).toContain("Chromium and WebKit");
    expect(docs).toContain("44 x 44");
    expect(docs).toContain("at least `16px`");
    expect(docs).toContain("accessibility snapshot");
    expect(docs).toContain("browser console");
    expect(docs).toContain("network requests");
  });

  it("keeps browser QA tied to the real release gates", () => {
    expect(docs).toContain("npm run check");
    expect(docs).toContain("npm run eval:identify:release");
    expect(docs).toContain("npm run verify:supabase");
    expect(docs).toContain("Do not mark the route production ready from component tests alone.");
  });

  it("documents the saved lookup seed required by result, history, and chat QA", () => {
    expect(docs).toContain("\"id\": \"qa-alternator-1\"");
    expect(docs).toContain("\"partName\": \"Alternator\"");
    expect(docs).toContain("\"candidateMatches\"");
    expect(docs).toContain("\"trainingStatus\": \"raw_unreviewed\"");
  });
});
