-- Fixed-window rate limiting for the paid AI endpoints (/api/identify, /api/chat).
-- Server-only: written exclusively by service-role code via check_rate_limit(). The
-- browser never reads or writes this table (RLS on, no client policies), and the RPC
-- is not exposed to anon/authenticated PostgREST callers.

create table if not exists public.rate_limit_hits (
  bucket_key text primary key,
  hits integer not null default 0 check (hits >= 0),
  expires_at timestamptz not null
);

comment on table public.rate_limit_hits is 'Server-side fixed-window counters for /api/* abuse protection. Written only by public.check_rate_limit().';

create index if not exists rate_limit_hits_expires_at_idx
  on public.rate_limit_hits (expires_at);

alter table public.rate_limit_hits enable row level security;
-- No policies: authenticated/anon get no access. Server code uses the service role,
-- which bypasses RLS. Counters stay unreadable and untamperable from the browser.
revoke all on table public.rate_limit_hits from anon, authenticated;

-- Atomic increment-and-check for one fixed window. Returns true when the request is
-- within the limit, false when it exceeds it. The window is derived from the current
-- epoch, so each new window opens a fresh counter row (its own bucket_key) and the
-- previous count is effectively reset.
create or replace function public.check_rate_limit(
  p_key text,
  p_max integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start bigint := (floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds)::bigint;
  v_bucket text := p_key || ':' || v_window_start::text;
  v_hits integer;
begin
  insert into public.rate_limit_hits as r (bucket_key, hits, expires_at)
  values (v_bucket, 1, to_timestamp(v_window_start + p_window_seconds))
  on conflict (bucket_key)
  do update set hits = r.hits + 1
  returning r.hits into v_hits;

  return v_hits <= p_max;
end;
$$;

comment on function public.check_rate_limit(text, integer, integer) is 'Atomic fixed-window rate limit: increments the counter for p_key and returns true if within p_max for the p_window_seconds window.';

revoke all on function public.check_rate_limit(text, integer, integer) from public;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

-- Housekeeping: drop expired counter rows. Kept off the hot path. Schedule with pg_cron,
-- e.g. select cron.schedule('rate-limit-cleanup', '*/15 * * * *',
--   $$select public.cleanup_rate_limit_hits()$$);  -- or call it periodically yourself.
create or replace function public.cleanup_rate_limit_hits()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.rate_limit_hits where expires_at < now();
$$;

revoke all on function public.cleanup_rate_limit_hits() from public;
grant execute on function public.cleanup_rate_limit_hits() to service_role;
