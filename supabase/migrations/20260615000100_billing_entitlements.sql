-- Verified billing entitlement state. The browser may read its own row, but
-- only server-side Stripe webhook code should insert or update paid access.

create table if not exists public.billing_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id text not null
    check (plan_id in ('plus_monthly', 'plus_yearly', 'scan_pack', 'pro_beta')),
  stripe_customer_id text not null,
  stripe_subscription_id text,
  stripe_checkout_session_id text,
  status text not null default 'inactive'
    check (status in ('active', 'past_due', 'canceled', 'inactive')),
  scan_allowance integer not null default 0 check (scan_allowance >= 0),
  scans_used integer not null default 0 check (scans_used >= 0),
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.billing_entitlements is 'Server-verified Stripe entitlement state for DeepSpec paid access.';
comment on column public.billing_entitlements.scans_used is 'Server-side paid scan consumption count; do not trust browser-local scan counts for paid access.';

create index if not exists billing_entitlements_stripe_customer_id_idx
  on public.billing_entitlements (stripe_customer_id);

create unique index if not exists billing_entitlements_stripe_subscription_id_key
  on public.billing_entitlements (stripe_subscription_id)
  where stripe_subscription_id is not null;

create unique index if not exists billing_entitlements_stripe_checkout_session_id_key
  on public.billing_entitlements (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

alter table public.billing_entitlements enable row level security;

drop policy if exists billing_entitlements_select_own on public.billing_entitlements;
create policy billing_entitlements_select_own
  on public.billing_entitlements
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists billing_entitlements_no_client_insert on public.billing_entitlements;
create policy billing_entitlements_no_client_insert
  on public.billing_entitlements
  for insert
  to authenticated
  with check (false);

drop policy if exists billing_entitlements_no_client_update on public.billing_entitlements;
create policy billing_entitlements_no_client_update
  on public.billing_entitlements
  for update
  to authenticated
  using (false)
  with check (false);

drop policy if exists billing_entitlements_no_client_delete on public.billing_entitlements;
create policy billing_entitlements_no_client_delete
  on public.billing_entitlements
  for delete
  to authenticated
  using (false);
