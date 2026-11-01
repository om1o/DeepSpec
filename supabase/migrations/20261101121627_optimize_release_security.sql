-- Align the production policies with the planner-safe auth call form and add
-- covering indexes for foreign keys introduced by the release migrations.
drop policy if exists waitlist_signups_insert_authenticated on public.waitlist_signups;
create policy waitlist_signups_insert_authenticated
  on public.waitlist_signups
  for insert
  to authenticated
  with check (
    (select auth.uid()) is not null
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
    and user_id = (select auth.uid())
    and source = 'pwa'
    and length(trim(email)) between 5 and 160
    and length(main_problem) <= 800
  );

drop policy if exists feedback_submissions_insert_authenticated on public.feedback_submissions;
create policy feedback_submissions_insert_authenticated
  on public.feedback_submissions
  for insert
  to authenticated
  with check (
    (select auth.uid()) is not null
    and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
    and user_id = (select auth.uid())
    and source = 'pwa'
    and length(trim(message)) between 8 and 800
    and (contact_email is null or length(contact_email) <= 160)
  );

create index if not exists billing_purchase_events_user_idx
  on public.billing_purchase_events (user_id);

create index if not exists job_scans_job_org_cover_idx
  on public.job_scans (job_id, org_id);

notify pgrst, 'reload schema';
