-- Deep Spec cloud database foundation.
-- This keeps scan photos private, ties every scan to a Supabase Auth user,
-- and preserves the local dataset fields needed for future evaluation work.

create extension if not exists pgcrypto;

create table if not exists public.scan_lookups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_id text not null,
  created_at timestamptz not null,
  captured_at timestamptz not null,
  analyzed_at timestamptz,
  synced_at timestamptz not null default now(),
  image_path text,
  result_json jsonb,
  error_message text,
  error_code text,
  scan_category text not null default 'unknown'
    check (scan_category in ('engine', 'electrical', 'brakes', 'steering', 'suspension', 'fuel', 'airbag', 'body', 'leak', 'unknown')),
  training_label text not null default 'unlabeled',
  training_status text not null default 'raw_unreviewed'
    check (training_status in ('raw_unreviewed', 'user_confirmed', 'user_corrected')),
  rating text check (rating in ('up', 'down') or rating is null),
  correction text,
  notes text not null default '',
  chat_history jsonb not null default '[]'::jsonb,
  constraint scan_lookups_user_local_unique unique (user_id, local_id)
);

comment on table public.scan_lookups is 'Private Deep Spec scan records used for user history and future model evaluation.';
comment on column public.scan_lookups.result_json is 'Structured AI result as shown to the user; never treat as verified repair documentation.';
comment on column public.scan_lookups.scan_category is 'Coarse category for filtering, review, and future dataset balancing.';
comment on column public.scan_lookups.training_status is 'Human review signal derived from rating and correction flow.';

create index if not exists scan_lookups_user_created_idx on public.scan_lookups (user_id, created_at desc);
create index if not exists scan_lookups_user_category_idx on public.scan_lookups (user_id, scan_category);
create index if not exists scan_lookups_training_status_idx on public.scan_lookups (training_status, created_at desc);

alter table public.scan_lookups enable row level security;

revoke all on public.scan_lookups from anon;
grant select, insert, update, delete on public.scan_lookups to authenticated;

drop policy if exists scan_lookups_select_own on public.scan_lookups;
create policy scan_lookups_select_own
  on public.scan_lookups
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists scan_lookups_insert_own on public.scan_lookups;
create policy scan_lookups_insert_own
  on public.scan_lookups
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists scan_lookups_update_own on public.scan_lookups;
create policy scan_lookups_update_own
  on public.scan_lookups
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists scan_lookups_delete_own on public.scan_lookups;
create policy scan_lookups_delete_own
  on public.scan_lookups
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  user_type text not null default 'other'
    check (user_type in ('car_owner', 'van_life', 'used_car_buyer', 'weekend_wrencher', 'other')),
  main_problem text not null default '',
  source text not null default 'pwa',
  constraint waitlist_signups_email_format check (email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

comment on table public.waitlist_signups is 'Early demand signal. Keep access narrow because it contains contact information.';

create unique index if not exists waitlist_signups_email_lower_idx on public.waitlist_signups (lower(email));
create index if not exists waitlist_signups_created_idx on public.waitlist_signups (created_at desc);

alter table public.waitlist_signups enable row level security;

revoke all on public.waitlist_signups from anon, authenticated;
grant insert on public.waitlist_signups to anon, authenticated;
grant select on public.waitlist_signups to authenticated;

drop policy if exists waitlist_signups_insert_public on public.waitlist_signups;
create policy waitlist_signups_insert_public
  on public.waitlist_signups
  for insert
  to anon, authenticated
  with check (length(trim(email)) between 5 and 160);

drop policy if exists waitlist_signups_select_own on public.waitlist_signups;
create policy waitlist_signups_select_own
  on public.waitlist_signups
  for select
  to authenticated
  using (user_id is not null and (select auth.uid()) = user_id);

create table if not exists public.feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  category text not null default 'other'
    check (category in ('scanner', 'ai_result', 'saved_scans', 'chat', 'business', 'other')),
  message text not null check (length(trim(message)) >= 8),
  contact_email text,
  source text not null default 'pwa',
  constraint feedback_submissions_contact_email_format
    check (contact_email is null or contact_email = '' or contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

comment on table public.feedback_submissions is 'Product feedback for Deep Spec validation. Contact email is optional PII.';

create index if not exists feedback_submissions_created_idx on public.feedback_submissions (created_at desc);
create index if not exists feedback_submissions_category_idx on public.feedback_submissions (category, created_at desc);

alter table public.feedback_submissions enable row level security;

revoke all on public.feedback_submissions from anon, authenticated;
grant insert on public.feedback_submissions to anon, authenticated;
grant select on public.feedback_submissions to authenticated;

drop policy if exists feedback_submissions_insert_public on public.feedback_submissions;
create policy feedback_submissions_insert_public
  on public.feedback_submissions
  for insert
  to anon, authenticated
  with check (length(trim(message)) >= 8);

drop policy if exists feedback_submissions_select_own on public.feedback_submissions;
create policy feedback_submissions_select_own
  on public.feedback_submissions
  for select
  to authenticated
  using (user_id is not null and (select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'scan-images',
  'scan-images',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[];

drop policy if exists scan_images_select_own on storage.objects;
create policy scan_images_select_own
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'scan-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists scan_images_insert_own on storage.objects;
create policy scan_images_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'scan-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists scan_images_update_own on storage.objects;
create policy scan_images_update_own
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'scan-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'scan-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists scan_images_delete_own on storage.objects;
create policy scan_images_delete_own
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'scan-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
