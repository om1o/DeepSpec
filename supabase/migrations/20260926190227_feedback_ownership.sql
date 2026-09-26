-- New feedback belongs to the authenticated submitter; legacy null owners remain unchanged.
-- Logged-out public feedback is still allowed, but cannot impersonate a user.
alter table public.feedback_submissions alter column user_id set default auth.uid();

alter policy feedback_submissions_insert_public on public.feedback_submissions
  with check (
    length(trim(message)) >= 8
    and user_id is not distinct from (select auth.uid())
  );
