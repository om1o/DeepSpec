-- Record provider-signed checkout/order events and mutate entitlements in the
-- same transaction. A receipt must roll back when the entitlement write fails
-- so a provider retry can safely try again.

create table public.billing_webhook_events (
  provider text not null
    check (provider in ('stripe', 'polar')),
  event_id text not null
    check (length(trim(event_id)) between 1 and 255),
  event_type text not null
    check (length(trim(event_type)) between 1 and 160),
  provider_object_id text not null
    check (length(trim(provider_object_id)) between 1 and 255),
  processed_at timestamptz not null default now(),
  primary key (provider, event_id),
  constraint billing_webhook_events_provider_object_key
    unique (provider, event_type, provider_object_id)
);

comment on table public.billing_webhook_events is
  'Service-only idempotency receipts for provider-signed billing webhook events.';
comment on constraint billing_webhook_events_provider_object_key on public.billing_webhook_events is
  'Also rejects separate provider event envelopes for the same checkout or order.';

alter table public.billing_webhook_events enable row level security;

revoke all on public.billing_webhook_events from public, anon, authenticated, service_role;
grant select, insert on public.billing_webhook_events to service_role;
grant select, insert, update on public.billing_entitlements to service_role;

create or replace function public.apply_billing_checkout_webhook_event(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_provider_object_id text,
  p_user_id uuid,
  p_plan_id text,
  p_checkout_id text,
  p_customer_id text,
  p_subscription_id text,
  p_current_period_end timestamptz,
  p_status text,
  p_scan_allowance integer,
  p_add_scan_allowance boolean
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  receipt_inserted boolean;
begin
  if p_provider not in ('stripe', 'polar') then
    raise exception 'Unsupported billing provider' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_event_id, ''))) not between 1 and 255 then
    raise exception 'Invalid billing event id' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_provider_object_id, ''))) not between 1 and 255 then
    raise exception 'Invalid billing provider object id' using errcode = '22023';
  end if;
  if (p_provider = 'stripe' and p_event_type <> 'checkout.session.completed')
    or (p_provider = 'polar' and p_event_type <> 'order.paid') then
    raise exception 'Unsupported billing event type' using errcode = '22023';
  end if;
  if p_plan_id not in ('plus_monthly', 'plus_yearly', 'scan_pack', 'pro_beta') then
    raise exception 'Invalid billing plan' using errcode = '22023';
  end if;
  if p_status not in ('active', 'past_due', 'canceled', 'inactive') then
    raise exception 'Invalid billing status' using errcode = '22023';
  end if;
  if p_scan_allowance is null or p_scan_allowance < 0 then
    raise exception 'Invalid billing scan allowance' using errcode = '22023';
  end if;
  if p_customer_id is null or trim(p_customer_id) = '' then
    raise exception 'Invalid billing customer id' using errcode = '22023';
  end if;
  if p_add_scan_allowance is null or (p_plan_id = 'scan_pack') <> p_add_scan_allowance then
    raise exception 'Invalid billing allowance operation' using errcode = '22023';
  end if;

  insert into public.billing_webhook_events (
    provider,
    event_id,
    event_type,
    provider_object_id
  ) values (
    p_provider,
    p_event_id,
    p_event_type,
    p_provider_object_id
  )
  on conflict do nothing
  returning true into receipt_inserted;

  if not coalesce(receipt_inserted, false) then
    return false;
  end if;

  insert into public.billing_entitlements as entitlement (
    user_id,
    plan_id,
    stripe_customer_id,
    stripe_subscription_id,
    stripe_checkout_session_id,
    status,
    scan_allowance,
    current_period_end,
    updated_at,
    billing_provider,
    provider_customer_id,
    provider_subscription_id,
    provider_checkout_id
  ) values (
    p_user_id,
    p_plan_id,
    case when p_provider = 'stripe' then p_customer_id end,
    case when p_provider = 'stripe' then p_subscription_id end,
    case when p_provider = 'stripe' then p_checkout_id end,
    p_status,
    p_scan_allowance,
    p_current_period_end,
    now(),
    p_provider,
    p_customer_id,
    p_subscription_id,
    p_checkout_id
  )
  on conflict (user_id) do update
  set
    plan_id = excluded.plan_id,
    stripe_customer_id = case
      when excluded.billing_provider = 'stripe' then excluded.stripe_customer_id
      else entitlement.stripe_customer_id
    end,
    stripe_subscription_id = case
      when excluded.billing_provider = 'stripe' then excluded.stripe_subscription_id
      else entitlement.stripe_subscription_id
    end,
    stripe_checkout_session_id = case
      when excluded.billing_provider = 'stripe' then excluded.stripe_checkout_session_id
      else entitlement.stripe_checkout_session_id
    end,
    status = excluded.status,
    scan_allowance = case
      when p_add_scan_allowance then entitlement.scan_allowance + excluded.scan_allowance
      else excluded.scan_allowance
    end,
    current_period_end = excluded.current_period_end,
    updated_at = now(),
    billing_provider = excluded.billing_provider,
    provider_customer_id = excluded.provider_customer_id,
    provider_subscription_id = excluded.provider_subscription_id,
    provider_checkout_id = excluded.provider_checkout_id;

  return true;
end;
$$;

comment on function public.apply_billing_checkout_webhook_event(
  text, text, text, text, uuid, text, text, text, text, timestamptz, text, integer, boolean
) is 'Atomically records a signed checkout/order event and applies its entitlement exactly once.';

revoke all on function public.apply_billing_checkout_webhook_event(
  text, text, text, text, uuid, text, text, text, text, timestamptz, text, integer, boolean
) from public, anon, authenticated;
grant execute on function public.apply_billing_checkout_webhook_event(
  text, text, text, text, uuid, text, text, text, text, timestamptz, text, integer, boolean
) to service_role;

notify pgrst, 'reload schema';
