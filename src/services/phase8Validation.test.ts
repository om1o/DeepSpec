import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Phase 8 Supabase validation tooling", () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const verifier = readFileSync(join(process.cwd(), "scripts", "verify-supabase-sync.mjs"), "utf8");
  const authDiagnostics = readFileSync(join(process.cwd(), "scripts", "print-supabase-auth-diagnostics.mjs"), "utf8");
  const authRepair = readFileSync(join(process.cwd(), "scripts", "print-supabase-auth-anonymous-repair.mjs"), "utf8");
  const authRepairSql = readFileSync(join(process.cwd(), "scripts", "supabase-auth-anonymous-repair-sql.mjs"), "utf8");
  const hostedProbe = readFileSync(join(process.cwd(), "scripts", "probe-supabase-hosted-setup.mjs"), "utf8");
  const docs = readFileSync(join(process.cwd(), "docs", "PHASE_8_SUPABASE_VALIDATION.md"), "utf8");
  const ciWorkflow = readFileSync(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");

  it("exposes a dedicated Supabase verification command", () => {
    expect(packageJson.scripts["verify:supabase"]).toBe("node scripts/verify-supabase-sync.mjs");
    expect(packageJson.scripts["supabase:print-migration"]).toBe("node scripts/print-supabase-migration.mjs");
    expect(packageJson.scripts["supabase:print-auth-diagnostics"]).toBe("node scripts/print-supabase-auth-diagnostics.mjs");
    expect(packageJson.scripts["supabase:print-auth-anonymous-repair"]).toBe(
      "node scripts/print-supabase-auth-anonymous-repair.mjs",
    );
    expect(packageJson.scripts["supabase:probe-hosted-setup"]).toBe("node scripts/probe-supabase-hosted-setup.mjs");
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
    expect(authDiagnostics).toContain("auth.audit_log_entries");
    expect(authDiagnostics).toContain("REQUEST_ID_HERE");
    expect(authDiagnostics).toContain("process.argv[2]");
    expect(authDiagnostics).toContain("escapeSqlLikeLiteral");
    expect(authDiagnostics).toContain("security_type");
    expect(authDiagnostics).toContain("Supabase Auth Hooks");
    expect(authDiagnostics).toContain("before_user_created");
    expect(authDiagnostics).toContain("supabase_auth_admin_can_execute");
    expect(authDiagnostics).toContain("profiles_table");
    expect(authDiagnostics).toContain("suggested_drop_trigger_sql");
    expect(authDiagnostics).toContain("scan_model_runs");
    expect(authDiagnostics).toContain("image_hash");
    expect(authDiagnostics).toContain("rls_enabled");
    expect(authDiagnostics).toContain("authenticated_can_insert");
    expect(authDiagnostics).toContain("scan-images");
    expect(authDiagnostics).toContain("review before running");
  });

  it("prints a guarded anonymous Auth repair only for the standard profile trigger", () => {
    expect(authRepair).toContain("Use this only after the Auth log or diagnostics show this exact failing path");
    expect(authRepair).toContain("auth.users -> public.handle_new_user() -> public.profiles");
    expect(authRepairSql).toContain("create or replace function public.handle_new_user()");
    expect(authRepairSql).toContain("security definer");
    expect(authRepairSql).toContain("set search_path = ''");
    expect(authRepairSql).toContain("coalesce(new.is_anonymous, false)");
    expect(authRepairSql).toContain("return new;");
    expect(authRepairSql).toContain("not tg.tgisinternal");
    expect(authRepairSql).not.toContain("drop trigger if exists");
  });

  it("probes hosted scan tables and storage without creating Auth users", () => {
    expect(hostedProbe).toContain("This is read-only and does not create Auth users.");
    expect(hostedProbe).toContain("/rest/v1/");
    expect(hostedProbe).toContain("/storage/v1/bucket/");
    expect(hostedProbe).toContain("PGRST205");
    expect(hostedProbe).toContain("scan_lookups");
    expect(hostedProbe).toContain("scan_model_runs");
    expect(hostedProbe).toContain("scan-images");
    expect(hostedProbe).toContain("supabase:print-migration");
    expect(hostedProbe).toContain("verify:supabase");
  });

  it("documents that parent setup and non-service-role keys are required", () => {
    expect(docs).toContain("Parent-Required Setup");
    expect(docs).toContain("Do not put a service-role key");
    expect(docs).toContain("VITE_SUPABASE_PUBLISHABLE_KEY");
    expect(docs).toContain("supabase:print-auth-diagnostics");
    expect(docs).toContain("supabase:print-auth-anonymous-repair");
    expect(docs).toContain("supabase:probe-hosted-setup");
    expect(docs).toContain("Authentication -> Hooks");
    expect(docs).toContain("supabase_auth_admin");
    expect(docs).toContain("codex/production-readiness-release*");
  });

  it("does not let production-readiness CI silently skip Supabase verification", () => {
    expect(ciWorkflow).toContain("Supabase public secrets are not configured; cloud sync verifier did not run.");
    expect(ciWorkflow).toContain("GITHUB_STEP_SUMMARY");
    expect(ciWorkflow).toContain("codex/production-readiness-release*");
    expect(ciWorkflow).toContain("Production-readiness branches and main must prove Supabase cloud sync.");
  });
});
