import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Phase 8 Supabase validation tooling", () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const verifier = readFileSync(join(process.cwd(), "scripts", "verify-supabase-sync.mjs"), "utf8");
  const authDiagnostics = readFileSync(join(process.cwd(), "scripts", "print-supabase-auth-diagnostics.mjs"), "utf8");
  const docs = readFileSync(join(process.cwd(), "docs", "PHASE_8_SUPABASE_VALIDATION.md"), "utf8");

  it("exposes a dedicated Supabase verification command", () => {
    expect(packageJson.scripts["verify:supabase"]).toBe("node scripts/verify-supabase-sync.mjs");
    expect(packageJson.scripts["supabase:print-migration"]).toBe("node scripts/print-supabase-migration.mjs");
    expect(packageJson.scripts["supabase:print-auth-diagnostics"]).toBe("node scripts/print-supabase-auth-diagnostics.mjs");
  });

  it("checks private image upload, scan row write, owner read, cross-user block, and cleanup", () => {
    expect(verifier).toContain("/auth/v1/settings");
    expect(verifier).toContain("PGRST205");
    expect(verifier.indexOf("signInAnonymously(ownerClient, config)")).toBeLessThan(
      verifier.indexOf('from("scan_lookups").upsert'),
    );
    expect(verifier).toContain("storage.from(SCAN_BUCKET).upload");
    expect(verifier).toContain('from("scan_lookups").upsert');
    expect(verifier).toContain("Owner read failed");
    expect(verifier).toContain("another anonymous user cannot read");
    expect(verifier).toContain('from("scan_lookups").delete()');
    expect(verifier).toContain("storage.from(SCAN_BUCKET).remove");
  });

  it("prints actionable Supabase Auth diagnostics when anonymous sign-in fails", () => {
    expect(verifier).toContain("Anonymous sign-ins are enabled in Supabase Auth settings.");
    expect(verifier).toContain("logs/auth-logs");
    expect(verifier).toContain("supabase:print-auth-diagnostics");
    expect(verifier).toContain("auth.users");
    expect(authDiagnostics).toContain("security_type");
    expect(authDiagnostics).toContain("profiles_table");
    expect(authDiagnostics).toContain("suggested_drop_trigger_sql");
    expect(authDiagnostics).toContain("review before running");
  });

  it("documents that parent setup and non-service-role keys are required", () => {
    expect(docs).toContain("Parent-Required Setup");
    expect(docs).toContain("Do not put a service-role key");
    expect(docs).toContain("VITE_SUPABASE_PUBLISHABLE_KEY");
    expect(docs).toContain("supabase:print-auth-diagnostics");
  });
});
