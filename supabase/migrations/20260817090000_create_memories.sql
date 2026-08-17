-- The second record domain, and the first proof that the first one generalised.
--
-- Phase 3 built `documents` and, across five migrations, discovered what a
-- record table actually needs. This migration is the test of whether that was
-- learning or coincidence: it does **no permission design of its own**, adds no
-- helper, and edits no existing function. Every policy below is the shape
-- documents arrived at, written correctly the first time.
--
-- Two tables (docs/18 §4):
--
--   memories         the record — a moment the family wants to keep
--   memory_members   who else it concerns, for finding it later
--
-- No `memory_files` and no bucket. Attachments are PR-18, with the upload flow
-- that gives them a caller. This project has five times shipped a capability
-- reachable only by its tests (docs/16 §6.1), and an empty attachment table
-- governed by untested policies would be the sixth.

-- ---------------------------------------------------------------------------
-- 1. memories — the record spine, plus what makes it a memory
-- ---------------------------------------------------------------------------
--
-- Everything down to `unique (id, family_id)` is docs/15 §8.2 verbatim.

create table public.memories (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families (id) on delete cascade,

  -- The person it is *about*. Nullable, because a holiday belongs to the whole
  -- household and to no one person.
  --
  -- It grants nothing. Every policy in this migration passes `null` in
  -- can_see_record's subject position, exactly as documents have since
  -- 20260810090000 — see §4 below for why this table does not take the branch
  -- that was deliberately left open for it.
  member_id  uuid,

  title      text not null check (length(btrim(title)) between 1 and 120),

  -- Two values, and the default diverges from documents on purpose — see §2.
  visibility text not null default 'family'
    check (visibility in ('family', 'private')),

  -- FR-027 says memories support stories. docs/08 §4 says a story is a field
  -- rather than an entity, which is why there is no `stories` table and no
  -- PR of its own: this column is the feature.
  --
  -- 10,000 characters is roughly two thousand words. The cap exists so a
  -- runaway paste cannot put a megabyte in a list query, not to ration what
  -- somebody has to say about their grandmother.
  story      text check (length(story) <= 10000),

  -- When it happened, which is not when it was written down.
  --
  -- Nullable on purpose. A photograph whose year nobody remembers is still a
  -- memory, and stamping it with today's date to make it sortable would be the
  -- product lying about the one fact it exists to preserve. Unknown dates sort
  -- last and are shown as "Date unknown".
  occurred_on date,

  -- How much of `occurred_on` is real.
  --
  -- Families do not remember days; they remember "summer 1998". Storing
  -- 1998-07-01 and rendering it as "1 July 1998" would invent a precision
  -- nobody claimed. So the date is stored whole and this column says how much
  -- of it to believe:
  --
  --   'day'    1998-07-12  ->  12 July 1998
  --   'month'  1998-07-01  ->  July 1998
  --   'year'   1998-01-01  ->  1998
  --
  -- One column rather than three nullable date parts: it sorts with a plain
  -- index, and it cannot represent a month without a year.
  occurred_precision text not null default 'day'
    check (occurred_precision in ('day', 'month', 'year')),

  -- Where it happened, as the family would say it — "Nani's house", not a
  -- latitude. docs/08 §9 asks for a location, and this is the honest half of
  -- it: free text, no geocoding, no map, no search. Those need a provider and
  -- a screen, and neither is in this phase.
  location   text check (length(btrim(location)) <= 120),

  -- Archive is not soft delete (docs/16 §6.3), and the same two columns give
  -- the same three behaviours here as on documents: archived rows stay visible
  -- to the policy and are filtered by the caller; deleted rows are filtered by
  -- the policy itself.
  archived_at timestamptz,

  -- Consent to let AI read this memory. Ships now, at 'denied', for exactly the
  -- reason it did in PR-11: adding it later means backfilling a value on
  -- somebody's behalf, and there is no defensible default to backfill *consent*
  -- with. It gates nothing until Phase 9.
  --
  -- docs/15 §9.6 as amended: when Phase 9 arrives, withdrawing consent must
  -- **delete** derived artefacts rather than ignore them, and derived content
  -- inherits the author's reach, because `created_by` is the only thing the
  -- private branch consults.
  ai_processing text not null default 'denied'
    check (ai_processing in ('allowed', 'denied')),

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  -- Tenant-scoped composite key: a memory about another family's person cannot
  -- be represented, so no policy has to check for it (PR-8's proof).
  foreign key (member_id, family_id)
    references public.family_members (id, family_id) on delete set null,

  unique (id, family_id)
);

-- ---------------------------------------------------------------------------
-- 2. `visibility` defaults to 'family', and documents default to 'private'
-- ---------------------------------------------------------------------------
--
-- This divergence is a decision, not drift (docs/18 §4.1). Do not "fix" it.
--
-- docs/15 §8.5 froze `family` as the default everywhere in v1 and recorded
-- documents as the documented exception, because a document is the most
-- sensitive thing this product holds — six categories of passports, bank
-- statements and wills, where the unrecoverable failure is sharing wider than
-- the author realised.
--
-- A memory is the opposite. It exists to be shared. A memories tab where every
-- photograph defaults to invisible ships a family album that nobody in the
-- family can see, and the failure mode is not a leak — it is a product that
-- does nothing. §8.5's own sentence, that the column lets each table revisit
-- its default with no change to the model, is this case exactly.
--
-- `private` remains available, means precisely what it says, and the create
-- form offers it as the second of two choices.
--
-- The default is set on the column in §1 rather than altered here, so there is
-- exactly one place in this file that decides it.

-- The list screen's only query: this family's live memories, most recent first
-- by when they happened. Unknown dates sort last, which is what `nulls last`
-- buys and what the screen renders under its own heading.
create index memories_family_idx
  on public.memories (family_id, occurred_on desc nulls last)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 3. memory_members — additional subjects, and NOT a permission
-- ---------------------------------------------------------------------------
--
-- **Read this before using this table for anything.**
--
-- A memory is usually about several people, which is the difference between a
-- memory and a document. The spine gives one `member_id`; both survive because
-- they answer different questions:
--
--   memories.member_id  the *subject* — the one field the record screen shows
--   memory_members      further links, for filtering and navigation only
--
-- A link here grants nothing. If it did, any member could insert a row naming
-- themselves against a private memory and read it — a privilege escalation
-- needing no interface, and the fourth instance of the lesson docs/15 was
-- written to catch.
--
-- Note that on this table the warning is doing *less* work than it did on
-- document_members, because §4 removes the subject branch entirely: neither
-- column grants anything now. The comment stays because the next person to add
-- a join table will read this one first, and the rule is what should be copied.

create table public.memory_members (
  memory_id uuid not null,
  member_id uuid not null,
  family_id uuid not null references public.families (id) on delete cascade,

  created_at timestamptz not null default now(),

  primary key (memory_id, member_id),

  foreign key (memory_id, family_id)
    references public.memories (id, family_id) on delete cascade,
  foreign key (member_id, family_id)
    references public.family_members (id, family_id) on delete cascade
);

create index memory_members_member_idx
  on public.memory_members (member_id);

-- ---------------------------------------------------------------------------
-- 4. Row-Level Security
-- ---------------------------------------------------------------------------
--
-- Documents reached these shapes across two migrations: 20260808090000 wrote
-- the frozen §8.2 policy with `member_id` in the subject position, and
-- 20260810090000 replaced all six after a privilege escalation found on a
-- device. Memories start at the end of that road.
--
-- **Why `null` and not `member_id`.** 20260810090000 left the subject branch
-- alive in can_see_record and said Phase 4-6 tables could take it. docs/18 §3.4
-- declined, and the reasoning is worth having next to the policies it produced:
--
--   * "Who is this record about" and "who may read this record" are different
--     questions, and a column answering both is a privilege escalation waiting
--     to be noticed. That is what PR-13 paid for.
--   * Taking the branch here would mean *belongs to* grants read on memories
--     and not on documents. One rule beats two, and the rule is: a label grants
--     nothing, anywhere in this product.
--   * It costs almost nothing, because this table defaults to 'family'. The
--     private branch is the rare case here, not the common one.
--
-- can_see_record is unchanged by this migration. The subject branch stays live
-- inside it for a future table with a real reason to want it.

alter table public.memories       enable row level security;
alter table public.memory_members enable row level security;

create policy "Members can read their family's memories"
  on public.memories for select to authenticated
  using (
    public.can_see_record(family_id, visibility, null, created_by)
    and deleted_at is null
  );

create policy "Members can keep memories"
  on public.memories for insert to authenticated
  with check (
    public.can_write_records(family_id)
    and created_by = (select auth.uid())
  );

-- Reading widens with `visibility`; writing never does (docs/15 §8.4, amended
-- 2026-08-13). A memory shared with the family may be opened by anyone in it
-- and edited by nobody but its author.
--
-- `can_write_records` is kept alongside the authorship test rather than made
-- redundant by it: it is what excludes an author whose role was reduced to
-- Guest after they wrote the memory.
create policy "Authors can edit their own memories"
  on public.memories for update to authenticated
  using (
    created_by = (select auth.uid())
    and deleted_at is null
    and public.can_write_records(family_id)
  )
  with check (
    created_by = (select auth.uid())
    and public.can_write_records(family_id)
  );

-- No `can_delete_records` branch, for the reason 20260810090000 §4 gives: an
-- owner cannot see another member's private memory, so the managerial branch
-- would be unreachable for exactly the rows it appears to cover. A clause that
-- reads as though it works is worse than its absence.
create policy "Authors can delete their own memories"
  on public.memories for delete to authenticated
  using (
    created_by = (select auth.uid())
    and public.can_write_records(family_id)
  );

-- Links resolve through the parent memory, and must agree with it. Missing this
-- would leave a named subject able to reach a private memory's links — the row
-- hidden, the things hanging off it not (20260810090000 §5).
--
-- Reading a link follows the memory's own visibility, so a family memory's
-- people are visible to the family. Writing one requires authorship, matching
-- the rule above.

create policy "Members can read links for memories they can see"
  on public.memory_members for select to authenticated
  using (
    exists (
      select 1 from public.memories m
      where m.id = memory_id
        and m.family_id = memory_members.family_id
        and public.can_see_record(m.family_id, m.visibility, null, m.created_by)
        and m.deleted_at is null
    )
  );

create policy "Authors can link people to their own memories"
  on public.memory_members for insert to authenticated
  with check (
    public.can_write_records(family_id)
    and exists (
      select 1 from public.memories m
      where m.id = memory_id
        and m.family_id = memory_members.family_id
        and m.created_by = (select auth.uid())
        and m.deleted_at is null
    )
  );

create policy "Authors can unlink people from their own memories"
  on public.memory_members for delete to authenticated
  using (
    public.can_write_records(family_id)
    and exists (
      select 1 from public.memories m
      where m.id = memory_id
        and m.family_id = memory_members.family_id
        and m.created_by = (select auth.uid())
        and m.deleted_at is null
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Triggers
-- ---------------------------------------------------------------------------

create trigger memories_touch_updated_at
  before update on public.memories
  for each row execute function public.touch_updated_at();

-- Authorship is what every policy above keys on, so it must not be rewritable
-- by the row's own UPDATE policy.
create trigger memories_pin_created_by
  before update on public.memories
  for each row execute function public.pin_created_by();

-- ---------------------------------------------------------------------------
-- 6. Privileges
-- ---------------------------------------------------------------------------
--
-- RLS only narrows what SQL privileges already allow, and CLI-created tables
-- inherit nothing (20260801101500). A policy can be perfectly correct and still
-- return 42501.

grant select, insert, update, delete on public.memories       to authenticated;
grant select, insert, delete         on public.memory_members to authenticated;

revoke all on public.memories       from anon;
revoke all on public.memory_members from anon;
