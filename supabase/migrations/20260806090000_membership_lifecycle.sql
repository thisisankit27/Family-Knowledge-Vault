-- Removing someone's access, and leaving a family.
--
-- PR-9a write-closed `family_users` — no INSERT, UPDATE or DELETE policy, and
-- `update`/`delete` revoked from `authenticated` — because a policy can gate
-- *who* writes but cannot pin *which row* or *what value*, and cannot hold the
-- row lock the last-owner guarantee needs. `set_family_role` was its only
-- writer. These are the other two.
--
-- Both follow that function's shape exactly, including taking the family row
-- lock as their first statement. Specification: docs/15-permission-matrix.md
-- §4.2 and §7.
--
-- Deleting a family needs nothing here: the `families` DELETE policy and its
-- grant have worked since PR-5 and are asserted by permissions.rls.test.ts.
-- PR-9b gives that capability an interface, not a migration.

-- ---------------------------------------------------------------------------
-- 1. Removing someone else's access
-- ---------------------------------------------------------------------------
--
-- The authorisation rule is two clauses, not a rank comparison, and getting
-- this wrong is the same trap PR-9a hit with set_family_role.
--
--   role_rank(actor) >  role_rank(target)  blocks an Owner removing a
--                                          co-owner — the exact case removal
--                                          exists for.
--   role_rank(actor) >= role_rank(target)  lets an Admin remove another Admin,
--                                          which the matrix forbids.
--
-- So: an Owner may remove anyone, and an Admin may remove strictly below
-- themselves. What stops an Owner decapitating the family is the last-owner
-- guarantee, not a hierarchy.
--
-- This does not touch `family_members`. The person stays in the family, their
-- relationships stay, and from Phase 3 their records stay. Keeping
-- `family_members.user_id` linked is also what lets `ensure_person_for_access`
-- match a returning member instead of creating a second person for them.

create function public.remove_family_access(
  target_family uuid,
  target_user   uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor       uuid := (select auth.uid());
  actor_role  text;
  victim_role text;
  owners_left int;
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- First statement, before any read of family_users. Every path that can
  -- change the owner count serialises on this one row.
  perform 1 from public.families where id = target_family for update;
  if not found then
    raise exception 'Not allowed to remove people from this family' using errcode = '42501';
  end if;

  -- Leaving is a different operation with different rules — a Guest may leave
  -- but may not remove anyone. Routing self-removal through a manager-gated
  -- function would also let an Admin quietly drop themselves through the wrong
  -- door.
  if target_user = actor then
    raise exception 'Use leave family to remove yourself' using errcode = '22023';
  end if;

  select role into actor_role
  from public.family_users
  where family_id = target_family and user_id = actor;

  select role into victim_role
  from public.family_users
  where family_id = target_family and user_id = target_user;

  if victim_role is null then
    raise exception 'That person does not have access to this family' using errcode = '22023';
  end if;

  if not (
    public.can_manage_family(target_family)
    or (
      public.can_manage_members(target_family)
      and public.role_rank(victim_role) < public.role_rank(actor_role)
    )
  ) then
    -- Same answer whether the caller has no rights at all or merely outranks
    -- nobody: distinguishing them tells an Admin exactly who the owners are.
    raise exception 'Not allowed to remove this person' using errcode = '42501';
  end if;

  -- A backstop, and deliberately kept even though nothing can currently reach
  -- it. Only an owner may remove an owner, so if the target is the last owner
  -- the actor is either that same person — caught by the self-check above — or
  -- somebody who may not remove an owner at all. There is no third case today.
  --
  -- It stays because the reasoning that makes it unreachable lives in two other
  -- clauses, and either of them moving would make this the only thing standing
  -- between a family and no owner. Checked before the delete rather than after
  -- so the message names the operation, which is safe only because the lock
  -- above is already held.
  if victim_role = 'owner' then
    select count(*) into owners_left
    from public.family_users
    where family_id = target_family and role = 'owner';

    if owners_left <= 1 then
      raise exception 'A family must always have an owner' using errcode = '23514';
    end if;
  end if;

  delete from public.family_users
  where family_id = target_family and user_id = target_user;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Leaving a family
-- ---------------------------------------------------------------------------
--
-- Open to all four roles. A Guest can leave; §4.2 of the matrix marks only the
-- Owner's case with a condition.
--
-- The sole owner cannot leave, and that is not a gap — it is the last-owner
-- guarantee seen from the inside. Their two ways out are to make somebody else
-- an owner first, or to delete the family. The message names both, because the
-- screen turns it into buttons.

create function public.leave_family(target_family uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor       uuid := (select auth.uid());
  actor_role  text;
  owners_left int;
begin
  if actor is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  perform 1 from public.families where id = target_family for update;
  if not found then
    raise exception 'You are not in this family' using errcode = '22023';
  end if;

  select role into actor_role
  from public.family_users
  where family_id = target_family and user_id = actor;

  if actor_role is null then
    raise exception 'You are not in this family' using errcode = '22023';
  end if;

  if actor_role = 'owner' then
    select count(*) into owners_left
    from public.family_users
    where family_id = target_family and role = 'owner';

    if owners_left <= 1 then
      raise exception
        'You are the only owner. Make someone else an owner first, or delete the family'
        using errcode = '23514';
    end if;
  end if;

  -- As with removal: the person row survives. Somebody who leaves and is later
  -- re-invited is matched to it rather than duplicated.
  delete from public.family_users
  where family_id = target_family and user_id = actor;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Privileges
-- ---------------------------------------------------------------------------

revoke all on function public.remove_family_access(uuid, uuid) from public;
revoke all on function public.leave_family(uuid)               from public;

grant execute on function public.remove_family_access(uuid, uuid) to authenticated;
grant execute on function public.leave_family(uuid)               to authenticated;
