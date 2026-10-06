-- Deploy before the new client. Older clients' unconditional updates must fail
-- closed rather than silently overwrite a revision they have never observed.
alter table public.scan_lookups
  add column revision bigint not null default 1 check (revision > 0);

create schema if not exists private;
create function private.guard_scan_lookup_revision()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
  elsif new.revision <> old.revision + 1 then
    raise exception 'scan_lookup_revision_conflict' using errcode = '40001';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_scan_lookup_revision() from public, anon, authenticated;
create trigger guard_scan_lookup_revision
  before insert or update on public.scan_lookups
  for each row execute function private.guard_scan_lookup_revision();

comment on column public.scan_lookups.revision is
  'Optimistic concurrency: updates must filter on the observed revision and set revision + 1. Missing local revision permits INSERT only.';
