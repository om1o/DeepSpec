-- Run after 20261031142108_billing_webhook_idempotency.sql. Fixtures roll back.
begin;
do $$
declare
  test_user_id uuid := gen_random_uuid();
  first_applied boolean;
  duplicate_applied boolean;
  allowance integer;
  event_count bigint;
begin
  insert into auth.users(id) values (test_user_id);

  perform set_config('role', 'service_role', true);
  first_applied := public.apply_billing_purchase(
    p_billing_provider => 'stripe',
    p_event_key => 'cs_sql_duplicate',
    p_user_id => test_user_id,
    p_plan_id => 'scan_pack',
    p_provider_customer_id => 'cus_sql_duplicate',
    p_provider_checkout_id => 'cs_sql_duplicate',
    p_provider_subscription_id => null,
    p_status => 'active',
    p_scan_allowance => 20,
    p_current_period_end => null,
    p_additive => true
  );
  duplicate_applied := public.apply_billing_purchase(
    p_billing_provider => 'stripe',
    p_event_key => 'cs_sql_duplicate',
    p_user_id => test_user_id,
    p_plan_id => 'scan_pack',
    p_provider_customer_id => 'cus_sql_duplicate',
    p_provider_checkout_id => 'cs_sql_duplicate',
    p_provider_subscription_id => null,
    p_status => 'active',
    p_scan_allowance => 20,
    p_current_period_end => null,
    p_additive => true
  );

  if first_applied is distinct from true then
    raise exception 'First billing event was not applied';
  end if;
  if duplicate_applied is distinct from false then
    raise exception 'Duplicate billing event was applied';
  end if;

  select scan_allowance into allowance
  from public.billing_entitlements
  where user_id = test_user_id;
  if allowance <> 20 then
    raise exception 'Duplicate event changed allowance to %', allowance;
  end if;

  select count(*) into event_count
  from public.billing_purchase_events
  where billing_provider = 'stripe' and event_key = 'cs_sql_duplicate';
  if event_count <> 1 then
    raise exception 'Duplicate event created % ledger rows', event_count;
  end if;

  if has_table_privilege('service_role', 'public.billing_purchase_events', 'update')
    or has_table_privilege('service_role', 'public.billing_purchase_events', 'delete')
    or has_table_privilege('service_role', 'public.billing_purchase_events', 'truncate')
    or not has_table_privilege('service_role', 'public.billing_purchase_events', 'select')
    or not has_table_privilege('service_role', 'public.billing_purchase_events', 'insert') then
    raise exception 'Billing event ledger privileges are not append-only';
  end if;
end;
$$;
rollback;
