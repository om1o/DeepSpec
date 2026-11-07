-- Administrator-run integration regression. Apply scan_lookup_revision and
-- scan_lookup_nonretryable_conflict first. Writes run as the authenticated owner.
-- Fixtures and successful writes are rolled back at the end.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  scan_id text := 'qa-revision-' || gen_random_uuid()::text;
  observed bigint;
  affected integer;
  rejected boolean;
  invalid_revision bigint;
  winner jsonb;
begin
  insert into auth.users(id) values (owner_id), (other_id);
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('role', 'authenticated', true);
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
  select to_jsonb(s) into winner from public.scan_lookups s
    where user_id = owner_id and local_id = scan_id;
  if winner->>'revision' <> '2' or winner->>'notes' <> 'device A' then
    raise exception 'Current revision update did not persist';
  end if;
  update public.scan_lookups set notes = 'stale device B', revision = observed + 1
    where user_id = owner_id and local_id = scan_id and revision = observed;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Stale revision overwrote winner'; end if;

  -- Identity scoping remains part of the CAS, independent of RLS.
  update public.scan_lookups set notes = 'wrong owner', revision = 3
    where user_id = other_id and local_id = scan_id and revision = 2;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Owner predicate was ineffective'; end if;

  -- P0001 is deliberately not retryable. Checking the exact message prevents
  -- unrelated exceptions, including assertion failures, from passing the test.
  rejected := false;
  begin
    update public.scan_lookups set notes = 'legacy update'
      where user_id = owner_id and local_id = scan_id;
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'scan_lookup_revision_conflict' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'Legacy unconditional update was accepted'; end if;
  if (select to_jsonb(s) from public.scan_lookups s
    where user_id = owner_id and local_id = scan_id) is distinct from winner then
    raise exception 'Rejected legacy update modified winning cloud data';
  end if;

  rejected := false;
  begin
    insert into public.scan_lookups(user_id, local_id, created_at, captured_at, notes)
      values (owner_id, scan_id, now(), now(), 'legacy upsert')
      on conflict (user_id, local_id) do update set notes = excluded.notes;
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'scan_lookup_revision_conflict' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'Legacy unconditional upsert was accepted'; end if;
  if (select to_jsonb(s) from public.scan_lookups s
    where user_id = owner_id and local_id = scan_id) is distinct from winner then
    raise exception 'Rejected legacy upsert modified winning cloud data';
  end if;

  rejected := false;
  begin
    insert into public.scan_lookups(user_id, local_id, created_at, captured_at, notes, revision)
      values (owner_id, scan_id, now(), now(), 'forged upsert', 3)
      on conflict (user_id, local_id) do update set notes = excluded.notes, revision = excluded.revision;
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'scan_lookup_revision_conflict' then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'Insert revision bypassed conflict guard'; end if;
  if (select to_jsonb(s) from public.scan_lookups s
    where user_id = owner_id and local_id = scan_id) is distinct from winner then
    raise exception 'Rejected forged upsert modified winning cloud data';
  end if;

  foreach invalid_revision in array array[1, 4]::bigint[] loop
    rejected := false;
    begin
      update public.scan_lookups set notes = 'wrong increment', revision = invalid_revision
        where user_id = owner_id and local_id = scan_id and revision = 2;
    exception when sqlstate 'P0001' then
      if sqlerrm <> 'scan_lookup_revision_conflict' then raise; end if;
      rejected := true;
    end;
    if not rejected then raise exception 'Wrong revision increment % was accepted', invalid_revision; end if;
    if (select to_jsonb(s) from public.scan_lookups s
      where user_id = owner_id and local_id = scan_id) is distinct from winner then
      raise exception 'Rejected wrong increment modified winning cloud data';
    end if;
  end loop;

  -- A different authenticated user cannot see or mutate this unshared scan,
  -- even when it knows the owner's identity and the current revision.
  perform set_config('request.jwt.claim.sub', other_id::text, true);
  if exists (select 1 from public.scan_lookups where user_id = owner_id and local_id = scan_id) then
    raise exception 'RLS exposed another owner scan';
  end if;
  update public.scan_lookups set notes = 'wrong authenticated owner', revision = 3
    where user_id = owner_id and local_id = scan_id and revision = 2;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'RLS allowed another owner update'; end if;
  delete from public.scan_lookups where user_id = owner_id and local_id = scan_id;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'RLS allowed another owner deletion'; end if;
  rejected := false;
  begin
    insert into public.scan_lookups(user_id, local_id, created_at, captured_at)
      values (owner_id, scan_id || '-forged-owner', now(), now());
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'RLS allowed an insert for another owner'; end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  if (select to_jsonb(s) from public.scan_lookups s
    where user_id = owner_id and local_id = scan_id) is distinct from winner then
    raise exception 'Rejected writes modified winning cloud data';
  end if;
end;
$$;
rollback;
