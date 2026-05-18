import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Phase 8 Supabase validation tooling", () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const verifier = readFileSync(join(process.cwd(), "scripts", "verify-supabase-sync.mjs"), "utf8");
  const docs = readFileSync(join(process.cwd(), "docs", "PHASE_8_SUPABASE_VALIDATION.md"), "utf8");

  it("exposes a dedicated Supabase verification command", () => {
    expect(packageJson.scripts["verify:supabase"]).toBe("node scripts/verify-supabase-sync.mjs");
  });

  it("checks private image upload, scan row write, owner read, cross-user block, and cleanup", () => {
    expect(verifier).toContain("storage.from(SCAN_BUCKET).upload");
    expect(verifier).toContain('from("scan_lookups").upsert');
    expect(verifier).toContain("Owner read failed");
    expect(verifier).toContain("another anonymous user cannot read");
    expect(verifier).toContain('from("scan_lookups").delete()');
    expect(verifier).toContain("storage.from(SCAN_BUCKET).remove");
  });

  it("documents that parent setup and non-service-role keys are required", () => {
    expect(docs).toContain("Parent-Required Setup");
    expect(docs).toContain("Do not put a service-role key");
    expect(docs).toContain("VITE_SUPABASE_PUBLISHABLE_KEY");
  });
});
