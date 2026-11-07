-- Authored locally. Hosted application requires approval.
-- Source scans may be removed without erasing the immutable comparison history.
create table public.inspection_comparisons (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  lookup_id text not null check (lookup_id ~ '^[A-Za-z0-9._:-]{1,160}$' and lookup_id not in ('.','..')),
  record_json jsonb not null,
  primary key (user_id,id)
);
create index inspection_comparisons_scan on public.inspection_comparisons(user_id,lookup_id,id);
alter table public.inspection_comparisons enable row level security;
revoke all on public.inspection_comparisons from public, anon, authenticated;
grant select, insert on public.inspection_comparisons to authenticated;
create policy inspection_comparisons_select_owner on public.inspection_comparisons for select to authenticated
  using ((select auth.uid()) = user_id);
create policy inspection_comparisons_insert_owner on public.inspection_comparisons for insert to authenticated
  with check ((select auth.uid()) = user_id);

create schema if not exists private;
create function private.guard_inspection_comparison()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  doc jsonb := new.record_json;
  side jsonb;
  context jsonb;
  confirmation jsonb;
  item jsonb;
  key text;
  source_id text;
  count_saved integer;
  bytes_saved bigint;
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  iso_pattern constant text := '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$';
begin
  if tg_op <> 'INSERT' then raise exception 'inspection_comparison_immutable' using errcode = '23514'; end if;
  if jsonb_typeof(doc) is distinct from 'object' or octet_length(doc::text) > 262144
    or doc->'version' is distinct from '1'::jsonb or jsonb_typeof(doc->'id') is distinct from 'string' or doc->>'id' is distinct from new.id::text
    or jsonb_typeof(doc->'lookupId') is distinct from 'string' or doc->>'lookupId' is distinct from new.lookup_id
    or jsonb_typeof(doc->'recordedAt') is distinct from 'string' or not (doc->>'recordedAt' ~ iso_pattern)
    or jsonb_typeof(doc->'subject') is distinct from 'string' or length(btrim(doc->>'subject')) = 0 or length(doc->>'subject') > 200
    or exists (select 1 from jsonb_object_keys(doc) k where k not in ('version','id','lookupId','recordedAt','subject','earlier','current','relationship','conditions','observation','alignment','supersedesId','correctionReason')) then
    raise exception 'invalid_inspection_comparison' using errcode = '23514';
  end if;
  if to_char((doc->>'recordedAt')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS') is distinct from left(doc->>'recordedAt',19) then
    raise exception 'invalid_comparison_recorded_date' using errcode = '23514';
  end if;
  foreach key in array array['earlier','current'] loop
    side := doc->key;
    if jsonb_typeof(side) is distinct from 'object'
      or jsonb_typeof(side->'lookupId') is distinct from 'string' or jsonb_typeof(side->'photoId') is distinct from 'string'
      or coalesce(side->>'lookupId','') !~ '^[A-Za-z0-9._:-]{1,160}$' or side->>'lookupId' in ('.','..')
      or coalesce(side->>'photoId','') !~ '^[A-Za-z0-9._:-]{1,80}$' or side->>'photoId' in ('.','..')
      or coalesce(side->>'photoLabel','') not in ('overview','close_up','marking','mounting','other')
      or coalesce(side->>'sha256','') !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(side->'width') is distinct from 'number' or jsonb_typeof(side->'height') is distinct from 'number'
      or not (side ? 'observedOn') or not (side ? 'vehicleContext')
      or exists (select 1 from jsonb_object_keys(side) k where k not in ('lookupId','photoId','photoLabel','photoAddedAt','scanSavedAt','sha256','width','height','observedOn','vehicleContext','analysisAttemptId')) then
      raise exception 'invalid_comparison_side' using errcode = '23514';
    end if;
    if (side->>'width')::numeric not between 1 and 32768 or (side->>'height')::numeric not between 1 and 32768
      or (side->>'width')::numeric <> trunc((side->>'width')::numeric) or (side->>'height')::numeric <> trunc((side->>'height')::numeric)
      or (side->>'width')::numeric * (side->>'height')::numeric > 100000000 then
      raise exception 'invalid_comparison_dimensions' using errcode = '23514';
    end if;
    for source_id in select unnest(array['photoAddedAt','scanSavedAt']) loop
      if jsonb_typeof(side->source_id) is distinct from 'string' or not (side->>source_id ~ iso_pattern)
        or to_char((side->>source_id)::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS') is distinct from left(side->>source_id,19) then
        raise exception 'invalid_comparison_source_date' using errcode = '23514';
      end if;
    end loop;
    if side->'observedOn' <> 'null'::jsonb and (jsonb_typeof(side->'observedOn') <> 'string'
      or not (side->>'observedOn' ~ '^\d{4}-\d{2}-\d{2}$')
      or to_char((side->>'observedOn')::date,'YYYY-MM-DD') is distinct from side->>'observedOn') then
      raise exception 'invalid_comparison_observation_date' using errcode = '23514';
    end if;
    if side ? 'analysisAttemptId' and (jsonb_typeof(side->'analysisAttemptId') <> 'string'
      or coalesce(side->>'analysisAttemptId','') !~ '^[A-Za-z0-9._:-]{1,160}$' or side->>'analysisAttemptId' in ('.','..')) then
      raise exception 'invalid_comparison_analysis_reference' using errcode = '23514';
    end if;
    context := side->'vehicleContext';
    if context <> 'null'::jsonb then
      if jsonb_typeof(context) <> 'object' or exists (select 1 from jsonb_object_keys(context) k where k not in ('vin','year','make','model','engine','mileage','mileageUnit','modifications','confirmedFields','symptom')) then
        raise exception 'invalid_comparison_vehicle' using errcode = '23514';
      end if;
      foreach source_id in array array['vin','year','make','model','engine','mileage','symptom'] loop
        if context ? source_id and (jsonb_typeof(context->source_id) <> 'string' or length(context->>source_id) > (case source_id when 'symptom' then 500 else 120 end)) then
          raise exception 'invalid_comparison_vehicle' using errcode = '23514';
        end if;
      end loop;
      if context ? 'mileageUnit' and coalesce(context->>'mileageUnit','') not in ('mi','km','unknown') then raise exception 'invalid_comparison_vehicle' using errcode = '23514'; end if;
      if context ? 'modifications' then
        item := context->'modifications';
        if jsonb_typeof(item) <> 'object' or coalesce(item->>'status','') not in ('unknown','none_known','modified')
          or exists (select 1 from jsonb_object_keys(item) k where k not in ('status','details'))
          or (item ? 'details' and (jsonb_typeof(item->'details') <> 'string' or length(item->>'details') > 600))
          or (item->>'status' <> 'modified' and coalesce(item->>'details','') <> '') then
          raise exception 'invalid_comparison_vehicle' using errcode = '23514';
        end if;
      end if;
      if context ? 'confirmedFields' then
        if jsonb_typeof(context->'confirmedFields') <> 'object' then raise exception 'invalid_comparison_vehicle_confirmation' using errcode = '23514'; end if;
        for source_id, confirmation in select * from jsonb_each(context->'confirmedFields') loop
          if source_id not in ('vin','year','make','model','engine','mileage','modifications') or jsonb_typeof(confirmation) <> 'object'
            or jsonb_typeof(confirmation->'value') is distinct from 'string' or length(confirmation->>'value') > 1000
            or jsonb_typeof(confirmation->'confirmedAt') is distinct from 'string' or not (confirmation->>'confirmedAt' ~ iso_pattern)
            or exists (select 1 from jsonb_object_keys(confirmation) k where k not in ('value','confirmedAt')) then
            raise exception 'invalid_comparison_vehicle_confirmation' using errcode = '23514';
          end if;
          if to_char((confirmation->>'confirmedAt')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS') is distinct from left(confirmation->>'confirmedAt',19) then
            raise exception 'invalid_comparison_vehicle_confirmation_date' using errcode = '23514';
          end if;
          if source_id = 'mileage' then
            if coalesce(context->>'mileageUnit','') not in ('mi','km') or coalesce(btrim(context->>'mileage'),'') = ''
              or btrim(context->>'mileage') ~* '^(unknown|not known|unsure|not sure|n/?a|not provided|not supplied)$'
              or (confirmation->>'value')::jsonb is distinct from jsonb_build_array(btrim(context->>'mileage'),context->>'mileageUnit') then
              raise exception 'stale_comparison_vehicle_confirmation' using errcode = '23514';
            end if;
          elsif source_id = 'modifications' then
            if coalesce(context#>>'{modifications,status}','unknown') = 'unknown'
              or (context#>>'{modifications,status}' = 'modified' and coalesce(btrim(context#>>'{modifications,details}'),'') = '')
              or (context#>>'{modifications,status}' = 'modified' and btrim(context#>>'{modifications,details}') ~* '^(unknown|not known|unsure|not sure|n/?a|not provided|not supplied)$')
              or (confirmation->>'value')::jsonb is distinct from jsonb_build_array(context#>>'{modifications,status}',coalesce(btrim(context#>>'{modifications,details}'),'')) then
              raise exception 'stale_comparison_vehicle_confirmation' using errcode = '23514';
            end if;
          elsif coalesce(btrim(context->>source_id),'') = '' or confirmation->>'value' is distinct from btrim(context->>source_id)
            or btrim(context->>source_id) ~* '^(unknown|not known|unsure|not sure|n/?a|not provided|not supplied)$' then
            raise exception 'stale_comparison_vehicle_confirmation' using errcode = '23514';
          end if;
        end loop;
      end if;
    end if;
  end loop;
  if doc#>>'{current,lookupId}' is distinct from new.lookup_id or doc#>>'{earlier,lookupId}' = new.lookup_id
    or doc#>>'{earlier,observedOn}' > doc#>>'{current,observedOn}' then
    raise exception 'invalid_comparison_pair' using errcode = '23514';
  end if;
  item := doc->'relationship';
  if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'sameVehicle') is distinct from 'boolean'
    or coalesce(item->>'component','') not in ('unconfirmed','same_part','replacement_same_location','different')
    or jsonb_typeof(item->'basis') is distinct from 'string' or length(item->>'basis') > 1000
    or ((item->'sameVehicle' = 'true'::jsonb or item->>'component' <> 'unconfirmed') and length(btrim(item->>'basis')) = 0)
    or exists (select 1 from jsonb_object_keys(item) k where k not in ('sameVehicle','component','basis')) then
    raise exception 'invalid_comparison_relationship' using errcode = '23514';
  end if;
  item := doc->'conditions';
  if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'angle','') not in ('similar','different','unknown')
    or coalesce(item->>'lighting','') not in ('similar','different','unknown')
    or jsonb_typeof(item->'surfaceNotes') is distinct from 'string' or length(item->>'surfaceNotes') > 2000
    or exists (select 1 from jsonb_object_keys(item) k where k not in ('angle','lighting','surfaceNotes')) then
    raise exception 'invalid_comparison_conditions' using errcode = '23514';
  end if;
  item := doc->'observation';
  if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'outcome','') not in ('not_reviewed','change_observed','no_obvious_change','inconclusive')
    or jsonb_typeof(item->'notes') is distinct from 'string' or length(item->>'notes') > 2000
    or (item->>'outcome' <> 'not_reviewed' and length(btrim(item->>'notes')) = 0)
    or (item->>'outcome' in ('change_observed','no_obvious_change') and (doc#>'{relationship,sameVehicle}' <> 'true'::jsonb or doc#>>'{relationship,component}' <> 'same_part'))
    or exists (select 1 from jsonb_object_keys(item) k where k not in ('outcome','notes')) then
    raise exception 'invalid_comparison_observation' using errcode = '23514';
  end if;
  item := doc->'alignment';
  if jsonb_typeof(item) is distinct from 'object' or exists (select 1 from jsonb_object_keys(item) k where k not in ('rotation','scale','offsetX','offsetY')) then
    raise exception 'invalid_comparison_alignment' using errcode = '23514';
  end if;
  foreach key in array array['rotation','scale','offsetX','offsetY'] loop
    if jsonb_typeof(item->key) is distinct from 'number' then raise exception 'invalid_comparison_alignment' using errcode = '23514'; end if;
  end loop;
  if (item->>'rotation')::numeric not between -180 and 180 or (item->>'scale')::numeric not between .25 and 4
    or (item->>'offsetX')::numeric not between -1 and 1 or (item->>'offsetY')::numeric not between -1 and 1 then
    raise exception 'invalid_comparison_alignment' using errcode = '23514';
  end if;
  if doc ? 'supersedesId' then
    if jsonb_typeof(doc->'supersedesId') <> 'string' or not (doc->>'supersedesId' ~ uuid_pattern) or doc->>'supersedesId' = new.id::text
      or jsonb_typeof(doc->'correctionReason') is distinct from 'string' or length(btrim(doc->>'correctionReason')) = 0 or length(doc->>'correctionReason') > 1000 then
      raise exception 'invalid_comparison_correction' using errcode = '23514';
    end if;
  elsif doc ? 'correctionReason' then raise exception 'invalid_comparison_correction' using errcode = '23514'; end if;

  -- Existing IDs still produce an exact-retry conflict after source deletion.
  if exists (select 1 from public.inspection_comparisons where user_id = new.user_id and id = new.id) then return new; end if;
  -- Lock both owned scans in stable order. New comparisons require both sources;
  -- source deletion after this transaction intentionally retains the history.
  for source_id in select value from unnest(array[new.lookup_id, doc#>>'{earlier,lookupId}']) value order by value loop
    perform 1 from public.scan_lookups where user_id = new.user_id and local_id = source_id for update;
    if not found then raise exception 'comparison_source_not_owned_or_missing' using errcode = '23503'; end if;
  end loop;
  select count(*), coalesce(sum(octet_length(record_json::text)),0) into count_saved, bytes_saved
    from public.inspection_comparisons where user_id = new.user_id and lookup_id = new.lookup_id;
  if count_saved >= 100 or bytes_saved + octet_length(doc::text) + 2 * (count_saved + 1) > 262144 then
    raise exception 'comparison_history_limit' using errcode = '23514';
  end if;
  if doc ? 'supersedesId' and not exists (select 1 from public.inspection_comparisons
    where user_id = new.user_id and lookup_id = new.lookup_id and id = (doc->>'supersedesId')::uuid) then
    raise exception 'comparison_correction_target_missing' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_inspection_comparison() from public, anon, authenticated;
create trigger guard_inspection_comparison before insert or update on public.inspection_comparisons
  for each row execute function private.guard_inspection_comparison();
comment on table public.inspection_comparisons is 'Owner-only immutable human visual comparisons. Source ownership is checked at insert; removing source scans retains historical observations and photo references. Account deletion cascades. No diagnosis or safety certification is implied.';
