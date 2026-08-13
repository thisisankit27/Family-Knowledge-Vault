-- Sharing: a document can reach the whole household, and only if its author says so.
--
-- 20260810090000 made every document author-only to close a privilege
-- escalation, and left `visibility` with no way to change it. That was the right
-- repair and it left the module unusable as a *family* vault: nothing reached
-- anybody but the person who filed it. This is the migration that gives the
-- column a caller.
--
-- **Almost nothing changes, and that is the point.** `can_see_record` has had a
-- 'family' branch since PR-9a (20260805090000 §4) waiting for something to set
-- the column:
--
--   when 'family' then public.can_read_records(target_family)
--
-- and every documents SELECT policy already calls the resolver. So the row, its
-- file rows and its people links all become readable by the household the moment
-- an author writes 'family' — with no policy edit, no resolver edit, and no
-- change to the 58 assertions in permissions.rls.test.ts. docs/15 §8.1 froze
-- "the columns every record table carries and the one function every record
-- policy calls" precisely so that this PR would be small. It is.
--
-- ---------------------------------------------------------------------------
-- What deliberately does NOT change
-- ---------------------------------------------------------------------------
--
--   * **Write stays author-only.** UPDATE and DELETE on `documents` gate on
--     `created_by = (select auth.uid())`, and `documents_pin_created_by` has
--     made authorship immutable since PR-11. Reading widens; writing does not.
--     That asymmetry is the whole safety property of this migration, and it is
--     structural rather than remembered — there is no policy here that could
--     have been written too loosely, because there is no policy here.
--
--     This is the direct answer to §8.4: the hole was an UPDATE policy that
--     inherited a *read* predicate, so seeing implied editing. Sharing arrives
--     through the read path alone and cannot repeat it.
--
--   * **The subject position stays `null`.** Every documents policy passes null
--     where `can_see_record` expects a subject, so the §8.3 subject branch stays
--     dead. Naming somebody in "Belongs to" still grants them nothing. "Whose
--     passport is this" and "who may open this" are different questions, and the
--     answer to the second is now a control of its own rather than a side effect
--     of the first.
--
--   * **`visibility` keeps two values and its 'private' default.** No 'shared'
--     value, no shares table. Per-record ACLs stay where docs/15 §10 puts them
--     (Phase 10), because no requirement yet needs "just Mum and Dad" and §8.1
--     makes adding it one function body whenever one does.
--
-- ---------------------------------------------------------------------------
-- What does this mean for rows that already exist?
-- ---------------------------------------------------------------------------
--
-- Nothing. `visibility` is already `not null` and every existing row holds
-- 'private'; the default stays 'private'; **this migration does not change a
-- single row's visibility.** It is worth stating rather than leaving a reader to
-- check, because 20260810090000 wrote the rule it is honouring: a privacy
-- migration must never broaden access silently. Broadening is now something a
-- person does, on one document, in the UI.
--
-- (The question itself is standing procedure here — PR-7 shipped a defect by not
-- asking it, and PR-9a, PR-10 and PR-14a each paid for the mirror-image version,
-- "what does this mean for rows on their way out?")

-- ---------------------------------------------------------------------------
-- 1. The one thing that was actually broken: reaching the bytes
-- ---------------------------------------------------------------------------
--
-- `storage.objects` has its own policy system, and docs/15 §9.1 states the trap
-- in its own words: **"an invisible row does not make its file unreachable."**
--
-- 20260811090000 fixed that direction. It is the reverse direction that is now
-- wrong: `public.owns_document_object(name)` pins `created_by = auth.uid()`, and
-- **all three** storage policies use it. Share a document and the recipient
-- reads the row, sees the attachment listed, taps it — and gets nothing. A
-- visible row whose file is unreachable.
--
-- Widening `owns_document_object` would be the obvious one-line fix and it is
-- wrong: that function also guards INSERT and DELETE, so widening it would let
-- any reader upload into, and delete from, somebody else's document.
--
-- One predicate cannot serve both, because reading and writing no longer have
-- the same answer. So it becomes two, named for what each decides.

create function public.can_read_document_object(object_name text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.documents d
    where d.id = nullif((storage.foldername(object_name))[2], '')::uuid
      and d.family_id = nullif((storage.foldername(object_name))[1], '')::uuid
      -- The same resolver the row itself goes through, with the same null in
      -- the subject position. Authorisation is *inherited* here, not restated:
      -- if these two ever disagreed about who may read a document, the bytes
      -- would be the copy that leaked, and nothing would fail a test.
      and public.can_see_record(d.family_id, d.visibility, null, d.created_by)
      and d.deleted_at is null
  );
$$;

comment on function public.can_read_document_object(text) is
  'May the caller read the bytes of this object? Mirrors the documents SELECT '
  'policy through can_see_record, so a shared document''s file follows its row. '
  'Read only — writing to an object stays with owns_document_object.';

-- Segment 1 is still the tenant and is still checked, exactly as docs/15 §9.1
-- requires. A SECURITY DEFINER helper rather than the join inline, for the
-- reason 20260811090000 gave: joins inside policy bodies are where storage RLS
-- goes slow.

-- ---------------------------------------------------------------------------
-- 2. Reading follows the row. Writing stays with the author.
-- ---------------------------------------------------------------------------
--
-- Only the SELECT policy moves. This policy governs downloading, listing a
-- prefix, and `createSignedUrl` — which is why nothing in the service layer has
-- to learn about sharing: a signed URL is minted *through* this policy, so it
-- inherits the answer instead of re-deciding it. PR-14b built it that way on
-- purpose ("authorisation is inherited, not re-implemented"), and this is the
-- migration that collects on it.

drop policy "Authors can read their own document objects" on storage.objects;

create policy "Readers can read document objects they can see"
  on storage.objects for select to authenticated
  using (bucket_id = 'family-files' and public.can_read_document_object(name));

-- INSERT and DELETE are untouched and keep `owns_document_object`. Somebody a
-- document was shared *with* may open it and may not change it — no uploading a
-- page into it, no removing one. The `document_files` DELETE policy from
-- 20260811090000 §5b agrees independently, gating on `d.created_by`, so the row
-- and the object cannot drift apart on this point.

-- ---------------------------------------------------------------------------
-- 3. Privileges
-- ---------------------------------------------------------------------------
--
-- Functions grant EXECUTE to PUBLIC by default and this one is SECURITY
-- DEFINER. A policy can be perfectly correct and still return 42501; only the
-- RLS suite catches the missing half.

revoke all on function public.can_read_document_object(text) from public;
grant execute on function public.can_read_document_object(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The invariant this leaves behind
-- ---------------------------------------------------------------------------
--
-- Four SELECT predicates now answer "who may read this document" and all four
-- resolve through `can_see_record(family_id, visibility, null, created_by)`:
--
--   documents            — the row
--   document_files       — the attachment metadata
--   document_members     — the people links
--   storage.objects      — the bytes
--
-- 20260810090000 §5 already named the failure mode when they disagree: "the row
-- hidden, the things hanging off it not." It now runs in both directions, so
-- there is an RLS test asserting all four move together when an author changes
-- their mind — not four tests that happen to agree today.
