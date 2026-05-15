-- Deep Spec: lookups + private part photo bucket (apply with Supabase CLI or SQL editor)
-- Prereq: Auth → enable "Anonymous sign-ins" for device-scoped rows.

create extension if not exists "pgcrypto";

create table if not exists public.lookups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  image_storage_path text not null,
  user_car_context text not null default '',
  user_problem_context text not null default '',
  result jsonb not null,
  rating text check (rating is null or rating in ('up', 'down')),
  correction text,
  chat_history jsonb not null default '[]'::jsonb,
  moderation_status text not null default 'none'
    check (moderation_status in ('none', 'pending_review', 'actioned')),
  constraint lookups_chat_history_is_array check (jsonb_typeof(chat_history) = 'array')
);

create index if not exists lookups_user_created_idx on public.lookups (user_id, created_at desc);

alter table public.lookups enable row level security;

create policy "lookups_select_own" on public.lookups
  for select to authenticated
  using (auth.uid() = user_id);

create policy "lookups_insert_own" on public.lookups
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy "lookups_update_own" on public.lookups
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "lookups_delete_own" on public.lookups
  for delete to authenticated
  using (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'part-photos',
  'part-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "part_photos_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'part-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "part_photos_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'part-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "part_photos_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'part-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id = 'part-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );

create policy "part_photos_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'part-photos'
    and split_part(name, '/', 1) = auth.uid()::text
  );
