import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const foundationMigrationPath = join(migrationsDir, "20260518000100_deepspec_secure_foundation.sql");
const durableDatasetMigrationPath = join(migrationsDir, "20260528000309_durable_dataset_tables.sql");
const mechanicShopMigrationPath = join(migrationsDir, "20260618000100_mechanic_shop_mode.sql");
const membershipHardeningMigrationPath = join(migrationsDir, "20261010171030_harden_organization_member_identity.sql");
const shopJobIdentityMigrationPath = join(migrationsDir, "20261101121022_harden_shop_job_identity.sql");
const billingIdempotencyMigrationPath = join(migrationsDir, "20261101121024_billing_webhook_idempotency.sql");
const billingIdempotencySqlTestPath = join(process.cwd(), "supabase", "tests", "billing_webhook_idempotency.sql");
const publicWriteHardeningMigrationPath = join(migrationsDir, "20261101121028_harden_public_write_surfaces.sql");
const publicWriteHardeningSqlTestPath = join(process.cwd(), "supabase", "tests", "public_write_hardening.sql");
const releaseSecurityOptimizationMigrationPath = join(migrationsDir, "20261101121627_optimize_release_security.sql");
const componentMapMigrationPath = join(migrationsDir, "20261105091323_component_maps.sql");
const componentMapOccurrencesMigrationPath = join(migrationsDir, "20261105211101_component_map_occurrences.sql");
const componentMapOverviewSourceMigrationPath = join(migrationsDir, "20261105213351_component_map_overview_source.sql");
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

  it("creates the original waitlist and feedback surfaces behind RLS", () => {
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

describe("Supabase form-write hardening migration", () => {
  const sql = readFileSync(publicWriteHardeningMigrationPath, "utf8");

  it("removes anonymous writes and binds protected metadata to database defaults", () => {
    expect(sql).toContain("alter column user_id set default auth.uid()");
    expect(sql).toContain("revoke insert on public.waitlist_signups from public, anon, authenticated");
    expect(sql).toContain("revoke insert on public.feedback_submissions from public, anon, authenticated");
    expect(sql).toContain("grant insert (email, user_type, main_problem)");
    expect(sql).toContain("grant insert (category, message, contact_email, issue_code, scan_local_id, reported_prediction)");
    expect(sql).toContain("to authenticated");
    expect(sql).not.toMatch(/to anon\b/);
    expect(sql).toContain("(select auth.jwt()) ->> 'is_anonymous'");
    expect(sql).not.toContain("select auth.jwt() ->> 'is_anonymous'");
  });

  it("caps user-controlled text and includes a rollback-only privilege regression", () => {
    expect(sql).toContain("length(main_problem) <= 800");
    expect(sql).toContain("length(message) between 8 and 800");
    expect(sql).toContain("length(contact_email) <= 160");
    expect(sql).toContain("waitlist_signups_user_created_idx");
    expect(sql).toContain("feedback_submissions_user_created_idx");
    expect(sql).toContain("create function public.enforce_form_write_quota()");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("daily_limit := 3");
    expect(sql).toContain("daily_limit := 20");
    expect(sql).toContain("created_at <= now()");
    const regression = readFileSync(publicWriteHardeningSqlTestPath, "utf8");
    expect(regression).toContain("has_table_privilege('anon', 'public.waitlist_signups', 'insert')");
    expect(regression).toContain("has_column_privilege('authenticated', 'public.feedback_submissions', 'user_id', 'insert')");
    expect(regression).toContain("repeat('x', 801)");
    expect(regression).toContain("'is_anonymous', true");
    expect(regression).toContain("Anonymous authenticated feedback user was accepted");
    expect(regression).toContain("now() + interval '10 years'");
    expect(regression).toContain("Twenty-first daily feedback should fail");
    expect(regression).toContain("Fourth daily signup should fail");
    expect(regression).toContain("rollback;");
  });
});

describe("Supabase release security optimization migration", () => {
  const sql = readFileSync(releaseSecurityOptimizationMigrationPath, "utf8");

  it("keeps form ownership checks planner-safe", () => {
    expect(sql).toContain("drop policy if exists waitlist_signups_insert_authenticated");
    expect(sql).toContain("drop policy if exists feedback_submissions_insert_authenticated");
    expect(sql.match(/\(select auth\.jwt\(\)\) ->> 'is_anonymous'/g)).toHaveLength(2);
    expect(sql).not.toContain("select auth.jwt() ->> 'is_anonymous'");
  });

  it("covers the release foreign keys", () => {
    expect(sql).toContain("billing_purchase_events_user_idx");
    expect(sql).toContain("on public.billing_purchase_events (user_id)");
    expect(sql).toContain("job_scans_job_org_cover_idx");
    expect(sql).toContain("on public.job_scans (job_id, org_id)");
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

  it("does not let clients rewrite membership identity or role", () => {
    expect(sql).toContain("grant select, insert, delete on public.organization_members to authenticated");
    expect(sql).not.toContain("grant select, insert, update, delete on public.organization_members to authenticated");
    expect(sql).not.toContain("create policy organization_members_update_self");
  });

  it("adds provider-neutral billing fields while retaining legacy adapter columns", () => {
    expect(sql).toContain("add column if not exists billing_provider text not null default 'stripe'");
    expect(sql).toContain("add column if not exists provider_customer_id text");
    expect(sql).toContain("provider_customer_id = coalesce(provider_customer_id, stripe_customer_id)");
    expect(sql).toContain("alter column stripe_customer_id drop not null");
    expect(sql).toContain("billing_entitlements_provider_subscription_key");
  });
});

describe("Supabase organization membership hardening migration", () => {
  const sql = readFileSync(membershipHardeningMigrationPath, "utf8");

  it("removes update privileges and the unsafe self-update policy", () => {
    expect(sql).toContain("revoke update on public.organization_members from authenticated");
    expect(sql).toContain("drop policy if exists organization_members_update_self on public.organization_members");
    expect(sql).not.toContain("create policy organization_members_update_self");
  });
});

describe("Supabase shop job identity hardening migration", () => {
  const sql = readFileSync(shopJobIdentityMigrationPath, "utf8").replace(/\r\n/g, "\n");

  it("binds every job scan to a job in the same organization", () => {
    expect(sql).toContain("constraint shop_jobs_id_org_key unique (id, org_id)");
    expect(sql).toContain("constraint job_scans_job_org_fk");
    expect(sql).toContain("foreign key (job_id, org_id)");
    expect(sql).toContain("references public.shop_jobs (id, org_id)");
  });

  it("keeps identity columns immutable while allowing workflow updates", () => {
    expect(sql).toContain("revoke update on public.shop_jobs from authenticated");
    expect(sql).toContain("revoke update on public.job_scans from authenticated");
    expect(sql).toContain("grant update (\n  title,");
    expect(sql).toContain("grant update (\n  org_id,\n  review_status,\n  customer_visible_report_json");
    expect(sql).not.toContain("grant update (\n  job_id,");
    expect(sql).not.toContain("grant update (\n  user_id,");
  });
});

describe("Supabase billing webhook idempotency migration", () => {
  const sql = readFileSync(billingIdempotencyMigrationPath, "utf8");

  it("records an immutable provider event key before granting credits", () => {
    expect(sql).toContain("primary key (billing_provider, event_key)");
    expect(sql).toContain("insert into public.billing_purchase_events");
    expect(sql).toContain("on conflict (billing_provider, event_key) do nothing");
    expect(sql).toContain("if not coalesce(event_inserted, false) then");
  });

  it("updates the entitlement in the same database function", () => {
    expect(sql).toContain("create function public.apply_billing_purchase");
    expect(sql).toContain("insert into public.billing_entitlements");
    expect(sql).toContain("scan_allowance = case when p_additive");
  });

  it("keeps the event ledger and RPC server-only", () => {
    expect(sql).toContain("alter table public.billing_purchase_events enable row level security");
    expect(sql).toContain("revoke all on public.billing_purchase_events from public, anon, authenticated, service_role");
    expect(sql).toContain("grant select, insert on public.billing_purchase_events to service_role");
    expect(sql).toContain("revoke all on function public.apply_billing_purchase");
    expect(sql).toContain("grant execute on function public.apply_billing_purchase");
  });

  it("includes a rollback-only duplicate-event SQL regression", () => {
    const regression = readFileSync(billingIdempotencySqlTestPath, "utf8");
    expect(regression).toContain("duplicate_applied := public.apply_billing_purchase");
    expect(regression).toContain("if duplicate_applied is distinct from false");
    expect(regression).toContain("if allowance <> 20");
    expect(regression).toContain("if event_count <> 1");
    expect(regression).toContain("'public.billing_purchase_events', 'truncate'");
    expect(regression).toContain("rollback;");
  });
});

describe("Supabase component-map overview source migration", () => {
  const sql = readFileSync(componentMapOverviewSourceMigrationPath, "utf8").replace(/\r\n/g, "\n");
  const previous = readFileSync(componentMapOccurrencesMigrationPath, "utf8").replace(/\r\n/g, "\n");

  it("requires an exact v3 source and rejects binding metadata on legacy documents", () => {
    expect(sql).toContain("if doc->'version' = '3'::jsonb then");
    expect(sql).toContain("jsonb_typeof(overview_source) is distinct from 'object'");
    expect(sql).toContain("overview_source - array['sha256', 'width', 'height', 'photoAddedAt', 'scanSavedAt']");
    expect(sql).toContain("overview_source->>'sha256' ~ '^[a-f0-9]{64}$'");
    expect(sql).toContain("elsif (doc->'overview') ? 'source' then");
    expect(sql).toContain("raise exception 'invalid_component_map_legacy_source'");
  });

  it("bounds decoded integer dimensions and canonical UTC millisecond timestamps", () => {
    for (const field of ["width", "height"]) {
      expect(sql).toContain(`jsonb_typeof(overview_source->'${field}') is distinct from 'number'`);
      expect(sql).toContain(`(overview_source->>'${field}')::numeric not between 1 and 32768`);
      expect(sql).toContain(`trunc((overview_source->>'${field}')::numeric) <> (overview_source->>'${field}')::numeric`);
    }
    expect(sql).toContain("(overview_source->>'width')::numeric * (overview_source->>'height')::numeric > 100000000");
    expect(sql).toContain("foreach key in array array['photoAddedAt', 'scanSavedAt']");
    expect(sql).toContain("left(source_time, 4) = '0000'");
    expect(sql).toContain("'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'");
    expect(sql).toContain("exception when sqlstate '22007' or sqlstate '22008'");
  });

  it("keeps v3 bindings immutable and blocks older-client downgrade without rewriting rows", () => {
    expect(sql).toContain("old.document_json->'version' = '3'::jsonb and doc->'version' is distinct from '3'::jsonb");
    expect(sql).toContain("doc#>'{overview,source}' is distinct from old.document_json#>'{overview,source}'");
    expect(sql).toContain("raise exception 'component_map_overview_source_immutable'");
    expect(sql).not.toMatch(/(?:^|\n)\s*(?:alter table|drop|grant|insert into|update public|delete from|create trigger)\b/i);
  });

  it("preserves prior trigger failures and ownership while allowing location hints in versions 2 and 3", () => {
    for (const [, message, code] of previous.matchAll(/raise exception '([^']+)' using errcode = '([^']+)'/g)) {
      expect(sql).toContain(`raise exception '${message}' using errcode = '${code}'`);
    }
    expect(sql).toContain("security invoker set search_path = ''");
    expect(sql).toContain("s.user_id = new.user_id and s.local_id = link->>'lookupId'");
    expect(sql).toContain("new.revision is distinct from old.revision + 1");
    expect(sql).toContain("if (doc->'version' is distinct from '2'::jsonb and doc->'version' is distinct from '3'::jsonb) or jsonb_typeof(suggested_location) is distinct from 'object' then");
    expect(sql).toContain("revoke all on function private.guard_component_map() from public, anon, authenticated");
  });
});

describe("Supabase component-map occurrence compatibility migration", () => {
  const sql = readFileSync(componentMapOccurrencesMigrationPath, "utf8").replace(/\r\n/g, "\n");
  const previous = readFileSync(componentMapMigrationPath, "utf8").replace(/\r\n/g, "\n");

  it("extends the existing trigger without rewriting rows or changing ownership privileges", () => {
    expect(sql).toContain("create or replace function private.guard_component_map()");
    expect(sql).toContain("security invoker set search_path = ''");
    expect(sql).toContain("revoke all on function private.guard_component_map() from public, anon, authenticated");
    expect(sql).not.toMatch(/(?:^|\n)\s*(?:alter table|drop|grant|insert into|update public|delete from|create trigger)\b/i);
  });

  it("accepts both document versions but forbids downgrading an existing occurrence map", () => {
    expect(sql).toContain("doc->'version' is distinct from '1'::jsonb and doc->'version' is distinct from '2'::jsonb");
    expect(sql).toContain("old.document_json->'version' = '2'::jsonb and doc->'version' is distinct from '2'::jsonb");
    expect(sql).toContain("raise exception 'component_map_version_downgrade'");
  });

  it("requires exact version-2 AI-location metadata with canonical text bounded to 240 characters", () => {
    expect(sql).toContain("if component ? 'suggestedLocation' then");
    expect(sql).toContain("doc->'version' is distinct from '2'::jsonb or jsonb_typeof(suggested_location) is distinct from 'object'");
    expect(sql).toContain("suggested_location->'source' is distinct from '\"ai_scene\"'::jsonb");
    expect(sql).toContain("jsonb_typeof(suggested_location->'text') is distinct from 'string'");
    expect(sql).toContain("(suggested_location - array['source', 'text']) <> '{}'::jsonb");
    expect(sql).toContain("length(suggested_location->>'text') not between 1 and 240");
    expect(sql).toContain("btrim(suggested_location->>'text', location_trim_characters)");
    expect(sql).toContain("\\00A0");
    expect(sql).toContain("\\FEFF");
  });

  it("retains every existing trigger protection for identity, revisions, review, geometry and owned photos", () => {
    const previousErrors = [...previous.matchAll(/raise exception '([^']+)' using errcode = '([^']+)'/g)];
    expect(previousErrors.length).toBeGreaterThan(10);
    for (const [, message, code] of previousErrors) {
      expect(sql).toContain(`raise exception '${message}' using errcode = '${code}'`);
    }
    for (const guard of [
      "new.user_id is distinct from old.user_id or new.map_id is distinct from old.map_id",
      "doc#>>'{overview,photoId}' is distinct from old.document_json#>>'{overview,photoId}'",
      "new.revision is distinct from old.revision + 1",
      "jsonb_array_length(doc->'components') > 100",
      "lower(component->>'id') = any(component_ids)",
      "component ? 'reviewedAt' or component->>'status' <> 'needs_view'",
      "region->>'sourcePhotoId' is distinct from doc#>>'{overview,photoId}'",
      "(box->>'x')::numeric + (box->>'width')::numeric > 1",
      "lower(link->>'linkId') = any(link_ids)",
      "jsonb_array_length(link->'photoIds') not between 1 and 4",
      "s.user_id = new.user_id and s.local_id = link->>'lookupId'",
      "if (photo#>>'{}' = any(photo_ids)) is not true then",
    ]) expect(sql).toContain(guard);
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
