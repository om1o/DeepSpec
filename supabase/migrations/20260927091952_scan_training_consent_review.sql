-- Product storage is not training permission. No existing scan is opted in.
create schema if not exists private;

create table public.scan_training_consent (
  user_id uuid not null,
  scan_local_id text not null,
  training_consent boolean not null default false,
  policy_version text not null check (policy_version = '2026-09-27-v1'),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, scan_local_id),
  foreign key (user_id, scan_local_id)
    references public.scan_lookups(user_id, local_id) on delete cascade
);

create function private.stamp_scan_training_consent()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
    new.updated_at := clock_timestamp();
  elsif new.training_consent is distinct from old.training_consent
    or new.policy_version is distinct from old.policy_version then
    new.revision := old.revision + 1;
    new.updated_at := clock_timestamp();
  else
    new.revision := old.revision;
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_scan_training_consent() from public, anon, authenticated;
create trigger stamp_scan_training_consent
  before insert or update on public.scan_training_consent
  for each row execute function private.stamp_scan_training_consent();

alter table public.scan_training_consent enable row level security;
revoke all on public.scan_training_consent from public, anon, authenticated;
grant select on public.scan_training_consent to authenticated;
grant insert (user_id, scan_local_id, training_consent, policy_version)
  on public.scan_training_consent to authenticated;
grant update (training_consent, policy_version)
  on public.scan_training_consent to authenticated;
grant all on public.scan_training_consent to service_role;
create policy consent_select_own on public.scan_training_consent for select to authenticated
  using ((select auth.uid()) = user_id);
create policy consent_insert_own on public.scan_training_consent for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy consent_update_own on public.scan_training_consent for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Review authority stays outside browser accounts, including the scan owner.
create table public.scan_training_reviews (
  user_id uuid not null,
  scan_local_id text not null,
  consent_revision bigint not null check (consent_revision > 0),
  reviewed_scan_hash text not null,
  status text not null default 'candidate' check (status in ('candidate', 'verified', 'approved', 'rejected')),
  human_verified boolean not null default false,
  reviewer_reference text not null check (length(trim(reviewer_reference)) between 1 and 120),
  notes text not null default '' check (length(notes) <= 1000),
  reviewed_at timestamptz not null default now(),
  primary key (user_id, scan_local_id),
  foreign key (user_id, scan_local_id)
    references public.scan_training_consent(user_id, scan_local_id) on delete cascade,
  check (status not in ('verified', 'approved') or human_verified)
);
alter table public.scan_training_reviews enable row level security;
revoke all on public.scan_training_reviews from public, anon, authenticated;
grant all on public.scan_training_reviews to service_role;

create table public.feedback_reviews (
  feedback_id uuid primary key references public.feedback_submissions(id) on delete cascade,
  status text not null default 'new' check (status in ('new', 'reviewed', 'confirmed_issue', 'fixed')),
  reviewer_reference text not null check (length(trim(reviewer_reference)) between 1 and 120),
  notes text not null default '' check (length(notes) <= 1000),
  reviewed_at timestamptz not null default now()
);
alter table public.feedback_reviews enable row level security;
revoke all on public.feedback_reviews from public, anon, authenticated;
grant all on public.feedback_reviews to service_role;

create view public.feedback_review_queue with (security_invoker = true) as
  select f.id, f.created_at, f.category, f.message,
    coalesce(r.status, 'new') as review_status, r.reviewer_reference, r.notes, r.reviewed_at
  from public.feedback_submissions f left join public.feedback_reviews r on r.feedback_id = f.id;
revoke all on public.feedback_review_queue from public, anon, authenticated;
grant select on public.feedback_review_queue to service_role;

-- A live queue, not a dataset export. Revoke/re-opt-in and scan edits invalidate approval.
create view public.scan_training_review_queue with (security_invoker = true) as
  select c.user_id, c.scan_local_id, c.training_consent, c.policy_version,
    c.revision, c.updated_at as consent_updated_at,
    md5((to_jsonb(s) - 'synced_at')::text) as current_scan_hash,
    coalesce(r.status, 'candidate') as review_status,
    coalesce(r.human_verified, false) as human_verified,
    r.reviewer_reference, r.reviewed_at,
    coalesce(c.training_consent and r.status = 'approved' and r.human_verified
      and r.consent_revision = c.revision
      and r.reviewed_scan_hash = md5((to_jsonb(s) - 'synced_at')::text), false) as ready_for_dataset_review
  from public.scan_training_consent c
  join public.scan_lookups s on s.user_id = c.user_id and s.local_id = c.scan_local_id
  left join public.scan_training_reviews r on r.user_id = c.user_id and r.scan_local_id = c.scan_local_id;
revoke all on public.scan_training_review_queue from public, anon, authenticated;
grant select on public.scan_training_review_queue to service_role;

comment on table public.scan_training_consent is 'Explicit revocable per-scan permission. Missing row means no consent. Browser updates must compare the last read revision.';
comment on view public.scan_training_review_queue is 'Administrator-only review queue. Readiness is not dataset membership or permission to skip image privacy, license, quality and current-consent checks at export.';
