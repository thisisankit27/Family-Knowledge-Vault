-- Fixes a defect in 20260803090000: families that already existed got no people.
--
-- That migration created `family_members` empty and taught create_family() and
-- redeem_invitation() to insert a person. Both only run for *new* families and
-- *new* joiners, so every family created before the migration ended up with an
-- access row in family_users and nobody in family_members. Its member list was
-- empty, and because the app derived "am I the owner?" from that list, owners
-- silently lost their invite controls.
--
-- Two corrections. Backfill the people who were missed, and stop provisioning
-- from being something a function has to remember to do.

-- ---------------------------------------------------------------------------
-- Provisioning becomes a property of gaining access
-- ---------------------------------------------------------------------------
--
-- It was duplicated in create_family() and redeem_invitation(), which is
-- exactly why the backfill case was missed: the rule lived in the two places
-- that happened to exist at the time. As a trigger on family_users it holds
-- for every path that grants access, including the ones PR-9b adds for
-- ownership transfer.

create function public.ensure_person_for_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fallback_name text;
begin
  if exists (
    select 1 from public.family_members
    where family_id = new.family_id and user_id = new.user_id
  ) then
    -- Rejoining: the person row survives removal, so reuse it rather than
    -- creating a duplicate of the same human being.
    return new;
  end if;

  select split_part(email, '@', 1) into fallback_name
  from auth.users where id = new.user_id;

  insert into public.family_members (family_id, user_id, display_name)
  values (new.family_id, new.user_id, coalesce(nullif(trim(fallback_name), ''), 'Member'));

  return new;
end;
$$;

create trigger family_users_ensure_person
  after insert on public.family_users
  for each row execute function public.ensure_person_for_access();

-- ---------------------------------------------------------------------------
-- Backfill everyone the first migration missed
-- ---------------------------------------------------------------------------
-- Guarded by NOT EXISTS so re-running is harmless.

insert into public.family_members (family_id, user_id, display_name)
select
  access.family_id,
  access.user_id,
  coalesce(nullif(trim(split_part(account.email, '@', 1)), ''), 'Member')
from public.family_users as access
join auth.users as account on account.id = access.user_id
where not exists (
  select 1 from public.family_members as person
  where person.family_id = access.family_id
    and person.user_id = access.user_id
);

-- ---------------------------------------------------------------------------
-- Remove the now-duplicated provisioning from the two functions
-- ---------------------------------------------------------------------------
-- Leaving it in would be harmless — the trigger's guard makes it a no-op — but
-- two copies of a rule is how the rule drifts.

create or replace function public.create_family(family_name text)
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

  -- The trigger on family_users creates the person.
  insert into public.family_users (family_id, user_id, role)
  values (created.id, creator, 'owner');

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

  -- The trigger on family_users creates the person, or reuses the existing one
  -- if this is a returning member.
  insert into public.family_users (family_id, user_id, role)
  values (invite.family_id, joiner, invite.role);

  update public.family_invitations
  set redeemed_by = joiner,
      redeemed_at = now()
  where id = invite.id;

  select * into family from public.families where id = invite.family_id;
  return family;
end;
$$;
