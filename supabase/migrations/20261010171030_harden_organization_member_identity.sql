-- Membership identity and role changes require a future privileged server flow.
-- Client-side self-updates allowed role escalation and cross-organization moves.
revoke update on public.organization_members from authenticated;
drop policy if exists organization_members_update_self on public.organization_members;

notify pgrst, 'reload schema';
