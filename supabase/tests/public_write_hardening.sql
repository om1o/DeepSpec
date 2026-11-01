-- Run after 20261101121028_harden_public_write_surfaces.sql. Fixtures roll back.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid();
  waitlist_owner uuid;
  feedback_owner uuid;
  waitlist_source text;
  feedback_source text;
  submission_index integer;
begin
  insert into auth.users(id) values (owner_id);
  insert into public.waitlist_signups(user_id, email, created_at)
    values (owner_id, 'future-' || owner_id::text || '@example.com', now() + interval '10 years');
  insert into public.feedback_submissions(user_id, message, created_at)
    values (owner_id, 'Future historical feedback', now() + interval '10 years');

  if has_table_privilege('anon', 'public.waitlist_signups', 'insert')
    or has_table_privilege('anon', 'public.feedback_submissions', 'insert') then
    raise exception 'Anonymous role retains a public write grant';
  end if;
  if has_column_privilege('authenticated', 'public.waitlist_signups', 'user_id', 'insert')
    or has_column_privilege('authenticated', 'public.waitlist_signups', 'created_at', 'insert')
    or has_column_privilege('authenticated', 'public.waitlist_signups', 'source', 'insert')
    or has_column_privilege('authenticated', 'public.feedback_submissions', 'user_id', 'insert')
    or has_column_privilege('authenticated', 'public.feedback_submissions', 'created_at', 'insert')
    or has_column_privilege('authenticated', 'public.feedback_submissions', 'source', 'insert') then
    raise exception 'Authenticated browser can override server-bound metadata';
  end if;
  if not has_column_privilege('authenticated', 'public.waitlist_signups', 'email', 'insert')
    or not has_column_privilege('authenticated', 'public.feedback_submissions', 'message', 'insert') then
    raise exception 'Authenticated form fields are not insertable';
  end if;

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.waitlist_signups(email, user_type, main_problem)
    values ('qa-' || owner_id::text || '@example.com', 'car_owner', 'Synthetic rollback-only waitlist check')
    returning user_id, source into waitlist_owner, waitlist_source;
  if waitlist_owner is distinct from owner_id or waitlist_source is distinct from 'pwa' then
    raise exception 'Waitlist metadata was not bound by database defaults';
  end if;

  insert into public.feedback_submissions(category, message)
    values ('other', 'Synthetic rollback-only feedback check')
    returning user_id, source into feedback_owner, feedback_source;
  if feedback_owner is distinct from owner_id or feedback_source is distinct from 'pwa' then
    raise exception 'Feedback metadata was not bound by database defaults';
  end if;

  perform set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object(
      'sub', owner_id::text,
      'role', 'authenticated',
      'is_anonymous', true
    )::text,
    true
  );
  begin
    insert into public.waitlist_signups(email, user_type, main_problem)
      values ('anonymous-' || owner_id::text || '@example.com', 'other', 'Anonymous authenticated write');
    raise exception 'Anonymous authenticated waitlist user was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.feedback_submissions(message) values ('Anonymous authenticated feedback');
    raise exception 'Anonymous authenticated feedback user was accepted';
  exception when insufficient_privilege then null;
  end;
  perform set_config(
    'request.jwt.claims',
    pg_catalog.json_build_object(
      'sub', owner_id::text,
      'role', 'authenticated',
      'is_anonymous', false
    )::text,
    true
  );

  begin
    insert into public.waitlist_signups(email, main_problem)
      values ('oversize-' || owner_id::text || '@example.com', repeat('x', 801));
    raise exception 'Oversize waitlist problem was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.feedback_submissions(message) values (repeat('x', 801));
    raise exception 'Oversize feedback was accepted';
  exception when check_violation then null;
  end;

  for submission_index in 2..3 loop
    insert into public.waitlist_signups(email, user_type, main_problem)
      values (
        'qa-' || submission_index::text || '-' || owner_id::text || '@example.com',
        'other',
        'Synthetic quota check'
      );
  end loop;
  begin
    insert into public.waitlist_signups(email, user_type, main_problem)
      values ('qa-4-' || owner_id::text || '@example.com', 'other', 'Fourth daily signup should fail');
    raise exception using message = 'Waitlist daily quota was not enforced', errcode = 'P0002';
  exception when raise_exception then null;
  end;

  for submission_index in 2..20 loop
    insert into public.feedback_submissions(category, message)
      values ('other', 'Synthetic quota check ' || submission_index::text);
  end loop;
  begin
    insert into public.feedback_submissions(category, message)
      values ('other', 'Twenty-first daily feedback should fail');
    raise exception using message = 'Feedback daily quota was not enforced', errcode = 'P0002';
  exception when raise_exception then null;
  end;

  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    insert into public.feedback_submissions(message) values ('Anonymous write should fail');
    raise exception 'Anonymous feedback write was accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
