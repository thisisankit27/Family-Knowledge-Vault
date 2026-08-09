-- A document belongs to whoever filed it, and to nobody else.
--
-- **This migration closes a privilege-escalation hole introduced in PR-11.**
--
-- The UPDATE policy shipped as:
--
--   using (can_see_record(family_id, visibility, member_id, created_by)
--          and deleted_at is null
--          and can_write_records(family_id))
--
-- Seeing implied editing. can_see_record grants a private record to its author
-- *or its subject* (docs/15 §8.3), so naming somebody in the subject field
-- handed them full write access to a document they did not file. They could
-- rename it, re-file it, reassign it, and — the worst of it — set `visibility`
-- back to 'family', publishing the author's private document to the whole
-- household. The policy's own comment called it "deliberately narrower than
-- insert". It was not.
--
-- The fix is not a narrower policy but a corrected model:
--
--   * Every document is private. Only its author may read, write or delete it.
--   * `created_by` is the owner, and it already cannot be transferred —
--     documents_pin_created_by has been on this table since PR-11.
--   * `member_id` stops meaning anything to permissions. It becomes a label:
--     whose passport this is. The conflation of "who it is about" with "who may
--     read it" is what produced the hole, and separating them is the repair.
--   * Sharing is PR-15's job, and gets designed rather than falling out of a
--     subject column.
--
-- The mechanism below is one argument, not a rewrite: every policy passes
-- **null** where the resolver expects a subject. With `subject_member = null`
-- the resolver's `exists (… where id = subject_member …)` cannot match, so the
-- subject branch is dead and only the author branch can grant. can_see_record
-- itself is untouched — docs/15 §8.3 froze it, Phase 4-6 record tables still
-- want the subject branch, and PR-15 restores it here by passing member_id
-- again.

-- ---------------------------------------------------------------------------
-- 1. Private by default
-- ---------------------------------------------------------------------------

alter table public.documents
  alter column visibility set default 'private';

-- The 'family' value stays in the check constraint. Nothing in the UI can set
-- it any more, so no document becomes family-visible before sharing has been
-- designed — but the vocabulary survives so PR-15 has somewhere to go rather
-- than needing a constraint change on top of everything else.

-- Existing rows were created under the old default.
--
-- Safe for the same reason PR-12's delete was, and checked the same way rather
-- than assumed: on 2026-08-09 `supabase migration list --linked` reported both
-- 20260808090000 and 20260809090000 as NOT PUSHED, so the documents table does
-- not exist in production and the only rows anywhere are demo records in the
-- local stack. **Do not copy this pattern into a migration that runs against
-- real data** — there it would be a silent, unannounced privacy change, which
-- is the one direction a privacy migration must never move without telling
-- somebody.

update public.documents
  set visibility = 'private'
  where visibility = 'family';

-- ---------------------------------------------------------------------------
-- 2. Reading
-- ---------------------------------------------------------------------------

drop policy "Members can read their family's documents" on public.documents;

create policy "Authors can read their own documents"
  on public.documents for select to authenticated
  using (
    public.can_see_record(family_id, visibility, null, created_by)
    and deleted_at is null
  );

-- ---------------------------------------------------------------------------
-- 3. Writing
-- ---------------------------------------------------------------------------

drop policy "Members can edit documents they can see" on public.documents;

-- `can_write_records` is kept alongside the authorship test rather than being
-- made redundant by it. It is what excludes a Guest, and a Guest whose role was
-- reduced *after* filing something would otherwise keep write access to it.
create policy "Authors can edit their own documents"
  on public.documents for update to authenticated
  using (
    created_by = (select auth.uid())
    and deleted_at is null
    and public.can_write_records(family_id)
  )
  with check (
    created_by = (select auth.uid())
    and public.can_write_records(family_id)
  );

-- ---------------------------------------------------------------------------
-- 4. Deleting
-- ---------------------------------------------------------------------------

drop policy "Authors and managers can delete documents" on public.documents;

-- `can_delete_records` drops out, and this is not the capability regression it
-- looks like: an owner can no longer *see* another member's document, so the
-- managerial branch was already unreachable. Leaving a clause in place that
-- reads as though it works would be the worse outcome.
--
-- An owner is not without recourse. Deleting the family still cascades, and
-- that act is visible in a way a silent single-row delete is not.
create policy "Authors can delete their own documents"
  on public.documents for delete to authenticated
  using (
    created_by = (select auth.uid())
    and public.can_write_records(family_id)
  );

-- ---------------------------------------------------------------------------
-- 5. The child tables resolve through the parent, and must agree
-- ---------------------------------------------------------------------------
--
-- Both pass null in the subject position for the same reason as §2. Missing
-- either one would leave a named subject able to reach a private document's
-- files or its links — the row hidden, the things hanging off it not.

drop policy "Members can read files for documents they can see" on public.document_files;

create policy "Authors can read files for their own documents"
  on public.document_files for select to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and d.family_id = document_files.family_id
        and public.can_see_record(d.family_id, d.visibility, null, d.created_by)
        and d.deleted_at is null
    )
  );

drop policy "Members can read document links they can see" on public.document_members;
drop policy "Members can link people to documents" on public.document_members;
drop policy "Members can unlink people from documents" on public.document_members;

create policy "Authors can read links for their own documents"
  on public.document_members for select to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and d.family_id = document_members.family_id
        and public.can_see_record(d.family_id, d.visibility, null, d.created_by)
        and d.deleted_at is null
    )
  );

create policy "Authors can link people to their own documents"
  on public.document_members for insert to authenticated
  with check (
    public.can_write_records(family_id)
    and exists (
      select 1 from public.documents d
      where d.id = document_id
        and d.family_id = document_members.family_id
        and d.created_by = (select auth.uid())
        and d.deleted_at is null
    )
  );

create policy "Authors can unlink people from their own documents"
  on public.document_members for delete to authenticated
  using (
    public.can_write_records(family_id)
    and exists (
      select 1 from public.documents d
      where d.id = document_id
        and d.family_id = document_members.family_id
        and d.created_by = (select auth.uid())
        and d.deleted_at is null
    )
  );
