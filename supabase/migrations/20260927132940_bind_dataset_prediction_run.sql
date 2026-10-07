create or replace view public.dataset_export_queue with (security_invoker = true) as
select d.id, d.dataset_version, d.user_id, d.scan_local_id, d.consent_revision,
  d.policy_version, d.scan_hash, d.model_run_id, d.model_run_hash,
  d.label, d.label_source, d.reviewer_reference,
  s.result_json ->> 'partName' as original_prediction, s.correction,
  m.provider, m.model, m.prompt_version, m.pipeline_version,
  s.image_path as original_image_path, s.image_hash as original_image_hash,
  s.image_mime_type as original_image_mime_type, s.image_byte_length as original_image_byte_length,
  s.isolated_image_path, s.isolated_image_hash, s.isolated_image_mime_type,
  s.isolated_image_byte_length, s.isolated_image_kind,
  coalesce(q.ready_for_dataset_review
    and q.revision = d.consent_revision and q.policy_version = d.policy_version
    and q.current_scan_hash = d.scan_hash
    and m.user_id = d.user_id and m.scan_local_id = d.scan_local_id
    and s.result_json is not null and m.error_code is null
    and m.run_key = coalesce(nullif(s.result_json #>> '{modelRun,runId}', ''), nullif(s.analysis_attempt_id, ''))
    and m.run_key not like 'legacy:%'
    and md5(to_jsonb(m)::text) = d.model_run_hash
    and s.image_path like d.user_id::text || '/%'
    and s.image_hash ~ '^[a-f0-9]{64}$'
    and s.image_byte_length between 1 and 2097152
    and s.image_mime_type in ('image/jpeg', 'image/png', 'image/webp')
    and (s.isolated_image_path is null or (
      s.isolated_image_path like d.user_id::text || '/%'
      and s.isolated_image_hash ~ '^[a-f0-9]{64}$'
      and s.isolated_image_byte_length between 1 and 2097152
      and s.isolated_image_mime_type in ('image/jpeg', 'image/png', 'image/webp')
      and s.isolated_image_kind in ('crop', 'segmentation'))), false) as eligible
from public.dataset_members d
join public.scan_lookups s on s.user_id = d.user_id and s.local_id = d.scan_local_id
join public.scan_model_runs m on m.id = d.model_run_id
join public.scan_training_review_queue q on q.user_id = d.user_id and q.scan_local_id = d.scan_local_id;
