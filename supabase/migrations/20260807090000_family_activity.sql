-- What happened in this family, and who may know about it.
--
-- Phase 2 built five PRs' worth of things worth knowing about — people added,
-- access granted and revoked, roles changed, relationships recorded — and none
-- of it was visible to anybody who was not holding the phone at the time.
--
-- Two design decisions carry this table, and both are about what a row is
-- allowed to contain.
--
-- 1. A row stores *references*, never prose. The sentence is assembled on the
--    device from the current member list. Names therefore never go stale, and —
--    the reason that matters — a row physically cannot hold a record title. From
--    Phase 3 a feed entry reading "Ankit added Therapy notes" would leak a
--    private record through its own title (docs/15-permission-matrix.md §9.5).
--    Storing the title nowhere is a stronger guarantee than remembering not to
--    show it.
--
-- 2. The SELECT policy is a single call to can_see_record. That one expression
--    delivers the whole of matrix §4.5 and §9.5, and this table does no
--    permission design of its own — which is exactly what PR-9a shipped the
--    resolver early for.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
--
-- It takes the parts of the §8.2 record spine that a log needs and no more.
-- No `updated_at` and no `deleted_at`: an event is not a record. It never
-- changes, and editing away the history of who was removed from a family would
-- defeat the point of keeping it.

create table public.family_activity (
  id        uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,

  action text not null check (action in (
    'family_created',
    'person_added',
    'person_updated',
    'access_granted',
    'access_revoked',
    'role_changed',
    'relationship_added',
    'relationship_removed'
  )),

  -- Who did it. Also the value handed to can_see_record as the "author" whose
  -- visibility this row resolves against.
  --
  -- One column rather than two, and the reasoning is worth keeping: only a
  -- private record's author or subject can act on it at all, so the actor is
  -- always one of them. The edge case — a record authored by A, about B, edited
  -- by B — hides the row from A, who could read the record itself. That is
  -- under-disclosure, which is the direction §8.4 already chose: the failure
  -- mode should be data being unreachable, never data leaking.
  actor_user_id uuid references auth.users (id) on delete set null,

  -- The person it is about. Tenant-scoped by the composite key, the same proof
  -- PR-8 used: a row about another family's person cannot be represented.
  subject_member_id uuid,

  -- Inherited from whatever the row describes. Everything Phase 2 records is
  -- 'family'; Phase 3's record triggers copy the record's own value.
  visibility text not null default 'family'
    check (visibility in ('family', 'private')),

  -- The one variable fact some actions carry — {"role": "admin"} — and nothing
  -- else. Never a name, never a title. Rule 1 above applies to this column
  -- most of all, because jsonb is where "just this once" would go.
  detail jsonb,

  created_at timestamptz not null default now(),

  foreign key (subject_member_id, family_id)
    references public.family_members (id, family_id) on delete set null
);

create index family_activity_family_idx
  on public.family_activity (family_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Row-Level Security
-- ---------------------------------------------------------------------------

alter table public.family_activity enable row level security;

-- The whole access model, in one call:
--
--   outsiders  → refused by has_family_access inside the resolver
--   guests     → refused because 'family' delegates to can_read_records, and
--                matrix §4.5 puts the feed at owner/admin/member
--   private    → author or subject only
--
-- If this ever needs a second clause, something has gone wrong upstream.
create policy "Members can read their family's activity"
  on public.family_activity for select to authenticated
  using (public.can_see_record(family_id, visibility, subject_member_id, actor_user_id));

-- No INSERT, UPDATE or DELETE policy, and `select` is the only grant. The
-- triggers below are SECURITY DEFINER, so they write regardless; nothing else
-- can. A log a client could edit is not a log.
grant select on public.family_activity to authenticated;
revoke all on public.family_activity from anon;

-- ---------------------------------------------------------------------------
-- 3. The cascade guard
-- ---------------------------------------------------------------------------
--
-- Read this before adding any trigger to this file.
--
-- `delete from families` cascades to family_users, family_members and
-- family_relationships. Every one of those cascades fires a trigger below,
-- which would try to insert an activity row referencing a families row that is
-- already gone inside the transaction — a foreign-key violation, whose symptom
-- is that families quietly become undeletable.
--
-- This is the third appearance of the same shape. PR-9a's enforce_last_owner
-- needed the identical guard, and PR-7's backfill defect was the same question
-- asked about rows that already existed. The question to ask of any trigger is:
-- *what does this mean for rows on their way out?*
--
-- `log_family_event` is the only writer, so the guard lives in it once.

create function public.log_family_event(
  target_family  uuid,
  event_action   text,
  subject_member uuid default null,
  event_detail   jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_family is null then
    return;
  end if;

  -- The guard. Not an optimisation.
  if not exists (select 1 from public.families where id = target_family) then
    return;
  end if;

  insert into public.family_activity
    (family_id, action, actor_user_id, subject_member_id, detail)
  values
    (target_family, event_action, (select auth.uid()), subject_member, event_detail);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Triggers
-- ---------------------------------------------------------------------------
--
-- `auth.uid()` inside a SECURITY DEFINER function still returns the caller:
-- it reads a JWT claim, not the current role. That is what lets these run under
-- elevated rights and still record who was actually responsible.

-- A family's first event, so the feed reads from the beginning rather than
-- opening with the creator apparently joining their own family.
create function public.log_family_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.log_family_event(new.id, 'family_created');
  return null;
end;
$$;

create trigger families_log_created
  after insert on public.families
  for each row execute function public.log_family_created();

-- People.
--
-- The `user_id is null` condition on insert is load-bearing.
-- `ensure_person_for_access` provisions a person row every time access is
-- granted, so without it every join writes two rows — "Ankit was added" and
-- "Ankit joined". A placeholder relative somebody typed in is a real
-- person_added; a joiner's story belongs to access_granted.
create function public.log_person_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.user_id is null then
      perform public.log_family_event(new.family_id, 'person_added', new.id);
    end if;
    return null;
  end if;

  -- touch_updated_at fires on every update, so an update that changed nothing
  -- a person would notice should not become news.
  if new.display_name is distinct from old.display_name
     or new.date_of_birth is distinct from old.date_of_birth
     or new.blood_group is distinct from old.blood_group
  then
    perform public.log_family_event(new.family_id, 'person_updated', new.id);
  end if;

  return null;
end;
$$;

create trigger family_members_log_event
  after insert or update on public.family_members
  for each row execute function public.log_person_event();

-- Access. The most security-relevant history this table holds, which is why
-- family_users was chosen over the quieter sources.
create function public.log_access_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_family uuid;
  affected_user   uuid;
  person          uuid;
begin
  -- NEW is unassigned in a DELETE trigger; reading a field off it is not
  -- reliably a null. Same reason enforce_last_owner branches on TG_OP.
  if tg_op = 'DELETE' then
    affected_family := old.family_id;
    affected_user   := old.user_id;
  else
    affected_family := new.family_id;
    affected_user   := new.user_id;
  end if;

  select id into person
  from public.family_members
  where family_id = affected_family and user_id = affected_user;

  if tg_op = 'INSERT' then
    perform public.log_family_event(
      affected_family, 'access_granted', person, jsonb_build_object('role', new.role));
  elsif tg_op = 'DELETE' then
    perform public.log_family_event(affected_family, 'access_revoked', person);
  elsif new.role is distinct from old.role then
    perform public.log_family_event(
      affected_family, 'role_changed', person, jsonb_build_object('role', new.role));
  end if;

  return null;
end;
$$;

create trigger family_users_log_event
  after insert or update or delete on public.family_users
  for each row execute function public.log_access_event();

-- Relationships. The subject is the first person named, which is the one whose
-- page the relationship was recorded from.
create function public.log_relationship_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.log_family_event(new.family_id, 'relationship_added', new.from_member);
  else
    perform public.log_family_event(old.family_id, 'relationship_removed', old.from_member);
  end if;
  return null;
end;
$$;

create trigger family_relationships_log_event
  after insert or delete on public.family_relationships
  for each row execute function public.log_relationship_event();

-- ---------------------------------------------------------------------------
-- 5. Privileges
-- ---------------------------------------------------------------------------
--
-- No EXECUTE grants for any of these. A trigger function runs as the table
-- owner regardless of who issued the statement, so nothing needs to call them
-- directly — and log_family_event in particular writes an actor it derives from
-- the session, so a client able to call it could forge history.

revoke all on function public.log_family_event(uuid, text, uuid, jsonb) from public;
revoke all on function public.log_family_created()      from public;
revoke all on function public.log_person_event()        from public;
revoke all on function public.log_access_event()        from public;
revoke all on function public.log_relationship_event()  from public;
