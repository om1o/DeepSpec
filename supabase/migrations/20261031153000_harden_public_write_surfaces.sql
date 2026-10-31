-- The authenticated app owns both forms. Keep browser writes bounded and let
-- database defaults bind identity, source, and timestamps.
alter table public.waitlist_signups
  alter column user_id set default auth.uid(),
  add constraint waitlist_main_problem_length check (length(main_problem) <= 800) not valid,
  add constraint waitlist_email_length check (length(email) between 5 and 160) not valid;

alter table public.feedback_submissions
  add constraint feedback_message_length check (length(message) between 8 and 800) not valid,
  add constraint feedback_contact_email_length check (contact_email is null or length(contact_email) <= 160) not valid;

create index waitlist_signups_user_created_idx
  on public.waitlist_signups (user_id, created_at desc) where user_id is not null;
create index feedback_submissions_user_created_idx
  on public.feedback_submissions (user_id, created_at desc) where user_id is not null;

revoke insert on public.waitlist_signups from public, anon, authenticated;
grant insert (email, user_type, main_problem) on public.waitlist_signups to authenticated;

drop policy if exists waitlist_signups_insert_public on public.waitlist_signups;
create policy waitlist_signups_insert_authenticated
  on public.waitlist_signups
  for insert
  to authenticated
  with check (
    (select auth.uid()) is not null
    and coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and user_id = (select auth.uid())
    and source = 'pwa'
    and length(trim(email)) between 5 and 160
    and length(main_problem) <= 800
  );

revoke insert on public.feedback_submissions from public, anon, authenticated;
grant insert (category, message, contact_email, issue_code, scan_local_id, reported_prediction)
  on public.feedback_submissions to authenticated;

drop policy if exists feedback_submissions_insert_public on public.feedback_submissions;
create policy feedback_submissions_insert_authenticated
  on public.feedback_submissions
  for insert
  to authenticated
  with check (
    (select auth.uid()) is not null
    and coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and user_id = (select auth.uid())
    and source = 'pwa'
    and length(trim(message)) between 8 and 800
    and (contact_email is null or length(contact_email) <= 160)
  );

create function public.enforce_form_write_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent_count integer;
  daily_limit integer;
begin
  if new.user_id is null then
    raise exception 'Form owner is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(tg_table_name || ':' || new.user_id::text, 0)
  );

  if tg_table_name = 'waitlist_signups' then
    daily_limit := 3;
    select count(*) into recent_count
    from public.waitlist_signups
    where user_id = new.user_id
      and created_at >= now() - interval '24 hours'
      and created_at <= now();
  elsif tg_table_name = 'feedback_submissions' then
    daily_limit := 20;
    select count(*) into recent_count
    from public.feedback_submissions
    where user_id = new.user_id
      and created_at >= now() - interval '24 hours'
      and created_at <= now();
  else
    raise exception 'Unsupported form table';
  end if;

  if recent_count >= daily_limit then
    raise exception 'Daily form submission limit reached';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_form_write_quota() from public, anon, authenticated;

drop trigger if exists waitlist_signups_enforce_quota on public.waitlist_signups;
create trigger waitlist_signups_enforce_quota
  before insert on public.waitlist_signups
  for each row execute function public.enforce_form_write_quota();

drop trigger if exists feedback_submissions_enforce_quota on public.feedback_submissions;
create trigger feedback_submissions_enforce_quota
  before insert on public.feedback_submissions
  for each row execute function public.enforce_form_write_quota();

notify pgrst, 'reload schema';
