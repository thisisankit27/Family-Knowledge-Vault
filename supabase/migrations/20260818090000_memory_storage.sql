-- Photographs, attached to the memories they belong to.
--
-- The second record domain to take bytes, and it starts where documents
-- finished rather than where they started. Documents reached the shape below
-- across three migrations and two corrections:
--
--   20260811090000  `has_family_access(segment 1)` was role-blind and unsafe
--                   once documents became author-only -> owns_document_object
--   20260813090000  one predicate could not answer two questions, because
--                   sharing made a *visible* row whose bytes were unreachable
--                   -> can_read_document_object for SELECT only
--
-- **This migration writes both predicates on day one.** That is the entire
-- reason docs/15 §9.1 records those amendments in place rather than tidying
-- them away, and it matters more here than it did there: a memory defaults to
-- `family`, so the "visible row, unreachable bytes" failure would be the
-- *normal* case rather than an edge one. A single-predicate version of this file
-- would be broken for almost every row it governs.
--
-- Nothing else about the storage architecture changes. Same private bucket, same
-- path shape, same three-phase upload, same signed URLs minted on demand.
--
-- No audio and no video. PR-19 extends the bucket's MIME allow-list to accept
-- recordings; video is deferred to Phase 12 with the file-size cap it depends on
-- (docs/18 §3.3).

-- ---------------------------------------------------------------------------
-- 1. memory_files — the bytes, addressed by provider
-- ---------------------------------------------------------------------------
--
-- `document_files` with two differences, and no other divergence: the parent is
-- a memory, and there is a place to record how long a recording runs.
--
-- `provider_file_id` is named for what it is — an opaque identifier the provider
-- assigned — and deliberately **not** `storage_path`. docs/18 §13.6 makes this
-- load-bearing beyond its original reason: an open question about whether
-- content belongs to a user or to a family may one day re-associate a record
-- with a different family, and a value nothing outside the allocator parses can
-- be re-pointed without moving a byte. A column called `storage_path` invites
-- string manipulation in a client, and by the time that is wrong it is in an app
-- bundle on somebody's phone.

create table public.memory_files (
  id        uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  memory_id uuid not null,

  provider text not null default 'supabase'
    check (provider in ('supabase')),

  provider_file_id text not null,

  -- 'original' today; 'thumbnail' is the reserved slot (docs/16 §3.2).
  -- A voice note will be an 'original' too — `kind` describes an object's role,
  -- not its media type, and the media type lives in `mime_type`.
  kind text not null default 'original'
    check (kind in ('original', 'thumbnail')),

  version integer not null default 1 check (version >= 1),

  mime_type  text not null,
  size_bytes bigint not null check (size_bytes > 0),

  -- Reserved for PR-19. Null for a photograph, and null for a recording whose
  -- length was not measured — "unknown" is an honest value here, so this needs
  -- no backfill decision when audio arrives (docs/18 §4.3).
  duration_seconds integer check (duration_seconds > 0),

  checksum          text,
  -- Display only. Never a path segment: the stored name is a uuid, so a
  -- user-supplied filename cannot reach the address of anything.
  original_filename text,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),

  foreign key (memory_id, family_id)
    references public.memories (id, family_id) on delete cascade,

  -- The invariant documents arrived at after `(document_id, kind, version)` was
  -- found to be wrong: a passport is one document with two pages, and a holiday
  -- is one memory with thirty photographs. `version` means *replacement* and
  -- stays at 1 until something replaces a file. What must not happen is the same
  -- object attached to the same memory twice.
  constraint memory_files_unique_object unique (memory_id, provider_file_id)
);

create index memory_files_memory_idx
  on public.memory_files (memory_id);

-- ---------------------------------------------------------------------------
-- 2. Two predicates, because reading and writing are different questions
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER helpers rather than joins inline: Supabase's own guidance is
-- that joins inside policy bodies are where storage RLS goes slow, and this
-- keeps each expression to one call the planner can cache.
--
-- Both check **segment 1 (the tenant) and segment 2 (the memory)**. Segment 2
-- alone would be sufficient, since memory ids are globally unique — but then a
-- malformed path could match a memory in another family, and the cheapest
-- defence against a class of bug is to not admit it exists. docs/15 §9.1 pins
-- segment 1, and this honours it.
--
-- **The naming is the durable part.** `owns_` and `can_read_` say which question
-- each answers, so the next phase cannot reach for the wrong one by accident.

-- WRITE. Author only, matching the UPDATE and DELETE policies on `memories`.
-- Reading widens with `visibility`; writing never does.
create function public.owns_memory_object(object_name text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.memories m
    where m.id = nullif((storage.foldername(object_name))[2], '')::uuid
      and m.family_id = nullif((storage.foldername(object_name))[1], '')::uuid
      and m.created_by = (select auth.uid())
      and m.deleted_at is null
  );
$$;

-- READ. Delegates to the same resolver the row policy calls, with the same
-- `null` in the subject position — so the row and its bytes cannot disagree
-- about who may read them, and neither can drift without the other.
--
-- The `null` is docs/18 §3.4: "belongs to" grants nothing, anywhere. If a later
-- migration passes `member_id` here, it must pass it in `memories`' SELECT
-- policy too, or the bytes become reachable to somebody the row is hidden from.
create function public.can_read_memory_object(object_name text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.memories m
    where m.id = nullif((storage.foldername(object_name))[2], '')::uuid
      and m.family_id = nullif((storage.foldername(object_name))[1], '')::uuid
      and public.can_see_record(m.family_id, m.visibility, null, m.created_by)
      and m.deleted_at is null
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. The path allocator — the only thing that builds a path
-- ---------------------------------------------------------------------------
--
--   <family_id>/<memory_id>/<uuid>.<ext>
--
-- The final segment is generated here and never derived from what the user
-- called the file. There is no user input in the path at all, which dissolves
-- filename sanitisation rather than solving it.
--
-- It writes nothing. The row arrives after the bytes do, which is why
-- attach_memory_file exists separately.
--
-- Documents and memories share the bucket and the path shape safely: each
-- predicate joins to its own table, so a memory path fails closed under the
-- document policies and a document path fails closed under these.

create function public.allocate_memory_file_path(
  target_memory uuid,
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
  select m.family_id into owning_family
  from public.memories m
  where m.id = target_memory
    and m.created_by = (select auth.uid())
    and m.deleted_at is null;

  if owning_family is null then
    -- Deliberately the same message whether the memory is missing or somebody
    -- else's. "Not yours" and "does not exist" are the same fact to a caller who
    -- should not learn which. This matters more than it did for documents,
    -- because a family memory *is* readable by the caller — so the message must
    -- not become the one place that distinguishes "you may read this" from "you
    -- may write to it".
    raise exception 'Memory not found' using errcode = '42501';
  end if;

  -- Letters and digits only. The extension is chosen by the service from the
  -- MIME type, never from the filename, so this guards against a bug rather
  -- than against a user.
  clean_extension := lower(regexp_replace(coalesce(extension, ''), '[^a-zA-Z0-9]', '', 'g'));
  if clean_extension = '' then
    raise exception 'Unknown file type' using errcode = '22023';
  end if;

  return owning_family || '/' || target_memory || '/' || gen_random_uuid() || '.' || clean_extension;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Attaching — and the check that makes this an RPC rather than a policy
-- ---------------------------------------------------------------------------
--
-- Because storage.objects is an ordinary Postgres table, "the bytes exist" is
-- *checkable* rather than merely asserted — and checking it is the whole reason
-- this is a function instead of an INSERT policy.
--
-- `memory_files` therefore has no INSERT policy and no INSERT grant, exactly as
-- `document_files` has none. A client that can write a file row before the
-- object exists can describe bytes nobody can fetch: a catalogue that lies.

create function public.attach_memory_file(
  target_memory      uuid,
  object_path        text,
  file_mime_type     text,
  file_size_bytes    bigint,
  file_original_name text default null,
  file_duration_seconds integer default null
)
returns public.memory_files
language plpgsql
security definer
set search_path = ''
as $$
declare
  owning_family uuid;
  inserted public.memory_files;
begin
  select m.family_id into owning_family
  from public.memories m
  where m.id = target_memory
    and m.created_by = (select auth.uid())
    and m.deleted_at is null;

  if owning_family is null then
    raise exception 'Memory not found' using errcode = '42501';
  end if;

  -- The path must be under this memory's own prefix. Without this an author
  -- could attach an object belonging to a different memory of their own, which
  -- is not a privacy hole but is a catalogue that lies in a subtler way.
  if object_path is null
     or object_path not like owning_family || '/' || target_memory || '/%' then
    raise exception 'That file does not belong to this memory' using errcode = '22023';
  end if;

  if not exists (
    select 1 from storage.objects
    where bucket_id = 'family-files'
      and name = object_path
  ) then
    raise exception 'No file was uploaded' using errcode = '22023';
  end if;

  insert into public.memory_files (
    family_id, memory_id, provider, provider_file_id,
    kind, version, mime_type, size_bytes, original_filename,
    duration_seconds, created_by
  )
  values (
    owning_family, target_memory, 'supabase', object_path,
    'original', 1, file_mime_type, file_size_bytes, file_original_name,
    file_duration_seconds, (select auth.uid())
  )
  returning * into inserted;

  return inserted;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Row-Level Security on memory_files
-- ---------------------------------------------------------------------------
--
-- SELECT resolves through the parent memory and must agree with it. A memory
-- hidden while its file rows stay listed is the failure 20260810090000 §5 named
-- — the row hidden, the things hanging off it not — and it runs both ways.
--
-- DELETE is granted where INSERT is not, and the asymmetry is the point. A
-- client writing a row before the bytes exist describes a file nobody can fetch;
-- deleting has no equivalent hazard, since the worst a caller achieves is
-- removing the record of their own file, which is what they asked for.

alter table public.memory_files enable row level security;

create policy "Members can read files for memories they can see"
  on public.memory_files for select to authenticated
  using (
    exists (
      select 1 from public.memories m
      where m.id = memory_id
        and m.family_id = memory_files.family_id
        and public.can_see_record(m.family_id, m.visibility, null, m.created_by)
        and m.deleted_at is null
    )
  );

-- Author only, independently of the storage policy. Two expressions agreeing
-- about who may remove a file means neither can drift alone.
create policy "Authors can detach files from their own memories"
  on public.memory_files for delete to authenticated
  using (
    exists (
      select 1 from public.memories m
      where m.id = memory_id
        and m.family_id = memory_files.family_id
        and m.created_by = (select auth.uid())
        and m.deleted_at is null
    )
  );

-- ---------------------------------------------------------------------------
-- 6. storage.objects policies
-- ---------------------------------------------------------------------------
--
-- Added alongside the document policies rather than replacing them. Postgres
-- combines permissive policies with OR, and each predicate joins to its own
-- table, so a document object is invisible to these and a memory object is
-- invisible to those.
--
-- No UPDATE policy. A file is replaced by uploading a new object, never mutated
-- in place — an object whose bytes change under a row recording its size is a
-- row that quietly stops being true.

create policy "Readers can read memory objects they can see"
  on storage.objects for select to authenticated
  using (bucket_id = 'family-files' and public.can_read_memory_object(name));

create policy "Authors can upload to their own memories"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'family-files' and public.owns_memory_object(name));

create policy "Authors can remove their own memory objects"
  on storage.objects for delete to authenticated
  using (bucket_id = 'family-files' and public.owns_memory_object(name));

-- ---------------------------------------------------------------------------
-- 7. The cleanup backstop
-- ---------------------------------------------------------------------------
--
-- The client deletes objects before deleting a memory, which is the normal path
-- and the one that reclaims real space. This catches what no screen ever sees: a
-- whole family being deleted, cascading to memories without anything knowing
-- which files went with them.
--
-- **`set_config` is not optional.** `storage.objects` carries a statement-level
-- trigger, `protect_objects_delete`, which raises *"Direct deletion from storage
-- tables is not allowed"* unless `storage.allow_delete_query` is set. Omitting it
-- in PR-14a made families quietly undeletable — the delete cascaded, hit the
-- guard, and rolled the whole transaction back. The third argument scopes the
-- setting to this transaction, so nothing else in the session inherits it.
--
-- It removes rows, not bytes, and that warning is accepted knowingly. Privacy
-- never depended on it: both predicates above resolve through a `memories` row
-- that no longer exists, so an orphaned object is unreachable by everyone. What
-- lingers is storage cost until Phase 12 sweeps, and the sweep stays computable
-- as a bucket listing diffed against `memory_files.provider_file_id`.

create function public.remove_memory_objects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('storage.allow_delete_query', 'true', true);

  delete from storage.objects
  where bucket_id = 'family-files'
    and name like old.family_id || '/' || old.id || '/%';

  return old;
end;
$$;

create trigger memories_remove_objects
  after delete on public.memories
  for each row execute function public.remove_memory_objects();

-- ---------------------------------------------------------------------------
-- 8. Privileges
-- ---------------------------------------------------------------------------
--
-- Functions grant EXECUTE to PUBLIC by default and every one of these is
-- SECURITY DEFINER. A policy can be perfectly correct and still return 42501,
-- and only the RLS suite catches a missing grant.
--
-- `memory_files` gets select and delete. **No insert** — attach_memory_file is
-- the only writer, and granting insert would reopen exactly what §4 closes.

grant select, delete on public.memory_files to authenticated;
revoke all on public.memory_files from anon;

revoke all on function public.owns_memory_object(text)                  from public;
revoke all on function public.can_read_memory_object(text)              from public;
revoke all on function public.allocate_memory_file_path(uuid, text)     from public;
revoke all on function public.attach_memory_file(uuid, text, text, bigint, text, integer) from public;
revoke all on function public.remove_memory_objects()                   from public;

grant execute on function public.owns_memory_object(text)              to authenticated;
grant execute on function public.can_read_memory_object(text)          to authenticated;
grant execute on function public.allocate_memory_file_path(uuid, text) to authenticated;
grant execute on function public.attach_memory_file(uuid, text, text, bigint, text, integer) to authenticated;
