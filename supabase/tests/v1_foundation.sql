-- Run with an administrative SQL connection. All fixtures roll back.
begin;
do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  report_id uuid;
  actual uuid;
  seen integer;
  k text := 'qa-' || gen_random_uuid()::text;
begin
  if has_function_privilege('anon', 'public.check_rate_limit(text,integer,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.check_rate_limit(text,integer,integer)', 'EXECUTE')
    or has_function_privilege('anon', 'public.cleanup_rate_limit_hits()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.cleanup_rate_limit_hits()', 'EXECUTE') then
    raise exception 'Browser role can execute server-only limiter';
  end if;
  if not has_function_privilege('service_role', 'public.check_rate_limit(text,integer,integer)', 'EXECUTE') then
    raise exception 'Server limiter execution missing';
  end if;
  if has_table_privilege('authenticated', 'public.rate_limit_hits', 'SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('anon', 'public.rate_limit_hits', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'Browser role can access limiter counters';
  end if;
  if not public.check_rate_limit(k, 2, 60) or not public.check_rate_limit(k, 2, 60)
    or public.check_rate_limit(k, 2, 60) then
    raise exception 'Limiter threshold incorrect';
  end if;

  insert into auth.users(id) values (a), (b);
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.feedback_submissions(category, message)
    values ('other', 'Generated rollback-only ownership verification')
    returning id, user_id into report_id, actual;
  if actual is distinct from a then raise exception 'Feedback owner default failed'; end if;
  begin
    insert into public.feedback_submissions(user_id, category, message)
      values (b, 'other', 'Generated spoofing attempt expected to fail');
    raise exception 'Owner spoofing was accepted';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', b::text, true);
  select count(*) into seen from public.feedback_submissions where id = report_id;
  if seen <> 0 then raise exception 'Cross-account feedback read allowed'; end if;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'anon', true);
  insert into public.feedback_submissions(category, message)
    values ('other', 'Generated logged-out rollback-only feedback');
  perform set_config('role', 'postgres', true);
end $$;
rollback;
