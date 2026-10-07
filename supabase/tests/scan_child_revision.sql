-- Administrator-run regression after scan_child_revision and shop migrations.
-- All synthetic rows and successful mutations roll back.
begin;
create function pg_temp.child_snapshot(owner_id uuid, scan_id text) returns jsonb
language sql as $$
  select jsonb_build_object(
    'candidates', (select jsonb_agg(to_jsonb(c) order by candidate_rank) from public.scan_candidates c where user_id = owner_id and scan_local_id = scan_id),
    'evidence', (select jsonb_agg(to_jsonb(e) order by evidence_rank) from public.scan_evidence e where user_id = owner_id and scan_local_id = scan_id),
    'correction', (select to_jsonb(c) from public.scan_corrections c where user_id = owner_id and scan_local_id = scan_id),
    'job', (select jsonb_agg(to_jsonb(j) order by job_id) from public.job_scans j where user_id = owner_id and scan_local_id = scan_id)
  );
$$;
do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  org_id uuid := gen_random_uuid();
  job_id uuid := gen_random_uuid();
  scan_id text := 'qa-child-revision-' || gen_random_uuid()::text;
  candidates jsonb := '[{"candidate_rank":0,"part_name":"New candidate","confidence":"high","scan_category":"electrical","reason":"New reason","candidate_json":{"partName":"New candidate"}}]';
  evidence jsonb := '[{"evidence_rank":0,"evidence_type":"observation","evidence_text":"New evidence","evidence_json":{"observation":"New evidence"}}]';
  correction jsonb := '{"correction_text":"New correction","corrected_part_name":"New correction","corrected_category":"electrical","rating":"up","notes":"New notes","training_status":"user_corrected","damage_severity":"unknown"}';
  job jsonb;
  winner jsonb;
  rejected boolean;
begin
  insert into auth.users(id) values (owner_id), (other_id);
  insert into public.organizations(id, owner_user_id, name, slug) values (org_id, owner_id, 'QA shop', 'qa-child');
  insert into public.organization_members(org_id, user_id, role) values (org_id, owner_id, 'owner');
  insert into public.shop_jobs(id, org_id, title, year, make, model, symptom, technician_name)
    values (job_id, org_id, 'QA job', '2026', 'Test', 'Car', 'Warning light', 'QA');
  insert into public.scan_lookups(user_id, local_id, created_at, captured_at, image_path, inspection_json)
    values (owner_id, scan_id, now(), now(), 'immutable-photo', '{"inspectorName":"Pat"}');
  job := jsonb_build_object('org_id', org_id, 'job_id', job_id, 'review_status', 'confirmed',
    'customer_visible_report_json', jsonb_build_object('title', 'New report'));
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('role', 'authenticated', true);

  -- A commits revision 2 and stalls. B reads 2, commits 3, then finishes its details.
  update public.scan_lookups set notes = 'Device A', revision = 2
    where user_id = owner_id and local_id = scan_id and revision = 1;
  update public.scan_lookups set notes = 'Device B', correction = 'New correction', revision = 3
    where user_id = owner_id and local_id = scan_id and revision = 2;
  if public.sync_scan_details(scan_id, 3, candidates, evidence, correction, job) is distinct from true then
    raise exception 'Current revision failed';
  end if;
  winner := pg_temp.child_snapshot(owner_id, scan_id);
  if winner #>> '{candidates,0,part_name}' <> 'New candidate'
    or winner #>> '{evidence,0,evidence_text}' <> 'New evidence'
    or winner #>> '{correction,correction_text}' <> 'New correction'
    or winner #>> '{job,0,customer_visible_report_json,title}' <> 'New report' then
    raise exception 'Current child data did not persist';
  end if;

  -- Both replacement and empty-list deletion from delayed A must be rejected.
  if public.sync_scan_details(scan_id, 2, replace(candidates::text, 'New', 'Old')::jsonb,
      replace(evidence::text, 'New', 'Old')::jsonb, replace(correction::text, 'New', 'Old')::jsonb,
      replace(job::text, 'New', 'Old')::jsonb) is distinct from false then
    raise exception 'Stale child replacement was accepted';
  end if;
  if public.sync_scan_details(scan_id, 2, '[]', '[]', correction, job) is distinct from false then
    raise exception 'Stale child deletion was accepted';
  end if;
  if pg_temp.child_snapshot(owner_id, scan_id) is distinct from winner then
    raise exception 'Stale device modified winning child details';
  end if;

  -- An evidence constraint failure must roll back the preceding candidate deletion.
  rejected := false;
  begin
    perform public.sync_scan_details(scan_id, 3, '[]', replace(evidence::text, 'observation', 'invalid')::jsonb, correction, job);
  exception when check_violation then rejected := true; end;
  if not rejected or pg_temp.child_snapshot(owner_id, scan_id) is distinct from winner then
    raise exception 'Failed child transaction left partial changes';
  end if;

  -- A late job failure must also roll back candidates, evidence, and correction.
  rejected := false;
  begin
    perform public.sync_scan_details(scan_id, 3, '[]', '[]', replace(correction::text, 'New', 'Bad')::jsonb,
      job || '{"review_status":"invalid"}'::jsonb);
  exception when check_violation then rejected := true; end;
  if not rejected or pg_temp.child_snapshot(owner_id, scan_id) is distinct from winner then
    raise exception 'Failed job transaction left partial changes';
  end if;

  -- Exact-revision retries are idempotent and never change parent inspection/images.
  perform public.sync_scan_details(scan_id, 3, candidates, evidence, correction, job);
  if pg_temp.child_snapshot(owner_id, scan_id) is distinct from winner then raise exception 'Retry changed details'; end if;
  if not exists(select 1 from public.scan_lookups where user_id = owner_id and local_id = scan_id
    and revision = 3 and image_path = 'immutable-photo' and inspection_json = '{"inspectorName":"Pat"}'::jsonb) then
    raise exception 'Child sync changed the parent';
  end if;

  perform set_config('request.jwt.claim.sub', other_id::text, true);
  if public.sync_scan_details(scan_id, 3, '[]', '[]', correction, job) is distinct from false then
    raise exception 'Wrong owner modified details';
  end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  if pg_temp.child_snapshot(owner_id, scan_id) is distinct from winner then raise exception 'Wrong owner changed data'; end if;
  if public.sync_scan_details(scan_id, null, '[]', '[]', correction, job) is distinct from false then
    raise exception 'Missing revision was accepted';
  end if;
  if public.sync_scan_details('missing-scan', 3, '[]', '[]', correction, job) is distinct from false then
    raise exception 'Missing parent was accepted';
  end if;

  -- Empty lists from the current revision intentionally clear candidates/evidence.
  if public.sync_scan_details(scan_id, 3, '[]', '[]', correction, null) is distinct from true then
    raise exception 'Current empty details failed';
  end if;
  if exists(select 1 from public.scan_candidates where user_id = owner_id and scan_local_id = scan_id)
    or exists(select 1 from public.scan_evidence where user_id = owner_id and scan_local_id = scan_id) then
    raise exception 'Current empty details did not clear old rows';
  end if;
  if (pg_temp.child_snapshot(owner_id, scan_id)->'job') is distinct from (winner->'job') then
    raise exception 'Missing job context changed the existing bridge';
  end if;

  perform set_config('role', 'anon', true);
  rejected := false;
  begin
    perform public.sync_scan_details(scan_id, 3, '[]', '[]', correction, null);
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'Anonymous caller executed the RPC'; end if;
end;
$$;
rollback;
