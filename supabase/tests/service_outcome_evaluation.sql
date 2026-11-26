-- Administrator-only synthetic regression. All fixtures roll back.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  scan_id text := 'qa-outcome-' || gen_random_uuid()::text;
  other_scan_id text := 'qa-outcome-other-' || gen_random_uuid()::text;
  followup_id uuid := gen_random_uuid();
  correction_id uuid := gen_random_uuid();
  retraction_id uuid := gen_random_uuid();
  prediction_followup_id uuid := gen_random_uuid();
  member_id uuid;
  prediction_member_id uuid;
  run_id uuid;
  prediction_run_id uuid;
  version_id text := 'qa-outcome-' || gen_random_uuid()::text;
  prediction_version_id text := 'qa-prediction-' || gen_random_uuid()::text;
  history_hash text;
  prediction_history_hash text;
  allowed boolean;
  revision_now bigint;
begin
  insert into auth.users(id) values (owner_id), (other_id);
  insert into public.scan_lookups(user_id, local_id, created_at, captured_at, result_json,
    correction, image_path, image_hash, image_mime_type, image_byte_length)
  values (owner_id, scan_id, now(), now(), '{"partName":"Alternator","modelRun":{"runId":"qa-outcome-run"}}',
    'Compressor', owner_id::text || '/qa.png', repeat('a',64), 'image/png', 42),
    (owner_id, other_scan_id, now(), now(), '{"partName":"Alternator","modelRun":{"runId":"qa-prediction-run"}}',
      null, owner_id::text || '/prediction.png', repeat('b',64), 'image/png', 42);
  insert into public.scan_model_runs(user_id, scan_local_id, run_key, provider, model, prompt_version, pipeline_version)
    values (owner_id, scan_id, 'qa-outcome-run', 'test', 'fixture', 'prompt-v1', 'pipeline-v1') returning id into run_id;
  insert into public.scan_training_consent(user_id, scan_local_id, training_consent, policy_version)
    values (owner_id, scan_id, true, '2026-09-27-v1');
  insert into public.scan_training_reviews(user_id, scan_local_id, consent_revision, reviewed_scan_hash, status, human_verified, reviewer_reference)
    select user_id, scan_local_id, revision, current_scan_hash, 'approved', true, 'QA label reviewer'
    from public.scan_training_review_queue where user_id = owner_id and scan_local_id = scan_id;
  insert into public.dataset_versions(version, purpose, description)
    values (version_id, 'evaluation', 'Synthetic outcome regression');
  insert into public.dataset_members(dataset_version, user_id, scan_local_id, model_run_id,
    consent_revision, policy_version, scan_hash, model_run_hash, label, label_source, reviewer_reference,
    privacy_checked, usage_rights_checked, quality_checked)
    select version_id, q.user_id, q.scan_local_id, run_id, q.revision, q.policy_version,
      q.current_scan_hash, md5(to_jsonb(m)::text), 'Compressor', 'human_verified_correction',
      'QA label reviewer', true, true, true
    from public.scan_training_review_queue q join public.scan_model_runs m on m.id = run_id
    where q.user_id = owner_id and q.scan_local_id = scan_id returning id into member_id;
  if not exists (select 1 from public.dataset_export_queue where id = member_id and eligible) then
    raise exception 'Base reviewed correction fixture not eligible';
  end if;
  insert into public.human_service_records(user_id, id, lookup_id, record_json)
    values (owner_id, followup_id, scan_id, jsonb_build_object(
      'version',1,'id',followup_id::text,'lookupId',scan_id,'recordedAt','2026-11-26T12:00:00Z',
      'occurredOn',null,'recordedBy','QA reporter','basis','personally_performed',
      'subject','Charging system','photoIds',jsonb_build_array(),'notes','Private note',
      'kind','follow_up','check','Retested symptom','outcome','symptom_not_observed',
      'conditions','After restart','relatedRecordIds',jsonb_build_array()));
  if exists (select 1 from public.dataset_outcome_export_queue where dataset_member_id = member_id) then
    raise exception 'Outcome appeared before separate consent and review';
  end if;
  begin
    insert into public.service_outcome_consents(user_id, scan_local_id, record_id, evaluation_consent, policy_version)
      values (owner_id, other_scan_id, followup_id, true, '2026-11-26-v1');
    raise exception 'Wrong-scan outcome consent accepted';
  exception when check_violation then null; end;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('role', 'authenticated', true);
  if auth.uid() is distinct from owner_id or not exists (
    select 1 from public.human_service_records where user_id = owner_id and id = followup_id
  ) then raise exception 'Owner service row not visible to authenticated role: uid %, role %', auth.uid(), current_user; end if;
  insert into public.service_outcome_consents(user_id, scan_local_id, record_id, evaluation_consent, policy_version)
    values (owner_id, scan_id, followup_id, false, '2026-11-26-v1');
  perform set_config('role', 'postgres', true);
  select md5(jsonb_agg(record_json order by id)::text) into history_hash from public.human_service_records
    where user_id = owner_id and lookup_id = scan_id;
  insert into public.dataset_outcome_reviews(dataset_member_id, user_id, scan_local_id, record_id,
    consent_revision, policy_version, reviewed_history_hash, status, category_checked, reviewer_reference)
    values (member_id, owner_id, scan_id, followup_id, 1, '2026-11-26-v1', history_hash,
      'approved', true, 'QA outcome reviewer');
  select eligible into allowed from public.dataset_outcome_export_queue where dataset_member_id = member_id;
  if allowed is distinct from false then raise exception 'Off-by-default outcome became eligible'; end if;
  perform set_config('role', 'authenticated', true);
  update public.service_outcome_consents set evaluation_consent = true where user_id = owner_id and record_id = followup_id;
  perform set_config('role', 'postgres', true);
  select revision into revision_now from public.service_outcome_consents where user_id = owner_id and record_id = followup_id;
  if revision_now <> 2 then raise exception 'Consent revision did not advance'; end if;
  select eligible into allowed from public.dataset_outcome_export_queue where dataset_member_id = member_id;
  if allowed is distinct from false then raise exception 'Stale review survived opt-in revision'; end if;
  update public.dataset_outcome_reviews set consent_revision = revision_now where dataset_member_id = member_id;
  select eligible into allowed from public.dataset_outcome_export_queue where dataset_member_id = member_id;
  if allowed is distinct from true then raise exception 'Reviewed and separately consented outcome not eligible'; end if;
  perform set_config('role', 'service_role', true);
  select eligible into allowed from public.dataset_outcome_export_queue where dataset_member_id = member_id;
  if allowed is distinct from true then raise exception 'Service-role exporter cannot read eligible outcome'; end if;
  perform set_config('role', 'postgres', true);
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'dataset_outcome_export_queue'
    and column_name in ('record_json','notes','photo_ids','vin','recorded_by','image_path','vehicle_context','check','conditions')) then
    raise exception 'Private service fields exposed by outcome queue';
  end if;
  perform set_config('request.jwt.claim.sub', other_id::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.service_outcome_consents(user_id, scan_local_id, record_id, evaluation_consent, policy_version)
      values (owner_id, scan_id, followup_id, true, '2026-11-26-v1');
    raise exception 'Other account opted in owner record';
  exception when insufficient_privilege or check_violation then null; end;
  if exists (select 1 from public.service_outcome_consents where user_id = owner_id) then
    raise exception 'Other account read outcome consent';
  end if;
  begin
    perform * from public.dataset_outcome_export_queue;
    raise exception 'Browser read privileged outcome queue';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.dataset_outcome_reviews;
    raise exception 'Browser read privileged outcome review';
  exception when insufficient_privilege then null; end;
  perform set_config('role', 'postgres', true);
  update public.service_outcome_consents set evaluation_consent = false where user_id = owner_id and record_id = followup_id;
  select eligible into allowed from public.dataset_outcome_export_queue where dataset_member_id = member_id;
  if allowed is distinct from false then raise exception 'Withdrawn outcome still eligible'; end if;
  update public.service_outcome_consents set evaluation_consent = true where user_id = owner_id and record_id = followup_id;
  select eligible into allowed from public.dataset_outcome_export_queue where dataset_member_id = member_id;
  if allowed is distinct from false then raise exception 'Re-opt-in resurrected stale review'; end if;
  select revision into revision_now from public.service_outcome_consents where user_id = owner_id and record_id = followup_id;
  update public.dataset_outcome_reviews set consent_revision = revision_now where dataset_member_id = member_id;
  select eligible into allowed from public.dataset_outcome_export_queue where dataset_member_id = member_id;
  if allowed is distinct from true then raise exception 'Refreshed review did not qualify'; end if;
  insert into public.human_service_records(user_id, id, lookup_id, record_json)
    values (owner_id, correction_id, scan_id, jsonb_build_object(
      'version',1,'id',correction_id::text,'lookupId',scan_id,'recordedAt','2026-11-26T13:00:00Z',
      'occurredOn',null,'recordedBy','QA reporter','basis','personally_performed',
      'subject','Charging system','photoIds',jsonb_build_array(),'notes','',
      'kind','follow_up','check','Retested symptom','outcome','symptom_observed',
      'conditions','After restart','relatedRecordIds',jsonb_build_array(),
      'supersedesId',followup_id::text,'correctionReason','Corrected the follow-up outcome'));
  select eligible into allowed from public.dataset_outcome_export_queue where dataset_member_id = member_id;
  if allowed is distinct from false then raise exception 'Correction did not invalidate outcome'; end if;
  insert into public.human_service_records(user_id, id, lookup_id, record_json)
    values (owner_id, retraction_id, scan_id, jsonb_build_object(
      'version',1,'id',retraction_id::text,'lookupId',scan_id,'recordedAt','2026-11-26T14:00:00Z',
      'occurredOn',null,'recordedBy','QA reporter','basis','personally_performed',
      'subject','Charging system','photoIds',jsonb_build_array(),'notes','',
      'kind','retraction','supersedesId',correction_id::text,'correctionReason','Reported outcome was wrong'));
  select eligible into allowed from public.dataset_outcome_export_queue where dataset_member_id = member_id;
  if allowed is distinct from false then raise exception 'Retraction did not invalidate outcome'; end if;
  begin
    insert into public.service_outcome_consents(user_id, scan_local_id, record_id, evaluation_consent, policy_version)
      values (owner_id, scan_id, retraction_id, true, '2026-11-26-v1');
    raise exception 'Retraction was offered outcome consent';
  exception when check_violation then null; end;

  insert into public.scan_model_runs(user_id, scan_local_id, run_key, provider, model, prompt_version, pipeline_version)
    values (owner_id, other_scan_id, 'qa-prediction-run', 'test', 'fixture', 'prompt-v1', 'pipeline-v1') returning id into prediction_run_id;
  insert into public.scan_training_consent(user_id, scan_local_id, training_consent, policy_version)
    values (owner_id, other_scan_id, true, '2026-09-27-v1');
  insert into public.scan_training_reviews(user_id, scan_local_id, consent_revision, reviewed_scan_hash, status, human_verified, reviewer_reference)
    select user_id, scan_local_id, revision, current_scan_hash, 'approved', true, 'QA prediction reviewer'
    from public.scan_training_review_queue where user_id = owner_id and scan_local_id = other_scan_id;
  insert into public.dataset_versions(version, purpose, description)
    values (prediction_version_id, 'evaluation', 'Synthetic verified prediction outcome');
  insert into public.dataset_members(dataset_version, user_id, scan_local_id, model_run_id,
    consent_revision, policy_version, scan_hash, model_run_hash, label, label_source, reviewer_reference,
    privacy_checked, usage_rights_checked, quality_checked)
    select prediction_version_id, q.user_id, q.scan_local_id, prediction_run_id, q.revision, q.policy_version,
      q.current_scan_hash, md5(to_jsonb(m)::text), 'Alternator', 'human_verified_prediction',
      'QA prediction reviewer', true, true, true
    from public.scan_training_review_queue q join public.scan_model_runs m on m.id = prediction_run_id
    where q.user_id = owner_id and q.scan_local_id = other_scan_id returning id into prediction_member_id;
  if not exists (select 1 from public.dataset_export_queue where id = prediction_member_id and eligible) then
    raise exception 'Base verified prediction fixture not eligible';
  end if;
  insert into public.human_service_records(user_id, id, lookup_id, record_json)
    values (owner_id, prediction_followup_id, other_scan_id, jsonb_build_object(
      'version',1,'id',prediction_followup_id::text,'lookupId',other_scan_id,'recordedAt','2026-11-26T15:00:00Z',
      'occurredOn',null,'recordedBy','QA reporter','basis','personally_performed',
      'subject','Charging system','photoIds',jsonb_build_array(),'notes','',
      'kind','follow_up','check','Retested symptom','outcome','symptom_not_observed',
      'conditions','After restart','relatedRecordIds',jsonb_build_array()));
  insert into public.service_outcome_consents(user_id, scan_local_id, record_id, evaluation_consent, policy_version)
    values (owner_id, other_scan_id, prediction_followup_id, true, '2026-11-26-v1');
  select md5(jsonb_agg(record_json order by id)::text) into prediction_history_hash from public.human_service_records
    where user_id = owner_id and lookup_id = other_scan_id;
  insert into public.dataset_outcome_reviews(dataset_member_id, user_id, scan_local_id, record_id,
    consent_revision, policy_version, reviewed_history_hash, status, category_checked, reviewer_reference)
    values (prediction_member_id, owner_id, other_scan_id, prediction_followup_id, 1, '2026-11-26-v1', prediction_history_hash,
      'approved', true, 'QA prediction outcome reviewer');
  select eligible into allowed from public.dataset_outcome_export_queue where dataset_member_id = prediction_member_id;
  if allowed is distinct from true then raise exception 'Verified prediction outcome not eligible'; end if;
end;
$$;
rollback;
