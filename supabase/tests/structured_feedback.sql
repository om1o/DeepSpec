-- Administrator-run regression; all synthetic users, scans and reports roll back.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  scan_id text := 'qa-feedback-' || gen_random_uuid()::text;
  other_scan text := 'qa-other-' || gen_random_uuid()::text;
  report_id uuid := gen_random_uuid();
  linked text;
  prediction text;
begin
  insert into auth.users(id) values(owner_id), (other_id);
  insert into public.scan_lookups(user_id, local_id, created_at, captured_at)
    values(owner_id, scan_id, now(), now()), (other_id, other_scan, now(), now());
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.feedback_submissions(id, user_id, category, issue_code, scan_local_id, reported_prediction, message)
    values(report_id, owner_id, 'ai_result', 'wrong_part', scan_id, 'Alternator', 'Actually a starter.');
  if not exists(select 1 from public.feedback_submissions where id = report_id and issue_code = 'wrong_part') then
    raise exception 'Owner could not read structured report';
  end if;
  begin
    insert into public.feedback_submissions(user_id, issue_code, message) values(owner_id, 'not_an_issue', 'Invalid issue attempt');
    raise exception 'Unknown issue was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.feedback_submissions(user_id, scan_local_id, message) values(owner_id, other_scan, 'Cross-account scan attempt');
    raise exception 'Another owner scan was linked';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.feedback_submissions(user_id, reported_prediction, message) values(owner_id, repeat('x', 161), 'Oversize prediction attempt');
    raise exception 'Unbounded prediction accepted';
  exception when check_violation then null; end;
  begin
    perform 1 from public.feedback_review_queue;
    raise exception 'Browser read privileged review queue';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub', other_id::text, true);
  if exists(select 1 from public.feedback_submissions where id = report_id) then raise exception 'Cross-account feedback read'; end if;
  begin
    insert into public.feedback_submissions(user_id, scan_local_id, message) values(owner_id, scan_id, 'Spoofed report owner');
    raise exception 'Spoofed report owner accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  insert into public.feedback_submissions(issue_code, message) values('bug', 'Logged-out report still works');
  begin
    insert into public.feedback_submissions(scan_local_id, message) values(scan_id, 'Anonymous linked report');
    raise exception 'Anonymous scan link accepted';
  exception when check_violation then null; end;
  perform set_config('role', 'postgres', true);
  delete from public.scan_lookups where user_id = owner_id and local_id = scan_id;
  select scan_local_id, reported_prediction into linked, prediction from public.feedback_submissions where id = report_id;
  if linked is not null or prediction is distinct from 'Alternator' then raise exception 'Scan deletion lost report context or retained link'; end if;
  insert into public.scan_lookups(user_id, local_id, created_at, captured_at) values(owner_id, scan_id, now(), now());
  update public.feedback_submissions set scan_local_id = scan_id where id = report_id;
  delete from auth.users where id = owner_id;
  if not exists(select 1 from public.feedback_submissions where id = report_id and user_id is null and scan_local_id is null and reported_prediction = 'Alternator') then
    raise exception 'Account deletion failed to preserve unlinked report';
  end if;
end;
$$;
rollback;
