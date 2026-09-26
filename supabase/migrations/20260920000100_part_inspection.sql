-- Human inspection is separate from the AI result and training feedback.
-- Existing scan_lookups ownership/shop RLS applies to this optional field.
alter table public.scan_lookups
  add column if not exists inspection_json jsonb
    check (inspection_json is null or jsonb_typeof(inspection_json) = 'object');

comment on column public.scan_lookups.inspection_json is
  'Optional human inspection: identity evidence, visible condition, functional test, reviewer and time. Not an AI label, verified certification, or training consent.';
