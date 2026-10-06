-- Administrator-run integration regression. Apply scan_lookup_revision first.
-- Fixtures and successful writes are rolled back at the end.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  scan_id text := 'qa-revision-' || gen_random_uuid()::text;
  observed bigint;
  affected integer;
begin
  insert into auth.users(id) values (owner_id), (other_id);
  insert into public.scan_lookups(user_id, local_id, created_at, captured_at, notes, revision)
    values (owner_id, scan_id, now(), now(), 'initial', 999);
  select revision into observed from public.scan_lookups
    where user_id = owner_id and local_id = scan_id;
  if observed is distinct from 1 then raise exception 'Insert did not stamp revision 1'; end if;

  -- Both devices observed revision 1; device A wins the conditional update.
  update public.scan_lookups set notes = 'device A', revision = observed + 1
    where user_id = owner_id and local_id = scan_id and revision = observed;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Current revision update failed'; end if;
  update public.scan_lookups set notes = 'stale device B', revision = observed + 1
    where user_id = owner_id and local_id = scan_id and revision = observed;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Stale revision overwrote winner'; end if;

  -- Identity scoping remains part of the CAS, independent of RLS.
  update public.scan_lookups set notes = 'wrong owner', revision = 3
    where user_id = other_id and local_id = scan_id and revision = 2;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Owner predicate was ineffective'; end if;

  begin
    update public.scan_lookups set notes = 'legacy update'
      where user_id = owner_id and local_id = scan_id;
    raise exception 'Legacy unconditional update was accepted';
  exception when serialization_failure then null; end;
  begin
    insert into public.scan_lookups(user_id, local_id, created_at, captured_at, notes)
      values (owner_id, scan_id, now(), now(), 'legacy upsert')
      on conflict (user_id, local_id) do update set notes = excluded.notes;
    raise exception 'Legacy unconditional upsert was accepted';
  exception when serialization_failure then null; end;
  begin
    insert into public.scan_lookups(user_id, local_id, created_at, captured_at, notes, revision)
      values (owner_id, scan_id, now(), now(), 'forged upsert', 3)
      on conflict (user_id, local_id) do update set notes = excluded.notes, revision = excluded.revision;
    raise exception 'Insert revision bypassed conflict guard';
  exception when serialization_failure then null; end;
  if not exists (select 1 from public.scan_lookups
    where user_id = owner_id and local_id = scan_id and revision = 2 and notes = 'device A') then
    raise exception 'Rejected writes modified winning cloud data';
  end if;
end;
$$;
rollback;
