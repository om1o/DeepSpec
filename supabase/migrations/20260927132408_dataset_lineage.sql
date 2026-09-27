-- Privileged curation only. These rows record review decisions, not automatic training.
create table public.dataset_versions (
  version text primary key check (version ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$'),
  purpose text not null check (purpose in ('evaluation', 'training')),
  description text not null check (length(description) between 1 and 1000),
  created_at timestamptz not null default now()
);
create table public.dataset_members (
  id uuid primary key default gen_random_uuid(),
  dataset_version text not null references public.dataset_versions(version),
  user_id uuid not null,
  scan_local_id text not null,
  model_run_id uuid not null references public.scan_model_runs(id) on delete cascade,
  consent_revision bigint not null check (consent_revision > 0),
  policy_version text not null,
  scan_hash text not null,
  model_run_hash text not null,
  label text not null check (length(trim(label)) between 1 and 160),
  label_source text not null check (label_source in ('human_verified_prediction', 'human_verified_correction')),
  reviewer_reference text not null check (length(trim(reviewer_reference)) between 1 and 120),
  privacy_checked boolean not null check (privacy_checked),
  usage_rights_checked boolean not null check (usage_rights_checked),
  quality_checked boolean not null check (quality_checked),
  reviewed_at timestamptz not null default now(),
  unique (dataset_version, user_id, scan_local_id),
  foreign key (user_id, scan_local_id) references public.scan_lookups(user_id, local_id) on delete cascade
);
alter table public.dataset_versions enable row level security;
alter table public.dataset_members enable row level security;
revoke all on public.dataset_versions, public.dataset_members from public, anon, authenticated;
grant all on public.dataset_versions, public.dataset_members to service_role;

-- Freeze review snapshots. To revise a membership, create another dataset version.
create function private.reject_dataset_update() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Dataset records are immutable; create a new version';
end;
$$;
revoke all on function private.reject_dataset_update() from public, anon, authenticated;
create trigger immutable_dataset_member before update on public.dataset_members
for each row execute function private.reject_dataset_update();
create trigger immutable_dataset_version before update on public.dataset_versions
for each row execute function private.reject_dataset_update();

create view public.dataset_export_queue with (security_invoker = true) as
select d.id, d.dataset_version, d.user_id, d.scan_local_id, d.consent_revision,
  d.policy_version, d.scan_hash, d.model_run_id, d.model_run_hash,
  d.label, d.label_source, d.reviewer_reference,
  s.result_json ->> 'partName' as original_prediction, s.correction,
  m.provider, m.model, m.prompt_version, m.pipeline_version,
  s.image_path as original_image_path, s.image_hash as original_image_hash,
  s.image_mime_type as original_image_mime_type, s.image_byte_length as original_image_byte_length,
  s.isolated_image_path, s.isolated_image_hash, s.isolated_image_mime_type,
  s.isolated_image_byte_length, s.isolated_image_kind,
  coalesce(q.ready_for_dataset_review
    and q.revision = d.consent_revision and q.policy_version = d.policy_version
    and q.current_scan_hash = d.scan_hash
    and m.user_id = d.user_id and m.scan_local_id = d.scan_local_id
    and md5(to_jsonb(m)::text) = d.model_run_hash
    and s.image_path like d.user_id::text || '/%'
    and s.image_hash ~ '^[a-f0-9]{64}$'
    and s.image_byte_length between 1 and 2097152
    and s.image_mime_type in ('image/jpeg', 'image/png', 'image/webp')
    and (s.isolated_image_path is null or (
      s.isolated_image_path like d.user_id::text || '/%'
      and s.isolated_image_hash ~ '^[a-f0-9]{64}$'
      and s.isolated_image_byte_length between 1 and 2097152
      and s.isolated_image_mime_type in ('image/jpeg', 'image/png', 'image/webp')
      and s.isolated_image_kind in ('crop', 'segmentation'))), false) as eligible
from public.dataset_members d
join public.scan_lookups s on s.user_id = d.user_id and s.local_id = d.scan_local_id
join public.scan_model_runs m on m.id = d.model_run_id
join public.scan_training_review_queue q on q.user_id = d.user_id and q.scan_local_id = d.scan_local_id;
revoke all on public.dataset_export_queue from public, anon, authenticated;
grant select on public.dataset_export_queue to service_role;
comment on view public.dataset_export_queue is 'Export-time eligibility; exporter must also download private bytes, verify hashes and recheck this view before publication. Never a public endpoint.';
comment on table public.dataset_members is 'Immutable reviewed membership. Source or model-run deletion cascades. Current consent and unchanged source required at every export; historical exported copies require separate purge tracking.';
