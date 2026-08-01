-- Families and membership — the tenant boundary.
--
-- docs/08-database-design.md §22: "Families must remain completely isolated
-- from one another. No data should ever cross tenant boundaries unless
-- explicitly shared." Every table added from here on hangs off this one, so
-- the policies below are the single thing standing between one household's
-- records and another's. They are tested in src/services/family.rls.test.ts.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.families (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(trim(name)) between 1 and 80),
  -- restrict, not cascade: deleting an account must not silently destroy a
  -- family that other people still belong to.
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.family_members (
  family_id uuid not null references public.families (id) on delete cascade,
  user_id   uuid not null references auth.users (id)      on delete cascade,
  -- Two values on purpose. The real permission matrix is PR-9 (Roles &
  -- Permissions); inventing its shape here would be guessing at requirements.
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

-- Every policy below answers "which families does this user belong to?", so
-- the reverse lookup needs an index. The primary key already covers
-- (family_id, user_id); this covers the other direction.
create index family_members_user_id_idx on public.family_members (user_id);

-- ---------------------------------------------------------------------------
-- Membership helpers
-- ---------------------------------------------------------------------------
--
-- These exist to break a policy recursion, not for convenience.
--
-- The natural policies deadlock: reading `families` requires knowing whether
-- you are a member, which reads `family_members`; reading `family_members`
-- requires the same check against itself. Postgres refuses with
-- "infinite recursion detected in policy for relation family_members".
--
-- SECURITY DEFINER runs the function as its owner, so RLS is not applied to
-- the query *inside* it — the cycle is broken. That also makes these functions
-- a privilege boundary: `set search_path = ''` is mandatory, because without
-- it a caller could shadow `family_members` with their own table and have this
-- function read it with elevated rights. Every object below is fully
-- qualified for the same reason.

create function public.is_family_member(target uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.family_members
    where family_id = target
      and user_id = (select auth.uid())
  );
$$;

create function public.is_family_owner(target uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.family_members
    where family_id = target
      and user_id = (select auth.uid())
      and role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- Creating a family
-- ---------------------------------------------------------------------------
--
-- Creation is a function rather than a plain INSERT, for three reasons.
--
-- 1. Ordering. A family is only visible to its members, so an
--    `insert ... returning` would be filtered by the SELECT policy *before*
--    an AFTER-INSERT trigger could add the creator as a member — RETURNING is
--    projected during the insert, while AFTER ROW triggers fire at end of
--    statement. Creation would appear to fail every time. Doing both inserts
--    inside one SECURITY DEFINER function removes the ordering question.
--
-- 2. Atomicity. There is no window in which a family exists that nobody can
--    see, and no way to end up with a family that has no owner.
--
-- 3. Ownership cannot be forged. `created_by` is taken from auth.uid() here
--    rather than accepted from the client, so there is no request shape that
--    creates a family in someone else's name. That is a stronger guarantee
--    than a WITH CHECK policy, which only validates what the client sent.
--
-- Consequently neither table has an INSERT policy: RLS denies by default, and
-- this function is the only way in. PR-6 adds a narrowly scoped INSERT policy
-- on family_members for redeemed invitations.

create function public.create_family(family_name text)
returns public.families
language plpgsql
security definer
set search_path = ''
as $$
declare
  creator uuid := (select auth.uid());
  created public.families;
begin
  if creator is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  insert into public.families (name, created_by)
  values (trim(family_name), creator)
  returning * into created;

  insert into public.family_members (family_id, user_id, role)
  values (created.id, creator, 'owner');

  return created;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

alter table public.families       enable row level security;
alter table public.family_members enable row level security;

-- families ------------------------------------------------------------------

create policy "Members can read their families"
  on public.families for select
  to authenticated
  using (public.is_family_member(id));

-- No INSERT policy — see create_family() above.

-- Renaming is an owner action. Note created_by is not pinned here; once PR-6
-- allows more than one owner, an owner could rewrite it. Harmless today
-- because owner and creator are the same person, but worth closing then.
create policy "Owners can update their family"
  on public.families for update
  to authenticated
  using (public.is_family_owner(id))
  with check (public.is_family_owner(id));

create policy "Owners can delete their family"
  on public.families for delete
  to authenticated
  using (public.is_family_owner(id));

-- family_members ------------------------------------------------------------

create policy "Members can see who else is in their families"
  on public.family_members for select
  to authenticated
  using (public.is_family_member(family_id));

-- No INSERT policy — membership is granted by create_family() today, and by
-- PR-6's invitation flow tomorrow. A client must never be able to add itself
-- to a family it chose.

create policy "Owners can change member roles"
  on public.family_members for update
  to authenticated
  using (public.is_family_owner(family_id))
  with check (public.is_family_owner(family_id));

create policy "Owners can remove members"
  on public.family_members for delete
  to authenticated
  using (public.is_family_owner(family_id));
