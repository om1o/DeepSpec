-- Durable dataset detail tables for synced Deep Spec scans.
-- This migration is intentionally additive: scan_lookups remains the owner row
-- and child tables reference its (user_id, local_id) pair so the browser client
-- can write detail rows without needing service-role access.

alter table public.scan_lookups
  add column if not exists image_hash text,
  add column if not exists image_mime_type text,
  add column if not exists image_byte_length integer
    check (image_byte_length is null or image_byte_length >= 0);

comment on column public.scan_lookups.image_hash is 'SHA-256 hash of the original scan image, used for dedupe and dataset exports.';
comment on column public.scan_lookups.image_mime_type is 'Browser-provided MIME type for the original scan image.';
comment on column public.scan_lookups.image_byte_length is 'Original scan image byte length before upload.';

create table if not exists public.scan_model_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_local_id text not null,
  created_at timestamptz not null default now(),
  provider text not null default 'unknown',
  model text not null default 'unknown',
  prompt_version text,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  ocr_used boolean not null default false,
  error_code text,
  error_message text,
  metadata_json jsonb not null default '{}'::jsonb,
  constraint scan_model_runs_scan_fk
    foreign key (user_id, scan_local_id)
    references public.scan_lookups (user_id, local_id)
    on delete cascade
);

comment on table public.scan_model_runs is 'Provider/model metadata for each synced scan attempt, kept separate from the user-facing scan row.';

create index if not exists scan_model_runs_scan_idx on public.scan_model_runs (user_id, scan_local_id, created_at desc);
create index if not exists scan_model_runs_model_idx on public.scan_model_runs (provider, model, created_at desc);

alter table public.scan_model_runs enable row level security;
revoke all on public.scan_model_runs from anon;
grant select, insert, update, delete on public.scan_model_runs to authenticated;

drop policy if exists scan_model_runs_select_own on public.scan_model_runs;
create policy scan_model_runs_select_own
  on public.scan_model_runs
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists scan_model_runs_insert_own on public.scan_model_runs;
create policy scan_model_runs_insert_own
  on public.scan_model_runs
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists scan_model_runs_update_own on public.scan_model_runs;
create policy scan_model_runs_update_own
  on public.scan_model_runs
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists scan_model_runs_delete_own on public.scan_model_runs;
create policy scan_model_runs_delete_own
  on public.scan_model_runs
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.scan_candidates (
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_local_id text not null,
  candidate_rank integer not null check (candidate_rank >= 0),
  part_name text not null,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  scan_category text not null default 'unknown'
    check (scan_category in ('engine', 'electrical', 'brakes', 'steering', 'suspension', 'fuel', 'airbag', 'body', 'leak', 'unknown')),
  reason text not null default '',
  candidate_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, scan_local_id, candidate_rank),
  constraint scan_candidates_scan_fk
    foreign key (user_id, scan_local_id)
    references public.scan_lookups (user_id, local_id)
    on delete cascade
);

comment on table public.scan_candidates is 'Ranked candidate matches from the model response, exportable without parsing result_json.';

create index if not exists scan_candidates_part_idx on public.scan_candidates (part_name, confidence);

alter table public.scan_candidates enable row level security;
revoke all on public.scan_candidates from anon;
grant select, insert, update, delete on public.scan_candidates to authenticated;

drop policy if exists scan_candidates_select_own on public.scan_candidates;
create policy scan_candidates_select_own on public.scan_candidates for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists scan_candidates_insert_own on public.scan_candidates;
create policy scan_candidates_insert_own on public.scan_candidates for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists scan_candidates_update_own on public.scan_candidates;
create policy scan_candidates_update_own on public.scan_candidates for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists scan_candidates_delete_own on public.scan_candidates;
create policy scan_candidates_delete_own on public.scan_candidates for delete to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.scan_evidence (
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_local_id text not null,
  evidence_rank integer not null check (evidence_rank >= 0),
  evidence_type text not null
    check (evidence_type in ('observation', 'region', 'concern', 'evidence', 'source_link', 'ocr')),
  label text,
  region_label text,
  evidence_text text not null default '',
  url text,
  source_type text check (source_type in ('dataset', 'reference', 'search', 'safety') or source_type is null),
  evidence_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, scan_local_id, evidence_rank),
  constraint scan_evidence_scan_fk
    foreign key (user_id, scan_local_id)
    references public.scan_lookups (user_id, local_id)
    on delete cascade
);

comment on table public.scan_evidence is 'Structured observations, regions, concerns, OCR text, and sources for dataset review.';

create index if not exists scan_evidence_type_idx on public.scan_evidence (evidence_type, created_at desc);

alter table public.scan_evidence enable row level security;
revoke all on public.scan_evidence from anon;
grant select, insert, update, delete on public.scan_evidence to authenticated;

drop policy if exists scan_evidence_select_own on public.scan_evidence;
create policy scan_evidence_select_own on public.scan_evidence for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists scan_evidence_insert_own on public.scan_evidence;
create policy scan_evidence_insert_own on public.scan_evidence for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists scan_evidence_update_own on public.scan_evidence;
create policy scan_evidence_update_own on public.scan_evidence for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists scan_evidence_delete_own on public.scan_evidence;
create policy scan_evidence_delete_own on public.scan_evidence for delete to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.scan_corrections (
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_local_id text not null,
  rating text check (rating in ('up', 'down') or rating is null),
  correction_text text,
  corrected_part_name text,
  corrected_category text
    check (corrected_category in ('engine', 'electrical', 'brakes', 'steering', 'suspension', 'fuel', 'airbag', 'body', 'leak', 'unknown') or corrected_category is null),
  damage_severity text check (damage_severity in ('none', 'minor', 'moderate', 'severe', 'unknown') or damage_severity is null),
  region_label text,
  notes text not null default '',
  training_status text not null default 'raw_unreviewed'
    check (training_status in ('raw_unreviewed', 'user_confirmed', 'user_corrected')),
  reviewed_at timestamptz not null default now(),
  primary key (user_id, scan_local_id),
  constraint scan_corrections_scan_fk
    foreign key (user_id, scan_local_id)
    references public.scan_lookups (user_id, local_id)
    on delete cascade
);

comment on table public.scan_corrections is 'Structured human review data derived from rating, correction, and notes.';

create index if not exists scan_corrections_status_idx on public.scan_corrections (training_status, reviewed_at desc);

alter table public.scan_corrections enable row level security;
revoke all on public.scan_corrections from anon;
grant select, insert, update, delete on public.scan_corrections to authenticated;

drop policy if exists scan_corrections_select_own on public.scan_corrections;
create policy scan_corrections_select_own on public.scan_corrections for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists scan_corrections_insert_own on public.scan_corrections;
create policy scan_corrections_insert_own on public.scan_corrections for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists scan_corrections_update_own on public.scan_corrections;
create policy scan_corrections_update_own on public.scan_corrections for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists scan_corrections_delete_own on public.scan_corrections;
create policy scan_corrections_delete_own on public.scan_corrections for delete to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.sync_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_local_id text,
  event_type text not null check (event_type in ('upload', 'upsert', 'delete', 'verify')),
  status text not null check (status in ('success', 'failure')),
  message text not null default '',
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.sync_events is 'User-owned cloud sync audit events for upload/upsert/delete verification.';

create index if not exists sync_events_user_created_idx on public.sync_events (user_id, created_at desc);
create index if not exists sync_events_scan_idx on public.sync_events (user_id, scan_local_id, created_at desc);

alter table public.sync_events enable row level security;
revoke all on public.sync_events from anon;
grant select, insert, update, delete on public.sync_events to authenticated;

drop policy if exists sync_events_select_own on public.sync_events;
create policy sync_events_select_own on public.sync_events for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists sync_events_insert_own on public.sync_events;
create policy sync_events_insert_own on public.sync_events for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists sync_events_update_own on public.sync_events;
create policy sync_events_update_own on public.sync_events for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists sync_events_delete_own on public.sync_events;
create policy sync_events_delete_own on public.sync_events for delete to authenticated using ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
