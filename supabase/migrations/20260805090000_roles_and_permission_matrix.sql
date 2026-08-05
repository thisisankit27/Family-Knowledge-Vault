-- Four roles, the permission matrix, and the record visibility contract.
--
-- Authoritative specification: docs/15-permission-matrix.md. This migration is
-- the implementation of §4 (the matrix), §5 (the helper contract), §6 (two
-- privilege-escalation fixes), §7 (the last-owner guarantee) and §8 (record
-- visibility).
--
-- The headline is "add admin and guest", but widening the role model is the
-- smallest part of it. Two escalation paths are latent in the schema today and
-- go live the moment can_manage_members() includes 'admin', so the fixes must
-- land in this same migration or the widening ships the holes.

-- ---------------------------------------------------------------------------
-- 1. Widen the role vocabulary
-- ---------------------------------------------------------------------------
--
-- Two things about the constraint names.
--
-- `alter table ... rename` does not rename constraints, so family_users still
-- carries the name it was given in 20260801093000 when the table was called
-- family_members. Confirm with:
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.family_users'::regclass and contype = 'c';
--
-- And deliberately no `if exists`: a silent no-op would leave the two-value
-- constraint in place, and the failure would surface as every new role being
-- rejected at runtime, on a device, long after this migration reported success.
-- Failing loudly here is the cheaper outcome.
--
-- No backfill is needed. Both existing values stay legal, which is the whole
-- benefit of widening rather than replacing.

alter table public.family_users
  drop constraint family_members_role_check;

alter table public.family_users
  add constraint family_users_role_check
  check (role in ('owner', 'admin', 'member', 'guest'));

alter table public.family_invitations
  drop constraint family_invitations_role_check;

alter table public.family_invitations
  add constraint family_invitations_role_check
  check (role in ('owner', 'admin', 'member', 'guest'));

-- `text` + `check` rather than a Postgres enum, on purpose: ALTER TYPE ... ADD
-- VALUE cannot be used in the transaction that adds it, removing a value is
-- near-impossible, and an enum's implicit ordering invites the
-- `role >= 'member'` comparison that section 3 below forbids.

-- ---------------------------------------------------------------------------
-- 2. role_rank — for comparing actors, never for granting permission
-- ---------------------------------------------------------------------------
--
-- This exists for exactly two questions: "may I act on this person" and "may I
-- invite at this level". It answers neither "may I do X".
--
--   role_rank(x) >= 1
--
-- is a deny-list wearing a disguise: every role invented in a later phase that
-- happens to rank above 1 inherits the permission silently. Permission checks
-- belong in the helpers below, and every one of them is an allow-list.
--
-- The -1 default means an unrecognised role ranks below everything and fails
-- closed.

create function public.role_rank(role_name text)
returns int
language sql
immutable
set search_path = ''
as $$
  select case role_name
    when 'owner'  then 3
    when 'admin'  then 2
    when 'member' then 1
    when 'guest'  then 0
    else -1
  end;
$$;

comment on function public.role_rank(text) is
  'Compares actors. Never use in a permission check — see docs/15-permission-matrix.md section 5.2.';

-- ---------------------------------------------------------------------------
-- 3. The permission helpers
-- ---------------------------------------------------------------------------
--
-- Every body is an allow-list: `role in (...)`, never `role <> 'guest'`. A
-- deny-list means every role invented in a later phase silently inherits every
-- permission written before it existed, which is the single most likely way
-- this model fails.
--
-- has_family_access is the one deliberate exception and stays role-blind: it
-- answers "are you inside the tenant boundary", and all four roles are.
-- can_manage_family also stays as written in PR-7 — renaming or deleting the
-- family is Owner-only and always was.
--
-- Two helpers with identical bodies are fine. can_write_records and
-- can_edit_people agree today; that costs eight lines. One helper doing two
-- jobs costs a rewrite the day they diverge.

-- Inviting, revoking, removing access. Now includes Admin — this is the
-- widening that makes sections 5 and 6 below mandatory rather than tidy-up.
create or replace function public.can_manage_members(target_family uuid)
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
      and role in ('owner', 'admin')
  );
$$;

-- Editing people and relationships. Excludes Guest, which is the point of
-- having a read-only role at all.
create or replace function public.can_edit_people(target_family uuid)
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
      and role in ('owner', 'admin', 'member')
  );
$$;

-- The three record helpers ship here rather than in Phase 3 so that PR-11 does
-- no permission design at all and cannot inline a role check into a policy.
-- They are testable by direct call before any record table exists.

create function public.can_read_records(target_family uuid)
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
      and role in ('owner', 'admin', 'member')
  );
$$;

create function public.can_write_records(target_family uuid)
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
      and role in ('owner', 'admin', 'member')
  );
$$;

-- Deleting someone else's record is a managerial act. "Delete own record" is
-- not this helper — it is `created_by = auth.uid()` on the record itself.
create function public.can_delete_records(target_family uuid)
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
      and role in ('owner', 'admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. can_see_record — the single visibility resolver
-- ---------------------------------------------------------------------------
--
-- Frozen before Phase 3. Every record table's SELECT policy is exactly:
--
--   using (public.can_see_record(family_id, visibility, member_id, created_by)
--          and deleted_at is null)
--
-- What is frozen is the four arguments and the one call, not the vocabulary.
-- Adding a 'shared' value in Phase 10 is an edit to this one body plus an
-- `alter table` on the check constraints — not a policy rewrite on five record
-- tables. That is the same lesson as the intent-named helpers above, applied a
-- second time.
--
-- 'private' has no role branch. Not Owner, not Admin. See section 8.4 of the
-- matrix for why, and for the designed recovery paths (Emergency Mode in Phase
-- 10, Digital Legacy in Phase 11) that make the strict reading safe.
--
-- The has_family_access gate is an addition to the specification, and it
-- matters: without it, someone removed from a family in PR-9b would keep
-- reading every private record they had authored, because `record_author =
-- auth.uid()` stays true forever. Access to the tenant is a precondition of
-- every branch.

create function public.can_see_record(
  target_family     uuid,
  record_visibility text,
  subject_member    uuid,
  record_author     uuid
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select public.has_family_access(target_family)
    and case record_visibility
      when 'family' then public.can_read_records(target_family)
      when 'private' then
        -- coalesce because a null author yields null, not false, and a policy
        -- treating null as false would hide the fact that this function can
        -- return something other than a boolean to its own tests.
        coalesce(record_author = (select auth.uid()), false)
        or exists (
          select 1 from public.family_members
          where id = subject_member
            and family_id = target_family
            and user_id = (select auth.uid())
        )
      -- An unrecognised value fails closed. This is what makes adding a
      -- vocabulary value safe: until the branch exists, nobody sees the row.
      else false
    end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Hole 1 — an Admin could promote themselves to Owner
-- ---------------------------------------------------------------------------
--
-- 20260801101500 granted `select, update, delete` on the table PR-7 renamed to
-- family_users; grants follow a rename. Both write policies were gated only by
-- can_manage_members(family_id), which pins neither the target row nor the new
-- value. Widen that helper to include 'admin' — as section 3 just did — and
-- both of these succeed from any client:
--
--   update public.family_users set role = 'owner' where user_id = :self;
--   delete from public.family_users where role = 'owner';
--
-- Self-promotion, and decapitation of the family in one statement.
--
-- A tighter policy is expressible but ends as an unreadable expression stating
-- four rules, and it still cannot hold the row lock section 7 requires. So
-- family_users becomes fully write-closed: no INSERT, UPDATE or DELETE policy,
-- and the privileges revoked underneath them. This is the third instance of a
-- rule this project already knows — writes with preconditions belong in a
-- definer function, not a policy (create_family, redeem_invitation).

drop policy "Managers can change roles"  on public.family_users;
drop policy "Managers can remove access" on public.family_users;

revoke update, delete on public.family_users from authenticated;

-- The only writer of family_users.role. PR-9b adds remove_family_access() and
-- leave_family() alongside it, on the same pattern and the same lock.
--
-- Deliberately no rank comparison. The function is already gated on
-- can_manage_family, which is Owner-only, and owners are equal in rank — so a
-- rank check would refuse every owner-to-owner change including self-demotion,
-- making the last-owner assertion below unreachable. What protects the family
-- here is the owner gate plus the count, not a hierarchy.

create function public.set_family_role(
  target_family uuid,
  target_user   uuid,
  new_role      text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor       uuid := (select auth.uid());
  owners_left int;
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- First statement, before any read of family_users. Every path that can
  -- change the owner count serialises on this one row; section 7 explains why
  -- a trigger cannot do this job. redeem_invitation already uses the same
  -- technique on the invitation row.
  perform 1 from public.families where id = target_family for update;
  if not found then
    raise exception 'Not allowed to change roles here' using errcode = '42501';
  end if;

  if not public.can_manage_family(target_family) then
    raise exception 'Not allowed to change roles here' using errcode = '42501';
  end if;

  if public.role_rank(new_role) < 0 then
    raise exception 'Unknown role' using errcode = '22023';
  end if;

  update public.family_users
  set role = new_role
  where family_id = target_family and user_id = target_user;

  if not found then
    raise exception 'That person does not have access to this family'
      using errcode = '22023';
  end if;

  select count(*) into owners_left
  from public.family_users
  where family_id = target_family and role = 'owner';

  if owners_left = 0 then
    raise exception 'A family must always have an owner' using errcode = '23514';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Hole 2 — an Admin could mint an Owner invitation
-- ---------------------------------------------------------------------------
--
-- create_invitation checked *who may invite* and *what role may be invited* as
-- two unrelated conditions. Once Admins may invite, an Admin creates an
-- owner-role code and redeems it on a second account they control: the same
-- escalation through a different door.
--
-- The cap is `role_rank(invited) <= role_rank(inviter)`.
--
-- Not `<`. docs/15-permission-matrix.md stated the cap both ways — "a role
-- below their own" and "Owner may invite any role" — and strictly-below
-- forbids an Owner inviting an Owner, which is the only way a family gets a
-- second owner and is behaviour PR-6 already shipped. `<=` is the condition
-- that actually closes the hole: nobody hands out more than they hold. An
-- Admin inviting an Admin is lateral, not an escalation.

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
  inviter      uuid := (select auth.uid());
  inviter_role text;
  created      public.family_invitations;
  attempts     int  := 0;
begin
  if inviter is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not public.can_manage_members(target_family) then
    raise exception 'Not allowed to invite people to this family' using errcode = '42501';
  end if;
  if public.role_rank(invited_role) < 0 then
    raise exception 'Unknown role' using errcode = '22023';
  end if;

  select role into inviter_role
  from public.family_users
  where family_id = target_family and user_id = inviter;

  if public.role_rank(invited_role) > public.role_rank(inviter_role) then
    raise exception 'Cannot invite someone at a higher role than your own'
      using errcode = '42501';
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

-- ---------------------------------------------------------------------------
-- 7. The last-owner backstop
-- ---------------------------------------------------------------------------
--
-- set_family_role's own count check covers the path through the function. It
-- does not cover the one path that goes through no function at all: deleting an
-- account cascades `family_users.user_id -> auth.users` and can remove the last
-- owner without any application code running.
--
-- Note what this trigger cannot do. Under READ COMMITTED, two owners demoting
-- each other concurrently each read count(*) = 2, because neither sees the
-- other's uncommitted change. A trigger runs inside the same transaction on the
-- same snapshot and is equally blind. Only the `for update` lock in section 5
-- serialises them. This is a backstop, not the guarantee.
--
-- The cascade guard is the detail that makes family deletion still work:
-- `delete from families` cascades to family_users, the trigger fires per row,
-- sees zero owners, and would refuse — breaking deletion of a family entirely.
-- Checking that the family row still exists skips exactly that case.

create function public.enforce_last_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  affected_family uuid;
begin
  -- Branching on TG_OP rather than coalesce(new.family_id, old.family_id):
  -- NEW is unassigned in a DELETE trigger, and reading a field off it is not
  -- reliably a null.
  if tg_op = 'DELETE' then
    affected_family := old.family_id;
  else
    affected_family := new.family_id;
  end if;

  if not exists (select 1 from public.families where id = affected_family) then
    return null;
  end if;

  if not exists (
    select 1 from public.family_users
    where family_id = affected_family and role = 'owner'
  ) then
    -- Same wording as set_family_role. Which of the two fires depends on
    -- statement ordering, and the person holding the phone should not be able
    -- to tell the difference.
    raise exception 'A family must always have an owner' using errcode = '23514';
  end if;

  -- AFTER triggers ignore the return value.
  return null;
end;
$$;

create trigger family_users_last_owner
  after update or delete on public.family_users
  for each row execute function public.enforce_last_owner();

-- ---------------------------------------------------------------------------
-- 8. Pin families.created_by
-- ---------------------------------------------------------------------------
--
-- PR-5 recorded this as deliberately deferred: "created_by is not pinned here;
-- once PR-6 allows a second owner, an owner could rewrite it. Close it then."
-- That moment is now, because this migration is what makes a family routinely
-- have more than one person who can update it.
--
-- A `with check` expression cannot see OLD, so it takes a trigger. Raising
-- rather than silently restoring the old value: a client that tried is either
-- buggy or probing, and both deserve an answer.

create function public.pin_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'created_by cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger families_pin_created_by
  before update on public.families
  for each row execute function public.pin_created_by();

-- ---------------------------------------------------------------------------
-- 9. Privileges
-- ---------------------------------------------------------------------------
--
-- Functions grant EXECUTE to PUBLIC by default, and every one of these is
-- SECURITY DEFINER. The RLS suite is the only thing that catches a missing
-- grant — a policy can be perfectly correct and still return
-- `42501 permission denied`.
--
-- The two trigger functions are not granted: a trigger runs as the table owner
-- regardless of who executes the statement, so nothing needs to call them
-- directly and everything that can is one more surface.

revoke all on function public.role_rank(text)                              from public;
revoke all on function public.can_read_records(uuid)                       from public;
revoke all on function public.can_write_records(uuid)                      from public;
revoke all on function public.can_delete_records(uuid)                     from public;
revoke all on function public.can_see_record(uuid, text, uuid, uuid)       from public;
revoke all on function public.set_family_role(uuid, uuid, text)            from public;
revoke all on function public.enforce_last_owner()                         from public;
revoke all on function public.pin_created_by()                             from public;

grant execute on function public.role_rank(text)                        to authenticated;
grant execute on function public.can_read_records(uuid)                 to authenticated;
grant execute on function public.can_write_records(uuid)                to authenticated;
grant execute on function public.can_delete_records(uuid)               to authenticated;
grant execute on function public.can_see_record(uuid, text, uuid, uuid) to authenticated;
grant execute on function public.set_family_role(uuid, uuid, text)      to authenticated;
