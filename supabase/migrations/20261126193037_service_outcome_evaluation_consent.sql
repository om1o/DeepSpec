-- Follow-up outcomes need their own revocable permission. Scan training consent
-- does not cover human service history. This path is for evaluation only.
create table public.service_outcome_consents (
  user_id uuid not null,
  scan_local_id text not null,
  record_id uuid not null,
  evaluation_consent boolean not null default false,
  policy_version text not null check (policy_version = '2026-11-26-v1'),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, record_id),
  foreign key (user_id, record_id) references public.human_service_records(user_id, id) on delete cascade,
  foreign key (user_id, scan_local_id) references public.scan_lookups(user_id, local_id) on delete cascade
);

create function private.stamp_service_outcome_consent()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from public.human_service_records r
    where r.user_id = new.user_id and r.lookup_id = new.scan_local_id and r.id = new.record_id
      and r.record_json->>'kind' = 'follow_up'
  ) then
    raise exception 'service_outcome_record_mismatch' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if (new.user_id, new.scan_local_id, new.record_id) is distinct from
       (old.user_id, old.scan_local_id, old.record_id) then
      raise exception 'service_outcome_consent_identity_immutable' using errcode = '23514';
    end if;
    if new.evaluation_consent is distinct from old.evaluation_consent
      or new.policy_version is distinct from old.policy_version then
      new.revision := old.revision + 1;
      new.updated_at := clock_timestamp();
    else
      new.revision := old.revision;
      new.updated_at := old.updated_at;
    end if;
  else
    new.revision := 1;
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_service_outcome_consent() from public, anon, authenticated;
create trigger stamp_service_outcome_consent before insert or update on public.service_outcome_consents
  for each row execute function private.stamp_service_outcome_consent();

alter table public.service_outcome_consents enable row level security;
revoke all on public.service_outcome_consents from public, anon, authenticated;
grant select on public.service_outcome_consents to authenticated;
grant insert (user_id, scan_local_id, record_id, evaluation_consent, policy_version)
  on public.service_outcome_consents to authenticated;
grant update (evaluation_consent, policy_version) on public.service_outcome_consents to authenticated;
grant all on public.service_outcome_consents to service_role;
create policy service_outcome_consent_select_owner on public.service_outcome_consents for select to authenticated
  using ((select auth.uid()) = user_id);
create policy service_outcome_consent_insert_owner on public.service_outcome_consents for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy service_outcome_consent_update_owner on public.service_outcome_consents for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- A curator deliberately chooses one reviewed follow-up record for one
-- immutable, human-reviewed identification in an evaluation dataset version.
create table public.dataset_outcome_reviews (
  dataset_member_id uuid primary key references public.dataset_members(id) on delete cascade,
  user_id uuid not null,
  scan_local_id text not null,
  record_id uuid not null,
  consent_revision bigint not null check (consent_revision > 0),
  policy_version text not null check (policy_version = '2026-11-26-v1'),
  reviewed_history_hash text not null check (reviewed_history_hash ~ '^[a-f0-9]{32}$'),
  status text not null check (status in ('candidate', 'approved', 'rejected')),
  category_checked boolean not null default false,
  reviewer_reference text not null check (length(trim(reviewer_reference)) between 1 and 120),
  reviewed_at timestamptz not null default now(),
  check (status <> 'approved' or category_checked),
  foreign key (user_id, record_id) references public.human_service_records(user_id, id) on delete cascade,
  foreign key (user_id, scan_local_id) references public.scan_lookups(user_id, local_id) on delete cascade
);
alter table public.dataset_outcome_reviews enable row level security;
revoke all on public.dataset_outcome_reviews from public, anon, authenticated;
grant all on public.dataset_outcome_reviews to service_role;
grant select on public.human_service_records to service_role;

-- A new correction, retraction, or other same-scan service entry changes the
-- reviewed history hash. No raw service JSON, notes, photos, VIN or names leave
-- this administrator-only view.
create view public.dataset_outcome_export_queue with (security_invoker = true) as
select o.dataset_member_id, e.dataset_version, o.record_id,
  r.record_json->>'outcome' as reported_outcome,
  r.record_json->>'basis' as reporting_basis,
  o.consent_revision, o.policy_version, o.reviewer_reference,
  o.reviewed_history_hash,
  coalesce(e.eligible and v.purpose = 'evaluation'
    and (e.label_source = 'human_verified_prediction'
      or (e.label_source = 'human_verified_correction' and nullif(trim(e.correction), '') is not null))
    and o.user_id = d.user_id and o.scan_local_id = d.scan_local_id
    and c.evaluation_consent and c.revision = o.consent_revision
    and c.policy_version = o.policy_version
    and o.status = 'approved' and o.category_checked
    and o.reviewed_history_hash = history.current_hash
    and r.record_json->>'kind' = 'follow_up'
    and r.record_json->>'outcome' in ('not_checked', 'symptom_observed', 'symptom_not_observed', 'inconclusive')
    and not exists (
      select 1 from public.human_service_records next
      where next.user_id = r.user_id and next.lookup_id = r.lookup_id
        and next.record_json->>'supersedesId' = r.id::text
    ), false) as eligible
from public.dataset_outcome_reviews o
join public.dataset_members d on d.id = o.dataset_member_id
join public.dataset_export_queue e on e.id = d.id
join public.dataset_versions v on v.version = d.dataset_version
join public.human_service_records r on r.user_id = o.user_id and r.lookup_id = o.scan_local_id and r.id = o.record_id
join public.service_outcome_consents c on c.user_id = o.user_id and c.scan_local_id = o.scan_local_id and c.record_id = o.record_id
cross join lateral (
  select md5(coalesce(jsonb_agg(h.record_json order by h.id), '[]'::jsonb)::text) as current_hash
  from public.human_service_records h where h.user_id = o.user_id and h.lookup_id = o.scan_local_id
) history;
revoke all on public.dataset_outcome_export_queue from public, anon, authenticated;
grant select on public.dataset_outcome_export_queue to service_role;
comment on view public.dataset_outcome_export_queue is 'Evaluation-only, separately consented and reviewed self-reported outcome category. Not repair proof or a training label.';
