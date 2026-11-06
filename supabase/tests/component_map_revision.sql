-- Administrator-run regression after component_map_nonretryable_conflict.
-- All fixtures, functions and successful writes are rolled back.
begin;
create function pg_temp.expect_map_error(statement text, expected_state text, expected_message text) returns void
language plpgsql as $$
declare rejected boolean := false;
begin
  begin
    execute statement;
  exception when others then
    if sqlstate <> expected_state or (expected_message is not null and sqlerrm <> expected_message) then raise; end if;
    rejected := true;
  end;
  if not rejected then raise exception 'Expected % from %', expected_state, statement; end if;
end;
$$;
do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  prefix text := 'qa-map-revision-' || gen_random_uuid()::text;
  scan_id text;
  detail_id text := prefix || '-detail';
  version integer;
  affected integer;
  statement text;
  doc jsonb;
  changed jsonb;
  winner jsonb;
  source jsonb := jsonb_build_object('sha256', repeat('a', 64), 'width', 800, 'height', 600,
    'photoAddedAt', '2026-11-05T00:00:00.000Z', 'scanSavedAt', '2026-11-05T00:00:01.000Z');
  binding jsonb;
begin
  insert into auth.users(id) values (owner_id), (other_id);
  insert into public.scan_lookups(user_id, local_id, created_at, captured_at, image_path, evidence_bundle_json)
    values (owner_id, detail_id, now(), now(), 'synthetic-detail', '{"version":1,"photos":[{"id":"p1"},{"id":"p2"}]}');
  for version in 1..4 loop
    insert into public.scan_lookups(user_id, local_id, created_at, captured_at, image_path, evidence_bundle_json)
      values (owner_id, prefix || '-v' || version, now(), now(), 'synthetic-overview',
        '{"version":1,"photos":[{"id":"original"},{"id":"second"}]}');
  end loop;
  binding := jsonb_build_object('version', 1, 'photoRelationship', 'same_part_or_area', 'photos',
    jsonb_build_array(jsonb_build_object('photoId', 'p1', 'label', 'overview', 'source', source),
      jsonb_build_object('photoId', 'p2', 'label', 'close_up', 'source', source)));
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('role', 'authenticated', true);

  for version in 1..4 loop
    scan_id := prefix || '-v' || version;
    doc := jsonb_build_object('version', version, 'id', scan_id,
      'overview', jsonb_build_object('lookupId', scan_id, 'photoId', 'original'),
      'components', jsonb_build_array(jsonb_build_object(
        'id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'label', 'Synthetic component', 'status', 'needs_view', 'notes', 'initial',
        'region', '{"sourcePhotoId":"original","box":{"x":0.1,"y":0.2,"width":0.3,"height":0.4,"confidence":0.8}}'::jsonb,
        'scanGroups', jsonb_build_array(jsonb_build_object('linkId', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          'lookupId', detail_id, 'photoIds', jsonb_build_array('p1', 'p2'))))));
    if version >= 2 then
      doc := jsonb_set(doc, '{components,0,suggestedLocation}', '{"source":"ai_scene","text":"left side"}');
    end if;
    if version >= 3 then doc := jsonb_set(doc, '{overview,source}', source); end if;
    if version = 4 then doc := jsonb_set(doc, '{components,0,scanGroups,0,binding}', binding); end if;
    insert into public.component_maps(user_id, map_id, document_json, revision) values (owner_id, scan_id, doc, 999);
    if not exists (select 1 from public.component_maps where user_id = owner_id and map_id = scan_id and revision = 1 and document_json = doc) then
      raise exception 'Version % insert did not stamp revision 1 and preserve the document', version;
    end if;

    doc := jsonb_set(doc, '{components,0,notes}', '"winner"');
    update public.component_maps set document_json = doc, revision = 2 where user_id = owner_id and map_id = scan_id and revision = 1;
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception 'Version % current CAS failed', version; end if;
    select to_jsonb(m) into winner from public.component_maps m where user_id = owner_id and map_id = scan_id;
    if winner->'document_json' is distinct from doc or winner->>'revision' is distinct from '2' then
      raise exception 'Version % current CAS did not persist', version;
    end if;
    update public.component_maps set document_json = jsonb_set(doc, '{components,0,notes}', '"stale"'), revision = 2
      where user_id = owner_id and map_id = scan_id and revision = 1;
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Version % stale CAS overwrote the winner', version; end if;

    -- Exact SQLSTATE/message assertions cannot accidentally catch their own failure.
    foreach statement in array array[
      format('update public.component_maps set document_json = %L::jsonb where user_id = %L and map_id = %L',
        jsonb_set(doc, '{components,0,notes}', '"legacy"'), owner_id, scan_id),
      format('insert into public.component_maps(user_id,map_id,document_json) values (%L,%L,%L::jsonb) on conflict (user_id,map_id) do update set document_json = excluded.document_json', owner_id, scan_id, doc),
      format('insert into public.component_maps(user_id,map_id,document_json,revision) values (%L,%L,%L::jsonb,3) on conflict (user_id,map_id) do update set document_json = excluded.document_json, revision = excluded.revision', owner_id, scan_id, doc),
      format('update public.component_maps set revision = 1 where user_id = %L and map_id = %L and revision = 2', owner_id, scan_id),
      format('update public.component_maps set revision = 4 where user_id = %L and map_id = %L and revision = 2', owner_id, scan_id),
      format('update public.component_maps set revision = null where user_id = %L and map_id = %L and revision = 2', owner_id, scan_id)
    ] loop
      perform pg_temp.expect_map_error(statement, 'P0001', 'component_map_revision_conflict');
      if (select to_jsonb(m) from public.component_maps m where user_id = owner_id and map_id = scan_id) is distinct from winner then
        raise exception 'Version % rejected conflict modified the complete row', version;
      end if;
    end loop;

    perform pg_temp.expect_map_error(format('update public.component_maps set user_id = %L, revision = 3 where user_id = %L and map_id = %L', other_id, owner_id, scan_id), '23514', 'component_map_identity_immutable');
    perform pg_temp.expect_map_error(format('update public.component_maps set map_id = %L, revision = 3 where user_id = %L and map_id = %L', scan_id || '-changed', owner_id, scan_id), '23514', 'component_map_identity_immutable');
    changed := jsonb_set(doc, '{overview,photoId}', '"second"');
    perform pg_temp.expect_map_error(format('update public.component_maps set document_json = %L::jsonb, revision = 3 where user_id = %L and map_id = %L', changed, owner_id, scan_id), '23514', 'component_map_overview_photo_immutable');
    if version > 1 then
      changed := jsonb_set(doc, '{version}', to_jsonb(version - 1));
      perform pg_temp.expect_map_error(format('update public.component_maps set document_json = %L::jsonb, revision = 3 where user_id = %L and map_id = %L', changed, owner_id, scan_id), '23514', 'component_map_version_downgrade');
    end if;
    if version >= 3 then
      changed := jsonb_set(doc, '{overview,source,sha256}', to_jsonb(repeat('b', 64)));
      perform pg_temp.expect_map_error(format('update public.component_maps set document_json = %L::jsonb, revision = 3 where user_id = %L and map_id = %L', changed, owner_id, scan_id), '23514', 'component_map_overview_source_immutable');
    end if;
    if version = 3 then
      changed := jsonb_set(jsonb_set(doc, '{version}', '4'), '{components,0,scanGroups,0,binding}', binding);
      perform pg_temp.expect_map_error(format('update public.component_maps set document_json = %L::jsonb, revision = 3 where user_id = %L and map_id = %L', changed, owner_id, scan_id), '23514', 'component_map_legacy_link_retrofit');
    end if;
    if version = 4 then
      foreach changed in array array[
        jsonb_set(doc, '{components,0,scanGroups,0,binding,photos,0,source,sha256}', to_jsonb(repeat('b', 64))),
        jsonb_set(doc, '{components,0,scanGroups,0,binding,photoRelationship}', '"independent"'),
        jsonb_set(doc, '{components,0,scanGroups}', '[]'),
        jsonb_set(jsonb_set(doc, '{components,0,scanGroups,0,photoIds}', '["p2","p1"]'),
          '{components,0,scanGroups,0,binding,photos}', jsonb_build_array(binding#>'{photos,1}', binding#>'{photos,0}'))
      ] loop
        perform pg_temp.expect_map_error(format('update public.component_maps set document_json = %L::jsonb, revision = 3 where user_id = %L and map_id = %L', changed, owner_id, scan_id), '23514', 'component_map_link_binding_immutable');
      end loop;
      changed := jsonb_set(doc, '{components,0,scanGroups,0,binding,photos,0,source,width}', '0');
      perform pg_temp.expect_map_error(format('update public.component_maps set document_json = %L::jsonb, revision = 3 where user_id = %L and map_id = %L', changed, owner_id, scan_id), '23514', 'invalid_component_map_link_binding');
    end if;
    if (select to_jsonb(m) from public.component_maps m where user_id = owner_id and map_id = scan_id) is distinct from winner then
      raise exception 'Version % validation failures changed the complete row', version;
    end if;

    perform set_config('request.jwt.claim.sub', other_id::text, true);
    if exists (select 1 from public.component_maps where user_id = owner_id and map_id = scan_id) then raise exception 'RLS exposed another owner map'; end if;
    update public.component_maps set revision = 3 where user_id = owner_id and map_id = scan_id and revision = 2;
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'RLS permitted another owner update'; end if;
    delete from public.component_maps where user_id = owner_id and map_id = scan_id;
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'RLS permitted another owner deletion'; end if;
    perform set_config('request.jwt.claim.sub', owner_id::text, true);
    if (select to_jsonb(m) from public.component_maps m where user_id = owner_id and map_id = scan_id) is distinct from winner then
      raise exception 'RLS failures changed the complete row';
    end if;
  end loop;
end;
$$;
rollback;
