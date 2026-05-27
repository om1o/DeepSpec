console.log("DeepSpec Supabase Auth diagnostics SQL");
console.log("");
console.log("Use this only in the Supabase SQL Editor for the DeepSpec project.");
console.log("It is read-only and helps diagnose `Database error creating anonymous user` failures.");
console.log("Run every query, then inspect the Auth logs entry for the matching /signup failure.");
console.log("");
console.log(`-- 1. List every trigger attached to auth.users.
select
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where event_object_schema = 'auth'
  and event_object_table = 'users'
order by trigger_name;

-- 2. Show Postgres trigger definitions for auth.users, including disabled triggers.
-- If a non-internal trigger appears here, it can block anonymous sign-up.
select
  tg.tgname as trigger_name,
  tg.tgenabled as enabled_state,
  pg_get_triggerdef(tg.oid, true) as trigger_definition
from pg_trigger tg
join pg_class c on c.oid = tg.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'auth'
  and c.relname = 'users'
  and not tg.tgisinternal
order by tg.tgname;

-- 3. Identify the functions behind non-internal auth.users triggers.
-- Check that trigger functions writing outside auth are SECURITY DEFINER and have a fixed search_path.
select
  trigger_info.trigger_name,
  n.nspname as function_schema,
  p.proname as function_name,
  pg_get_userbyid(p.proowner) as function_owner,
  case when p.prosecdef then 'security definer' else 'security invoker' end as security_type,
  coalesce(array_to_string(p.proconfig, ', '), '') as function_config,
  pg_get_functiondef(p.oid) as function_definition
from pg_trigger tg
join pg_class c on c.oid = tg.tgrelid
join pg_namespace auth_ns on auth_ns.oid = c.relnamespace
join pg_proc p on p.oid = tg.tgfoid
join pg_namespace n on n.oid = p.pronamespace
cross join lateral (
  select tg.tgname as trigger_name
) trigger_info
where auth_ns.nspname = 'auth'
  and c.relname = 'users'
  and not tg.tgisinternal
order by trigger_info.trigger_name;

-- 4. Find functions that mention auth.users, anonymous metadata, or common profile inserts.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_userbyid(p.proowner) as function_owner,
  case when p.prosecdef then 'security definer' else 'security invoker' end as security_type,
  coalesce(array_to_string(p.proconfig, ', '), '') as function_config,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname not in ('pg_catalog', 'information_schema')
  and (
    pg_get_functiondef(p.oid) ilike '%auth.users%'
    or pg_get_functiondef(p.oid) ilike '%new.raw_user_meta_data%'
    or pg_get_functiondef(p.oid) ilike '%insert into public.profiles%'
  )
order by schema_name, function_name;

-- 5. Check whether a profiles table exists and has constraints that could reject anonymous users.
select
  to_regclass('public.profiles') as profiles_table,
  to_regclass('public.users') as public_users_table;

with candidate_tables as (
  select table_oid
  from (
    values
      (to_regclass('public.profiles')),
      (to_regclass('public.users'))
  ) as candidates(table_oid)
  where table_oid is not null
)
select
  conrelid::regclass as table_name,
  conname as constraint_name,
  contype as constraint_type,
  pg_get_constraintdef(oid, true) as constraint_definition
from pg_constraint
where conrelid in (select table_oid from candidate_tables)
order by table_name::text, constraint_name;

-- 6. Generate review-only drop statements for auth.users triggers.
-- Do not run these until the Auth log or function body proves the trigger is the failing object.
select
  format(
    '-- review before running: drop trigger if exists %I on auth.users;',
    tg.tgname
  ) as suggested_drop_trigger_sql
from pg_trigger tg
join pg_class c on c.oid = tg.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'auth'
  and c.relname = 'users'
  and not tg.tgisinternal
order by tg.tgname;

-- 7. Confirm anonymous Auth is enabled through the verifier first, then rerun:
-- npm run verify:supabase
`);
