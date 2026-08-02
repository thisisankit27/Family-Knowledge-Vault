-- People, and the separation of "who is in the family" from "who can sign in".
--
-- docs/08-database-design.md §8 defines a Member as "a person within the
-- family" who owns Documents, Medical Records, Recipes, Memories and Timeline
-- Events. FR-010 gives them birthdays and blood groups; FR-011 attaches records
-- to them.
--
-- A person is not an account. A grandmother who never installs the app, a
-- child, a deceased ancestor in the family tree — all are members of the family
-- and all will own records. The table PR-5 called `family_members` is
-- (family_id, user_id, role): an access grant. It cannot represent a person
-- without a login, and it is misnamed for what the rest of the product means.
--
-- So: the access table becomes `family_users`, and `family_members` is reborn
-- as people. Every record table from Phase 3 will read
-- `documents.member_id -> family_members.id`. Doing this now costs five
-- function rewrites; doing it after Phase 3 would cost a migration on every
-- record table.

-- ---------------------------------------------------------------------------
-- 1. Rename the access table
-- ---------------------------------------------------------------------------
-- Policies are attached to the table object and follow it automatically.
-- Function bodies are stored as text and do not, which is why every function
-- touching this table is rewritten below.

alter table public.family_members rename to family_users;
alter index family_members_user_id_idx rename to family_users_user_id_idx;

-- ---------------------------------------------------------------------------
-- 2. Intent-named permission helpers
-- ---------------------------------------------------------------------------
--
-- These replace is_family_member / is_family_owner, and the renaming is the
-- point rather than a tidy-up.
--
-- PR-9a widens the role model from two roles to four. If policies name roles
-- directly, PR-9a has to rewrite every policy in this phase. Because policies
-- ask *what may this person do* instead of *what role do they hold*, PR-9a
-- edits four function bodies and touches no policy at all.
--
-- SECURITY DEFINER for the same reason as before: reading family_users from
-- inside a family_users policy would recurse. `set search_path = ''` is
-- mandatory on a definer function — without it a caller can shadow a table and
-- have it read with elevated rights.

create function public.has_family_access(target_family uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.family_users
    where family_id = target_family and user_id = (select auth.uid())
  );
$$;

-- Renaming or deleting the family itself.
create function public.can_manage_family(target_family uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.family_users
    where family_id = target_family
      and user_id = (select auth.uid())
      and role = 'owner'
  );
$$;

-- Inviting, removing, and changing roles. Widens to include 'admin' in PR-9a.
create function public.can_manage_members(target_family uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.family_users
    where family_id = target_family
      and user_id = (select auth.uid())
      and role = 'owner'
  );
$$;

-- Editing the people in the family and their relationships. Any member today;
-- PR-9a excludes guests.
create function public.can_edit_people(target_family uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.family_users
    where family_id = target_family and user_id = (select auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Move every existing policy onto the new helpers
-- ---------------------------------------------------------------------------
-- Postgres refuses to drop a function a policy depends on, so the policies go
-- first and the old helpers are dropped afterwards.

drop policy "Members can read their families"                on public.families;
drop policy "Owners can update their family"                 on public.families;
drop policy "Owners can delete their family"                 on public.families;
drop policy "Members can see who else is in their families"  on public.family_users;
drop policy "Owners can change member roles"                 on public.family_users;
drop policy "Owners can remove members"                      on public.family_users;
drop policy "Members can read their family's invitations"    on public.family_invitations;
drop policy "Owners can revoke invitations"                  on public.family_invitations;

create policy "Members can read their families"
  on public.families for select to authenticated
  using (public.has_family_access(id));

create policy "Owners can update their family"
  on public.families for update to authenticated
  using (public.can_manage_family(id))
  with check (public.can_manage_family(id));

create policy "Owners can delete their family"
  on public.families for delete to authenticated
  using (public.can_manage_family(id));

create policy "Members can see who else has access"
  on public.family_users for select to authenticated
  using (public.has_family_access(family_id));

create policy "Managers can change roles"
  on public.family_users for update to authenticated
  using (public.can_manage_members(family_id))
  with check (public.can_manage_members(family_id));

create policy "Managers can remove access"
  on public.family_users for delete to authenticated
  using (public.can_manage_members(family_id));

create policy "Members can read their family's invitations"
  on public.family_invitations for select to authenticated
  using (public.has_family_access(family_id));

create policy "Managers can revoke invitations"
  on public.family_invitations for delete to authenticated
  using (public.can_manage_members(family_id));

-- ---------------------------------------------------------------------------
-- 4. The people table
-- ---------------------------------------------------------------------------

create table public.family_members (
  id             uuid primary key default gen_random_uuid(),
  family_id      uuid not null references public.families (id) on delete cascade,
  -- Null for everyone who does not use the app, which is most of a family.
  -- `on delete set null` so deleting an account never erases the person or the
  -- records hanging off them.
  user_id        uuid references auth.users (id) on delete set null,
  display_name   text not null check (char_length(trim(display_name)) between 1 and 80),
  -- No CHECK against current_date: a check constraint must be immutable, and a
  -- date that was valid on insert would fail a later dump and restore.
  -- Validated in add_family_member / update_family_member instead.
  date_of_birth  date,
  blood_group    text check (blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Soft delete from day one. A person acquires records from Phase 3 onward,
  -- and hard-deleting them would orphan every one. Adding this later means a
  -- migration plus a policy rewrite.
  deleted_at     timestamptz,
  -- The composite target PR-8 needs: a relationship references
  -- (member_id, family_id), which makes a cross-family link structurally
  -- impossible rather than merely policy-prevented.
  unique (id, family_id)
);

-- One account maps to at most one person per family.
create unique index family_members_account_unique
  on public.family_members (family_id, user_id)
  where user_id is not null;

create index family_members_family_idx
  on public.family_members (family_id)
  where deleted_at is null;

-- Generic, and reused by every table that gains updated_at later.
create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger family_members_touch_updated_at
  before update on public.family_members
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Writing people
-- ---------------------------------------------------------------------------
--
-- Definer functions rather than INSERT/UPDATE policies, consistent with
-- create_family and redeem_invitation. The specific reason here: `user_id`
-- links a person to an account, and a client must never be able to set it.
-- A policy cannot express "you may edit every column except this one".

create function public.add_family_member(
  target_family      uuid,
  member_name        text,
  member_dob         date default null,
  member_blood_group text default null
)
returns public.family_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  created public.family_members;
begin
  if not public.can_edit_people(target_family) then
    raise exception 'Not allowed to edit this family' using errcode = '42501';
  end if;
  if member_dob is not null and member_dob > current_date then
    raise exception 'Date of birth is in the future' using errcode = '22023';
  end if;

  insert into public.family_members (family_id, display_name, date_of_birth, blood_group)
  values (target_family, trim(member_name), member_dob, member_blood_group)
  returning * into created;

  return created;
end;
$$;

create function public.update_family_member(
  member             uuid,
  member_name        text,
  member_dob         date default null,
  member_blood_group text default null
)
returns public.family_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  owning_family uuid;
  updated       public.family_members;
begin
  select family_id into owning_family
  from public.family_members
  where id = member and deleted_at is null;

  -- Same answer whether the person does not exist or belongs to someone else's
  -- family: distinguishing them confirms the existence of records the caller
  -- cannot see.
  if owning_family is null or not public.can_edit_people(owning_family) then
    raise exception 'Not allowed to edit this person' using errcode = '42501';
  end if;
  if member_dob is not null and member_dob > current_date then
    raise exception 'Date of birth is in the future' using errcode = '22023';
  end if;

  update public.family_members
  set display_name  = trim(member_name),
      date_of_birth = member_dob,
      blood_group   = member_blood_group
  where id = member
  returning * into updated;

  return updated;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Row-Level Security and privileges for people
-- ---------------------------------------------------------------------------

alter table public.family_members enable row level security;

-- The soft-delete filter lives in the policy, not in application code, so no
-- future query can forget it.
create policy "Members can read the people in their family"
  on public.family_members for select to authenticated
  using (public.has_family_access(family_id) and deleted_at is null);

-- No INSERT or UPDATE policy: add_family_member and update_family_member are
-- the only writers. No DELETE policy either — removing a person is a Phase 2
-- follow-up, and hard deletion is not the intended mechanism.

grant select on public.family_members to authenticated;
revoke all on public.family_members from anon;

revoke all on function public.has_family_access(uuid)                     from public;
revoke all on function public.can_manage_family(uuid)                     from public;
revoke all on function public.can_manage_members(uuid)                    from public;
revoke all on function public.can_edit_people(uuid)                       from public;
revoke all on function public.add_family_member(uuid, text, date, text)   from public;
revoke all on function public.update_family_member(uuid, text, date, text) from public;

grant execute on function public.has_family_access(uuid)                     to authenticated;
grant execute on function public.can_manage_family(uuid)                     to authenticated;
grant execute on function public.can_manage_members(uuid)                    to authenticated;
grant execute on function public.can_edit_people(uuid)                       to authenticated;
grant execute on function public.add_family_member(uuid, text, date, text)   to authenticated;
grant execute on function public.update_family_member(uuid, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Rewrite the functions that referenced the old table or helpers
-- ---------------------------------------------------------------------------
--
-- Postgres does not track a function's dependency on the tables it names, so
-- none of these would have failed at migration time — they would have failed
-- at runtime, after the rename, on a live app.

create or replace function public.create_invitation(
  target_family uuid,
  invited_role  text default 'member'
)
returns public.family_invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  inviter  uuid := (select auth.uid());
  created  public.family_invitations;
  attempts int  := 0;
begin
  if inviter is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.can_manage_members(target_family) then
    raise exception 'Only an owner can invite' using errcode = '42501';
  end if;
  if invited_role not in ('owner', 'member') then
    raise exception 'Unknown role' using errcode = '22023';
  end if;

  loop
    attempts := attempts + 1;
    begin
      insert into public.family_invitations (family_id, code, role, created_by, expires_at)
      values (
        target_family,
        public.generate_invitation_code(),
        invited_role,
        inviter,
        now() + interval '7 days'
      )
      returning * into created;
      return created;
    exception when unique_violation then
      if attempts >= 5 then raise; end if;
    end;
  end loop;
end;
$$;

-- Creating a family now also creates the creator as a person, not only as an
-- account with access. Without this the family has a member list of one row
-- that is an email address rather than a human being.
create or replace function public.create_family(family_name text)
returns public.families
language plpgsql
security definer
set search_path = ''
as $$
declare
  creator uuid := (select auth.uid());
  created public.families;
  fallback_name text;
begin
  if creator is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  insert into public.families (name, created_by)
  values (trim(family_name), creator)
  returning * into created;

  insert into public.family_users (family_id, user_id, role)
  values (created.id, creator, 'owner');

  -- Best available name until they edit their profile. Nothing else is known
  -- about them at this point.
  select split_part(email, '@', 1) into fallback_name from auth.users where id = creator;

  insert into public.family_members (family_id, user_id, display_name)
  values (created.id, creator, coalesce(nullif(trim(fallback_name), ''), 'Me'));

  return created;
end;
$$;

create or replace function public.redeem_invitation(invitation_code text)
returns public.families
language plpgsql
security definer
set search_path = ''
as $$
declare
  joiner uuid := (select auth.uid());
  invite public.family_invitations;
  family public.families;
  fallback_name text;
begin
  if joiner is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- A product rule, not a data constraint: the schema supports belonging to
  -- several families, but there is no switcher UI, so a second family would be
  -- joined and then invisible. Delete these four lines when switching ships.
  if exists (select 1 from public.family_users where user_id = joiner) then
    raise exception 'Already in a family' using errcode = '42501';
  end if;

  select * into invite
  from public.family_invitations
  where code = upper(trim(invitation_code))
  for update;

  if invite.id is null then
    raise exception 'Invalid code' using errcode = '22023';
  end if;
  if invite.redeemed_at is not null then
    raise exception 'Code already used' using errcode = '22023';
  end if;
  if invite.expires_at <= now() then
    raise exception 'Code expired' using errcode = '22023';
  end if;

  insert into public.family_users (family_id, user_id, role)
  values (invite.family_id, joiner, invite.role);

  -- Rejoining: PR-9b's removal deletes the access row and leaves the person
  -- row linked, so a returning member is matched here rather than duplicated.
  if not exists (
    select 1 from public.family_members
    where family_id = invite.family_id and user_id = joiner
  ) then
    select split_part(email, '@', 1) into fallback_name from auth.users where id = joiner;
    insert into public.family_members (family_id, user_id, display_name)
    values (invite.family_id, joiner, coalesce(nullif(trim(fallback_name), ''), 'Me'));
  end if;

  update public.family_invitations
  set redeemed_by = joiner,
      redeemed_at = now()
  where id = invite.id;

  select * into family from public.families where id = invite.family_id;
  return family;
end;
$$;

-- Now returns people rather than accounts. A family's list should show
-- everyone in it, including the relatives who will never sign in.
drop function public.list_family_members(uuid);

create function public.list_family_members(target_family uuid)
returns table (
  id            uuid,
  user_id       uuid,
  display_name  text,
  date_of_birth date,
  blood_group   text,
  email         text,
  role          text,
  joined_at     timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    person.id,
    person.user_id,
    person.display_name,
    person.date_of_birth,
    person.blood_group,
    account.email::text,
    access.role,
    access.joined_at
  from public.family_members as person
  left join public.family_users as access
    on access.family_id = person.family_id and access.user_id = person.user_id
  left join auth.users as account
    on account.id = person.user_id
  where person.family_id = target_family
    and person.deleted_at is null
    and public.has_family_access(target_family)
  order by person.display_name;
$$;

-- ---------------------------------------------------------------------------
-- 8. Retire the role-named helpers
-- ---------------------------------------------------------------------------
-- Safe now that no policy references them. Any function that did has been
-- rewritten above.

drop function public.is_family_member(uuid);
drop function public.is_family_owner(uuid);
