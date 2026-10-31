-- Run after 20261031101500_harden_shop_job_identity.sql.
begin;
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.job_scans'::regclass
      and conname = 'job_scans_job_org_fk'
      and contype = 'f'
  ) then
    raise exception 'job_scans is not bound to the job organization';
  end if;

  if has_column_privilege('authenticated', 'public.shop_jobs', 'org_id', 'update')
    or has_column_privilege('authenticated', 'public.shop_jobs', 'created_by_user_id', 'update') then
    raise exception 'Authenticated clients can rewrite shop job identity';
  end if;

  if has_column_privilege('authenticated', 'public.job_scans', 'org_id', 'update')
    or has_column_privilege('authenticated', 'public.job_scans', 'job_id', 'update')
    or has_column_privilege('authenticated', 'public.job_scans', 'user_id', 'update')
    or has_column_privilege('authenticated', 'public.job_scans', 'scan_local_id', 'update') then
    raise exception 'Authenticated clients can rewrite job scan identity';
  end if;

  if not has_column_privilege('authenticated', 'public.shop_jobs', 'status', 'update')
    or not has_column_privilege('authenticated', 'public.job_scans', 'review_status', 'update') then
    raise exception 'Expected shop workflow updates are unavailable';
  end if;
end;
$$;
rollback;
