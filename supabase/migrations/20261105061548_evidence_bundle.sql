-- Visual evidence belongs to the saved scan, independently of AI predictions.
-- Existing owner/shop RLS and the revision trigger continue to govern writes.
-- Numeric JSON equality excludes "1"; COALESCE rejects a missing version
-- instead of allowing the UNKNOWN result that a PostgreSQL CHECK accepts.
alter table public.scan_lookups
  add column if not exists evidence_bundle_json jsonb
    check (evidence_bundle_json is null or coalesce((
      jsonb_typeof(evidence_bundle_json) = 'object'
      and evidence_bundle_json -> 'version' = '1'::jsonb
      and (not (evidence_bundle_json ? 'photos') or jsonb_typeof(evidence_bundle_json -> 'photos') = 'array')
      and (not (evidence_bundle_json ? 'isolatedObjects') or jsonb_typeof(evidence_bundle_json -> 'isolatedObjects') = 'array')
    ), false));

comment on column public.scan_lookups.evidence_bundle_json is
  'Versioned original-photo references, selected objects, crop geometry and correction timestamps. Private storage paths only; no image bytes or signed tokens. Separate from result_json and training consent.';
