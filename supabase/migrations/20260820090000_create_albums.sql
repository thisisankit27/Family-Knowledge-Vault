-- Collections of memories, and the last table Phase 4 adds.
--
-- An album is the first thing in this product that groups content **across
-- authors**: a family album holds your photographs and mine. That makes it the
-- first place "whose is this collection" has no obvious answer — and docs/18
-- §13.6 is explicit that the question must not be answered here. An album gets
-- the ordinary spine, `can_see_record` decides who reads it, and its author
-- decides what goes in. **No co-curators, no shared ownership, no
-- collection-level permission of any kind.** That belongs to the Content
-- Ownership & Family Lifecycle review (§13.5), before Phase 5.
--
-- Two tables and no storage. A cover is not a stored reference — see §3.

-- ---------------------------------------------------------------------------
-- 1. albums — the spine, plus a name
-- ---------------------------------------------------------------------------
--
-- Everything down to `unique (id, family_id)` is docs/15 §8.2 verbatim.
--
-- **No `cover_memory_id`.** docs/18 §4.4 originally specified one and it was
-- removed before this file was written, because it leaks: `albums`' SELECT
-- policy says nothing about a cover, so a `family` album whose cover is a
-- `private` memory would hand that memory's id to everyone who can read the
-- album. The reader still cannot open the memory, but learning it exists is the
-- disclosure §6.1 exists to prevent — the same failure one table up. The cover
-- is derived per viewer instead (§3).
--
-- **No `archived_at` and no `ai_processing`.** An album is a way of looking at
-- memories rather than content in its own right: the memories inside carry
-- their own consent, and there is no archive interface to reach. Shipping
-- either would be a column no screen can change, which this project has done
-- five times and is not doing again in the same phase it wrote that down.
--
-- **No `position`.** Ordering is by the memory's own date, the same ordering the
-- memories list uses. A column that needs a reorder UI to mean anything is a
-- column with no interface.

create table public.albums (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families (id) on delete cascade,

  -- Spine fidelity. Carried from creation because docs/15 §8.2 records the
  -- retrofit cost — a migration plus a policy rewrite on every record table —
  -- and because `can_see_record` takes a subject argument whether or not this
  -- table uses it. **It has no control in v1**, exactly as `documents.member_id`
  -- had none between PR-11 and PR-13, and for the same reason: the schema makes
  -- room, the feature waits (docs/16 §6.4).
  member_id  uuid,

  title      text not null check (length(btrim(title)) between 1 and 120),

  -- Defaults to `family`, matching memories rather than documents. An album
  -- exists to be looked at together; one nobody else can open is a folder.
  visibility text not null default 'family'
    check (visibility in ('family', 'private')),

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  foreign key (member_id, family_id)
    references public.family_members (id, family_id) on delete set null,

  unique (id, family_id)
);

create index albums_family_idx
  on public.albums (family_id, created_at desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. album_memories — what is in an album
-- ---------------------------------------------------------------------------
--
-- A memory may sit in several albums; the same memory cannot sit in one album
-- twice. That is the whole of what the primary key says.
--
-- Deleting an album takes its links and **not its memories** — the cascade is
-- on this table, and `memories` is referenced rather than owned. Deleting a
-- memory removes it from every album it was in, which is the same cascade read
-- from the other side.

create table public.album_memories (
  album_id  uuid not null,
  memory_id uuid not null,
  family_id uuid not null references public.families (id) on delete cascade,

  created_at timestamptz not null default now(),

  primary key (album_id, memory_id),

  foreign key (album_id, family_id)
    references public.albums (id, family_id) on delete cascade,
  foreign key (memory_id, family_id)
    references public.memories (id, family_id) on delete cascade
);

create index album_memories_memory_idx
  on public.album_memories (memory_id);

-- ---------------------------------------------------------------------------
-- 3. Row-Level Security
-- ---------------------------------------------------------------------------

alter table public.albums         enable row level security;
alter table public.album_memories enable row level security;

-- Albums resolve exactly as memories do, including the `null` subject: "belongs
-- to" grants nothing, anywhere in this product (docs/18 §3.4).
create policy "Members can read their family's albums"
  on public.albums for select to authenticated
  using (
    public.can_see_record(family_id, visibility, null, created_by)
    and deleted_at is null
  );

create policy "Members can make albums"
  on public.albums for insert to authenticated
  with check (
    public.can_write_records(family_id)
    and created_by = (select auth.uid())
  );

-- Reading widens with `visibility`; writing never does. Somebody an album is
-- shared with may look through it and may not rename it, add to it, remove from
-- it or delete it.
create policy "Authors can edit their own albums"
  on public.albums for update to authenticated
  using (
    created_by = (select auth.uid())
    and deleted_at is null
    and public.can_write_records(family_id)
  )
  with check (
    created_by = (select auth.uid())
    and public.can_write_records(family_id)
  );

create policy "Authors can delete their own albums"
  on public.albums for delete to authenticated
  using (
    created_by = (select auth.uid())
    and public.can_write_records(family_id)
  );

-- ---------------------------------------------------------------------------
-- 3a. The both-sides rule — the one genuinely new thing in Phase 4
-- ---------------------------------------------------------------------------
--
-- **This policy must check the album AND the memory, and the reason is not
-- symmetry.**
--
-- If it resolved through the album alone, a member reading a `family` album
-- would receive the `memory_id` of every private memory inside it. They could
-- not open those memories — the memories policy still refuses — but they would
-- learn that a private memory exists, and its id. docs/18 §6.1 names that
-- disclosure, and 20260810090000 §5 named the shape: *the row hidden, the things
-- hanging off it not.*
--
-- So a link is visible only to somebody who can see both ends of it. An album
-- containing memories you may not read simply appears to contain fewer
-- memories, which is the correct answer and reveals nothing — including by
-- arithmetic, because counts are computed from this join rather than stored.

create policy "Members can read links where they can see both ends"
  on public.album_memories for select to authenticated
  using (
    exists (
      select 1 from public.albums a
      where a.id = album_id
        and a.family_id = album_memories.family_id
        and public.can_see_record(a.family_id, a.visibility, null, a.created_by)
        and a.deleted_at is null
    )
    and exists (
      select 1 from public.memories m
      where m.id = memory_id
        and m.family_id = album_memories.family_id
        and public.can_see_record(m.family_id, m.visibility, null, m.created_by)
        and m.deleted_at is null
    )
  );

-- Adding requires **authoring the album** and **being able to see the memory** —
-- not authoring the memory.
--
-- That asymmetry is deliberate and is what makes a family album possible.
-- Curating somebody else's family memory into your album is an act on the
-- album, not on the memory: it changes nothing about the memory and widens
-- nobody's access to it, because every reader still resolves it through the
-- memory's own policy. Requiring authorship of the memory would mean a family
-- album could only ever hold one person's photographs.
--
-- The `can_see_record` conjunct is not decoration. Without it an author could
-- add a memory id they guessed, and the link's *absence* from another member's
-- view would then depend on the SELECT policy alone rather than on two
-- independent expressions agreeing.
create policy "Authors can add memories they can see to their own albums"
  on public.album_memories for insert to authenticated
  with check (
    public.can_write_records(family_id)
    and exists (
      select 1 from public.albums a
      where a.id = album_id
        and a.family_id = album_memories.family_id
        and a.created_by = (select auth.uid())
        and a.deleted_at is null
    )
    and exists (
      select 1 from public.memories m
      where m.id = memory_id
        and m.family_id = album_memories.family_id
        and public.can_see_record(m.family_id, m.visibility, null, m.created_by)
        and m.deleted_at is null
    )
  );

-- Removing needs only the album. A memory that became private after it was
-- added must still be removable by the album's author, and requiring visibility
-- of the memory here would strand exactly that link.
create policy "Authors can remove memories from their own albums"
  on public.album_memories for delete to authenticated
  using (
    public.can_write_records(family_id)
    and exists (
      select 1 from public.albums a
      where a.id = album_id
        and a.family_id = album_memories.family_id
        and a.created_by = (select auth.uid())
        and a.deleted_at is null
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Triggers
-- ---------------------------------------------------------------------------

create trigger albums_touch_updated_at
  before update on public.albums
  for each row execute function public.touch_updated_at();

-- Authorship is what every write policy above keys on, so it must not be
-- rewritable by the row's own UPDATE policy.
create trigger albums_pin_created_by
  before update on public.albums
  for each row execute function public.pin_created_by();

-- ---------------------------------------------------------------------------
-- 5. Privileges
-- ---------------------------------------------------------------------------
--
-- RLS only narrows what SQL privileges already allow, and a policy can be
-- perfectly correct and still return 42501.
--
-- `album_memories` gets no UPDATE: a link has nothing to change. Moving a memory
-- between albums is a delete and an insert, both of which say what they mean.

grant select, insert, update, delete on public.albums         to authenticated;
grant select, insert, delete         on public.album_memories to authenticated;

revoke all on public.albums         from anon;
revoke all on public.album_memories from anon;
