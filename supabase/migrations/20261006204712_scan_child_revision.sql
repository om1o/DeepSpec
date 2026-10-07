-- Deploy before the client that calls sync_scan_details. Do not fall back to
-- independent child writes when this RPC is unavailable.
create function public.sync_scan_details(
  p_scan_local_id text,
  p_revision bigint,
  p_candidates jsonb,
  p_evidence jsonb,
  p_correction jsonb,
  p_job_scan jsonb default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
begin
  -- This lock conflicts with the next parent CAS and lasts until all child
  -- mutations commit (or roll back). Checking without a lock is not sufficient.
  perform 1 from public.scan_lookups
    where user_id = owner_id and local_id = p_scan_local_id and revision = p_revision
    for update;
  if not found then return false; end if;

  -- Never take ownership or scan identity from caller-supplied detail JSON.
  delete from public.scan_candidates where user_id = owner_id and scan_local_id = p_scan_local_id;
  insert into public.scan_candidates (
    user_id, scan_local_id, candidate_rank, part_name, confidence, scan_category, reason, candidate_json
  )
  select owner_id, p_scan_local_id, c.candidate_rank, c.part_name, c.confidence, c.scan_category, c.reason, c.candidate_json
  from jsonb_to_recordset(p_candidates) as c(
    candidate_rank integer, part_name text, confidence text, scan_category text, reason text, candidate_json jsonb
  );

  delete from public.scan_evidence where user_id = owner_id and scan_local_id = p_scan_local_id;
  insert into public.scan_evidence (
    user_id, scan_local_id, evidence_rank, evidence_type, label, region_label, evidence_text, url, source_type, evidence_json
  )
  select owner_id, p_scan_local_id, e.evidence_rank, e.evidence_type, e.label, e.region_label,
    e.evidence_text, e.url, e.source_type, e.evidence_json
  from jsonb_to_recordset(p_evidence) as e(
    evidence_rank integer, evidence_type text, label text, region_label text,
    evidence_text text, url text, source_type text, evidence_json jsonb
  );

  insert into public.scan_corrections (
    user_id, scan_local_id, corrected_category, corrected_part_name, correction_text,
    damage_severity, notes, rating, region_label, training_status
  )
  select owner_id, p_scan_local_id, c.corrected_category, c.corrected_part_name, c.correction_text,
    c.damage_severity, c.notes, c.rating, c.region_label, c.training_status
  from jsonb_to_record(p_correction) as c(
    corrected_category text, corrected_part_name text, correction_text text,
    damage_severity text, notes text, rating text, region_label text, training_status text
  )
  on conflict (user_id, scan_local_id) do update set
    corrected_category = excluded.corrected_category,
    corrected_part_name = excluded.corrected_part_name,
    correction_text = excluded.correction_text,
    damage_severity = excluded.damage_severity,
    notes = excluded.notes,
    rating = excluded.rating,
    region_label = excluded.region_label,
    training_status = excluded.training_status;

  -- Shop mode is optional: private scans must work without its tables installed.
  -- Retain invoker privileges and all existing membership/RLS checks.
  if p_job_scan is not null and p_job_scan <> 'null'::jsonb then
    insert into public.job_scans (
      user_id, scan_local_id, org_id, job_id, review_status, customer_visible_report_json
    )
    select owner_id, p_scan_local_id, j.org_id, j.job_id, j.review_status, j.customer_visible_report_json
    from jsonb_to_record(p_job_scan) as j(
      org_id uuid, job_id uuid, review_status text, customer_visible_report_json jsonb
    )
    on conflict (job_id, user_id, scan_local_id) do update set
      org_id = excluded.org_id,
      review_status = excluded.review_status,
      customer_visible_report_json = excluded.customer_visible_report_json;
  end if;

  return true;
end;
$$;

revoke all on function public.sync_scan_details(text, bigint, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.sync_scan_details(text, bigint, jsonb, jsonb, jsonb, jsonb) to authenticated;
comment on function public.sync_scan_details(text, bigint, jsonb, jsonb, jsonb, jsonb) is
  'Atomically replace mutable scan details only while the caller-owned parent remains at the committed revision. False means missing, inaccessible, or stale; no children changed.';
notify pgrst, 'reload schema';
