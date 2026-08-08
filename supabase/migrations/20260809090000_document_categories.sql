-- Filed under something, always.
--
-- PR-11 shipped documents with a title and a subject. This gives them a shelf.
--
-- A column with a check constraint, not a `categories` table. Three reasons,
-- in order of weight:
--
-- 1. The list is product vocabulary, not family data. It comes from
--    `docs/06-information-architecture.md` §4 and is the same six for every
--    household. A table would ask each family to own six rows they did not
--    choose and cannot meaningfully change.
-- 2. A table needs six seed rows per family, which means a trigger on family
--    creation *and* a backfill for families that already exist. That is
--    precisely the shape that broke PR-7.
-- 3. The extension point already exists and is not this. `docs/08` §16 defines
--    a Tagging Model — "every entity may support tags… tags improve
--    discoverability without affecting ownership" — with free-form,
--    user-chosen values. Category is the fixed shelf; tags are the open axis.
--    Making category user-definable would build the tag system twice.
--
-- Same pattern as `family_users.role` and `family_activity.action`: a check
-- constraint here, the labels in the service layer. Adding a seventh category
-- later is one `drop constraint` / `add constraint` pair.
--
-- Note what is *not* here: "Archived". IA §4 lists it beside the six, but PR-11
-- made archiving a timestamp, and it is a different axis — a document can be
-- Medical *and* archived. Adding it as a category value would make those two
-- states mutually exclusive and lose the document's meaning the moment it was
-- filed away.

-- ---------------------------------------------------------------------------
-- 1. The column, briefly nullable
-- ---------------------------------------------------------------------------

alter table public.documents
  add column category text
  check (category in (
    'identity',
    'medical',
    'finance',
    'property',
    'education',
    'legal'
  ));

-- ---------------------------------------------------------------------------
-- 2. Existing rows
-- ---------------------------------------------------------------------------
--
-- **This deletes data, deliberately, and it is safe exactly once.**
--
-- There is no honest value to backfill. Choosing 'identity' for a row that
-- might be a property deed is a guess about somebody's passport, and the
-- vocabulary has no 'other' — adding one would make the column optional again
-- while pretending otherwise.
--
-- What makes deletion the right answer rather than a shortcut is that there is
-- nothing to lose. On 2026-08-08, `supabase migration list --linked` reported
-- 20260808090000 with an empty `remote`: PR-11 had never been pushed, so the
-- documents table did not exist in production and held no rows anywhere except
-- three demo records in the local stack, which `db reset` discards regardless.
--
-- Recorded here because a future reader will find a `delete` in a migration and
-- should be able to see, without asking anyone, why it was not reckless. **Do
-- not copy this pattern into a migration that runs against real data.**

delete from public.documents where category is null;

-- ---------------------------------------------------------------------------
-- 3. Now it is mandatory
-- ---------------------------------------------------------------------------
--
-- Mandatory rather than nullable because the product's claim is that things are
-- found by what they mean. An uncategorised bucket is the junk drawer this
-- application exists to replace, and every later feature — Phase 8's filters,
-- Phase 9's smart categorisation, Phase 5's medical view — would carry a null
-- branch forever to accommodate it.

alter table public.documents
  alter column category set not null;

-- Filtering happens on the client, over a list the screen has already fetched
-- for its active/archived split, so no second index is added here. When a
-- family's document count makes that a bad trade, the filter moves into the
-- query and the index arrives with it — not before.
