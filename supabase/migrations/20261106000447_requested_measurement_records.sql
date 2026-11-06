-- UNAPPLIED: immutable requested-measurement receipts in the existing JSONB record.
-- No columns, data rewrites, policies, grants or externally exposed API changes.
create or replace function private.guard_human_service_record()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  doc jsonb := new.record_json;
  key text;
  item jsonb;
  allowed text[];
  seen text[] := '{}';
  prior jsonb;
  count_saved integer;
  bytes_saved bigint;
  receipt jsonb;
  guide jsonb;
  side jsonb;
  source_id text;
  position integer;
  text_units bigint;
  trim_chars constant text := E' \t\n\r\f' || chr(11) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279);
  context jsonb;
  confirmation jsonb;
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  iso_pattern constant text := '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$';
begin
  if tg_op <> 'INSERT' then raise exception 'human_service_record_immutable' using errcode = '23514'; end if;
  if jsonb_typeof(doc) is distinct from 'object' or octet_length(doc::text) > 262144
    or (doc->'version' is distinct from '1'::jsonb and doc->'version' is distinct from '2'::jsonb)
    or jsonb_typeof(doc->'id') is distinct from 'string' or doc->>'id' is distinct from new.id::text
    or jsonb_typeof(doc->'lookupId') is distinct from 'string' or doc->>'lookupId' is distinct from new.lookup_id
    or jsonb_typeof(doc->'recordedAt') is distinct from 'string' or not (doc->>'recordedAt' ~ iso_pattern)
    or not (doc ? 'occurredOn') or (doc->'occurredOn' <> 'null'::jsonb and (jsonb_typeof(doc->'occurredOn') <> 'string' or not (doc->>'occurredOn' ~ '^\d{4}-\d{2}-\d{2}$')))
    or coalesce(doc->>'basis','') not in ('personally_performed','reported_by_another','transcribed_document')
    or coalesce(doc->>'kind','') not in ('measurement','repair','follow_up','retraction') then
    raise exception 'invalid_human_service_record' using errcode = '23514';
  end if;
  if to_char((doc->>'recordedAt')::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') is distinct from left(doc->>'recordedAt',19)
    or (doc->'occurredOn' <> 'null'::jsonb and to_char((doc->>'occurredOn')::date,'YYYY-MM-DD') is distinct from doc->>'occurredOn') then
    raise exception 'invalid_human_service_record_date' using errcode = '23514';
  end if;
  foreach key in array array['recordedBy','subject','notes'] loop
    if jsonb_typeof(doc->key) is distinct from 'string'
      or length(doc->>key) > (case key when 'recordedBy' then 120 when 'subject' then 200 else 2000 end)
      or (key <> 'notes' and length(btrim(doc->>key)) = 0) then
      raise exception 'invalid_human_service_record_text' using errcode = '23514';
    end if;
  end loop;
  if jsonb_typeof(doc->'photoIds') is distinct from 'array' then raise exception 'invalid_human_service_record_photos' using errcode = '23514'; end if;
  if jsonb_array_length(doc->'photoIds') > 4 then raise exception 'invalid_human_service_record_photos' using errcode = '23514'; end if;
  for item in select value from jsonb_array_elements(doc->'photoIds') loop
    if jsonb_typeof(item) <> 'string' or not (item#>>'{}' ~ '^[A-Za-z0-9._:-]{1,80}$')
      or item#>>'{}' in ('.','..') or item#>>'{}' = any(seen) then
      raise exception 'invalid_human_service_record_photo_id' using errcode = '23514';
    end if;
    seen := array_append(seen, item#>>'{}');
  end loop;
  if doc ? 'analysisAttemptId' and (jsonb_typeof(doc->'analysisAttemptId') <> 'string'
    or not (doc->>'analysisAttemptId' ~ '^[A-Za-z0-9._:-]{1,160}$') or doc->>'analysisAttemptId' in ('.','..')) then
    raise exception 'invalid_human_service_record_analysis' using errcode = '23514';
  end if;
  if doc ? 'supersedesId' then
    if jsonb_typeof(doc->'supersedesId') <> 'string' or not (doc->>'supersedesId' ~ uuid_pattern) or doc->>'supersedesId' = new.id::text
      or jsonb_typeof(doc->'correctionReason') is distinct from 'string' or length(doc->>'correctionReason') > 1000 or length(btrim(doc->>'correctionReason')) = 0 then
      raise exception 'invalid_human_service_record_correction' using errcode = '23514';
    end if;
  elsif doc ? 'correctionReason' or doc->>'kind' = 'retraction' then
    raise exception 'invalid_human_service_record_correction' using errcode = '23514';
  end if;
  allowed := array['version','id','lookupId','recordedAt','occurredOn','recordedBy','basis','subject','photoIds','analysisAttemptId','vehicleContext','notes','supersedesId','correctionReason','kind'];
  if doc->>'kind' = 'measurement' then
    allowed := allowed || array['quantity','reading','unit','method','instrument','conditions','noReadingReason'];
    foreach key in array array['quantity','unit','method','instrument','conditions','noReadingReason'] loop
      if jsonb_typeof(doc->key) is distinct from 'string'
        or length(doc->>key) > (case key when 'quantity' then 120 when 'unit' then 40 when 'instrument' then 200 else 1000 end) then
        raise exception 'invalid_human_service_measurement' using errcode = '23514';
      end if;
    end loop;
    if length(btrim(doc->>'quantity')) = 0 or not (doc ? 'reading') then raise exception 'invalid_human_service_measurement' using errcode = '23514'; end if;
    if doc->'reading' = 'null'::jsonb then
      if length(btrim(doc->>'noReadingReason')) = 0 then raise exception 'invalid_human_service_measurement_reason' using errcode = '23514'; end if;
    else
      if jsonb_typeof(doc->'reading') <> 'string' or length(doc->>'reading') > 100
        or not (btrim(doc->>'reading') ~ '^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$')
        or length(btrim(doc->>'unit')) = 0 or length(btrim(doc->>'method')) = 0 or doc->>'noReadingReason' <> '' then
        raise exception 'invalid_human_service_measurement_reading' using errcode = '23514';
      end if;
      perform (doc->>'reading')::double precision;
    end if;
  elsif doc->>'kind' = 'repair' then
    allowed := allowed || array['action','status','parts'];
    if jsonb_typeof(doc->'action') is distinct from 'string' or length(btrim(doc->>'action')) = 0 or length(doc->>'action') > 2000
      or jsonb_typeof(doc->'parts') is distinct from 'string' or length(doc->>'parts') > 2000
      or coalesce(doc->>'status','') not in ('planned','completed','attempted','unknown') then
      raise exception 'invalid_human_service_repair' using errcode = '23514';
    end if;
  elsif doc->>'kind' = 'follow_up' then
    allowed := allowed || array['check','outcome','conditions','relatedRecordIds'];
    if jsonb_typeof(doc->'check') is distinct from 'string' or length(doc->>'check') > 2000
      or coalesce(doc->>'outcome','') not in ('not_checked','symptom_observed','symptom_not_observed','inconclusive')
      or (doc->>'outcome' <> 'not_checked' and length(btrim(doc->>'check')) = 0)
      or jsonb_typeof(doc->'conditions') is distinct from 'string' or length(doc->>'conditions') > 1000
      or jsonb_typeof(doc->'relatedRecordIds') is distinct from 'array' then
      raise exception 'invalid_human_service_followup' using errcode = '23514';
    end if;
    if jsonb_array_length(doc->'relatedRecordIds') > 100 then raise exception 'invalid_human_service_followup_refs' using errcode = '23514'; end if;
    seen := '{}';
    for item in select value from jsonb_array_elements(doc->'relatedRecordIds') loop
      if jsonb_typeof(item) <> 'string' or not (item#>>'{}' ~ uuid_pattern) or item#>>'{}' = new.id::text or item#>>'{}' = any(seen) then
        raise exception 'invalid_human_service_followup_refs' using errcode = '23514';
      end if;
      seen := array_append(seen,item#>>'{}');
    end loop;
  end if;

  -- The legacy envelope must never silently discard a request association.
  if doc->'version' = '1'::jsonb then
    if doc ? 'requestedMeasurement' then raise exception 'legacy_service_record_cannot_carry_request' using errcode = '23514'; end if;
  else
    if doc->>'kind' not in ('measurement','retraction') then raise exception 'invalid_requested_measurement_kind' using errcode = '23514'; end if;
    receipt := doc->'requestedMeasurement';
    if jsonb_typeof(receipt) is distinct from 'object' then raise exception 'invalid_requested_measurement_receipt' using errcode = '23514'; end if;
    if receipt->'version' is distinct from '1'::jsonb
      or exists (select 1 from jsonb_object_keys(receipt) k where k not in ('version','guide','analysisSha256','references'))
      or jsonb_typeof(receipt->'analysisSha256') is distinct from 'string' or coalesce(receipt->>'analysisSha256','') !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(receipt->'references') is distinct from 'array' then
      raise exception 'invalid_requested_measurement_receipt' using errcode = '23514';
    end if;
    guide := receipt->'guide';
    if jsonb_typeof(guide) is distinct from 'object' then raise exception 'invalid_requested_measurement_guide' using errcode = '23514'; end if;
    if guide->'version' is distinct from '1'::jsonb or guide->>'kind' is distinct from 'measurement'
      or exists (select 1 from jsonb_object_keys(guide) k where k not in ('version','kind','request','purpose','photoIds','analysisAttemptId')) then
      raise exception 'invalid_requested_measurement_guide' using errcode = '23514';
    end if;
    foreach key in array array['request','purpose'] loop
      if jsonb_typeof(guide->key) is distinct from 'string' or coalesce(guide->>key,'') = ''
        or guide->>key is distinct from btrim(guide->>key,trim_chars) then
        raise exception 'invalid_requested_measurement_text' using errcode = '23514';
      end if;
      select coalesce(sum(case when ascii(ch.value) > 65535 then 2 else 1 end),0) into text_units
        from regexp_split_to_table(guide->>key,'') ch(value);
      if text_units > 600 then raise exception 'invalid_requested_measurement_text' using errcode = '23514'; end if;
    end loop;
    if jsonb_typeof(guide->'photoIds') is distinct from 'array' then raise exception 'invalid_requested_measurement_photos' using errcode = '23514'; end if;
    if jsonb_array_length(guide->'photoIds') > 4
      or jsonb_array_length(receipt->'references') <> jsonb_array_length(guide->'photoIds')
      or exists (select 1 from jsonb_array_elements(guide->'photoIds') p where jsonb_typeof(p) <> 'string'
        or (p #>> '{}') !~ '^[A-Za-z0-9._:-]{1,80}$' or (p #>> '{}') in ('.','..'))
      or (select count(*) from jsonb_array_elements(guide->'photoIds')) <> (select count(distinct p) from jsonb_array_elements(guide->'photoIds') p)
      or not ((doc->'photoIds') @> (guide->'photoIds')) then
      raise exception 'invalid_requested_measurement_photos' using errcode = '23514';
    end if;
    if guide ? 'analysisAttemptId' and (jsonb_typeof(guide->'analysisAttemptId') <> 'string'
      or coalesce(guide->>'analysisAttemptId','') !~ '^[A-Za-z0-9._:-]{1,160}$' or guide->>'analysisAttemptId' in ('.','..')) then
      raise exception 'invalid_requested_measurement_analysis' using errcode = '23514';
    end if;
    if guide->'analysisAttemptId' is distinct from doc->'analysisAttemptId' then raise exception 'mismatched_requested_measurement_analysis' using errcode = '23514'; end if;
    position := 0;
    for side in select value from jsonb_array_elements(receipt->'references') loop
    if jsonb_typeof(side) is distinct from 'object'
      or jsonb_typeof(side->'lookupId') is distinct from 'string' or jsonb_typeof(side->'photoId') is distinct from 'string'
      or coalesce(side->>'lookupId','') !~ '^[A-Za-z0-9._:-]{1,160}$' or side->>'lookupId' in ('.','..')
      or coalesce(side->>'photoId','') !~ '^[A-Za-z0-9._:-]{1,80}$' or side->>'photoId' in ('.','..')
      or coalesce(side->>'photoLabel','') not in ('overview','close_up','marking','mounting','other')
      or coalesce(side->>'sha256','') !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(side->'width') is distinct from 'number' or jsonb_typeof(side->'height') is distinct from 'number'
      or not (side ? 'observedOn') or not (side ? 'vehicleContext')
      or exists (select 1 from jsonb_object_keys(side) k where k not in ('lookupId','photoId','photoLabel','photoAddedAt','scanSavedAt','sha256','width','height','observedOn','vehicleContext','analysisAttemptId')) then
      raise exception 'invalid_requested_measurement_side' using errcode = '23514';
    end if;
    if (side->>'width')::numeric not between 1 and 32768 or (side->>'height')::numeric not between 1 and 32768
      or (side->>'width')::numeric <> trunc((side->>'width')::numeric) or (side->>'height')::numeric <> trunc((side->>'height')::numeric)
      or (side->>'width')::numeric * (side->>'height')::numeric > 100000000 then
      raise exception 'invalid_requested_measurement_dimensions' using errcode = '23514';
    end if;
    for source_id in select unnest(array['photoAddedAt','scanSavedAt']) loop
      if jsonb_typeof(side->source_id) is distinct from 'string' or not (side->>source_id ~ iso_pattern)
        or to_char((side->>source_id)::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS') is distinct from left(side->>source_id,19) then
        raise exception 'invalid_requested_measurement_source_date' using errcode = '23514';
      end if;
    end loop;
    if side->'observedOn' <> 'null'::jsonb and (jsonb_typeof(side->'observedOn') <> 'string'
      or not (side->>'observedOn' ~ '^\d{4}-\d{2}-\d{2}$')
      or to_char((side->>'observedOn')::date,'YYYY-MM-DD') is distinct from side->>'observedOn') then
      raise exception 'invalid_requested_measurement_observation_date' using errcode = '23514';
    end if;
    if side ? 'analysisAttemptId' and (jsonb_typeof(side->'analysisAttemptId') <> 'string'
      or coalesce(side->>'analysisAttemptId','') !~ '^[A-Za-z0-9._:-]{1,160}$' or side->>'analysisAttemptId' in ('.','..')) then
      raise exception 'invalid_requested_measurement_analysis_reference' using errcode = '23514';
    end if;
    context := side->'vehicleContext';
    if context <> 'null'::jsonb then
      if jsonb_typeof(context) <> 'object' or exists (select 1 from jsonb_object_keys(context) k where k not in ('vin','year','make','model','engine','mileage','mileageUnit','modifications','confirmedFields','symptom')) then
        raise exception 'invalid_requested_measurement_vehicle' using errcode = '23514';
      end if;
      foreach source_id in array array['vin','year','make','model','engine','mileage','symptom'] loop
        if context ? source_id and (jsonb_typeof(context->source_id) <> 'string' or length(context->>source_id) > (case source_id when 'symptom' then 500 else 120 end)) then
          raise exception 'invalid_requested_measurement_vehicle' using errcode = '23514';
        end if;
      end loop;
      if context ? 'mileageUnit' and coalesce(context->>'mileageUnit','') not in ('mi','km','unknown') then raise exception 'invalid_requested_measurement_vehicle' using errcode = '23514'; end if;
      if context ? 'modifications' then
        item := context->'modifications';
        if jsonb_typeof(item) <> 'object' or coalesce(item->>'status','') not in ('unknown','none_known','modified')
          or exists (select 1 from jsonb_object_keys(item) k where k not in ('status','details'))
          or (item ? 'details' and (jsonb_typeof(item->'details') <> 'string' or length(item->>'details') > 600))
          or (item->>'status' <> 'modified' and coalesce(item->>'details','') <> '') then
          raise exception 'invalid_requested_measurement_vehicle' using errcode = '23514';
        end if;
      end if;
      if context ? 'confirmedFields' then
        if jsonb_typeof(context->'confirmedFields') <> 'object' then raise exception 'invalid_requested_measurement_vehicle_confirmation' using errcode = '23514'; end if;
        for source_id, confirmation in select * from jsonb_each(context->'confirmedFields') loop
          if source_id not in ('vin','year','make','model','engine','mileage','modifications') or jsonb_typeof(confirmation) <> 'object'
            or jsonb_typeof(confirmation->'value') is distinct from 'string' or length(confirmation->>'value') > 1000
            or jsonb_typeof(confirmation->'confirmedAt') is distinct from 'string' or not (confirmation->>'confirmedAt' ~ iso_pattern)
            or exists (select 1 from jsonb_object_keys(confirmation) k where k not in ('value','confirmedAt')) then
            raise exception 'invalid_requested_measurement_vehicle_confirmation' using errcode = '23514';
          end if;
          if to_char((confirmation->>'confirmedAt')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS') is distinct from left(confirmation->>'confirmedAt',19) then
            raise exception 'invalid_requested_measurement_vehicle_confirmation_date' using errcode = '23514';
          end if;
          if source_id = 'mileage' then
            if coalesce(context->>'mileageUnit','') not in ('mi','km') or coalesce(btrim(context->>'mileage'),'') = ''
              or btrim(context->>'mileage') ~* '^(unknown|not known|unsure|not sure|n/?a|not provided|not supplied)$'
              or (confirmation->>'value')::jsonb is distinct from jsonb_build_array(btrim(context->>'mileage'),context->>'mileageUnit') then
              raise exception 'stale_requested_measurement_vehicle_confirmation' using errcode = '23514';
            end if;
          elsif source_id = 'modifications' then
            if coalesce(context#>>'{modifications,status}','unknown') = 'unknown'
              or (context#>>'{modifications,status}' = 'modified' and coalesce(btrim(context#>>'{modifications,details}'),'') = '')
              or (context#>>'{modifications,status}' = 'modified' and btrim(context#>>'{modifications,details}') ~* '^(unknown|not known|unsure|not sure|n/?a|not provided|not supplied)$')
              or (confirmation->>'value')::jsonb is distinct from jsonb_build_array(context#>>'{modifications,status}',coalesce(btrim(context#>>'{modifications,details}'),'')) then
              raise exception 'stale_requested_measurement_vehicle_confirmation' using errcode = '23514';
            end if;
          elsif coalesce(btrim(context->>source_id),'') = '' or confirmation->>'value' is distinct from btrim(context->>source_id)
            or btrim(context->>source_id) ~* '^(unknown|not known|unsure|not sure|n/?a|not provided|not supplied)$' then
            raise exception 'stale_requested_measurement_vehicle_confirmation' using errcode = '23514';
          end if;
        end loop;
      end if;
    end if;

      if side->>'lookupId' is distinct from new.lookup_id or side->'photoId' is distinct from guide->'photoIds'->position
        or side->'analysisAttemptId' is distinct from guide->'analysisAttemptId' then
        raise exception 'mismatched_requested_measurement_source' using errcode = '23514';
      end if;
      position := position + 1;
    end loop;
  end if;

  if doc->'version' = '2'::jsonb then allowed := allowed || array['requestedMeasurement']; end if;
  if exists (select 1 from jsonb_object_keys(doc) k where not (k = any(allowed))) then raise exception 'unknown_human_service_record_field' using errcode = '23514'; end if;
  if doc ? 'vehicleContext' then
    context := doc->'vehicleContext';
    if jsonb_typeof(context) <> 'object' or exists (select 1 from jsonb_object_keys(context) k where k not in ('vin','year','make','model','engine','mileage','mileageUnit','modifications','confirmedFields','symptom')) then
      raise exception 'invalid_human_service_vehicle' using errcode = '23514';
    end if;
    foreach key in array array['vin','year','make','model','engine','mileage','symptom'] loop
      if context ? key and (jsonb_typeof(context->key) <> 'string' or length(context->>key) > (case key when 'symptom' then 500 else 120 end)) then
        raise exception 'invalid_human_service_vehicle' using errcode = '23514';
      end if;
    end loop;
    if context ? 'mileageUnit' and coalesce(context->>'mileageUnit','') not in ('mi','km','unknown') then raise exception 'invalid_human_service_vehicle' using errcode = '23514'; end if;
    if context ? 'modifications' and (jsonb_typeof(context->'modifications') <> 'object'
      or coalesce(context#>>'{modifications,status}','') not in ('unknown','none_known','modified')
      or exists (select 1 from jsonb_object_keys(context->'modifications') k where k not in ('status','details'))
      or (context->'modifications' ? 'details' and (jsonb_typeof(context#>'{modifications,details}') <> 'string' or length(context#>>'{modifications,details}') > 600))) then
      raise exception 'invalid_human_service_vehicle' using errcode = '23514';
    end if;
    if context ? 'confirmedFields' then
      if jsonb_typeof(context->'confirmedFields') <> 'object' then raise exception 'invalid_human_service_vehicle_confirmation' using errcode = '23514'; end if;
      for key, confirmation in select * from jsonb_each(context->'confirmedFields') loop
        if key not in ('vin','year','make','model','engine','mileage','modifications') or jsonb_typeof(confirmation) <> 'object'
          or jsonb_typeof(confirmation->'value') is distinct from 'string' or length(confirmation->>'value') > 1000
          or jsonb_typeof(confirmation->'confirmedAt') is distinct from 'string' or not (confirmation->>'confirmedAt' ~ iso_pattern)
          or exists (select 1 from jsonb_object_keys(confirmation) k where k not in ('value','confirmedAt')) then
          raise exception 'invalid_human_service_vehicle_confirmation' using errcode = '23514';
        end if;
        perform (confirmation->>'confirmedAt')::timestamptz;
      end loop;
    end if;
  end if;

  -- Serialize inserts for this owner's scan; neither shop visibility nor another
  -- tab can bypass ownership, reference checks or the bounded history size.
  perform 1 from public.scan_lookups where user_id = new.user_id and local_id = new.lookup_id for update;
  if not found then raise exception 'human_service_record_parent_missing' using errcode = '23503'; end if;
  -- Let the primary key return 23505 for an idempotent retry, even at capacity.
  if exists (select 1 from public.human_service_records where user_id = new.user_id and id = new.id) then return new; end if;
  select count(*), coalesce(sum(octet_length(record_json::text)),0) into count_saved, bytes_saved
    from public.human_service_records where user_id = new.user_id and lookup_id = new.lookup_id;
  if count_saved >= 100 or bytes_saved + octet_length(doc::text) + 2 * (count_saved + 1) > 262144 then
    raise exception 'human_service_record_history_limit' using errcode = '23514';
  end if;
  if doc ? 'supersedesId' then
    select record_json into prior from public.human_service_records
      where user_id = new.user_id and lookup_id = new.lookup_id and id = (doc->>'supersedesId')::uuid;
    if not found or prior->>'kind' = 'retraction' or (doc->>'kind' <> 'retraction' and doc->>'kind' <> prior->>'kind')
      or prior->'version' is distinct from doc->'version'
      or (prior->'version' = '2'::jsonb and prior->'requestedMeasurement' is distinct from doc->'requestedMeasurement') then
      raise exception 'invalid_human_service_record_target' using errcode = '23514';
    end if;
  end if;
  if doc->>'kind' = 'follow_up' then
    for item in select value from jsonb_array_elements(doc->'relatedRecordIds') loop
      if not exists (select 1 from public.human_service_records where user_id = new.user_id and lookup_id = new.lookup_id and id = (item#>>'{}')::uuid) then
        raise exception 'invalid_human_service_record_reference' using errcode = '23514';
      end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_human_service_record() from public, anon, authenticated;
