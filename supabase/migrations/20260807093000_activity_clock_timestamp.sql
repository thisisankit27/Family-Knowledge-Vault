-- A log needs statement time, not transaction time.
--
-- `now()` is the start of the *transaction*, so every row written inside one
-- gets an identical `created_at`. `create_family` writes two events —
-- family_created, then access_granted for its creator — and they tied, leaving
-- the feed free to show the owner joining a family that did not exist yet.
-- Transferring ownership writes two role_changed rows the same way, and every
-- Phase 3 trigger that logs alongside a record write will do it again.
--
-- `clock_timestamp()` reads the wall clock per statement, so events ordered by
-- `created_at` come back in the order they actually happened.
--
-- Found by the RLS suite asserting the feed opens with the family being
-- created; it came back second about half the time.
--
-- A separate migration rather than an edit to 20260807090000, which is already
-- applied. Migration history is append-only.

alter table public.family_activity
  alter column created_at set default clock_timestamp();
