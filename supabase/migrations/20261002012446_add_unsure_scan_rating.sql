alter table public.scan_lookups
  drop constraint if exists scan_lookups_rating_check;

alter table public.scan_lookups
  add constraint scan_lookups_rating_check
  check (rating in ('up', 'down', 'unsure') or rating is null);

alter table public.scan_corrections
  drop constraint if exists scan_corrections_rating_check;

alter table public.scan_corrections
  add constraint scan_corrections_rating_check
  check (rating in ('up', 'down', 'unsure') or rating is null);

comment on column public.scan_lookups.rating is
  'User review state: up means accepted, down means rejected, unsure means explicitly unresolved, and null means not reviewed.';

comment on column public.scan_corrections.rating is
  'User review state copied from the scan: up, down, unsure, or null when no review was submitted.';

notify pgrst, 'reload schema';
