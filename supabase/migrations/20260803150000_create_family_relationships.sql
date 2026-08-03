-- How the people in a family are connected.
--
-- docs/08-database-design.md §17: "the platform is graph-oriented… instead of
-- storing disconnected records, entities reference one another." This is the
-- first table that connects two people rather than a person to a family, and
-- it is what the Phase 6 tree view will draw and Phase 8 will navigate.
--
-- Three types, not a vocabulary. Grandparent, cousin, aunt and in-law are all
-- derivable from parent/spouse/sibling; enumerating relationship names is a
-- list that grows forever and still misses cases. Derivation ships with the
-- tree view — this PR stores and shows direct relations only.

create table public.family_relationships (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families (id) on delete cascade,
  from_member uuid not null,
  to_member   uuid not null,
  type        text not null check (type in ('parent_of', 'spouse_of', 'sibling_of')),
  created_at  timestamptz not null default now(),

  -- The security boundary of this table. Referencing (id, family_id) rather
  -- than id alone makes a relationship between two different families
  -- structurally impossible, rather than something a policy has to catch.
  foreign key (from_member, family_id)
    references public.family_members (id, family_id) on delete cascade,
  foreign key (to_member, family_id)
    references public.family_members (id, family_id) on delete cascade,

  constraint relationship_not_self check (from_member <> to_member),

  -- parent_of has a direction. spouse_of and sibling_of do not, so they are
  -- stored once with the lower id first — otherwise (A,B) and (B,A) would both
  -- be insertable and "are they married?" would need two lookups.
  constraint relationship_canonical_order
    check (type = 'parent_of' or from_member < to_member),

  constraint relationship_unique unique (from_member, to_member, type)
);

create index family_relationships_from_idx   on public.family_relationships (from_member);
create index family_relationships_to_idx     on public.family_relationships (to_member);
create index family_relationships_family_idx on public.family_relationships (family_id);

-- ---------------------------------------------------------------------------
-- A cannot be B's parent while B is A's parent
-- ---------------------------------------------------------------------------
--
-- Not expressible as a check constraint, which can only see the row being
-- written. Longer cycles (A → B → C → A) are deliberately *not* prevented:
-- detecting them needs a recursive walk on every insert, and a family tree
-- that loops is a data-entry mistake rather than an attack.

create function public.reject_reciprocal_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.type = 'parent_of' and exists (
    select 1 from public.family_relationships
    where type = 'parent_of'
      and from_member = new.to_member
      and to_member = new.from_member
  ) then
    raise exception 'Circular parent relationship' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger family_relationships_reject_reciprocal_parent
  before insert on public.family_relationships
  for each row execute function public.reject_reciprocal_parent();

-- ---------------------------------------------------------------------------
-- Recording a relationship
-- ---------------------------------------------------------------------------
--
-- A function rather than an INSERT policy, and canonical ordering is why.
-- Requiring the *client* to put the lower id first for symmetric types is a
-- rule nobody will remember, and forgetting it would surface as an opaque
-- check-constraint violation rather than "they are already married".
--
-- It also derives family_id from the people involved, so the caller cannot
-- assert which family a relationship belongs to.

create function public.add_family_relationship(
  first_member      uuid,
  second_member     uuid,
  relationship_type text
)
returns public.family_relationships
language plpgsql
security definer
set search_path = ''
as $$
declare
  owning_family uuid;
  other_family  uuid;
  lower_member  uuid;
  higher_member uuid;
  created       public.family_relationships;
begin
  if first_member = second_member then
    raise exception 'A person cannot be related to themselves' using errcode = '22023';
  end if;
  if relationship_type not in ('parent_of', 'spouse_of', 'sibling_of') then
    raise exception 'Unknown relationship type' using errcode = '22023';
  end if;

  select family_id into owning_family
  from public.family_members where id = first_member and deleted_at is null;

  select family_id into other_family
  from public.family_members where id = second_member and deleted_at is null;

  if owning_family is null or other_family is null or owning_family <> other_family then
    raise exception 'Those people are not in the same family' using errcode = '22023';
  end if;

  -- Checked after the family is known, so an outsider naming two people inside
  -- somebody else's family gets a permission answer rather than confirmation
  -- that those people exist together.
  if not public.can_edit_people(owning_family) then
    raise exception 'Not allowed to edit this family' using errcode = '42501';
  end if;

  if relationship_type = 'parent_of' then
    lower_member  := first_member;
    higher_member := second_member;
  else
    lower_member  := least(first_member, second_member);
    higher_member := greatest(first_member, second_member);
  end if;

  insert into public.family_relationships (family_id, from_member, to_member, type)
  values (owning_family, lower_member, higher_member, relationship_type)
  returning * into created;

  return created;

exception
  when unique_violation then
    raise exception 'That relationship already exists' using errcode = '23505';
end;
$$;

-- ---------------------------------------------------------------------------
-- Row-Level Security and privileges
-- ---------------------------------------------------------------------------

alter table public.family_relationships enable row level security;

create policy "Members can read their family's relationships"
  on public.family_relationships for select
  to authenticated
  using (public.has_family_access(family_id));

-- No INSERT or UPDATE policy: add_family_relationship is the only writer.
-- Editing a relationship makes no sense either — the pair and the type are the
-- whole row, so a change is a delete and a re-add.

create policy "Members can remove a relationship"
  on public.family_relationships for delete
  to authenticated
  using (public.can_edit_people(family_id));

-- Policies only narrow what privileges already allow. Tables created by CLI
-- migrations inherit none of Supabase's defaults — see
-- 20260801101500_grant_family_privileges.sql for how that was learned.
grant select, delete on public.family_relationships to authenticated;
revoke all on public.family_relationships from anon;

revoke all on function public.add_family_relationship(uuid, uuid, text) from public;
revoke all on function public.reject_reciprocal_parent()                from public;
grant execute on function public.add_family_relationship(uuid, uuid, text) to authenticated;
