-- Mechanic-grade shop workflow foundation.
-- Additive by design: private user scan history keeps working, while shop jobs
-- add organization-owned intake, review, correction, and report context.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 160),
  slug text not null check (length(trim(slug)) between 2 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_owner_slug_key unique (owner_user_id, slug)
);

comment on table public.organizations is 'Shop/company account for DeepSpec technician workflows.';

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'technician'
    check (role in ('owner', 'admin', 'technician', 'viewer')),
  created_at timestamptz not null default now(),
  constraint organization_members_org_user_key unique (org_id, user_id)
);

comment on table public.organization_members is 'Membership and role map for shop-owned DeepSpec workflows.';

create table if not exists public.shop_feedback_permissions (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  learning_opt_in boolean not null default false,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.shop_feedback_permissions is 'Per-shop opt-in for using corrected scan history in model/eval improvement.';

create table if not exists public.shop_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_by_user_id uuid references auth.users(id) on delete set null,
  title text not null check (length(trim(title)) between 2 and 160),
  year text not null check (length(trim(year)) between 2 and 20),
  make text not null check (length(trim(make)) between 2 and 80),
  model text not null check (length(trim(model)) between 1 and 80),
  symptom text not null check (length(trim(symptom)) between 2 and 800),
  technician_name text not null check (length(trim(technician_name)) between 2 and 160),
  vin text check (vin is null or length(trim(vin)) between 11 and 17),
  mileage text,
  engine text,
  customer_name text,
  plate text,
  bay_or_ro text,
  notes text not null default '',
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'ready_for_review', 'closed')),
  review_status text not null default 'needs_review'
    check (review_status in ('needs_review', 'confirmed', 'corrected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.shop_jobs is 'Shop-owned job intake records that wrap technician scans, feedback, and customer reports.';
comment on column public.shop_jobs.vin is 'Optional but promoted. Exact fitment claims require VIN, readable OCR label, or verified source evidence.';

create table if not exists public.job_scans (
  org_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid not null references public.shop_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_local_id text not null,
  review_status text not null default 'needs_review'
    check (review_status in ('needs_review', 'confirmed', 'corrected')),
  customer_visible_report_json jsonb,
  created_at timestamptz not null default now(),
  primary key (job_id, user_id, scan_local_id),
  constraint job_scans_scan_fk
    foreign key (user_id, scan_local_id)
    references public.scan_lookups (user_id, local_id)
    on delete cascade
);

comment on table public.job_scans is 'Join table connecting existing user-owned scan rows to shop jobs.';

alter table public.scan_lookups
  add column if not exists org_id uuid,
  add column if not exists job_id uuid,
  add column if not exists technician_user_id uuid references auth.users(id) on delete set null,
  add column if not exists vehicle_context jsonb,
  add column if not exists customer_visible_report_json jsonb,
  add column if not exists review_status text
    check (review_status in ('needs_review', 'confirmed', 'corrected') or review_status is null);

comment on column public.scan_lookups.org_id is 'Optional shop/company context for a scan. Null keeps existing private user history behavior.';
comment on column public.scan_lookups.job_id is 'Optional shop job context for a scan; job_scans is the durable join table.';
comment on column public.scan_lookups.vehicle_context is 'VIN/year/make/model/engine/customer context supplied before or after scan.';
comment on column public.scan_lookups.customer_visible_report_json is 'Share/export payload safe for customer-facing reports.';
comment on column public.scan_lookups.review_status is 'Shop review queue state derived from confirmation or correction feedback.';

create index if not exists organizations_owner_idx on public.organizations (owner_user_id);
create index if not exists organization_members_user_idx on public.organization_members (user_id, org_id);
create index if not exists shop_jobs_org_status_idx on public.shop_jobs (org_id, status, updated_at desc);
create index if not exists shop_jobs_org_review_idx on public.shop_jobs (org_id, review_status, updated_at desc);
create index if not exists job_scans_org_job_idx on public.job_scans (org_id, job_id, created_at desc);
create index if not exists scan_lookups_org_job_idx on public.scan_lookups (org_id, job_id, created_at desc);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.shop_feedback_permissions enable row level security;
alter table public.shop_jobs enable row level security;
alter table public.job_scans enable row level security;

revoke all on public.organizations from anon;
revoke all on public.organization_members from anon;
revoke all on public.shop_feedback_permissions from anon;
revoke all on public.shop_jobs from anon;
revoke all on public.job_scans from anon;

grant select, insert, update, delete on public.organizations to authenticated;
grant select, insert, update, delete on public.organization_members to authenticated;
grant select, insert, update on public.shop_feedback_permissions to authenticated;
grant select, insert, update, delete on public.shop_jobs to authenticated;
grant select, insert, update, delete on public.job_scans to authenticated;

drop policy if exists organizations_select_member on public.organizations;
create policy organizations_select_member
  on public.organizations
  for select
  to authenticated
  using (
    owner_user_id = (select auth.uid())
    or id in (
      select org_id
      from public.organization_members
      where user_id = (select auth.uid())
    )
  );

drop policy if exists organizations_insert_owner on public.organizations;
create policy organizations_insert_owner
  on public.organizations
  for insert
  to authenticated
  with check (owner_user_id = (select auth.uid()));

drop policy if exists organizations_update_owner on public.organizations;
create policy organizations_update_owner
  on public.organizations
  for update
  to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

drop policy if exists organizations_delete_owner on public.organizations;
create policy organizations_delete_owner
  on public.organizations
  for delete
  to authenticated
  using (owner_user_id = (select auth.uid()));

drop policy if exists organization_members_select_own on public.organization_members;
create policy organization_members_select_own
  on public.organization_members
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists organization_members_insert_owner on public.organization_members;
create policy organization_members_insert_owner
  on public.organization_members
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and role = 'owner'
    and exists (
      select 1
      from public.organizations
      where organizations.id = organization_members.org_id
        and organizations.owner_user_id = (select auth.uid())
    )
  );

drop policy if exists organization_members_update_self on public.organization_members;
create policy organization_members_update_self
  on public.organization_members
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists organization_members_delete_self on public.organization_members;
create policy organization_members_delete_self
  on public.organization_members
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists shop_feedback_permissions_select_member on public.shop_feedback_permissions;
create policy shop_feedback_permissions_select_member
  on public.shop_feedback_permissions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members
      where organization_members.org_id = shop_feedback_permissions.org_id
        and organization_members.user_id = (select auth.uid())
    )
  );

drop policy if exists shop_feedback_permissions_write_admin on public.shop_feedback_permissions;
create policy shop_feedback_permissions_write_admin
  on public.shop_feedback_permissions
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members
      where organization_members.org_id = shop_feedback_permissions.org_id
        and organization_members.user_id = (select auth.uid())
        and organization_members.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members
      where organization_members.org_id = shop_feedback_permissions.org_id
        and organization_members.user_id = (select auth.uid())
        and organization_members.role in ('owner', 'admin')
    )
  );

drop policy if exists shop_jobs_select_member on public.shop_jobs;
create policy shop_jobs_select_member
  on public.shop_jobs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members
      where organization_members.org_id = shop_jobs.org_id
        and organization_members.user_id = (select auth.uid())
    )
  );

drop policy if exists shop_jobs_insert_technician on public.shop_jobs;
create policy shop_jobs_insert_technician
  on public.shop_jobs
  for insert
  to authenticated
  with check (
    created_by_user_id = (select auth.uid())
    and exists (
      select 1
      from public.organization_members
      where organization_members.org_id = shop_jobs.org_id
        and organization_members.user_id = (select auth.uid())
        and organization_members.role in ('owner', 'admin', 'technician')
    )
  );

drop policy if exists shop_jobs_update_technician on public.shop_jobs;
create policy shop_jobs_update_technician
  on public.shop_jobs
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members
      where organization_members.org_id = shop_jobs.org_id
        and organization_members.user_id = (select auth.uid())
        and organization_members.role in ('owner', 'admin', 'technician')
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members
      where organization_members.org_id = shop_jobs.org_id
        and organization_members.user_id = (select auth.uid())
        and organization_members.role in ('owner', 'admin', 'technician')
    )
  );

drop policy if exists shop_jobs_delete_admin on public.shop_jobs;
create policy shop_jobs_delete_admin
  on public.shop_jobs
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members
      where organization_members.org_id = shop_jobs.org_id
        and organization_members.user_id = (select auth.uid())
        and organization_members.role in ('owner', 'admin')
    )
  );

drop policy if exists job_scans_select_member on public.job_scans;
create policy job_scans_select_member
  on public.job_scans
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members
      where organization_members.org_id = job_scans.org_id
        and organization_members.user_id = (select auth.uid())
    )
  );

drop policy if exists job_scans_insert_technician on public.job_scans;
create policy job_scans_insert_technician
  on public.job_scans
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.organization_members
      where organization_members.org_id = job_scans.org_id
        and organization_members.user_id = (select auth.uid())
        and organization_members.role in ('owner', 'admin', 'technician')
    )
  );

drop policy if exists job_scans_update_technician on public.job_scans;
create policy job_scans_update_technician
  on public.job_scans
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members
      where organization_members.org_id = job_scans.org_id
        and organization_members.user_id = (select auth.uid())
        and organization_members.role in ('owner', 'admin', 'technician')
    )
  )
  with check (
    exists (
      select 1
      from public.organization_members
      where organization_members.org_id = job_scans.org_id
        and organization_members.user_id = (select auth.uid())
        and organization_members.role in ('owner', 'admin', 'technician')
    )
  );

drop policy if exists job_scans_delete_admin on public.job_scans;
create policy job_scans_delete_admin
  on public.job_scans
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members
      where organization_members.org_id = job_scans.org_id
        and organization_members.user_id = (select auth.uid())
        and organization_members.role in ('owner', 'admin')
    )
  );

drop policy if exists scan_lookups_select_own on public.scan_lookups;
create policy scan_lookups_select_own
  on public.scan_lookups
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      org_id is not null
      and exists (
        select 1
        from public.organization_members
        where organization_members.org_id = scan_lookups.org_id
          and organization_members.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists scan_lookups_insert_own on public.scan_lookups;
create policy scan_lookups_insert_own
  on public.scan_lookups
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and (
      org_id is null
      or exists (
        select 1
        from public.organization_members
        where organization_members.org_id = scan_lookups.org_id
          and organization_members.user_id = (select auth.uid())
          and organization_members.role in ('owner', 'admin', 'technician')
      )
    )
  );

drop policy if exists scan_lookups_update_own on public.scan_lookups;
create policy scan_lookups_update_own
  on public.scan_lookups
  for update
  to authenticated
  using (
    (select auth.uid()) = user_id
    or (
      org_id is not null
      and exists (
        select 1
        from public.organization_members
        where organization_members.org_id = scan_lookups.org_id
          and organization_members.user_id = (select auth.uid())
          and organization_members.role in ('owner', 'admin', 'technician')
      )
    )
  )
  with check (
    (select auth.uid()) = user_id
    and (
      org_id is null
      or exists (
        select 1
        from public.organization_members
        where organization_members.org_id = scan_lookups.org_id
          and organization_members.user_id = (select auth.uid())
          and organization_members.role in ('owner', 'admin', 'technician')
      )
    )
  );

drop policy if exists scan_lookups_delete_own on public.scan_lookups;
create policy scan_lookups_delete_own
  on public.scan_lookups
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

alter table public.billing_entitlements
  add column if not exists billing_provider text not null default 'stripe',
  add column if not exists provider_customer_id text,
  add column if not exists provider_subscription_id text,
  add column if not exists provider_checkout_id text;

alter table public.billing_entitlements
  alter column stripe_customer_id drop not null;

update public.billing_entitlements
set
  billing_provider = coalesce(nullif(billing_provider, ''), 'stripe'),
  provider_customer_id = coalesce(provider_customer_id, stripe_customer_id),
  provider_subscription_id = coalesce(provider_subscription_id, stripe_subscription_id),
  provider_checkout_id = coalesce(provider_checkout_id, stripe_checkout_session_id)
where provider_customer_id is null
   or provider_subscription_id is null
   or provider_checkout_id is null
   or billing_provider is null
   or billing_provider = '';

comment on table public.billing_entitlements is 'Server-verified provider-neutral entitlement state for DeepSpec paid access.';
comment on column public.billing_entitlements.billing_provider is 'Payment provider adapter that verified this entitlement, for example stripe, lemonsqueezy, polar, or paddle.';
comment on column public.billing_entitlements.provider_customer_id is 'Provider-neutral customer identifier. Legacy stripe_customer_id is retained for the Stripe adapter.';
comment on column public.billing_entitlements.provider_subscription_id is 'Provider-neutral subscription identifier. Legacy stripe_subscription_id is retained for the Stripe adapter.';
comment on column public.billing_entitlements.provider_checkout_id is 'Provider-neutral checkout identifier. Legacy stripe_checkout_session_id is retained for the Stripe adapter.';

create index if not exists billing_entitlements_provider_customer_idx
  on public.billing_entitlements (billing_provider, provider_customer_id)
  where provider_customer_id is not null;

create unique index if not exists billing_entitlements_provider_subscription_key
  on public.billing_entitlements (billing_provider, provider_subscription_id)
  where provider_subscription_id is not null;

create unique index if not exists billing_entitlements_provider_checkout_key
  on public.billing_entitlements (billing_provider, provider_checkout_id)
  where provider_checkout_id is not null;

notify pgrst, 'reload schema';
