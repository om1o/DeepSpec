-- Exact imported originals and immutable human associations. Source scan deletion
-- retains this history; account deletion removes it. No client UPDATE or DELETE.
create table public.diagnostic_reports (
  user_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  lookup_id text not null check (lookup_id ~ '^[A-Za-z0-9._:-]{1,160}$' and lookup_id not in ('.','..')),
  kind text not null check (kind in ('document','association')),
  record_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id,id)
);
create index diagnostic_reports_lookup on public.diagnostic_reports(user_id,lookup_id,id);
alter table public.diagnostic_reports enable row level security;
revoke all on public.diagnostic_reports from public,anon,authenticated;
grant select,insert on public.diagnostic_reports to authenticated;
create policy diagnostic_reports_select_owner on public.diagnostic_reports for select to authenticated
  using ((select auth.uid()) = user_id);
create policy diagnostic_reports_insert_owner on public.diagnostic_reports for insert to authenticated
  with check ((select auth.uid()) = user_id);

create schema if not exists private;
create function private.valid_diagnostic_timestamp(value jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare stamp text := value #>> '{}'; local_time timestamp; utc_time timestamp; zone text;
begin
  if jsonb_typeof(value) is distinct from 'string' or stamp !~ '^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,9})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$' then return false; end if;
  local_time := left(stamp,19)::timestamp;
  if to_char(local_time,'YYYY-MM-DD"T"HH24:MI:SS') is distinct from left(stamp,19) then return false; end if;
  zone := right(stamp,6);
  utc_time := local_time;
  if right(stamp,1)<>'Z' then
    utc_time := local_time - (case when left(zone,1)='+' then 1 else -1 end) * make_interval(hours=>substring(zone,2,2)::integer,mins=>right(zone,2)::integer);
  end if;
  return utc_time >= timestamp '0001-01-01 00:00:00' and utc_time < timestamp '10000-01-01 00:00:00';
exception when others then return false;
end;
$$;

create function private.guard_diagnostic_report()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  doc jsonb := new.record_json;
  item jsonb;
  context jsonb;
  confirmation jsonb;
  modifications jsonb;
  report jsonb;
  parent jsonb;
  raw bytea;
  key text;
  existing_count integer;
  existing_bytes bigint;
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if tg_op <> 'INSERT' then raise exception 'diagnostic_record_immutable' using errcode='23514'; end if;
  if auth.uid() is distinct from new.user_id then raise exception 'diagnostic_owner_mismatch' using errcode='42501'; end if;
  if jsonb_typeof(doc) is distinct from 'object' or doc->'version' is distinct from '1'::jsonb
    or jsonb_typeof(doc->'id') is distinct from 'string' or doc->>'id' is distinct from new.id::text
    or jsonb_typeof(doc->'lookupId') is distinct from 'string' or doc->>'lookupId' is distinct from new.lookup_id then
    raise exception 'invalid_diagnostic_record' using errcode='23514';
  end if;
  -- Serialize quota checks for concurrent inserts belonging to the same owner/scan.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || ':' || new.lookup_id,0));
  -- Let the primary key return 23505 for every same-ID retry, including retained
  -- history after scan removal and full buckets. Client readback compares content.
  if exists(select 1 from public.diagnostic_reports where user_id=new.user_id and id=new.id) then return new; end if;
  if not exists(select 1 from public.scan_lookups where user_id=new.user_id and local_id=new.lookup_id) then
    raise exception 'diagnostic_scan_required' using errcode='23503';
  end if;
  select count(*),coalesce(sum(octet_length(record_json::text)),0) into existing_count,existing_bytes
    from public.diagnostic_reports where user_id=new.user_id and lookup_id=new.lookup_id;
  if existing_count >= 108 or existing_bytes + octet_length(doc::text) > 25165824 then
    raise exception 'diagnostic_history_limit' using errcode='23514';
  end if;
  if new.kind='document' then
    if exists(select 1 from jsonb_object_keys(doc) k where k not in ('version','id','lookupId','importedAt','fileName','mime','byteLength','sha256','encoding','sourceBase64'))
      or not private.valid_diagnostic_timestamp(doc->'importedAt')
      or doc->>'importedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$'
      or jsonb_typeof(doc->'fileName') is distinct from 'string' or length(doc->>'fileName') not between 1 and 255
      or doc->>'fileName' ~ '[/\\]' or doc->>'fileName' ~ U&'[\0001-\001F\007F-\009F]' or doc->>'fileName' !~* '\.txt$'
      or jsonb_typeof(doc->'mime') is distinct from 'string' or doc->>'mime' not in ('','text/plain','application/octet-stream')
      or jsonb_typeof(doc->'byteLength') is distinct from 'number'
      or jsonb_typeof(doc->'sha256') is distinct from 'string' or coalesce(doc->>'sha256','') !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(doc->'encoding') is distinct from 'string' or coalesce(doc->>'encoding','') not in ('utf-8','windows-1252')
      or jsonb_typeof(doc->'sourceBase64') is distinct from 'string' or length(doc->>'sourceBase64') > 2796204
      or coalesce(doc->>'sourceBase64','') !~ '^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' then
      raise exception 'invalid_diagnostic_document' using errcode='23514';
    end if;
    raw := decode(doc->>'sourceBase64','base64');
    if octet_length(raw) not between 1 and 2097152 or (doc->>'byteLength')::numeric <> octet_length(raw)
      or replace(encode(raw,'base64'),E'\n','') is distinct from doc->>'sourceBase64'
      or encode(sha256(raw),'hex') is distinct from doc->>'sha256' then
      raise exception 'diagnostic_original_mismatch' using errcode='23514';
    end if;
    -- SQL proves canonical bytes and their hash, not the text encoding, VCDS
    -- grammar or selected entry membership. verifyDiagnosticBundle must decode
    -- and parse the exact original before client/cloud reads expose the bundle.
    select count(*) into existing_count from public.diagnostic_reports where user_id=new.user_id and lookup_id=new.lookup_id and kind='document';
    if existing_count >= 8 then raise exception 'diagnostic_document_limit' using errcode='23514'; end if;
  else
    if octet_length(doc::text) > 262144 or exists(select 1 from jsonb_object_keys(doc) k where k not in ('version','id','lookupId','documentId','sourceSha256','recordedAt','subject','entryIds','photos','vehicleRelationship','basis','notes','supersedesId','correctionReason'))
      or not private.valid_diagnostic_timestamp(doc->'recordedAt')
      or jsonb_typeof(doc->'documentId') is distinct from 'string' or coalesce(doc->>'documentId','') !~ uuid_pattern
      or jsonb_typeof(doc->'sourceSha256') is distinct from 'string' or coalesce(doc->>'sourceSha256','') !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(doc->'subject') is distinct from 'string' or length(btrim(doc->>'subject'))=0 or length(doc->>'subject')>200
      or jsonb_typeof(doc->'basis') is distinct from 'string' or length(doc->>'basis')>1000
      or jsonb_typeof(doc->'notes') is distinct from 'string' or length(doc->>'notes')>4000
      or jsonb_typeof(doc->'vehicleRelationship') is distinct from 'string' or coalesce(doc->>'vehicleRelationship','') not in ('unconfirmed','same_vehicle','different_vehicle')
      or (doc->>'vehicleRelationship'<>'unconfirmed' and length(btrim(doc->>'basis'))=0)
      or jsonb_typeof(doc->'entryIds') is distinct from 'array' or jsonb_typeof(doc->'photos') is distinct from 'array' then
      raise exception 'invalid_diagnostic_association' using errcode='23514';
    end if;
    if jsonb_array_length(doc->'entryIds')>100 or jsonb_array_length(doc->'photos') not between 1 and 4 then
      raise exception 'diagnostic_reference_limit' using errcode='23514';
    end if;
    select record_json into report from public.diagnostic_reports
      where user_id=new.user_id and lookup_id=new.lookup_id and id=(doc->>'documentId')::uuid and kind='document';
    if report is null or report->>'sha256' is distinct from doc->>'sourceSha256' then
      raise exception 'diagnostic_document_required' using errcode='23503';
    end if;
    for item in select value from jsonb_array_elements(doc->'entryIds') loop
      if jsonb_typeof(item) is distinct from 'string' or (item#>>'{}') !~ '^(controller|fault|frame|reading)-[1-9][0-9]{0,4}$' then
        raise exception 'invalid_diagnostic_entry_reference' using errcode='23514';
      end if;
    end loop;
    if (select count(distinct value) from jsonb_array_elements(doc->'entryIds')) <> jsonb_array_length(doc->'entryIds')
      or (select count(distinct value->>'photoId') from jsonb_array_elements(doc->'photos')) <> jsonb_array_length(doc->'photos') then
      raise exception 'duplicate_diagnostic_reference' using errcode='23514';
    end if;
    for item in select value from jsonb_array_elements(doc->'photos') loop
      if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(item->'lookupId') is distinct from 'string' or item->>'lookupId' is distinct from new.lookup_id
        or jsonb_typeof(item->'photoId') is distinct from 'string' or coalesce(item->>'photoId','') !~ '^[A-Za-z0-9._:-]{1,80}$' or item->>'photoId' in ('.','..')
        or jsonb_typeof(item->'photoLabel') is distinct from 'string' or coalesce(item->>'photoLabel','') not in ('overview','close_up','marking','mounting','other')
        or jsonb_typeof(item->'sha256') is distinct from 'string' or coalesce(item->>'sha256','') !~ '^[0-9a-f]{64}$'
        or not private.valid_diagnostic_timestamp(item->'photoAddedAt') or not private.valid_diagnostic_timestamp(item->'scanSavedAt')
        or item->>'photoAddedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$' or item->>'scanSavedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$'
        or jsonb_typeof(item->'width') is distinct from 'number' or jsonb_typeof(item->'height') is distinct from 'number'
        or not(item?'observedOn') or not(item?'vehicleContext')
        or exists(select 1 from jsonb_object_keys(item) k where k not in ('lookupId','photoId','photoLabel','photoAddedAt','scanSavedAt','sha256','width','height','observedOn','vehicleContext','analysisAttemptId')) then
        raise exception 'invalid_diagnostic_photo' using errcode='23514';
      end if;
      if (item->>'width')::numeric not between 1 and 32768 or (item->>'height')::numeric not between 1 and 32768
        or (item->>'width')::numeric <> trunc((item->>'width')::numeric) or (item->>'height')::numeric <> trunc((item->>'height')::numeric)
        or (item->>'width')::numeric*(item->>'height')::numeric > 100000000 then raise exception 'invalid_diagnostic_dimensions' using errcode='23514'; end if;
      if item->'observedOn'<>'null'::jsonb and (jsonb_typeof(item->'observedOn')<>'string'
        or not(item->>'observedOn' ~ '^\d{4}-\d{2}-\d{2}$') or to_char((item->>'observedOn')::date,'YYYY-MM-DD') is distinct from item->>'observedOn') then
        raise exception 'invalid_diagnostic_observation_date' using errcode='23514';
      end if;
      if item?'analysisAttemptId' and (jsonb_typeof(item->'analysisAttemptId')<>'string' or coalesce(item->>'analysisAttemptId','') !~ '^[A-Za-z0-9._:-]{1,160}$' or item->>'analysisAttemptId' in ('.','..')) then
        raise exception 'invalid_diagnostic_analysis_reference' using errcode='23514';
      end if;
      context := item->'vehicleContext';
      if context<>'null'::jsonb then
        if jsonb_typeof(context)<>'object' or octet_length(context::text)>16384
          or exists(select 1 from jsonb_object_keys(context) k where k not in ('vin','year','make','model','engine','mileage','mileageUnit','modifications','symptom','confirmedFields')) then
          raise exception 'invalid_diagnostic_vehicle_snapshot' using errcode='23514';
        end if;
        for key in select jsonb_object_keys(context) loop
          if key not in ('confirmedFields','modifications') and (jsonb_typeof(context->key)<>'string' or length(context->>key)>(case when key='symptom' then 500 else 120 end)) then
            raise exception 'invalid_diagnostic_vehicle_field' using errcode='23514';
          end if;
        end loop;
        if context?'mileageUnit' and coalesce(context->>'mileageUnit','') not in ('mi','km','unknown') then raise exception 'invalid_diagnostic_vehicle_field' using errcode='23514'; end if;
        if context?'modifications' then
          modifications := context->'modifications';
          if jsonb_typeof(modifications)<>'object' or coalesce(modifications->>'status','') not in ('unknown','none_known','modified')
            or exists(select 1 from jsonb_object_keys(modifications) k where k not in ('status','details'))
            or (modifications?'details' and (jsonb_typeof(modifications->'details')<>'string' or length(modifications->>'details')>600))
            or (modifications->>'status'<>'modified' and coalesce(modifications->>'details','')<>'') then
            raise exception 'invalid_diagnostic_modifications' using errcode='23514';
          end if;
        end if;
        if context?'confirmedFields' then
          if jsonb_typeof(context->'confirmedFields')<>'object' then raise exception 'invalid_diagnostic_confirmation' using errcode='23514'; end if;
          for key,confirmation in select * from jsonb_each(context->'confirmedFields') loop
            if key not in ('vin','year','make','model','engine','mileage','modifications')
              or jsonb_typeof(confirmation)<>'object' or jsonb_typeof(confirmation->'value') is distinct from 'string'
              or length(confirmation->>'value')>1000 or not private.valid_diagnostic_timestamp(confirmation->'confirmedAt')
              or exists(select 1 from jsonb_object_keys(confirmation) k where k not in ('value','confirmedAt')) then
              raise exception 'invalid_diagnostic_confirmation' using errcode='23514';
            end if;
            if key='mileage' then
              if coalesce(context->>'mileageUnit','') not in ('mi','km') or coalesce(btrim(context->>'mileage'),'')=''
                or btrim(context->>'mileage') ~* '^(unknown|not known|unsure|not sure|n/?a|not provided|not supplied)$'
                or (confirmation->>'value')::jsonb is distinct from jsonb_build_array(btrim(context->>'mileage'),context->>'mileageUnit') then
                raise exception 'stale_diagnostic_confirmation' using errcode='23514';
              end if;
            elsif key='modifications' then
              if coalesce(context#>>'{modifications,status}','unknown')='unknown'
                or (context#>>'{modifications,status}'='modified' and coalesce(btrim(context#>>'{modifications,details}'),'')='')
                or (context#>>'{modifications,status}'='modified' and btrim(context#>>'{modifications,details}') ~* '^(unknown|not known|unsure|not sure|n/?a|not provided|not supplied)$')
                or (confirmation->>'value')::jsonb is distinct from jsonb_build_array(context#>>'{modifications,status}',coalesce(btrim(context#>>'{modifications,details}'),'')) then
                raise exception 'stale_diagnostic_confirmation' using errcode='23514';
              end if;
            elsif coalesce(btrim(context->>key),'')='' or confirmation->>'value' is distinct from btrim(context->>key)
              or btrim(context->>key) ~* '^(unknown|not known|unsure|not sure|n/?a|not provided|not supplied)$' then
              raise exception 'stale_diagnostic_confirmation' using errcode='23514';
            end if;
          end loop;
        end if;
      end if;
    end loop;
    if doc?'supersedesId' then
      if jsonb_typeof(doc->'supersedesId') is distinct from 'string' or coalesce(doc->>'supersedesId','') !~ uuid_pattern or doc->>'supersedesId'=new.id::text
        or jsonb_typeof(doc->'correctionReason') is distinct from 'string' or length(btrim(doc->>'correctionReason'))=0 or length(doc->>'correctionReason')>1000 then
        raise exception 'invalid_diagnostic_correction' using errcode='23514';
      end if;
      select record_json into parent from public.diagnostic_reports where user_id=new.user_id and lookup_id=new.lookup_id and kind='association' and id=(doc->>'supersedesId')::uuid;
      if parent is null then raise exception 'diagnostic_correction_parent_required' using errcode='23503'; end if;
    elsif doc?'correctionReason' then raise exception 'diagnostic_correction_parent_required' using errcode='23514'; end if;
    select count(*) into existing_count from public.diagnostic_reports where user_id=new.user_id and lookup_id=new.lookup_id and kind='association';
    if existing_count>=100 then raise exception 'diagnostic_association_limit' using errcode='23514'; end if;
  end if;
  return new;
end;
$$;
revoke all on function private.valid_diagnostic_timestamp(jsonb) from public,anon;
revoke all on function private.guard_diagnostic_report() from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.valid_diagnostic_timestamp(jsonb) to authenticated;
grant execute on function private.guard_diagnostic_report() to authenticated;
create trigger diagnostic_report_guard before insert or update on public.diagnostic_reports
  for each row execute function private.guard_diagnostic_report();
comment on table public.diagnostic_reports is 'Owner-only immutable imported originals and human photo associations; no diagnostic conclusion or vehicle health certification. Source-scan removal retains records; account removal cascades.';
