-- Run after the billing entitlement and free_scan_usage migrations. All fixtures roll back.
begin;
do $$
declare
  free_id uuid := gen_random_uuid();
  paid_id uuid := gen_random_uuid();
  unconfirmed_id uuid := gen_random_uuid();
  hold uuid;
  second_hold uuid;
  result jsonb;
  used integer;
begin
  insert into auth.users(id) values (free_id), (paid_id), (unconfirmed_id);
  for i in 1..5 loop
    result := public.reserve_scan_credit(free_id, true);
    if result->>'ok' <> 'true' or result->>'reservation_id' is not null then raise exception 'Free scan % rejected', i; end if;
  end loop;
  if public.reserve_scan_credit(free_id, true)->>'ok' <> 'false' then raise exception 'Sixth free scan allowed'; end if;
  select scans_used into used from public.free_scan_usage where user_id = free_id;
  if used <> 5 then raise exception 'Free usage is not exactly five'; end if;
  if public.reserve_scan_credit(unconfirmed_id, false)->>'ok' <> 'false' then raise exception 'Unverified free account allowed'; end if;

  insert into public.billing_entitlements(user_id, plan_id, stripe_customer_id, status, scan_allowance, scans_used)
    values (paid_id, 'plus_monthly', 'qa-credit-customer', 'active', 2, 0);
  result := public.reserve_scan_credit(paid_id, false); hold := (result->>'reservation_id')::uuid;
  result := public.reserve_scan_credit(paid_id, false); second_hold := (result->>'reservation_id')::uuid;
  if hold is null or second_hold is null then raise exception 'Paid hold not created'; end if;
  if public.reserve_scan_credit(paid_id, true)->>'ok' <> 'false' then raise exception 'In-flight paid scans overbooked or fell through to free'; end if;
  perform public.finalize_scan_credit(paid_id, hold, true);
  perform public.finalize_scan_credit(paid_id, hold, true);
  select scans_used into used from public.billing_entitlements where user_id = paid_id;
  if used <> 1 then raise exception 'Paid completion was not idempotent'; end if;
  perform public.finalize_scan_credit(paid_id, second_hold, false);
  result := public.reserve_scan_credit(paid_id, true); hold := (result->>'reservation_id')::uuid;
  if hold is null then raise exception 'Paid failed hold was not released'; end if;
  perform public.finalize_scan_credit(free_id, hold, true);
  if not exists(select 1 from public.scan_credit_reservations where id = hold) then raise exception 'Wrong user finalized hold'; end if;
  perform public.finalize_scan_credit(paid_id, hold, true);
  if public.reserve_scan_credit(paid_id, true)->>'ok' <> 'false' then raise exception 'Exhausted paid entitlement got free credits'; end if;
  if (select scans_used from public.free_scan_usage where user_id = paid_id) <> 0 then raise exception 'Paid scans consumed free allowance'; end if;

  -- Webhook period changes must not hide holds or erase successful consumption.
  update public.billing_entitlements set scans_used = 0 where user_id = paid_id;
  result := public.reserve_scan_credit(paid_id, true); hold := (result->>'reservation_id')::uuid;
  update public.billing_entitlements set current_period_end = now() + interval '1 month' where user_id = paid_id;
  result := public.reserve_scan_credit(paid_id, true); second_hold := (result->>'reservation_id')::uuid;
  if public.reserve_scan_credit(paid_id, true)->>'ok' <> 'false' then raise exception 'Period change hid pending hold'; end if;
  perform public.finalize_scan_credit(paid_id, hold, true);
  perform public.finalize_scan_credit(paid_id, second_hold, true);
  if (select scans_used from public.billing_entitlements where user_id = paid_id) <> 2 then raise exception 'Period change lost successful consumption'; end if;

  -- Becoming paid and then canceled cannot reset the lifetime free counter.
  insert into public.billing_entitlements(user_id, plan_id, stripe_customer_id, status, scan_allowance)
    values (free_id, 'plus_monthly', 'qa-upgrade', 'active', 10);
  update public.billing_entitlements set status = 'canceled' where user_id = free_id;
  if public.reserve_scan_credit(free_id, true)->>'ok' <> 'false' then raise exception 'Cancel reset free allowance'; end if;
  if has_function_privilege('anon', 'public.reserve_scan_credit(uuid,boolean)', 'execute')
    or has_function_privilege('authenticated', 'public.reserve_scan_credit(uuid,boolean)', 'execute')
    or has_function_privilege('authenticated', 'public.finalize_scan_credit(uuid,uuid,boolean)', 'execute')
    or has_table_privilege('authenticated', 'public.free_scan_usage', 'update') then
    raise exception 'Clients can modify credits';
  end if;
end;
$$;
-- Verify SECURITY INVOKER functions work as the actual API service role.
set local role service_role;
select public.reserve_scan_credit(user_id, false) from public.free_scan_usage limit 1;
reset role;
rollback;
