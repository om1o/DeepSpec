-- UNAPPLIED: version 3 binds the overview to an immutable saved-file fingerprint.
-- This validates client metadata, not Storage bytes. Existing rows are not rewritten.
-- Existing RLS, grants, foreign keys and trigger registration remain unchanged.
create or replace function private.guard_component_map()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  doc jsonb := new.document_json;
  component jsonb;
  suggested_location jsonb;
  overview_source jsonb;
  source_time text;
  -- ECMAScript trim whitespace: match the client normalizer, including Unicode.
  location_trim_characters constant text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  link jsonb;
  region jsonb;
  box jsonb;
  photo jsonb;
  key text;
  reviewed_at text;
  component_ids text[] := '{}';
  link_ids text[] := '{}';
  photo_ids text[];
  references_to_check jsonb;
  scan_evidence jsonb;
  scan_image_path text;
  uuid_pattern constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
  elsif new.user_id is distinct from old.user_id or new.map_id is distinct from old.map_id then
    raise exception 'component_map_identity_immutable' using errcode = '23514';
  elsif (old.document_json->'version' = '3'::jsonb and doc->'version' is distinct from '3'::jsonb)
    or (old.document_json->'version' = '2'::jsonb and doc->'version' is distinct from '2'::jsonb and doc->'version' is distinct from '3'::jsonb) then
    raise exception 'component_map_version_downgrade' using errcode = '23514';
  elsif old.document_json->'version' = '3'::jsonb and doc#>'{overview,source}' is distinct from old.document_json#>'{overview,source}' then
    raise exception 'component_map_overview_source_immutable' using errcode = '23514';
  elsif doc#>>'{overview,photoId}' is distinct from old.document_json#>>'{overview,photoId}' then
    raise exception 'component_map_overview_photo_immutable' using errcode = '23514';
  elsif new.revision is distinct from old.revision + 1 then
    raise exception 'component_map_revision_conflict' using errcode = '40001';
  end if;

  if jsonb_typeof(doc) is distinct from 'object' or (doc->'version' is distinct from '1'::jsonb and doc->'version' is distinct from '2'::jsonb and doc->'version' is distinct from '3'::jsonb)
    or jsonb_typeof(doc->'id') is distinct from 'string' or doc->>'id' is distinct from new.map_id
    or jsonb_typeof(doc->'overview') is distinct from 'object'
    or jsonb_typeof(doc#>'{overview,lookupId}') is distinct from 'string'
    or doc#>>'{overview,lookupId}' is distinct from new.map_id
    or jsonb_typeof(doc#>'{overview,photoId}') is distinct from 'string'
    or not (doc#>>'{overview,photoId}' ~ '^[A-Za-z0-9._:-]{1,80}$')
    or jsonb_typeof(doc->'components') is distinct from 'array' then
    raise exception 'invalid_component_map' using errcode = '23514';
  end if;
  if doc->'version' = '3'::jsonb then
    overview_source := doc#>'{overview,source}';
    if jsonb_typeof(overview_source) is distinct from 'object' then
      raise exception 'invalid_component_map_overview_source' using errcode = '23514';
    end if;
    if (overview_source - array['sha256', 'width', 'height', 'photoAddedAt', 'scanSavedAt']) <> '{}'::jsonb
      or jsonb_typeof(overview_source->'sha256') is distinct from 'string'
      or not (overview_source->>'sha256' ~ '^[a-f0-9]{64}$')
      or jsonb_typeof(overview_source->'width') is distinct from 'number'
      or jsonb_typeof(overview_source->'height') is distinct from 'number' then
      raise exception 'invalid_component_map_overview_source' using errcode = '23514';
    end if;
    if (overview_source->>'width')::numeric not between 1 and 32768
      or (overview_source->>'height')::numeric not between 1 and 32768
      or trunc((overview_source->>'width')::numeric) <> (overview_source->>'width')::numeric
      or trunc((overview_source->>'height')::numeric) <> (overview_source->>'height')::numeric
      or (overview_source->>'width')::numeric * (overview_source->>'height')::numeric > 100000000 then
      raise exception 'invalid_component_map_overview_source' using errcode = '23514';
    end if;
    foreach key in array array['photoAddedAt', 'scanSavedAt'] loop
      source_time := overview_source->>key;
      if jsonb_typeof(overview_source->key) is distinct from 'string'
        or not (source_time ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$')
        or left(source_time, 4) = '0000' then
        raise exception 'invalid_component_map_overview_source' using errcode = '23514';
      end if;
      begin
        if to_char(source_time::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') is distinct from source_time then
          raise exception 'invalid_component_map_overview_source' using errcode = '23514';
        end if;
      exception when sqlstate '22007' or sqlstate '22008' then
        raise exception 'invalid_component_map_overview_source' using errcode = '23514';
      end;
    end loop;
  elsif (doc->'overview') ? 'source' then
    raise exception 'invalid_component_map_legacy_source' using errcode = '23514';
  end if;
  if jsonb_array_length(doc->'components') > 100 then
    raise exception 'invalid_component_map_component_count' using errcode = '23514';
  end if;
  references_to_check := jsonb_build_array(jsonb_build_object('lookupId', new.map_id,
    'photoIds', jsonb_build_array(doc#>>'{overview,photoId}')));

  for component in select value from jsonb_array_elements(doc->'components') loop
    if jsonb_typeof(component) is distinct from 'object'
      or jsonb_typeof(component->'id') is distinct from 'string' or not (component->>'id' ~ uuid_pattern)
      or lower(component->>'id') = any(component_ids)
      or jsonb_typeof(component->'label') is distinct from 'string'
      or length(btrim(component->>'label')) not between 1 and 120
      or component->>'label' is distinct from btrim(component->>'label')
      or jsonb_typeof(component->'notes') is distinct from 'string' or length(component->>'notes') > 2000
      or coalesce(component->>'status', '') not in ('needs_view', 'inspected', 'not_visible')
      or jsonb_typeof(component->'scanGroups') is distinct from 'array' then
      raise exception 'invalid_component_map_component' using errcode = '23514';
    end if;
    if component ? 'suggestedLocation' then
      suggested_location := component->'suggestedLocation';
      if (doc->'version' is distinct from '2'::jsonb and doc->'version' is distinct from '3'::jsonb) or jsonb_typeof(suggested_location) is distinct from 'object' then
        raise exception 'invalid_component_map_suggested_location' using errcode = '23514';
      end if;
      if suggested_location->'source' is distinct from '"ai_scene"'::jsonb
        or jsonb_typeof(suggested_location->'text') is distinct from 'string'
        or (suggested_location - array['source', 'text']) <> '{}'::jsonb
        or length(suggested_location->>'text') not between 1 and 240
        or suggested_location->>'text' is distinct from btrim(suggested_location->>'text', location_trim_characters) then
        raise exception 'invalid_component_map_suggested_location' using errcode = '23514';
      end if;
    end if;
    component_ids := array_append(component_ids, lower(component->>'id'));
    if jsonb_array_length(component->'scanGroups') > 100 then
      raise exception 'invalid_component_map_link_count' using errcode = '23514';
    end if;
    if component ? 'reviewedAt' or component->>'status' <> 'needs_view' then
      reviewed_at := component->>'reviewedAt';
      if jsonb_typeof(component->'reviewedAt') is distinct from 'string'
        or not (reviewed_at ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$') then
        raise exception 'invalid_component_map_review_time' using errcode = '23514';
      end if;
      perform reviewed_at::timestamptz;
      if to_char(reviewed_at::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') is distinct from left(reviewed_at, 19) then
        raise exception 'invalid_component_map_review_time' using errcode = '23514';
      end if;
    end if;
    if component ? 'region' then
      region := component->'region';
      box := region->'box';
      if jsonb_typeof(region) is distinct from 'object'
        or jsonb_typeof(region->'sourcePhotoId') is distinct from 'string'
        or region->>'sourcePhotoId' is distinct from doc#>>'{overview,photoId}'
        or jsonb_typeof(box) is distinct from 'object' then
        raise exception 'invalid_component_map_region' using errcode = '23514';
      end if;
      foreach key in array array['x', 'y', 'width', 'height', 'confidence'] loop
        if jsonb_typeof(box->key) is distinct from 'number' then
          raise exception 'invalid_component_map_box' using errcode = '23514';
        end if;
      end loop;
      if (box->>'x')::numeric < 0 or (box->>'y')::numeric < 0
        or (box->>'width')::numeric <= 0 or (box->>'height')::numeric <= 0
        or (box->>'x')::numeric + (box->>'width')::numeric > 1
        or (box->>'y')::numeric + (box->>'height')::numeric > 1
        or (box->>'confidence')::numeric not between 0 and 1 then
        raise exception 'invalid_component_map_box' using errcode = '23514';
      end if;
    end if;
    for link in select value from jsonb_array_elements(component->'scanGroups') loop
      if jsonb_typeof(link) is distinct from 'object'
        or jsonb_typeof(link->'linkId') is distinct from 'string' or not (link->>'linkId' ~ uuid_pattern)
        or lower(link->>'linkId') = any(link_ids)
        or jsonb_typeof(link->'lookupId') is distinct from 'string'
        or not (link->>'lookupId' ~ '^[A-Za-z0-9._:-]{1,160}$')
        or jsonb_typeof(link->'photoIds') is distinct from 'array' then
        raise exception 'invalid_component_map_link' using errcode = '23514';
      end if;
      if jsonb_array_length(link->'photoIds') not between 1 and 4 then
        raise exception 'invalid_component_map_photo_count' using errcode = '23514';
      end if;
      link_ids := array_append(link_ids, lower(link->>'linkId'));
      photo_ids := '{}';
      for photo in select value from jsonb_array_elements(link->'photoIds') loop
        if jsonb_typeof(photo) is distinct from 'string' or not (photo#>>'{}' ~ '^[A-Za-z0-9._:-]{1,80}$')
          or photo#>>'{}' = any(photo_ids) then
          raise exception 'invalid_component_map_photo_id' using errcode = '23514';
        end if;
        photo_ids := array_append(photo_ids, photo#>>'{}');
      end loop;
      references_to_check := references_to_check || jsonb_build_array(link);
    end loop;
  end loop;

  -- Shop visibility never establishes ownership. Only original photos with the
  -- stated stable IDs in the exact owner's scan can back an overview/link.
  for link in select value from jsonb_array_elements(references_to_check) loop
    select s.evidence_bundle_json, s.image_path into scan_evidence, scan_image_path
      from public.scan_lookups s where s.user_id = new.user_id and s.local_id = link->>'lookupId';
    if not found or scan_image_path is null or scan_image_path = '' then
      raise exception 'component_map_owned_scan_unavailable' using errcode = '23514';
    end if;
    if jsonb_typeof(scan_evidence->'photos') = 'array' and jsonb_array_length(scan_evidence->'photos') > 0 then
      select array_agg(value->>'id') into photo_ids from jsonb_array_elements(scan_evidence->'photos');
    else
      photo_ids := array['photo-1'];
    end if;
    for photo in select value from jsonb_array_elements(link->'photoIds') loop
      if (photo#>>'{}' = any(photo_ids)) is not true then
        raise exception 'component_map_original_photo_unavailable' using errcode = '23514';
      end if;
    end loop;
  end loop;
  return new;
end;
$$;
revoke all on function private.guard_component_map() from public, anon, authenticated;
