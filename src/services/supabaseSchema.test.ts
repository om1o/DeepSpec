import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(process.cwd(), "supabase", "migrations", "20260518000100_deepspec_secure_foundation.sql");
const srcPath = join(process.cwd(), "src");

describe("Supabase secure foundation migration", () => {
  const sql = readFileSync(migrationPath, "utf8");

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
    expect(sql).toContain("metadata_json jsonb not null default '{}'::jsonb");
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
