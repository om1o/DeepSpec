-- Webhook deliveries are at-least-once. Record each provider purchase key and
-- mutate its entitlement in one transaction so retries cannot duplicate credit.
create table public.billing_purchase_events (
  billing_provider text not null check (billing_provider in ('stripe', 'polar')),
  event_key text not null check (length(event_key) between 1 and 255),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null,
  provider_checkout_id text,
  created_at timestamptz not null default now(),
  primary key (billing_provider, event_key)
);

alter table public.billing_purchase_events enable row level security;
revoke all on public.billing_purchase_events from public, anon, authenticated, service_role;
grant select, insert on public.billing_purchase_events to service_role;

create function public.apply_billing_purchase(
  p_billing_provider text,
  p_event_key text,
  p_user_id uuid,
  p_plan_id text,
  p_provider_customer_id text,
  p_provider_checkout_id text,
  p_provider_subscription_id text,
  p_status text,
  p_scan_allowance integer,
  p_current_period_end timestamptz,
  p_additive boolean
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  event_inserted boolean;
begin
  if p_billing_provider not in ('stripe', 'polar')
    or p_event_key is null or length(p_event_key) not between 1 and 255
    or p_user_id is null
    or p_plan_id is null
    or p_provider_customer_id is null
    or p_scan_allowance is null or p_scan_allowance < 0 then
    raise exception 'Invalid billing purchase';
  end if;

  insert into public.billing_purchase_events (
    billing_provider,
    event_key,
    user_id,
    plan_id,
    provider_checkout_id
  ) values (
    p_billing_provider,
    p_event_key,
    p_user_id,
    p_plan_id,
    p_provider_checkout_id
  )
  on conflict (billing_provider, event_key) do nothing
  returning true into event_inserted;

  if not coalesce(event_inserted, false) then
    return false;
  end if;

  insert into public.billing_entitlements (
    user_id,
    plan_id,
    billing_provider,
    provider_customer_id,
    provider_subscription_id,
    provider_checkout_id,
    stripe_customer_id,
    stripe_subscription_id,
    stripe_checkout_session_id,
    status,
    scan_allowance,
    current_period_end,
    updated_at
  ) values (
    p_user_id,
    p_plan_id,
    p_billing_provider,
    p_provider_customer_id,
    p_provider_subscription_id,
    p_provider_checkout_id,
    case when p_billing_provider = 'stripe' then p_provider_customer_id end,
    case when p_billing_provider = 'stripe' then p_provider_subscription_id end,
    case when p_billing_provider = 'stripe' then p_provider_checkout_id end,
    p_status,
    p_scan_allowance,
    p_current_period_end,
    now()
  )
  on conflict (user_id) do update set
    plan_id = excluded.plan_id,
    billing_provider = excluded.billing_provider,
    provider_customer_id = excluded.provider_customer_id,
    provider_subscription_id = excluded.provider_subscription_id,
    provider_checkout_id = excluded.provider_checkout_id,
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    stripe_checkout_session_id = excluded.stripe_checkout_session_id,
    status = excluded.status,
    scan_allowance = case when p_additive
      then public.billing_entitlements.scan_allowance + excluded.scan_allowance
      else excluded.scan_allowance
    end,
    current_period_end = excluded.current_period_end,
    updated_at = now();

  return true;
end;
$$;

revoke all on function public.apply_billing_purchase(
  text, text, uuid, text, text, text, text, text, integer, timestamptz, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.apply_billing_purchase(
  text, text, uuid, text, text, text, text, text, integer, timestamptz, boolean
) to service_role;

notify pgrst, 'reload schema';
