-- Table privileges for the families schema.
--
-- Why this is a separate concern from the policies in the previous migration:
-- RLS decides *which rows* a role may see, but it only ever narrows what SQL
-- privileges already allow. Without a GRANT, `authenticated` cannot touch the
-- table at all and every query fails with `42501 permission denied`, no matter
-- how correct the policies are.
--
-- Supabase's default privileges cover objects created by the `postgres` role,
-- which is why tables made in the dashboard "just work". The CLI runs
-- migrations under its own login role (see "Initialising login role..." in
-- `supabase db push` output), so tables created this way inherit nothing and
-- need explicit grants. Found by src/services/family.rls.test.ts, which failed
-- against the live database while the policies themselves were fine.

-- No INSERT for either table: the only way to create a family or a membership
-- is public.create_family(). Withholding the privilege makes that structural
-- rather than merely policy-enforced.
grant select, update, delete on public.families       to authenticated;
grant select, update, delete on public.family_members to authenticated;

-- Nothing at all for anon. Every policy is already scoped `to authenticated`,
-- so this is belt and braces — but a signed-out client should be refused at
-- the privilege layer, before RLS is ever consulted.
revoke all on public.families       from anon;
revoke all on public.family_members from anon;

-- Functions grant EXECUTE to PUBLIC by default. These three are SECURITY
-- DEFINER, so they run with elevated rights — leaving them callable by
-- everyone is exactly the exposure that makes SECURITY DEFINER worth being
-- careful about. create_family() already refuses an anonymous caller, and the
-- helpers return false without a session, but the privilege should not depend
-- on that.
revoke all on function public.is_family_member(uuid) from public;
revoke all on function public.is_family_owner(uuid)  from public;
revoke all on function public.create_family(text)    from public;

grant execute on function public.is_family_member(uuid) to authenticated;
grant execute on function public.is_family_owner(uuid)  to authenticated;
grant execute on function public.create_family(text)    to authenticated;
