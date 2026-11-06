-- A stale application revision is permanent for the submitted write. PostgREST
-- 14 retries SQLSTATE 40001 internally, so return a standard exception instead.
-- https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
-- Preserve the trigger, owner, grants and revision checks; replace only its code.
create or replace function private.guard_scan_lookup_revision()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
  elsif new.revision <> old.revision + 1 then
    raise exception 'scan_lookup_revision_conflict' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
