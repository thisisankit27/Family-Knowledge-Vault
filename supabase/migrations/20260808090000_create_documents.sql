-- The first records the family actually keeps.
--
-- Phase 2 built the people and the permissions; this is the first table those
-- permissions were designed for. PR-9a shipped can_see_record, can_read_records,
-- can_write_records and can_delete_records ahead of any record table precisely
-- so that this migration does **no permission design of its own** — the SELECT
-- policy below is the frozen §8.2 expression, unmodified.
--
-- Three tables, and the split between them is the decision worth understanding
-- (docs/17-storage-architecture-review.md §10):
--
--   documents         the record — what this thing *means* to the family
--   document_files    the bytes — one row per stored object
--   document_members  who else it concerns, for finding it later
--
-- A `storage_path text` column on `documents` would have been shorter and is
-- the obvious first design. It was rejected for two reasons that both bite
-- later rather than now. It cannot express a document with more than one file
-- (docs/08 §15: "one uploaded file may appear in multiple contexts"), and it
-- bakes one provider's addressing scheme into the record itself. Splitting a
-- column into a table after a thousand files exist is a data migration plus a
-- rewrite of every query; doing it while both tables are empty costs nothing.
--
-- No bucket and no storage.objects policies here. Those arrive in PR-14 with
-- the upload flow that gives them a caller — this project has three times
-- shipped a capability reachable only by its tests, and an empty bucket
-- governed by untested policies would be the fourth.

-- ---------------------------------------------------------------------------
-- 1. documents — the record spine, plus two columns
-- ---------------------------------------------------------------------------
--
-- Everything down to `unique (id, family_id)` is docs/15 §8.2 verbatim. Read
-- the two additions below as the whole of this table's design.

create table public.documents (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families (id) on delete cascade,

  -- The person it is *about*, and — via can_see_record — the only thing that
  -- grants a private document to somebody other than its author. Nullable
  -- because a deed or an insurance policy belongs to the household, not a
  -- person.
  member_id  uuid,

  title      text not null check (length(btrim(title)) between 1 and 120),

  visibility text not null default 'family'
    check (visibility in ('family', 'private')),

  -- Archive is not soft delete (docs/16 §6.3). FR-014 lists Archive as an
  -- action, the information architecture lists "Archived" as a peer of the six
  -- categories, and docs/08 §20 wants both in one lifecycle. Two nullable
  -- timestamps give all three: archived rows stay visible to the policy and are
  -- filtered by the caller, deleted rows are filtered by the policy itself.
  -- Collapsing them into one column would make "archive" and "delete" the same
  -- irreversible act, which is exactly what a family filing cabinet must not do.
  archived_at timestamptz,

  -- Consent to let AI read this document, recorded at creation rather than in
  -- Phase 9 (docs/17 §6).
  --
  -- It ships now for one reason: adding it later means a backfill choosing a
  -- value on behalf of every existing row, and this project has already been
  -- bitten by exactly that (PR-7 shipped a table with no backfill and every
  -- pre-existing family lost its member list). There is no defensible default
  -- to backfill *consent* with. Asking at upload is the only honest moment.
  --
  -- 'denied' is the default deliberately. Consent that was never given is not
  -- consent, and Phase 9 must not be able to read a document filed in Phase 3
  -- by a user who was never asked.
  ai_processing text not null default 'denied'
    check (ai_processing in ('allowed', 'denied')),

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  -- Tenant-scoped composite key, the same proof PR-8 used for relationships: a
  -- document about another family's person cannot be represented, so no policy
  -- has to check for it.
  foreign key (member_id, family_id)
    references public.family_members (id, family_id) on delete set null,

  unique (id, family_id)
);

-- The list screen's only query: this family's live documents, newest first.
create index documents_family_idx
  on public.documents (family_id, created_at desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. document_files — the bytes, addressed by provider
-- ---------------------------------------------------------------------------
--
-- Empty until PR-14. It exists now because its *shape* is the expensive part,
-- not its contents.
--
-- `provider` carries a check constraint with a single value. That is not
-- decoration: it makes adding a second provider a deliberate migration rather
-- than an accidental insert, and it documents at the schema level that the
-- storage backend is a variable. Bring-your-own-storage was reviewed and
-- declined for Phase 3 (docs/17), so 'supabase' may well be the only value
-- this column ever holds — the constraint costs one line either way.

create table public.document_files (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references public.families (id) on delete cascade,
  document_id uuid not null,

  provider text not null default 'supabase'
    check (provider in ('supabase')),

  -- Named for what it is — an opaque identifier the provider assigned — and
  -- deliberately **not** `storage_path`. The name is what teaches the next
  -- service whether it may parse this value or must treat it as a token. A
  -- column called `storage_path` invites string manipulation in the client,
  -- and by the time that is wrong it is in an app bundle on a user's phone.
  provider_file_id text not null,

  -- 'original' today; 'thumbnail' is the reserved slot (docs/16 §3.2).
  -- Thumbnails are deferred because Supabase's image transformation is a paid
  -- feature, but reserving the value now means adding them later inserts rows
  -- rather than migrating every existing one.
  kind text not null default 'original'
    check (kind in ('original', 'thumbnail')),

  version integer not null default 1 check (version >= 1),

  -- Recorded at upload, never read back from storage.objects. That table
  -- belongs to Supabase; depending on it for size and type would put a second
  -- provider's absence on the critical path of every list query.
  mime_type         text not null,
  size_bytes        bigint not null check (size_bytes > 0),
  checksum          text,
  -- Kept for display only. It is never part of an address — see docs/15 §9.1
  -- as amended: the stored name is a uuid, so a user-supplied filename can
  -- never become a path segment, and the sanitisation question disappears
  -- instead of being answered.
  original_filename text,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),

  foreign key (document_id, family_id)
    references public.documents (id, family_id) on delete cascade,

  -- One row per document per kind per version.
  unique (document_id, kind, version)
);

create index document_files_document_idx
  on public.document_files (document_id);

-- ---------------------------------------------------------------------------
-- 3. document_members — additional subjects, and NOT a permission
-- ---------------------------------------------------------------------------
--
-- **Read this before using this table for anything.**
--
-- docs/08 §7 says a document may relate to multiple members. The spine gives
-- one `member_id`. Both survive because they answer different questions:
--
--   documents.member_id  the *subject* — the one thing can_see_record consults
--   document_members     further links, for filtering and navigation only
--
-- A link here grants nothing. If it did, any member could insert a row naming
-- themselves against a private document and read it — a privilege escalation
-- with no interface required, and the third instance of the lesson docs/15 was
-- written to catch: an authorisation rule is rarely a single comparison.
--
-- The INSERT policy below therefore checks can_write_records on the *family*,
-- and the SELECT policy resolves through the parent document. Neither consults
-- this table to decide whether the document is visible.

create table public.document_members (
  document_id uuid not null,
  member_id   uuid not null,
  family_id   uuid not null references public.families (id) on delete cascade,

  created_at timestamptz not null default now(),

  primary key (document_id, member_id),

  foreign key (document_id, family_id)
    references public.documents (id, family_id) on delete cascade,
  foreign key (member_id, family_id)
    references public.family_members (id, family_id) on delete cascade
);

create index document_members_member_idx
  on public.document_members (member_id);

-- ---------------------------------------------------------------------------
-- 4. Row-Level Security
-- ---------------------------------------------------------------------------

alter table public.documents        enable row level security;
alter table public.document_files   enable row level security;
alter table public.document_members enable row level security;

-- The frozen §8.2 policy, with nothing added. Outsiders fail inside
-- has_family_access; Guests fail because 'family' delegates to
-- can_read_records; private resolves to author or subject.
create policy "Members can read their family's documents"
  on public.documents for select to authenticated
  using (
    public.can_see_record(family_id, visibility, member_id, created_by)
    and deleted_at is null
  );

create policy "Members can file documents"
  on public.documents for insert to authenticated
  with check (
    public.can_write_records(family_id)
    and created_by = (select auth.uid())
  );

-- Update is deliberately narrower than insert. can_write_records admits
-- owner, admin and member; a member editing another member's private document
-- would contradict §8.4, so the row must also be one this caller can see.
create policy "Members can edit documents they can see"
  on public.documents for update to authenticated
  using (
    public.can_see_record(family_id, visibility, member_id, created_by)
    and deleted_at is null
    and public.can_write_records(family_id)
  )
  with check (public.can_write_records(family_id));

-- Deleting someone else's record is managerial (owner/admin); deleting your
-- own is not, and that half is the `created_by` clause rather than a role.
create policy "Authors and managers can delete documents"
  on public.documents for delete to authenticated
  using (
    public.can_see_record(family_id, visibility, member_id, created_by)
    and (
      public.can_delete_records(family_id)
      or created_by = (select auth.uid())
    )
  );

-- Files and links resolve through their parent document. This is the one place
-- the "an invisible row does not make its file unreachable" warning from
-- docs/15 §9.1 is answered at the row layer: no document, no file row.
create policy "Members can read files for documents they can see"
  on public.document_files for select to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and d.family_id = document_files.family_id
        and public.can_see_record(d.family_id, d.visibility, d.member_id, d.created_by)
        and d.deleted_at is null
    )
  );

create policy "Members can read document links they can see"
  on public.document_members for select to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and d.family_id = document_members.family_id
        and public.can_see_record(d.family_id, d.visibility, d.member_id, d.created_by)
        and d.deleted_at is null
    )
  );

create policy "Members can link people to documents"
  on public.document_members for insert to authenticated
  with check (
    public.can_write_records(family_id)
    and exists (
      select 1 from public.documents d
      where d.id = document_id
        and d.family_id = document_members.family_id
        and public.can_see_record(d.family_id, d.visibility, d.member_id, d.created_by)
        and d.deleted_at is null
    )
  );

create policy "Members can unlink people from documents"
  on public.document_members for delete to authenticated
  using (
    public.can_write_records(family_id)
    and exists (
      select 1 from public.documents d
      where d.id = document_id
        and d.family_id = document_members.family_id
        and public.can_see_record(d.family_id, d.visibility, d.member_id, d.created_by)
        and d.deleted_at is null
    )
  );

-- document_files has no INSERT policy. PR-14 adds one alongside the upload
-- function that allocates the path, because a client that can insert a file
-- row before the object exists can describe bytes that are not there.

-- ---------------------------------------------------------------------------
-- 5. Triggers
-- ---------------------------------------------------------------------------

create trigger documents_touch_updated_at
  before update on public.documents
  for each row execute function public.touch_updated_at();

-- Same guarantee families got in PR-9a: authorship is what the delete policy
-- and can_see_record both key on, so it must not be rewritable by the row's
-- own UPDATE policy.
create trigger documents_pin_created_by
  before update on public.documents
  for each row execute function public.pin_created_by();

-- ---------------------------------------------------------------------------
-- 6. Privileges
-- ---------------------------------------------------------------------------
--
-- RLS only narrows what SQL privileges already allow, and CLI-created tables
-- inherit nothing (20260801101500). A policy can be perfectly correct and still
-- return 42501.

grant select, insert, update, delete on public.documents        to authenticated;
grant select                        on public.document_files    to authenticated;
grant select, insert, delete        on public.document_members  to authenticated;

revoke all on public.documents        from anon;
revoke all on public.document_files   from anon;
revoke all on public.document_members from anon;
