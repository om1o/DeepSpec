-- DISPOSABLE LOCAL POSTGRESQL ONLY. Never run this fixture test on a linked
-- production database. Run after all migrations, as the postgres table owner
-- with CREATE permission on this disposable database.
-- This is a transactional SQL assertion test, not a pgTAP test.
begin;

do $$
declare
  table_name text;
  client_role text;
  privilege_name text;
  forbidden text[] := array['TRUNCATE', 'REFERENCES', 'TRIGGER'];
begin
  if current_setting('server_version_num')::integer >= 170000 then
    forbidden := array_append(forbidden, 'MAINTAIN');
  end if;
  foreach table_name in array array[
    'billing_entitlements', 'billing_purchase_events', 'dataset_members',
    'dataset_versions', 'feedback_reviews', 'feedback_submissions',
    'free_scan_usage', 'job_scans', 'organization_members', 'organizations',
    'rate_limit_hits', 'scan_candidates', 'scan_corrections',
    'scan_credit_reservations', 'scan_evidence', 'scan_lookups', 'scan_model_runs',
    'scan_training_consent', 'scan_training_reviews', 'shop_feedback_permissions',
    'shop_jobs', 'sync_events', 'waitlist_signups'
  ] loop
    foreach client_role in array array['anon', 'authenticated'] loop
      foreach privilege_name in array forbidden loop
        if has_table_privilege(client_role, format('public.%I', table_name), privilege_name) then
          raise exception '% retains % on %', client_role, privilege_name, table_name;
        end if;
      end loop;
    end loop;
  end loop;

  if not has_table_privilege('service_role', 'public.billing_purchase_events', 'SELECT')
    or not has_table_privilege('service_role', 'public.billing_purchase_events', 'INSERT')
    or has_table_privilege('service_role', 'public.billing_purchase_events', 'UPDATE')
    or has_table_privilege('service_role', 'public.billing_purchase_events', 'DELETE')
    or has_table_privilege('service_role', 'public.billing_purchase_events', 'TRUNCATE') then
    raise exception 'Service billing ledger privileges changed';
  end if;
end;
$$;

-- Creating a new real table proves postgres's future defaults, not just the
-- default-ACL catalog. Ordinary DML defaults are deliberately unchanged; new
-- application tables still require their own grants and RLS policies.
create table public._deepspec_client_privilege_probe (
  id integer primary key,
  value text not null
);
create function public._deepspec_client_privilege_probe_trigger()
returns trigger language plpgsql as $$ begin return new; end; $$;
grant execute on function public._deepspec_client_privilege_probe_trigger() to anon, authenticated;
create schema _deepspec_privilege_test;
grant usage, create on schema _deepspec_privilege_test to anon, authenticated;

do $$
declare
  client_role text;
  privilege_name text;
  command text;
  service_privileges text[] := array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  commands text[] := array[
    'truncate public._deepspec_client_privilege_probe',
    'create table _deepspec_privilege_test.reference_probe (id integer references public._deepspec_client_privilege_probe(id))',
    'create trigger _deepspec_trigger_probe before insert on public._deepspec_client_privilege_probe for each row execute function public._deepspec_client_privilege_probe_trigger()'
  ];
begin
  if current_user <> 'postgres' then
    raise exception 'Run this disposable test as postgres';
  end if;
  if current_setting('server_version_num')::integer >= 170000 then
    service_privileges := array_append(service_privileges, 'MAINTAIN');
    commands := array_append(commands, 'reindex table public._deepspec_client_privilege_probe');
    if has_table_privilege('anon', 'public._deepspec_client_privilege_probe', 'MAINTAIN')
      or has_table_privilege('authenticated', 'public._deepspec_client_privilege_probe', 'MAINTAIN') then
      raise exception 'Future postgres table retains client MAINTAIN';
    end if;
  end if;
  foreach privilege_name in array service_privileges loop
    if not has_table_privilege('service_role', 'public._deepspec_client_privilege_probe', privilege_name) then
      raise exception 'Future service_role default changed for %', privilege_name;
    end if;
  end loop;
  foreach client_role in array array['anon', 'authenticated'] loop
    foreach privilege_name in array array['TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(client_role, 'public._deepspec_client_privilege_probe', privilege_name) then
        raise exception 'Future postgres table retains % for %', privilege_name, client_role;
      end if;
    end loop;
    if not has_schema_privilege(client_role, '_deepspec_privilege_test', 'CREATE') then
      raise exception 'Disposable REFERENCES probe requires schema CREATE for %', client_role;
    end if;
    foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not has_table_privilege(client_role, 'public._deepspec_client_privilege_probe', privilege_name) then
        raise exception 'Future % DML default changed for %', privilege_name, client_role;
      end if;
    end loop;
    perform set_config('role', client_role, true);
    insert into public._deepspec_client_privilege_probe values (1, 'before');
    update public._deepspec_client_privilege_probe set value = 'after' where id = 1;
    if (select value from public._deepspec_client_privilege_probe where id = 1) <> 'after' then
      raise exception 'Ordinary DML failed for %', client_role;
    end if;
    delete from public._deepspec_client_privilege_probe where id = 1;
    foreach command in array commands loop
      begin
        execute command;
        raise exception 'Client administrative command unexpectedly succeeded: %', command;
      exception when insufficient_privilege then
        null;
      end;
    end loop;
    perform set_config('role', 'postgres', true);
  end loop;
end;
$$;
rollback;
