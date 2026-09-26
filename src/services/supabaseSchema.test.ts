import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const foundationMigrationPath = join(migrationsDir, "20260518000100_deepspec_secure_foundation.sql");
const durableDatasetMigrationPath = join(migrationsDir, "20260528000309_durable_dataset_tables.sql");
const mechanicShopMigrationPath = join(migrationsDir, "20260618000100_mechanic_shop_mode.sql");
const srcPath = join(process.cwd(), "src");

describe("Supabase secure foundation migration", () => {
  const sql = readFileSync(foundationMigrationPath, "utf8");

  it("keeps scan rows private with auth-owned RLS policies", () => {
    expect(sql).toContain("grant usage on schema public to anon, authenticated");
    expect(sql).toContain("alter table public.scan_lookups enable row level security");
    expect(sql).toContain("revoke all on public.scan_lookups from anon");
    expect(sql).toContain("grant select, insert, update, delete on public.scan_lookups to authenticated");
    expect(sql).toContain("using ((select auth.uid()) = user_id)");
    expect(sql).toContain("with check ((select auth.uid()) = user_id)");
  });

  it("preserves dataset fields needed for future training and review", () => {
    expect(sql).toContain("scan_category text not null default 'unknown'");
    expect(sql).toContain("training_label text not null default 'unlabeled'");
    expect(sql).toContain("training_status text not null default 'raw_unreviewed'");
    expect(sql).toContain("rating text check");
    expect(sql).toContain("correction text");
    expect(sql).toContain("chat_history jsonb not null default '[]'::jsonb");
  });

  it("uses a private storage bucket with user-folder policies", () => {
    expect(sql).toContain("insert into storage.buckets");
    expect(sql).toContain("'scan-images'");
    expect(sql).toContain("public = false");
    expect(sql).toContain("bucket_id = 'scan-images'");
    expect(sql).toContain("(storage.foldername(name))[1] = (select auth.uid())::text");
    expect(sql).toContain("notify pgrst, 'reload schema'");
  });

  it("keeps public waitlist and feedback writes narrow", () => {
    expect(sql).toContain("alter table public.waitlist_signups enable row level security");
    expect(sql).toContain("alter table public.feedback_submissions enable row level security");
    expect(sql).toContain("grant insert on public.waitlist_signups to anon, authenticated");
    expect(sql).toContain("grant insert on public.feedback_submissions to anon, authenticated");
  });

  it("does not expose service role credentials in browser source", () => {
    const source = readSourceFiles(srcPath);
    expect(source).not.toMatch(/service[_-]?role/i);
    expect(source).not.toMatch(/SUPABASE_SERVICE/i);
  });
});

describe("Supabase mechanic shop migration", () => {
  const sql = readFileSync(mechanicShopMigrationPath, "utf8");

  it("creates organization, member, job, feedback permission, and job scan tables", () => {
    expect(sql).toContain("create table if not exists public.organizations");
    expect(sql).toContain("create table if not exists public.organization_members");
    expect(sql).toContain("create table if not exists public.shop_feedback_permissions");
    expect(sql).toContain("create table if not exists public.shop_jobs");
    expect(sql).toContain("create table if not exists public.job_scans");
  });

  it("extends scan lookups with shop context without removing private history", () => {
    expect(sql).toContain("add column if not exists org_id uuid");
    expect(sql).toContain("add column if not exists job_id uuid");
    expect(sql).toContain("add column if not exists vehicle_context jsonb");
    expect(sql).toContain("add column if not exists customer_visible_report_json jsonb");
    expect(sql).toContain("add column if not exists review_status text");
    expect(sql).toContain("org_id is null");
  });

  it("enables RLS and constrains shop records to authenticated org members", () => {
    for (const table of ["organizations", "organization_members", "shop_feedback_permissions", "shop_jobs", "job_scans"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`revoke all on public.${table} from anon`);
    }
    expect(sql).toContain("organization_members.user_id = (select auth.uid())");
    expect(sql).toContain("organization_members.role in ('owner', 'admin', 'technician')");
    expect(sql).toContain("scan_lookups_select_own");
  });

  it("adds provider-neutral billing fields while retaining legacy adapter columns", () => {
    expect(sql).toContain("add column if not exists billing_provider text not null default 'stripe'");
    expect(sql).toContain("add column if not exists provider_customer_id text");
    expect(sql).toContain("provider_customer_id = coalesce(provider_customer_id, stripe_customer_id)");
    expect(sql).toContain("alter column stripe_customer_id drop not null");
    expect(sql).toContain("billing_entitlements_provider_subscription_key");
  });
});

describe("Supabase durable dataset migration", () => {
  const sql = readFileSync(durableDatasetMigrationPath, "utf8");

  it("adds original image metadata to scan_lookups", () => {
    expect(sql).toContain("add column if not exists image_hash text");
    expect(sql).toContain("add column if not exists image_mime_type text");
    expect(sql).toContain("add column if not exists image_byte_length integer");
  });

  it("creates model run, candidate, evidence, correction, and sync event tables", () => {
    expect(sql).toContain("create table if not exists public.scan_model_runs");
    expect(sql).toContain("create table if not exists public.scan_candidates");
    expect(sql).toContain("create table if not exists public.scan_evidence");
    expect(sql).toContain("create table if not exists public.scan_corrections");
    expect(sql).toContain("create table if not exists public.sync_events");
  });

  it("keeps dataset detail tables auth-owned and Data API accessible to authenticated users", () => {
    for (const table of ["scan_model_runs", "scan_candidates", "scan_evidence", "scan_corrections", "sync_events"]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`revoke all on public.${table} from anon`);
      expect(sql).toContain(`grant select, insert, update, delete on public.${table} to authenticated`);
      expect(sql).toContain(`(select auth.uid()) = user_id`);
    }
  });

  it("links detail rows back to the user-owned scan row", () => {
    expect(sql).toContain("references public.scan_lookups (user_id, local_id)");
    expect(sql).toContain("on delete cascade");
    expect(sql).toContain("notify pgrst, 'reload schema'");
  });
});

function readSourceFiles(path: string): string {
  return readdirSync(path)
    .flatMap((entry) => {
      const entryPath = join(path, entry);
      if (statSync(entryPath).isDirectory()) {
        return readSourceFiles(entryPath);
      }

      if (!/\.(ts|tsx)$/.test(entryPath) || /\.test\.(ts|tsx)$/.test(entryPath)) {
        return [];
      }

      return readFileSync(entryPath, "utf8");
    })
    .join("\n");
}
