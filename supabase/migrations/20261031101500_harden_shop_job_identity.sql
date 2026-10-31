-- Keep shop jobs and their scan links inside one organization, and prevent
-- authenticated clients from rewriting ownership/identity columns.

alter table public.shop_jobs
  add constraint shop_jobs_id_org_key unique (id, org_id);

alter table public.job_scans
  add constraint job_scans_job_org_fk
  foreign key (job_id, org_id)
  references public.shop_jobs (id, org_id)
  on delete cascade;

revoke update on public.shop_jobs from authenticated;
grant update (
  title,
  year,
  make,
  model,
  symptom,
  technician_name,
  vin,
  mileage,
  engine,
  customer_name,
  plate,
  bay_or_ro,
  notes,
  status,
  review_status,
  updated_at
) on public.shop_jobs to authenticated;

revoke update on public.job_scans from authenticated;
grant update (
  org_id,
  review_status,
  customer_visible_report_json
) on public.job_scans to authenticated;

notify pgrst, 'reload schema';
