-- Run after 20261102020143_billing_webhook_idempotency.sql. All fixtures roll back.
begin;

insert into auth.users (id)
values ('00000000-0000-4000-8000-000000000201'::uuid);

set local role service_role;

do $$
declare
  test_user constant uuid := '00000000-0000-4000-8000-000000000201'::uuid;
  applied boolean;
begin
  applied := public.apply_billing_checkout_webhook_event(
    p_provider => 'stripe',
    p_event_id => 'evt_test_pack_1',
    p_event_type => 'checkout.session.completed',
    p_provider_object_id => 'cs_test_pack_1',
    p_user_id => test_user,
    p_plan_id => 'scan_pack',
    p_checkout_id => 'cs_test_pack_1',
    p_customer_id => 'cus_test',
    p_subscription_id => null,
    p_current_period_end => null,
    p_status => 'active',
    p_scan_allowance => 20,
    p_add_scan_allowance => true
  );
  if not applied then
    raise exception 'First signed checkout event was not applied';
  end if;

  applied := public.apply_billing_checkout_webhook_event(
    p_provider => 'stripe',
    p_event_id => 'evt_test_pack_1',
    p_event_type => 'checkout.session.completed',
    p_provider_object_id => 'cs_test_pack_1',
    p_user_id => test_user,
    p_plan_id => 'scan_pack',
    p_checkout_id => 'cs_test_pack_1',
    p_customer_id => 'cus_test',
    p_subscription_id => null,
    p_current_period_end => null,
    p_status => 'active',
    p_scan_allowance => 20,
    p_add_scan_allowance => true
  );
  if applied then
    raise exception 'Duplicate provider event id was applied twice';
  end if;

  applied := public.apply_billing_checkout_webhook_event(
    p_provider => 'stripe',
    p_event_id => 'evt_test_pack_duplicate_envelope',
    p_event_type => 'checkout.session.completed',
    p_provider_object_id => 'cs_test_pack_1',
    p_user_id => test_user,
    p_plan_id => 'scan_pack',
    p_checkout_id => 'cs_test_pack_1',
    p_customer_id => 'cus_test',
    p_subscription_id => null,
    p_current_period_end => null,
    p_status => 'active',
    p_scan_allowance => 20,
    p_add_scan_allowance => true
  );
  if applied then
    raise exception 'Duplicate checkout object was applied through a second event envelope';
  end if;

  update public.billing_entitlements
  set scans_used = 7
  where user_id = test_user;

  applied := public.apply_billing_checkout_webhook_event(
    p_provider => 'stripe',
    p_event_id => 'evt_test_pack_2',
    p_event_type => 'checkout.session.completed',
    p_provider_object_id => 'cs_test_pack_2',
    p_user_id => test_user,
    p_plan_id => 'scan_pack',
    p_checkout_id => 'cs_test_pack_2',
    p_customer_id => 'cus_test',
    p_subscription_id => null,
    p_current_period_end => null,
    p_status => 'active',
    p_scan_allowance => 20,
    p_add_scan_allowance => true
  );
  if not applied then
    raise exception 'Distinct checkout event was treated as a duplicate';
  end if;

  if (
    select scan_allowance <> 40 or scans_used <> 7
    from public.billing_entitlements
    where user_id = test_user
  ) then
    raise exception 'Distinct scan packs were not added atomically or scans_used was reset';
  end if;

  begin
    perform public.apply_billing_checkout_webhook_event(
      p_provider => 'stripe',
      p_event_id => 'evt_test_missing_user',
      p_event_type => 'checkout.session.completed',
      p_provider_object_id => 'cs_test_missing_user',
      p_user_id => '00000000-0000-4000-8000-000000000299'::uuid,
      p_plan_id => 'scan_pack',
      p_checkout_id => 'cs_test_missing_user',
      p_customer_id => 'cus_test',
      p_subscription_id => null,
      p_current_period_end => null,
      p_status => 'active',
      p_scan_allowance => 20,
      p_add_scan_allowance => true
    );
    raise exception 'Expected entitlement foreign-key failure was not raised';
  exception
    when foreign_key_violation then null;
  end;

  if exists (
    select 1
    from public.billing_webhook_events
    where provider = 'stripe' and event_id = 'evt_test_missing_user'
  ) then
    raise exception 'Failed entitlement write left a claimed webhook receipt';
  end if;
end;
$$;

reset role;

do $$
begin
  if has_table_privilege('anon', 'public.billing_webhook_events', 'select')
    or has_table_privilege('anon', 'public.billing_webhook_events', 'insert')
    or has_table_privilege('authenticated', 'public.billing_webhook_events', 'select')
    or has_table_privilege('authenticated', 'public.billing_webhook_events', 'insert')
    or has_table_privilege('service_role', 'public.billing_webhook_events', 'update')
    or has_table_privilege('service_role', 'public.billing_webhook_events', 'delete')
    or has_function_privilege(
      'anon',
      'public.apply_billing_checkout_webhook_event(text,text,text,text,uuid,text,text,text,text,timestamp with time zone,text,integer,boolean)',
      'execute'
    )
    or has_function_privilege(
      'authenticated',
      'public.apply_billing_checkout_webhook_event(text,text,text,text,uuid,text,text,text,text,timestamp with time zone,text,integer,boolean)',
      'execute'
    ) then
    raise exception 'Client roles can read, claim, or apply billing webhook events';
  end if;

  if not has_function_privilege(
    'service_role',
    'public.apply_billing_checkout_webhook_event(text,text,text,text,uuid,text,text,text,text,timestamp with time zone,text,integer,boolean)',
    'execute'
  ) then
    raise exception 'Service role cannot apply billing webhook events';
  end if;

  if not exists (
    select 1
    from pg_class
    where oid = 'public.billing_webhook_events'::regclass
      and relrowsecurity
  ) then
    raise exception 'Billing webhook receipt table does not have RLS enabled';
  end if;
end;
$$;

rollback;
