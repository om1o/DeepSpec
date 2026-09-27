-- Add queryable fields without changing or removing historical report text.
alter table public.feedback_submissions
  add column issue_code text,
  add column scan_local_id text,
  add column reported_prediction text,
  add constraint feedback_issue_code_allowed check (issue_code is null or issue_code in (
    'wrong_part', 'wrong_vehicle', 'wrong_value', 'wrong_condition', 'missing_information',
    'bad_explanation', 'other_result', 'ar_placement', 'ar_component', 'ar_jitter',
    'ar_tracking', 'ar_disappeared', 'ar_camera', 'ar_label', 'ar_detection', 'ar_other',
    'bug', 'feature_request'
  )),
  add constraint feedback_scan_id_length check (scan_local_id is null or length(scan_local_id) between 1 and 100),
  add constraint feedback_prediction_length check (reported_prediction is null or length(reported_prediction) <= 160),
  add constraint feedback_link_requires_owner check (scan_local_id is null or user_id is not null),
  add constraint feedback_owned_scan_fk foreign key (user_id, scan_local_id)
    references public.scan_lookups(user_id, local_id) on delete set null (scan_local_id);

comment on column public.feedback_submissions.reported_prediction is
  'User-supplied historical prediction context, not verified truth or training consent. Retained if the linked scan is deleted.';
comment on column public.feedback_submissions.scan_local_id is
  'Optional explicitly shared link to an owned cloud scan. Device-only context remains in the original message.';

-- User deletion also clears the link, regardless of FK-trigger execution order.
create function public.clear_feedback_link_on_owner_removal() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.user_id is null then new.scan_local_id := null; end if;
  return new;
end;
$$;
revoke all on function public.clear_feedback_link_on_owner_removal() from public, anon, authenticated;
create trigger feedback_owner_removed before update of user_id on public.feedback_submissions
  for each row execute function public.clear_feedback_link_on_owner_removal();

-- Backfill only the exact v1 envelope emitted by the application. Never infer
-- arbitrary report prose as a label, and only link an existing scan of that owner.
with parsed as (
  select id, user_id,
    regexp_match(message, E'^DeepSpec report v1\nIssue: ([a-z_]+)\n(?:Scan: ([^\n\r]{1,100})\nPrediction: ([^\n\r]{0,160})\n)?\n') as parts
  from public.feedback_submissions
), recognized as (
  select * from parsed where parts[1] in (
    'wrong_part', 'wrong_vehicle', 'wrong_value', 'wrong_condition', 'missing_information',
    'bad_explanation', 'other_result', 'ar_placement', 'ar_component', 'ar_jitter',
    'ar_tracking', 'ar_disappeared', 'ar_camera', 'ar_label', 'ar_detection', 'ar_other',
    'bug', 'feature_request'
  )
)
update public.feedback_submissions f
set issue_code = p.parts[1],
    scan_local_id = s.local_id,
    reported_prediction = case when s.local_id is not null then p.parts[3] else null end
from recognized p left join public.scan_lookups s
  on s.user_id = p.user_id and s.local_id = p.parts[2]
where f.id = p.id;

create index feedback_issue_created_idx on public.feedback_submissions(issue_code, created_at desc)
  where issue_code is not null;
create index feedback_owned_scan_idx on public.feedback_submissions(user_id, scan_local_id)
  where scan_local_id is not null;

-- Keep the original view columns in their original order; append only.
create or replace view public.feedback_review_queue with (security_invoker = true) as
  select f.id, f.created_at, f.category, f.message,
    coalesce(r.status, 'new') as review_status, r.reviewer_reference, r.notes, r.reviewed_at,
    f.issue_code, f.user_id, f.scan_local_id, f.reported_prediction
  from public.feedback_submissions f left join public.feedback_reviews r on r.feedback_id = f.id;
revoke all on public.feedback_review_queue from public, anon, authenticated;
grant select on public.feedback_review_queue to service_role;
