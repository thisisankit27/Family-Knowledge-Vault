-- The first bytes this project stores.
--
-- Everything before this migration was the record. This is the file.
--
-- Four things arrive together because none of them is reachable without the
-- others: the bucket, the two functions that are the only writers, the
-- storage.objects policies, and a cleanup trigger. PR-11 deferred all of it
-- here deliberately — "an empty bucket governed by untested policies would be
-- the fourth" capability reachable only by its tests.
--
-- **The storage predicate docs/15 §9.1 froze is not safe any more, and this
-- migration is where that is corrected.** §9.1 specified:
--
--   has_family_access((storage.foldername(name))[1]::uuid)
--
-- Tenant-level and role-blind, written when documents were family-visible by
-- default. After 20260810090000 a document belongs to its author alone, so that
-- predicate would let any family member fetch the bytes of a row they cannot
-- read — precisely the failure §9.1 itself names: "an invisible row does not
-- make its file unreachable." Confidentiality would then rest entirely on never
-- minting a URL, which is a promise kept by code where a policy is available.
--
-- §9.1 pins segment 1 as unchanged. It does not forbid adding to the
-- expression, and this adds an author conjunct on segment 2.

-- ---------------------------------------------------------------------------
-- 1. The bucket
-- ---------------------------------------------------------------------------
--
-- In a migration rather than config.toml: a [storage.buckets.*] block
-- provisions the local stack only, and the divergence would surface as a failed
-- upload after deploy (docs/16 §3.2).
--
-- The 10MB cap lives here as well as in the client. config.toml's global
-- file_size_limit is 50MiB and is only a ceiling; this row is the real limit,
-- because a cap enforced only in an app bundle is a cap until somebody points
-- curl at the endpoint.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'family-files',
  'family-files',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/webp',
    'application/pdf'
  ]
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. One attachment is one row
-- ---------------------------------------------------------------------------
--
-- PR-11 shipped `unique (document_id, kind, version)`, which reads sensibly and
-- is wrong for what a document turns out to be. A passport is one document with
-- two pages; under that constraint the second page has to claim version 2,
-- which says the front of the passport was *superseded by* the back.
--
-- `version` was for replacing a file, and that is still what it means. It stays
-- at 1, unreached by any interface, until something replaces a file. What
-- replaces the constraint is the honest invariant: the same object cannot be
-- attached to the same document twice.

alter table public.document_files
  drop constraint document_files_document_id_kind_version_key;

alter table public.document_files
  add constraint document_files_unique_object
  unique (document_id, provider_file_id);

-- ---------------------------------------------------------------------------
-- 3. Who may reach an object
-- ---------------------------------------------------------------------------
--
-- A SECURITY DEFINER helper rather than the join inline: Supabase's own
-- guidance is that joins inside policy bodies are where storage RLS goes slow,
-- and this keeps the expression to one call the planner can cache.
--
-- Both segments are checked. Segment 1 is the tenant, exactly as §9.1 requires;
-- segment 2 is the document, which is what makes it author-scoped. Checking
-- only segment 2 would be sufficient — document ids are globally unique — but
-- then a malformed path could match a document in another family, and the
-- cheapest defence against a class of bug is to not admit it exists.

create function public.owns_document_object(object_name text)
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
      and d.created_by = (select auth.uid())
      and d.deleted_at is null
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. The path allocator — the only thing that builds a path
-- ---------------------------------------------------------------------------
--
--   <family_id>/<document_id>/<uuid>.<ext>
--
-- The final segment is generated here and never derived from what the user
-- called the file (docs/15 §9.1 as amended). That is what dissolves filename
-- sanitisation instead of solving it: there is no user input in the path.
--
-- It writes nothing. The row arrives after the bytes do, which is the whole
-- reason attach_document_file exists separately.

create function public.allocate_document_file_path(
  target_document uuid,
  extension text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  owning_family uuid;
  clean_extension text;
begin
  select d.family_id into owning_family
  from public.documents d
  where d.id = target_document
    and d.created_by = (select auth.uid())
    and d.deleted_at is null;

  if owning_family is null then
    -- Deliberately the same message whether the document is missing or somebody
    -- else's. "Not yours" and "does not exist" are the same fact to a caller who
    -- should not know either way.
    raise exception 'Document not found' using errcode = '42501';
  end if;

  -- Letters and digits only. The extension is chosen by the service from the
  -- MIME type, never from the filename, so this is a guard against a bug rather
  -- than against a user.
  clean_extension := lower(regexp_replace(coalesce(extension, ''), '[^a-zA-Z0-9]', '', 'g'));
  if clean_extension = '' then
    raise exception 'Unknown file type' using errcode = '22023';
  end if;

  return owning_family || '/' || target_document || '/' || gen_random_uuid() || '.' || clean_extension;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Attaching — and the check that makes this function worth having
-- ---------------------------------------------------------------------------
--
-- PR-11 wrote: "a client that can insert a file row before the object exists
-- can describe bytes that are not there." Because storage.objects is an
-- ordinary Postgres table, that is *checkable* rather than merely asserted —
-- and checking it is the reason this is an RPC instead of an INSERT policy.
--
-- document_files therefore still has no INSERT policy and no INSERT grant. The
-- existing RLS test asserting it is not writable by any client stays green;
-- granting insert would reopen exactly what this closes.

create function public.attach_document_file(
  target_document   uuid,
  object_path       text,
  file_mime_type    text,
  file_size_bytes   bigint,
  file_original_name text default null
)
returns public.document_files
language plpgsql
security definer
set search_path = ''
as $$
declare
  owning_family uuid;
  inserted public.document_files;
begin
  select d.family_id into owning_family
  from public.documents d
  where d.id = target_document
    and d.created_by = (select auth.uid())
    and d.deleted_at is null;

  if owning_family is null then
    raise exception 'Document not found' using errcode = '42501';
  end if;

  -- The path must be under this document's own prefix. Without this an author
  -- could attach an object belonging to a different document of their own,
  -- which is not a privacy hole but is a catalogue that lies.
  if object_path is null
     or object_path not like owning_family || '/' || target_document || '/%' then
    raise exception 'That file does not belong to this document' using errcode = '22023';
  end if;

  if not exists (
    select 1 from storage.objects
    where bucket_id = 'family-files'
      and name = object_path
  ) then
    raise exception 'No file was uploaded' using errcode = '22023';
  end if;

  insert into public.document_files (
    family_id, document_id, provider, provider_file_id,
    kind, version, mime_type, size_bytes, original_filename, created_by
  )
  values (
    owning_family, target_document, 'supabase', object_path,
    'original', 1, file_mime_type, file_size_bytes, file_original_name,
    (select auth.uid())
  )
  returning * into inserted;

  return inserted;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5b. Detaching
-- ---------------------------------------------------------------------------
--
-- DELETE *is* granted here, unlike INSERT, and the asymmetry is the point.
--
-- INSERT is withheld because a client that can write a row before the bytes
-- exist can describe a file nobody can fetch — a catalogue that lies. Deleting
-- has no equivalent hazard: the worst a caller achieves is removing a record of
-- their own file, which is exactly the thing they are asking for.
--
-- Without this, the remove button removed the object and left the row, so the
-- file reappeared on the next read. Found on a device, not by the 21 storage
-- tests, which asserted the object was gone and never re-listed the rows.

create policy "Authors can detach files from their own documents"
  on public.document_files for delete to authenticated
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_id
        and d.family_id = document_files.family_id
        and d.created_by = (select auth.uid())
        and d.deleted_at is null
    )
  );

grant delete on public.document_files to authenticated;

-- ---------------------------------------------------------------------------
-- 6. storage.objects policies
-- ---------------------------------------------------------------------------
--
-- No UPDATE policy. A file is replaced by uploading a new object, never mutated
-- in place — an object whose bytes can change under a row that records its size
-- and checksum is a row that quietly stops being true.

create policy "Authors can read their own document objects"
  on storage.objects for select to authenticated
  using (bucket_id = 'family-files' and public.owns_document_object(name));

create policy "Authors can upload to their own documents"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'family-files' and public.owns_document_object(name));

create policy "Authors can remove their own document objects"
  on storage.objects for delete to authenticated
  using (bucket_id = 'family-files' and public.owns_document_object(name));

-- ---------------------------------------------------------------------------
-- 7. The cleanup backstop
-- ---------------------------------------------------------------------------
--
-- The client deletes objects before deleting a document, which is the normal
-- path and the one that reclaims real space. This catches what the client never
-- sees: a whole family being deleted, which cascades to documents without any
-- screen knowing which files went with them.
--
-- **Storage defends itself, and the first version of this trigger broke family
-- deletion entirely.** `storage.objects` carries a statement-level trigger,
-- `protect_objects_delete`, which raises *"Direct deletion from storage tables
-- is not allowed. Use the Storage API instead"* unless the caller sets
-- `storage.allow_delete_query`. Deleting a family cascaded to documents, fired
-- this trigger, hit that guard, and rolled the whole delete back — the symptom
-- being that families quietly became undeletable. Exactly the shape PR-7, PR-9a
-- and PR-10 each paid for, arriving from a direction none of them came from.
--
-- The setting is the platform's own escape hatch and is set transaction-locally
-- below. **Its warning is accurate and is accepted knowingly**: this removes
-- rows, not bytes.
--
-- **What that leaves.** Listings and policies are honest immediately — and
-- privacy never depended on this anyway, since `owns_document_object` resolves
-- through a `documents` row that no longer exists, so an orphaned object is
-- unreachable by anyone. What lingers is the storage cost, until Phase 12's
-- Storage Management sweeps it. The paths are not lost with the rows: the sweep
-- is a bucket listing diffed against `document_files.provider_file_id`, which
-- stays computable however many rows go.
--
-- The client still deletes properly in the normal path, where the API removes
-- the bytes as well. This catches only what no screen ever sees — a whole family
-- going, taking documents nobody opened.

create function public.remove_document_objects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Transaction-local: the third argument scopes it to this statement's
  -- transaction, so nothing else in the session inherits permission to delete
  -- storage rows.
  perform set_config('storage.allow_delete_query', 'true', true);

  delete from storage.objects
  where bucket_id = 'family-files'
    and name like old.family_id || '/' || old.id || '/%';

  return old;
end;
$$;

create trigger documents_remove_objects
  after delete on public.documents
  for each row execute function public.remove_document_objects();

-- ---------------------------------------------------------------------------
-- 8. Privileges
-- ---------------------------------------------------------------------------
--
-- Functions grant EXECUTE to PUBLIC by default and every one of these is
-- SECURITY DEFINER. A policy can be perfectly correct and still return 42501,
-- and only the RLS suite catches a missing grant.

revoke all on function public.owns_document_object(text)                     from public;
revoke all on function public.allocate_document_file_path(uuid, text)        from public;
revoke all on function public.attach_document_file(uuid, text, text, bigint, text) from public;
revoke all on function public.remove_document_objects()                      from public;

grant execute on function public.owns_document_object(text)              to authenticated;
grant execute on function public.allocate_document_file_path(uuid, text) to authenticated;
grant execute on function public.attach_document_file(uuid, text, text, bigint, text) to authenticated;
