-- Separate capture assets and preserve identity across sync retries.
alter table public.scan_lookups
  add column isolated_image_path text,
  add column isolated_image_hash text,
  add column isolated_image_mime_type text,
  add column isolated_image_byte_length integer check (isolated_image_byte_length >= 0),
  add column isolated_image_kind text check (isolated_image_kind in ('crop', 'segmentation')),
  add column analysis_attempt_id text;

alter table public.scan_model_runs
  add column run_key text,
  add column pipeline_version text,
  add constraint scan_model_runs_run_key_unique unique (user_id, scan_local_id, run_key);

comment on column public.scan_model_runs.run_key is 'Stable inference identity; legacy: hashes deduplicate resyncs but do not establish distinct historical requests. Old NULL rows remain unchanged.';
comment on column public.scan_lookups.isolated_image_path is 'Optional private scan-images crop/segmentation object, separate from original image_path. Not automatically a verified training example.';
