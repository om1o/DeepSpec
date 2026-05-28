export const AUTH_ANONYMOUS_REPAIR_SQL = `-- Review before running. This targets the common Supabase template trigger:
--   auth.users -> public.handle_new_user() -> public.profiles
-- It does not drop triggers. If diagnostics show a different trigger function,
-- fix that function instead.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Anonymous users have no email/profile data. They still use the authenticated
  -- role after sign-in, so do not let a profile trigger block cloud-sync auth.
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;

  if to_regclass('public.profiles') is null then
    return new;
  end if;

  begin
    insert into public.profiles (id, first_name, last_name)
    values (
      new.id,
      new.raw_user_meta_data ->> 'first_name',
      new.raw_user_meta_data ->> 'last_name'
    )
    on conflict (id) do nothing;
  exception
    when undefined_table
      or undefined_column
      or not_null_violation
      or check_violation
      or foreign_key_violation then
      raise warning 'public.handle_new_user skipped profile insert so Auth signup can complete: %', sqlerrm;
  end;

  return new;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace auth_ns on auth_ns.oid = c.relnamespace
    join pg_proc p on p.oid = tg.tgfoid
    join pg_namespace fn_ns on fn_ns.oid = p.pronamespace
    where auth_ns.nspname = 'auth'
      and c.relname = 'users'
      and not tg.tgisinternal
      and fn_ns.nspname = 'public'
      and p.proname = 'handle_new_user'
  ) then
    raise notice 'Repaired public.handle_new_user for anonymous sign-ins. Rerun npm run verify:supabase.';
  else
    raise notice 'No auth.users trigger currently calls public.handle_new_user. If anonymous sign-in still fails, inspect diagnostics before changing more SQL.';
  end if;
end;
$$;

commit;`;
