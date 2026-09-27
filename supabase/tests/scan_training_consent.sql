-- Administrator-run integration regression. All fixtures roll back.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  scan_id text := 'qa-consent-' || gen_random_uuid()::text;
  rev bigint;
  affected integer;
  allowed boolean;
  report_id uuid;
  review_state text;
begin
  insert into auth.users(id) values (owner_id), (other_id);
  insert into public.scan_lookups(user_id, local_id, created_at, captured_at, result_json)
    values (owner_id, scan_id, now(), now(), '{"partName":"QA part"}');
  if exists(select 1 from public.scan_training_consent where user_id = owner_id) then
    raise exception 'New scan was opted in';
  end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.scan_training_consent(user_id, scan_local_id, policy_version)
    values (owner_id, scan_id, '2026-09-27-v1');
  select revision, training_consent into rev, allowed from public.scan_training_consent
    where user_id = owner_id and scan_local_id = scan_id;
  if allowed is distinct from false or rev is distinct from 1 then raise exception 'Consent default/revision wrong'; end if;
  begin
    update public.scan_training_consent set revision = 999 where user_id = owner_id;
    raise exception 'Owner forged consent revision';
  exception when insufficient_privilege then null; end;
  begin
    update public.scan_training_consent set user_id = other_id where user_id = owner_id;
    raise exception 'Owner reassigned consent';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.scan_training_reviews(user_id, scan_local_id, consent_revision, reviewed_scan_hash, reviewer_reference)
      values (owner_id, scan_id, 1, 'forged', 'self');
    raise exception 'User self-approved a review';
  exception when insufficient_privilege then null; end;
  update public.scan_training_consent set training_consent = true
    where user_id = owner_id and scan_local_id = scan_id and revision = 1;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Owner opt-in failed'; end if;
  select revision into rev from public.scan_training_consent where user_id = owner_id and scan_local_id = scan_id;
  if rev is distinct from 2 then raise exception 'Revision did not advance'; end if;

  perform set_config('request.jwt.claim.sub', other_id::text, true);
  if exists(select 1 from public.scan_training_consent where user_id = owner_id) then
    raise exception 'Cross-account consent read';
  end if;
  update public.scan_training_consent set training_consent = false where user_id = owner_id;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Cross-account consent update'; end if;
  begin
    insert into public.scan_training_consent(user_id, scan_local_id, policy_version)
      values (owner_id, scan_id || '-spoof', '2026-09-27-v1');
    raise exception 'Cross-account consent insert';
  exception when insufficient_privilege then null; end;

  perform set_config('role', 'postgres', true);
  begin
    insert into public.scan_training_reviews(user_id, scan_local_id, consent_revision, reviewed_scan_hash, status, human_verified, reviewer_reference)
      values (owner_id, scan_id, 2, 'unverified', 'approved', false, 'QA only');
    raise exception 'Unverified review was approved';
  exception when check_violation then null; end;
  insert into public.scan_training_reviews(user_id, scan_local_id, consent_revision, reviewed_scan_hash, status, human_verified, reviewer_reference)
    select user_id, scan_local_id, revision, current_scan_hash, 'approved', true, 'QA only'
    from public.scan_training_review_queue where user_id = owner_id and scan_local_id = scan_id;
  select ready_for_dataset_review into allowed from public.scan_training_review_queue where user_id = owner_id;
  if allowed is distinct from true then raise exception 'Current reviewed consent not recognized'; end if;
  update public.scan_lookups set correction = 'Changed label' where user_id = owner_id and local_id = scan_id;
  select ready_for_dataset_review into allowed from public.scan_training_review_queue where user_id = owner_id;
  if allowed is distinct from false then raise exception 'Changed scan kept old approval'; end if;
  update public.scan_training_reviews r set reviewed_scan_hash = q.current_scan_hash
    from public.scan_training_review_queue q where r.user_id = owner_id and q.user_id = r.user_id and q.scan_local_id = r.scan_local_id;

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('role', 'authenticated', true);
  update public.scan_training_consent set training_consent = false where user_id = owner_id and revision = 2;
  update public.scan_training_consent set training_consent = true where user_id = owner_id and revision = 2;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Stale write overwrote withdrawal'; end if;
  perform set_config('role', 'postgres', true);
  select ready_for_dataset_review into allowed from public.scan_training_review_queue where user_id = owner_id;
  if allowed is distinct from false then raise exception 'Withdrawal did not exclude scan'; end if;
  perform set_config('role', 'authenticated', true);
  update public.scan_training_consent set training_consent = true where user_id = owner_id and revision = 3;
  perform set_config('role', 'postgres', true);
  select ready_for_dataset_review into allowed from public.scan_training_review_queue where user_id = owner_id;
  if allowed is distinct from false then raise exception 'Re-opt-in resurrected old review'; end if;

  if has_table_privilege('authenticated', 'public.scan_training_reviews', 'INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated', 'public.feedback_reviews', 'INSERT,UPDATE,DELETE')
    or has_table_privilege('anon', 'public.scan_training_consent', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated', 'public.feedback_review_queue', 'SELECT')
    or has_table_privilege('authenticated', 'public.scan_training_review_queue', 'SELECT') then
    raise exception 'Unexpected browser grant';
  end if;
  insert into public.feedback_submissions(user_id, category, message)
    values (owner_id, 'other', 'Synthetic feedback review QA') returning id into report_id;
  select review_status into review_state from public.feedback_review_queue where id = report_id;
  if review_state is distinct from 'new' then raise exception 'Feedback queue default incorrect'; end if;
  insert into public.feedback_reviews(feedback_id, status, reviewer_reference)
    values (report_id, 'reviewed', 'QA only');
  update public.feedback_reviews set status = 'confirmed_issue' where feedback_id = report_id;
  update public.feedback_reviews set status = 'fixed' where feedback_id = report_id;
  select review_status into review_state from public.feedback_review_queue where id = report_id;
  if review_state is distinct from 'fixed' then raise exception 'Feedback review did not persist'; end if;
  delete from public.feedback_submissions where id = report_id;
  if exists(select 1 from public.feedback_reviews where feedback_id = report_id) then
    raise exception 'Deleted feedback left its review';
  end if;
  perform set_config('role', 'authenticated', true);
  delete from public.scan_lookups where user_id = owner_id and local_id = scan_id;
  perform set_config('role', 'postgres', true);
  if exists(select 1 from public.scan_training_consent where user_id = owner_id)
    or exists(select 1 from public.scan_training_reviews where user_id = owner_id)
    or exists(select 1 from public.scan_training_review_queue where user_id = owner_id) then
    raise exception 'Scan deletion left consent/review eligibility';
  end if;
end $$;
rollback;
