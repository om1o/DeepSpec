const requestId = process.argv[2]?.trim() || "REQUEST_ID_HERE";

console.log("DeepSpec Supabase Auth diagnostics SQL");
console.log("");
console.log("Use this only in the Supabase SQL Editor for the DeepSpec project.");
console.log("It is read-only and helps diagnose `Database error creating anonymous user` failures.");
console.log(
  requestId === "REQUEST_ID_HERE"
    ? "Pass the verifier's sb-request-id/error_id as an argument to prefill the audit-log lookup."
    : `Audit-log lookup is prefilled for request id ${requestId}.`,
);
console.log("Run every query, then inspect the Auth logs entry for the matching /signup failure.");
console.log("");
console.log(`-- 1. Check whether Auth audit logs are stored in Postgres.
-- Supabase stores auth audit events in auth.audit_log_entries by default.
select
  to_regclass('auth.audit_log_entries') as auth_audit_log_entries_table;

select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'auth'
  and table_name = 'audit_log_entries'
order by ordinal_position;

-- 2. Search recent Auth audit entries for the failed anonymous signup.
-- Pass the sb-request-id/error_id as an argument to npm run supabase:print-auth-diagnostics to prefill this value.
-- If Postgres audit-log storage was disabled, use Dashboard -> Auth Logs instead.
select
  created_at,
  id,
  payload
from auth.audit_log_entries
where created_at > now() - interval '2 hours'
  and (
    payload::text ilike '%${escapeSqlLikeLiteral(requestId)}%'
    or payload::text ilike '%signup%'
    or payload::text ilike '%anonymous%'
    or payload::text ilike '%unexpected_failure%'
  )
order by created_at desc
limit 25;

-- 3. List every trigger attached to auth.users.
select
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where event_object_schema = 'auth'
  and event_object_table = 'users'
order by trigger_name;

-- 4. Show Postgres trigger definitions for auth.users, including disabled triggers.
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

-- 5. Identify the functions behind non-internal auth.users triggers.
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

-- 6. Find functions that mention auth.users, anonymous metadata, or common profile inserts.
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

-- 7. Check Postgres functions that are likely Supabase Auth Hooks.
-- In Supabase Auth Hooks, a before_user_created Postgres function can block signup.
-- Hook functions should be SECURITY DEFINER, pin search_path, and grant execute to supabase_auth_admin.
select
  n.nspname as function_schema,
  p.proname as function_name,
  pg_get_userbyid(p.proowner) as function_owner,
  case when p.prosecdef then 'security definer' else 'security invoker' end as security_type,
  coalesce(array_to_string(p.proconfig, ', '), '') as function_config,
  has_function_privilege('supabase_auth_admin', p.oid, 'execute') as supabase_auth_admin_can_execute,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
  and (
    p.proname ilike '%hook%'
    or p.proname ilike '%auth%'
    or pg_get_functiondef(p.oid) ilike '%before_user_created%'
    or pg_get_functiondef(p.oid) ilike '%supabase_auth_admin%'
  )
order by function_schema, function_name;

-- 8. Check whether a profiles table exists and has constraints that could reject anonymous users.
select
  to_regclass('public.profiles') as profiles_table,
  to_regclass('public.users') as public_users_table;

-- 9. Show required columns/defaults on common profile tables.
-- Anonymous users usually do not have email or display-name fields, so NOT NULL
-- profile columns without safe defaults can break auth.users trigger inserts.
select
  table_schema,
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles', 'users')
order by table_name, ordinal_position;

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

-- 10. Generate review-only drop statements for auth.users triggers.
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

-- 11. Check whether the DeepSpec cloud tables are present.
with expected_tables(table_name) as (
  values
    ('scan_lookups'),
    ('scan_model_runs'),
    ('scan_candidates'),
    ('scan_evidence'),
    ('scan_corrections'),
    ('sync_events')
)
select
  table_name,
  to_regclass('public.' || quote_ident(table_name)) is not null as table_exists
from expected_tables
order by table_name;

-- 12. Check whether required durable dataset columns exist.
with expected_columns(table_name, column_name) as (
  values
    ('scan_lookups', 'image_hash'),
    ('scan_lookups', 'image_mime_type'),
    ('scan_lookups', 'image_byte_length'),
    ('scan_model_runs', 'provider'),
    ('scan_model_runs', 'model'),
    ('scan_model_runs', 'prompt_version'),
    ('scan_model_runs', 'latency_ms'),
    ('scan_model_runs', 'ocr_used'),
    ('scan_candidates', 'candidate_rank'),
    ('scan_candidates', 'part_name'),
    ('scan_candidates', 'confidence'),
    ('scan_evidence', 'evidence_rank'),
    ('scan_evidence', 'evidence_type'),
    ('scan_evidence', 'evidence_text'),
    ('scan_corrections', 'corrected_part_name'),
    ('scan_corrections', 'corrected_category'),
    ('scan_corrections', 'damage_severity'),
    ('sync_events', 'event_type'),
    ('sync_events', 'status')
)
select
  expected_columns.table_name,
  expected_columns.column_name,
  columns.column_name is not null as column_exists
from expected_columns
left join information_schema.columns columns
  on columns.table_schema = 'public'
  and columns.table_name = expected_columns.table_name
  and columns.column_name = expected_columns.column_name
order by expected_columns.table_name, expected_columns.column_name;

-- 13. Check RLS and role grants for the cloud dataset tables.
with expected_tables(table_name) as (
  values
    ('scan_lookups'),
    ('scan_model_runs'),
    ('scan_candidates'),
    ('scan_evidence'),
    ('scan_corrections'),
    ('sync_events')
)
select
  expected_tables.table_name,
  c.relrowsecurity as rls_enabled,
  case when c.oid is null then null else has_table_privilege('authenticated', c.oid, 'select') end as authenticated_can_select,
  case when c.oid is null then null else has_table_privilege('authenticated', c.oid, 'insert') end as authenticated_can_insert,
  case when c.oid is null then null else has_table_privilege('authenticated', c.oid, 'update') end as authenticated_can_update,
  case when c.oid is null then null else has_table_privilege('authenticated', c.oid, 'delete') end as authenticated_can_delete,
  case when c.oid is null then null else has_table_privilege('anon', c.oid, 'select') end as anon_can_select
from expected_tables
left join pg_class c
  on c.oid = to_regclass('public.' || quote_ident(expected_tables.table_name))
order by expected_tables.table_name;

-- 14. List RLS policies for the cloud dataset tables.
select
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'scan_lookups',
    'scan_model_runs',
    'scan_candidates',
    'scan_evidence',
    'scan_corrections',
    'sync_events'
  )
order by tablename, policyname;

-- 15. Check the private scan image bucket.
select
  id,
  public,
  file_size_limit,
  allowed_mime_types
from storage.buckets
where id = 'scan-images';

-- 16. Confirm anonymous Auth is enabled through the verifier first, then rerun:
-- npm run verify:supabase
`);

function escapeSqlLikeLiteral(value) {
  return value.replaceAll("'", "''").replaceAll("\\", "\\\\");
}
