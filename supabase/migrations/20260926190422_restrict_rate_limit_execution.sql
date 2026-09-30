-- Supabase default privileges can explicitly grant EXECUTE to browser roles.
-- Revoking PUBLIC alone does not remove those explicit grants.
revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.cleanup_rate_limit_hits() from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
grant execute on function public.cleanup_rate_limit_hits() to service_role;
