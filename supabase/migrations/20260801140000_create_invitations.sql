-- Invitations — the only way a second person enters a family.
--
-- PR-5 deliberately left family_members with no INSERT policy, so the single
-- SECURITY DEFINER function that creates a family was the only way membership
-- could come into existence. This migration does not open that up. It adds a
-- second function, redeem_invitation(), with its own narrow rules. Membership
-- is still never something a client can simply insert.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.family_invitations (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families (id) on delete cascade,
  -- Unambiguous alphabet: no I, O, 0 or 1, because these get read aloud and
  -- typed by hand. 32 symbols over 8 characters is 40 bits — plenty for a
  -- single-use code that expires in a week.
  code        text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  role        text not null default 'member' check (role in ('owner', 'member')),
  created_by  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  redeemed_by uuid references auth.users (id) on delete set null,
  redeemed_at timestamptz
);

create index family_invitations_family_id_idx on public.family_invitations (family_id);

-- ---------------------------------------------------------------------------
-- Code generation
-- ---------------------------------------------------------------------------
--
-- Built from gen_random_uuid() rather than random(). random() is a seeded PRNG:
-- observing a few codes can reveal the sequence, and an invitation code is a
-- bearer credential for someone's family records. gen_random_uuid() uses the
-- server's strong RNG and is in core Postgres, so this needs no extension.
--
-- 256 is divisible by 32, so the modulo introduces no bias toward early
-- letters of the alphabet.

create function public.generate_invitation_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(
           substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                  1 + (get_byte(source.bytes, position) % 32),
                  1),
           '' order by position
         )
  from (select uuid_send(gen_random_uuid()) as bytes) as source,
       generate_series(0, 7) as position;
$$;

-- ---------------------------------------------------------------------------
-- Creating an invitation
-- ---------------------------------------------------------------------------
--
-- Owner-only. PR-9 (Roles & Permissions) is where the real matrix decides who
-- else may invite; until then the narrower rule is the safer default, because
-- widening a permission later is easy and revoking one is not.

create function public.create_invitation(
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

  if not public.is_family_owner(target_family) then
    -- Deliberately the same message whether the family does not exist or the
    -- caller is not its owner: distinguishing them would confirm the existence
    -- of families the caller cannot see.
    raise exception 'Only an owner can invite' using errcode = '42501';
  end if;

  if invited_role not in ('owner', 'member') then
    raise exception 'Unknown role' using errcode = '22023';
  end if;

  -- Codes are random, so a collision is vanishingly unlikely — but the unique
  -- constraint is what guarantees correctness, and a retry is what stops a
  -- one-in-a-trillion collision surfacing as a failed invite.
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
-- Redeeming an invitation
-- ---------------------------------------------------------------------------
--
-- This runs SECURITY DEFINER because the person redeeming is, by definition,
-- not yet a member — so no SELECT policy could let them read the invitation
-- they are trying to use. The code itself is the credential.

create function public.redeem_invitation(invitation_code text)
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

  -- A product rule, not a data constraint. The schema supports belonging to
  -- several families, but there is no switcher UI yet, so a second family
  -- would be joined and then invisible — which reads as data loss. Delete
  -- these four lines when family switching ships.
  if exists (select 1 from public.family_members where user_id = joiner) then
    raise exception 'Already in a family' using errcode = '42501';
  end if;

  -- FOR UPDATE holds the row for the rest of the transaction, so two people
  -- racing on the same code cannot both pass the redeemed_at check below.
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

  insert into public.family_members (family_id, user_id, role)
  values (invite.family_id, joiner, invite.role);

  update public.family_invitations
  set redeemed_by = joiner,
      redeemed_at = now()
  where id = invite.id;

  select * into family from public.families where id = invite.family_id;
  return family;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reading the member list
-- ---------------------------------------------------------------------------
--
-- auth.users is not readable by client roles, and rightly so — but a member
-- list showing bare UUIDs is useless. This exposes exactly the addresses of
-- people who share a family with the caller, and nothing else.
--
-- The is_family_member guard inside the query is the whole security of this
-- function. Without it, SECURITY DEFINER would let any signed-in user dump the
-- email address of every member of any family whose id they could guess.

create function public.list_family_members(target_family uuid)
returns table (user_id uuid, email text, role text, joined_at timestamptz)
language sql
security definer
stable
set search_path = ''
as $$
  select member.user_id, account.email::text, member.role, member.joined_at
  from public.family_members as member
  join auth.users as account on account.id = member.user_id
  where member.family_id = target_family
    and public.is_family_member(target_family)
  order by member.joined_at;
$$;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

alter table public.family_invitations enable row level security;

-- Any member may see their family's invitations, so the member list can show
-- what is outstanding. The code column is visible to them, which is correct:
-- they are already inside the boundary it protects.
create policy "Members can read their family's invitations"
  on public.family_invitations for select
  to authenticated
  using (public.is_family_member(family_id));

-- No INSERT or UPDATE policy: create_invitation() and redeem_invitation() are
-- the only writers, and both check their own rules.

create policy "Owners can revoke invitations"
  on public.family_invitations for delete
  to authenticated
  using (public.is_family_owner(family_id));

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
--
-- Policies narrow what privileges allow; without these the table is
-- unreachable regardless of the policies above. Tables created by CLI
-- migrations do not inherit Supabase's default grants — see
-- 20260801101500_grant_family_privileges.sql for how that was learned.

grant select, delete on public.family_invitations to authenticated;
revoke all on public.family_invitations from anon;

revoke all on function public.generate_invitation_code()            from public;
revoke all on function public.create_invitation(uuid, text)         from public;
revoke all on function public.redeem_invitation(text)               from public;
revoke all on function public.list_family_members(uuid)             from public;

-- generate_invitation_code stays unavailable to clients: it is an internal
-- detail of create_invitation, which runs as definer and can call it anyway.
grant execute on function public.create_invitation(uuid, text) to authenticated;
grant execute on function public.redeem_invitation(text)       to authenticated;
grant execute on function public.list_family_members(uuid)     to authenticated;
