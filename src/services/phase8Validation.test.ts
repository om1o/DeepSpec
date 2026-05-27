import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Phase 8 Supabase validation tooling", () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const verifier = readFileSync(join(process.cwd(), "scripts", "verify-supabase-sync.mjs"), "utf8");
  const authDiagnostics = readFileSync(join(process.cwd(), "scripts", "print-supabase-auth-diagnostics.mjs"), "utf8");
  const authRepairApply = readFileSync(join(process.cwd(), "scripts", "apply-supabase-auth-anonymous-repair.mjs"), "utf8");
  const authRepairPrint = readFileSync(join(process.cwd(), "scripts", "print-supabase-auth-anonymous-repair.mjs"), "utf8");
  const authRepairSql = readFileSync(join(process.cwd(), "scripts", "supabase-auth-anonymous-repair-sql.mjs"), "utf8");
  const docs = readFileSync(join(process.cwd(), "docs", "PHASE_8_SUPABASE_VALIDATION.md"), "utf8");
  const ciWorkflow = readFileSync(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");

  it("exposes a dedicated Supabase verification command", () => {
    expect(packageJson.scripts["verify:supabase"]).toBe("node scripts/verify-supabase-sync.mjs");
    expect(packageJson.scripts["supabase:print-migration"]).toBe("node scripts/print-supabase-migration.mjs");
    expect(packageJson.scripts["supabase:print-auth-diagnostics"]).toBe("node scripts/print-supabase-auth-diagnostics.mjs");
    expect(packageJson.scripts["supabase:print-auth-anonymous-repair"]).toBe("node scripts/print-supabase-auth-anonymous-repair.mjs");
    expect(packageJson.scripts["supabase:apply-auth-anonymous-repair"]).toBe("node scripts/apply-supabase-auth-anonymous-repair.mjs");
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
    expect(verifier).toContain("sb-request-id");
    expect(verifier).toContain("error_id");
    expect(verifier).toContain("logs/auth-logs");
    expect(verifier).toContain("supabase:print-auth-diagnostics");
    expect(verifier).toContain("supabase:print-auth-anonymous-repair");
    expect(verifier).toContain("auth.users");
    expect(authDiagnostics).toContain("security_type");
    expect(authDiagnostics).toContain("profiles_table");
    expect(authDiagnostics).toContain("suggested_drop_trigger_sql");
    expect(authDiagnostics).toContain("review before running");
  });

  it("prints a narrow anonymous Auth repair SQL for the standard profile trigger", () => {
    const authRepair = `${authRepairPrint}\n${authRepairSql}`;

    expect(authRepair).toContain("public.handle_new_user");
    expect(authRepair).toContain("coalesce(new.is_anonymous, false)");
    expect(authRepair).toContain("security definer");
    expect(authRepair).toContain("set search_path = ''");
    expect(authRepair).toContain("No auth.users trigger currently calls public.handle_new_user");
    expect(authRepair).not.toContain("drop trigger if exists");
  });

  it("guards the executable anonymous Auth repair behind explicit confirmation and privileged Postgres credentials", () => {
    expect(authRepairApply).toContain("--confirm-standard-profile-trigger");
    expect(authRepairApply).toContain("SUPABASE_DB_URL");
    expect(authRepairApply).toContain("PGPASSWORD");
    expect(authRepairApply).toContain('["--no-psqlrc", "--set", "ON_ERROR_STOP=1"]');
    expect(authRepairApply).toContain("input: AUTH_ANONYMOUS_REPAIR_SQL");
    expect(authRepairApply).toContain("Do not use VITE_SUPABASE_PUBLISHABLE_KEY");
    expect(authRepairApply).not.toContain("drop trigger if exists");
  });

  it("documents that parent setup and non-service-role keys are required", () => {
    expect(docs).toContain("Parent-Required Setup");
    expect(docs).toContain("Do not put a service-role key");
    expect(docs).toContain("VITE_SUPABASE_PUBLISHABLE_KEY");
    expect(docs).toContain("supabase:print-auth-diagnostics");
    expect(docs).toContain("supabase:print-auth-anonymous-repair");
    expect(docs).toContain("supabase:apply-auth-anonymous-repair");
    expect(docs).toContain("[codex] Production readiness release");
    expect(docs).toContain("Do not encode release readiness in the branch name");
    expect(docs).toContain("Cannot update this protected ref");
  });

  it("does not let production-readiness CI silently skip Supabase verification", () => {
    expect(ciWorkflow).toContain("Supabase public secrets are not configured; cloud sync verifier did not run.");
    expect(ciWorkflow).toContain("GITHUB_STEP_SUMMARY");
    expect(ciWorkflow).toContain("GITHUB_EVENT_PATH");
    expect(ciWorkflow).toContain("[codex] Production readiness release");
    expect(ciWorkflow).not.toContain("codex/production-readiness-release*");
    expect(ciWorkflow).not.toContain("codex/release-v*");
    expect(ciWorkflow).toContain("Production-readiness release PRs and main must prove Supabase cloud sync.");
  });
});
