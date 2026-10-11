-- Run after the mechanic-shop and membership-hardening migrations.
begin;
do $$
begin
  if has_table_privilege('authenticated', 'public.organization_members', 'update') then
    raise exception 'Authenticated clients can update organization membership identity or role';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_members'
      and cmd in ('UPDATE', 'ALL')
  ) then
    raise exception 'A membership update policy remains installed';
  end if;
end;
$$;
rollback;
