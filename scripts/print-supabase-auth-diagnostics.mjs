console.log("DeepSpec Supabase Auth diagnostics SQL");
console.log("");
console.log("Use this only in the Supabase SQL Editor for the DeepSpec project.");
console.log("It is read-only and helps diagnose `Database error creating anonymous user` failures.");
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

-- 3. Find public functions that mention auth.users or common profile inserts.
select
  n.nspname as schema_name,
  p.proname as function_name,
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

-- 4. Confirm anonymous Auth is enabled through the verifier first, then rerun:
-- npm run verify:supabase
`);
