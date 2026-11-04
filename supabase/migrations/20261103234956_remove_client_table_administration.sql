-- Client requests use row-level DML, not table administration. In particular,
-- RLS does not constrain TRUNCATE or REFERENCES. Keep DML, column allowlists,
-- and service_role privileges unchanged (including the append-only ledger).
revoke truncate, references, trigger on table
  public.billing_entitlements,
  public.billing_purchase_events,
  public.dataset_members,
  public.dataset_versions,
  public.feedback_reviews,
  public.feedback_submissions,
  public.free_scan_usage,
  public.job_scans,
  public.organization_members,
  public.organizations,
  public.rate_limit_hits,
  public.scan_candidates,
  public.scan_corrections,
  public.scan_credit_reservations,
  public.scan_evidence,
  public.scan_lookups,
  public.scan_model_runs,
  public.scan_training_consent,
  public.scan_training_reviews,
  public.shop_feedback_permissions,
  public.shop_jobs,
  public.sync_events,
  public.waitlist_signups
from public, anon, authenticated;

-- These are the observed schema-specific defaults of the application owner.
-- This does not change other creators' defaults or any global default grant.
-- supabase_admin is a separate platform-owned role: its future public tables
-- require a separate ACL review; postgres is not allowed to alter its defaults.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from public, anon, authenticated;

-- MAINTAIN was added in PostgreSQL 17. Dynamic SQL lets older supported
-- PostgreSQL versions replay the migration without parsing an unknown privilege.
do $$
begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'revoke maintain on table
      public.billing_entitlements, public.billing_purchase_events,
      public.dataset_members, public.dataset_versions, public.feedback_reviews,
      public.feedback_submissions, public.free_scan_usage, public.job_scans,
      public.organization_members, public.organizations, public.rate_limit_hits,
      public.scan_candidates, public.scan_corrections, public.scan_credit_reservations,
      public.scan_evidence, public.scan_lookups, public.scan_model_runs,
      public.scan_training_consent, public.scan_training_reviews,
      public.shop_feedback_permissions, public.shop_jobs, public.sync_events,
      public.waitlist_signups from public, anon, authenticated';
    execute 'alter default privileges for role postgres in schema public
      revoke maintain on tables from public, anon, authenticated';
  end if;
end;
$$;
