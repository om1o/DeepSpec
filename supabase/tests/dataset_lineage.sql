-- Run as administrator. Synthetic fixtures are rolled back, including auth users.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  scan_id text := 'qa-dataset-' || gen_random_uuid()::text;
  dataset_id text := 'qa-' || gen_random_uuid()::text;
  run_id uuid;
  other_run_id uuid;
  member_id uuid;
  rejected_run_id uuid;
  rejected_member_id uuid;
  rejected_case text;
  allowed boolean;
begin
  insert into auth.users(id) values(owner_id), (other_id);
  insert into public.scan_lookups(user_id,local_id,created_at,captured_at,result_json,
    correction,image_path,image_hash,image_mime_type,image_byte_length)
  values(owner_id,scan_id,now(),now(),'{"partName":"Alternator","modelRun":{"runId":"qa-attempt"}}','Compressor',
    owner_id::text || '/qa.png',repeat('a',64),'image/png',42);
  insert into public.scan_model_runs(user_id,scan_local_id,run_key,provider,model,prompt_version,pipeline_version)
    values(owner_id,scan_id,'qa-attempt','test','fixture','prompt-v1','pipeline-v1') returning id into run_id;
  insert into public.scan_model_runs(user_id,scan_local_id,run_key)
    values(owner_id,scan_id,'qa-attempt') on conflict(user_id,scan_local_id,run_key) do nothing;
  if (select count(*) from public.scan_model_runs where user_id=owner_id) <> 1 then
    raise exception 'Resync duplicated inference'; end if;
  insert into public.scan_training_consent(user_id,scan_local_id,training_consent,policy_version)
    values(owner_id,scan_id,true,'2026-09-27-v1');
  insert into public.scan_training_reviews(user_id,scan_local_id,consent_revision,reviewed_scan_hash,status,human_verified,reviewer_reference)
    select user_id,scan_local_id,revision,current_scan_hash,'approved',true,'QA synthetic reviewer'
    from public.scan_training_review_queue where user_id=owner_id;
  insert into public.dataset_versions(version,purpose,description) values(dataset_id,'evaluation','QA only');
  insert into public.dataset_members(dataset_version,user_id,scan_local_id,model_run_id,
    consent_revision,policy_version,scan_hash,model_run_hash,label,label_source,reviewer_reference,
    privacy_checked,usage_rights_checked,quality_checked)
    select dataset_id,q.user_id,q.scan_local_id,m.id,q.revision,q.policy_version,q.current_scan_hash,
      md5(to_jsonb(m)::text),'Compressor','human_verified_correction','QA synthetic reviewer',true,true,true
    from public.scan_training_review_queue q join public.scan_model_runs m on m.user_id=q.user_id
      and m.scan_local_id=q.scan_local_id where q.user_id=owner_id returning id into member_id;
  select eligible into allowed from public.dataset_export_queue where id=member_id;
  if allowed is distinct from true then raise exception 'Reviewed example not eligible'; end if;
  if not exists(select 1 from public.dataset_export_queue where id=member_id
    and original_prediction='Alternator' and correction='Compressor' and label='Compressor') then
    raise exception 'Prediction/correction provenance lost'; end if;
  -- Privileged mistakes must not make another owner's model run exportable.
  insert into public.scan_lookups(user_id,local_id,created_at,captured_at)
    values(other_id,scan_id,now(),now());
  insert into public.scan_model_runs(user_id,scan_local_id,run_key)
    values(other_id,scan_id,'other-owner-attempt') returning id into other_run_id;
  insert into public.dataset_versions(version,purpose,description) values(dataset_id || '-cross','evaluation','QA cross-owner guard');
  insert into public.dataset_members(dataset_version,user_id,scan_local_id,model_run_id,
    consent_revision,policy_version,scan_hash,model_run_hash,label,label_source,reviewer_reference,
    privacy_checked,usage_rights_checked,quality_checked)
    select dataset_id || '-cross',d.user_id,d.scan_local_id,other_run_id,
      d.consent_revision,d.policy_version,d.scan_hash,md5(to_jsonb(m)::text),d.label,d.label_source,d.reviewer_reference,
      true,true,true
    from public.dataset_members d join public.scan_model_runs m on m.id=other_run_id where d.id=member_id;
  if exists(select 1 from public.dataset_export_queue where dataset_version=dataset_id || '-cross' and eligible) then
    raise exception 'Cross-owner model lineage exported'; end if;
  begin
    insert into public.dataset_members(dataset_version,user_id,scan_local_id,model_run_id,
      consent_revision,policy_version,scan_hash,model_run_hash,label,label_source,reviewer_reference,
      privacy_checked,usage_rights_checked,quality_checked)
      select dataset_version,user_id,scan_local_id,model_run_id,consent_revision,policy_version,scan_hash,
        model_run_hash,label,label_source,reviewer_reference,false,true,true from public.dataset_members where id=member_id;
    raise exception 'Unchecked privacy membership accepted';
  exception when check_violation then null; end;
  begin
    update public.dataset_members set label='Changed' where id=member_id;
    raise exception 'Membership mutation allowed';
  exception when raise_exception then
    if sqlerrm <> 'Dataset records are immutable; create a new version' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('role','authenticated',true);
  begin
    perform * from public.dataset_export_queue;
    raise exception 'Browser accessed dataset queue';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.dataset_versions(version,purpose,description) values('forged','training','Browser forgery');
    raise exception 'Browser created dataset';
  exception when insufficient_privilege then null; end;
  update public.scan_training_consent set training_consent=false where user_id=owner_id;
  perform set_config('role','postgres',true);
  select eligible into allowed from public.dataset_export_queue where id=member_id;
  if allowed is distinct from false then raise exception 'Withdrawal still eligible'; end if;
  update public.scan_training_consent set training_consent=true where user_id=owner_id;
  select eligible into allowed from public.dataset_export_queue where id=member_id;
  if allowed is distinct from false then raise exception 'Re-opt-in resurrected old dataset'; end if;
  -- Refresh explicit review and create a distinct version to test source mutations.
  update public.scan_training_reviews r set consent_revision=q.revision
    from public.scan_training_review_queue q where r.user_id=owner_id and q.user_id=r.user_id;
  insert into public.dataset_versions(version,purpose,description) values(dataset_id || '-2','evaluation','QA revision');
  insert into public.dataset_members(dataset_version,user_id,scan_local_id,model_run_id,
    consent_revision,policy_version,scan_hash,model_run_hash,label,label_source,reviewer_reference,
    privacy_checked,usage_rights_checked,quality_checked)
    select dataset_id || '-2',q.user_id,q.scan_local_id,m.id,q.revision,q.policy_version,q.current_scan_hash,
      md5(to_jsonb(m)::text),'Compressor','human_verified_correction','QA synthetic reviewer',true,true,true
    from public.scan_training_review_queue q join public.scan_model_runs m on m.id=run_id
    where q.user_id=owner_id returning id into member_id;
  update public.scan_model_runs set model='Changed' where id=run_id;
  select eligible into allowed from public.dataset_export_queue where id=member_id;
  if allowed is distinct from false then raise exception 'Changed model lineage eligible'; end if;
  update public.scan_model_runs set model='fixture' where id=run_id;
  select eligible into allowed from public.dataset_export_queue where id=member_id;
  if allowed is distinct from true then raise exception 'Restored fixture not eligible'; end if;
  update public.scan_lookups set correction='Changed correction' where user_id=owner_id;
  select eligible into allowed from public.dataset_export_queue where id=member_id;
  if allowed is distinct from false then raise exception 'Changed correction eligible'; end if;
  -- Fresh approved hashes isolate run identity/error/legacy gates, rather than
  -- accidentally passing these checks because a source hash is already stale.
  foreach rejected_case in array array['older', 'failed', 'legacy'] loop
    update public.scan_lookups
      set result_json = jsonb_build_object('partName','Alternator','modelRun',jsonb_build_object('runId',
        case when rejected_case='legacy' then 'legacy:qa-old' else 'qa-current-' || rejected_case end))
      where user_id=owner_id and local_id=scan_id;
    insert into public.scan_model_runs(user_id,scan_local_id,run_key,error_code)
      values(owner_id,scan_id,
        case when rejected_case='older' then 'qa-previous-success'
          when rejected_case='legacy' then 'legacy:qa-old' else 'qa-current-' || rejected_case end,
        case when rejected_case='failed' then 'provider_error' else null end)
      returning id into rejected_run_id;
    update public.scan_training_reviews r set reviewed_scan_hash=q.current_scan_hash,consent_revision=q.revision
      from public.scan_training_review_queue q where r.user_id=owner_id and q.user_id=r.user_id and q.scan_local_id=r.scan_local_id;
    insert into public.dataset_versions(version,purpose,description)
      values(dataset_id || '-' || rejected_case,'evaluation','QA rejected run binding');
    insert into public.dataset_members(dataset_version,user_id,scan_local_id,model_run_id,
      consent_revision,policy_version,scan_hash,model_run_hash,label,label_source,reviewer_reference,
      privacy_checked,usage_rights_checked,quality_checked)
      select dataset_id || '-' || rejected_case,q.user_id,q.scan_local_id,m.id,q.revision,q.policy_version,q.current_scan_hash,
        md5(to_jsonb(m)::text),'Compressor','human_verified_correction','QA synthetic reviewer',true,true,true
      from public.scan_training_review_queue q join public.scan_model_runs m on m.id=rejected_run_id
      where q.user_id=owner_id returning id into rejected_member_id;
    select eligible into allowed from public.dataset_export_queue where id=rejected_member_id;
    if allowed is distinct from false then raise exception 'Invalid % run was eligible', rejected_case; end if;
  end loop;
  delete from public.scan_lookups where user_id=owner_id;
  if exists(select 1 from public.dataset_members where user_id=owner_id)
    or exists(select 1 from public.dataset_export_queue where user_id=owner_id) then
    raise exception 'Deleted source retained export membership'; end if;
end;
$$;
rollback;
