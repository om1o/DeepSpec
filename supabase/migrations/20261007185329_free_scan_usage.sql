-- Apply after billing_entitlements. Server-only credit gates; five lifetime free
-- provider attempts for a registered, confirmed account. No automatic hold expiry:
-- an unknown provider outcome must not silently permit more paid spend.
create table public.free_scan_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  scans_used integer not null default 0 check (scans_used between 0 and 5)
);
create table public.scan_credit_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index scan_credit_reservations_user_idx
  on public.scan_credit_reservations(user_id);
alter table public.free_scan_usage enable row level security;
alter table public.scan_credit_reservations enable row level security;
revoke all on public.free_scan_usage, public.scan_credit_reservations from public, anon, authenticated;
grant select, insert, update, delete on public.free_scan_usage, public.scan_credit_reservations to service_role;
grant select, update on public.billing_entitlements to service_role;

create function public.reserve_scan_credit(p_user_id uuid, p_free_eligible boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  entitlement public.billing_entitlements%rowtype;
  free_used integer;
  pending bigint;
  reservation_id uuid;
begin
  -- The first-use insert and row lock serialize every reservation for this user.
  insert into public.free_scan_usage(user_id) values (p_user_id) on conflict do nothing;
  select scans_used into free_used from public.free_scan_usage where user_id = p_user_id for update;
  select * into entitlement from public.billing_entitlements where user_id = p_user_id for update;
  if entitlement.status = 'active' then
    select count(*) into pending from public.scan_credit_reservations
      where user_id = p_user_id;
    if entitlement.scans_used + pending >= entitlement.scan_allowance then
      return jsonb_build_object('ok', false);
    end if;
    insert into public.scan_credit_reservations(user_id)
      values (p_user_id) returning id into reservation_id;
    return jsonb_build_object('ok', true, 'reservation_id', reservation_id);
  end if;
  if not coalesce(p_free_eligible, false) or free_used >= 5 then
    return jsonb_build_object('ok', false);
  end if;
  update public.free_scan_usage set scans_used = scans_used + 1 where user_id = p_user_id;
  return jsonb_build_object('ok', true, 'reservation_id', null);
end;
$$;

create function public.finalize_scan_credit(p_user_id uuid, p_reservation_id uuid, p_succeeded boolean)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  entitlement public.billing_entitlements%rowtype;
  reservation public.scan_credit_reservations%rowtype;
begin
  perform 1 from public.free_scan_usage where user_id = p_user_id for update;
  select * into entitlement from public.billing_entitlements where user_id = p_user_id for update;
  select * into reservation from public.scan_credit_reservations
    where id = p_reservation_id and user_id = p_user_id for update;
  if not found then return; end if;
  if p_succeeded then
    update public.billing_entitlements set scans_used = scans_used + 1, updated_at = now()
      where user_id = p_user_id;
  end if;
  delete from public.scan_credit_reservations where id = p_reservation_id and user_id = p_user_id;
end;
$$;
revoke all on function public.reserve_scan_credit(uuid, boolean) from public, anon, authenticated;
revoke all on function public.finalize_scan_credit(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.reserve_scan_credit(uuid, boolean) to service_role;
grant execute on function public.finalize_scan_credit(uuid, uuid, boolean) to service_role;
