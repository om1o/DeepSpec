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
  const ciWorkflow = readFileSync(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");

  it("exposes a dedicated Supabase verification command", () => {
    expect(packageJson.scripts["verify:supabase"]).toBe("node scripts/verify-supabase-sync.mjs");
    expect(packageJson.scripts["supabase:print-migration"]).toBe("node scripts/print-supabase-migration.mjs");
    expect(packageJson.scripts["supabase:print-auth-diagnostics"]).toBe("node scripts/print-supabase-auth-diagnostics.mjs");
  });

  it("checks private image upload, durable dataset writes, owner reads, cross-user blocks, and cleanup", () => {
    expect(verifier).toContain("/auth/v1/settings");
    expect(verifier).toContain("PGRST205");
    expect(verifier.indexOf("signInAnonymously(ownerClient, config)")).toBeLessThan(
      verifier.indexOf('from("scan_lookups").upsert'),
    );
    expect(verifier).toContain("storage.from(SCAN_BUCKET).upload");
    expect(verifier).toContain('from("scan_lookups").upsert');
    expect(verifier).toContain("image_hash");
    expect(verifier).toContain("image_mime_type");
    expect(verifier).toContain("image_byte_length");
    expect(verifier).toContain("durable dataset detail rows");
    expect(verifier).toContain('from("scan_candidates").insert');
    expect(verifier).toContain('from("scan_evidence").insert');
    expect(verifier).toContain('from("scan_corrections").upsert');
    expect(verifier).toContain('from("scan_model_runs").insert');
    expect(verifier).toContain('from("sync_events").insert');
    expect(verifier).toContain("Owner read failed");
    expect(verifier).toContain("scan_candidates owner read failed");
    expect(verifier).toContain("scan_evidence owner read failed");
    expect(verifier).toContain("scan_corrections owner read failed");
    expect(verifier).toContain("scan_model_runs owner read failed");
    expect(verifier).toContain("sync_events owner read failed");
    expect(verifier).toContain("another anonymous user cannot read");
    expect(verifier).toContain("assertCrossUserCannotRead");
    expect(verifier).toContain('from("scan_lookups").delete()');
    expect(verifier).toContain('from("sync_events").delete()');
    expect(verifier).toContain("storage.from(SCAN_BUCKET).remove");
  });

  it("prints actionable Supabase Auth diagnostics when anonymous sign-in fails", () => {
    expect(verifier).toContain("Anonymous sign-ins are enabled in Supabase Auth settings.");
    expect(verifier).toContain("logs/auth-logs");
    expect(verifier).toContain("sb-request-id/error_id");
    expect(verifier).toContain("Search that request id in Supabase Auth Logs.");
    expect(verifier).toContain("supabase:print-auth-diagnostics");
    expect(verifier).toContain("auth.users");
    expect(authDiagnostics).toContain("security_type");
    expect(authDiagnostics).toContain("profiles_table");
    expect(authDiagnostics).toContain("suggested_drop_trigger_sql");
    expect(authDiagnostics).toContain("scan_model_runs");
    expect(authDiagnostics).toContain("image_hash");
    expect(authDiagnostics).toContain("rls_enabled");
    expect(authDiagnostics).toContain("authenticated_can_insert");
    expect(authDiagnostics).toContain("scan-images");
    expect(authDiagnostics).toContain("review before running");
  });

  it("documents that parent setup and non-service-role keys are required", () => {
    expect(docs).toContain("Parent-Required Setup");
    expect(docs).toContain("Do not put a service-role key");
    expect(docs).toContain("VITE_SUPABASE_PUBLISHABLE_KEY");
    expect(docs).toContain("supabase:print-auth-diagnostics");
    expect(docs).toContain("codex/production-readiness-release*");
  });

  it("does not let production-readiness CI silently skip Supabase verification", () => {
    expect(ciWorkflow).toContain("Supabase public secrets are not configured; cloud sync verifier did not run.");
    expect(ciWorkflow).toContain("GITHUB_STEP_SUMMARY");
    expect(ciWorkflow).toContain("codex/production-readiness-release*");
    expect(ciWorkflow).toContain("Production-readiness branches and main must prove Supabase cloud sync.");
  });
});
