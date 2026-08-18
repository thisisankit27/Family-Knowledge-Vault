-- A memory you can hear.
--
-- **The whole database change is one array.** No new table, no new function, no
-- new policy, no edit to `can_see_record`. A voice note is a `memory_files` row
-- like a photograph is, reached through the same allocator, written by the same
-- attach function, and guarded by the same two predicates.
--
-- That is the evidence `docs/18` §3.1 and §5.2 were right, and it is worth
-- stating plainly because it is the cheapest migration in the project so far and
-- the one that would have been most expensive if the earlier shape were wrong.
-- `kind` describes an object's *role* — a voice note is an `original`, not a new
-- kind — and the media type lives in `mime_type`, which is where the bucket
-- already checks it.
--
-- `memory_files.duration_seconds` shipped in PR-18, nullable, and
-- `attach_memory_file` already takes `file_duration_seconds`. Nothing here.

-- ---------------------------------------------------------------------------
-- 1. The bucket learns about audio
-- ---------------------------------------------------------------------------
--
-- `docs/16` §3.2 anticipated exactly this line: *"Phase 4 adds audio and
-- video."* Half of it lands here. **Video is deferred to Phase 12** with the
-- 10MB per-file cap it depends on (`docs/18` §3.3) — at that cap a video is
-- roughly fifteen seconds, which is not a feature.
--
-- Two MIME types for one format. `expo-audio`'s HIGH_QUALITY preset writes
-- `.m4a` (MPEG-4 container, AAC) on both platforms; the canonical type for that
-- is `audio/mp4`, which is what this app sends. `audio/m4a` is the variant other
-- tools emit for the same bytes, and allowing it costs one array element while
-- refusing it would produce a failure whose message named a MIME type the user
-- never chose.
--
-- **This array and `ALLOWED_MIME_TYPES` in `src/services/storage.ts` are two
-- halves of one decision.** They are duplicated deliberately — the bucket is the
-- real limit, because a cap enforced only in an app bundle lasts until somebody
-- points curl at the endpoint, while the client copy is what stops a user
-- waiting through an upload to be told no. Changing one without the other is how
-- the first recording fails, live, at the last step.

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'application/pdf',
  'audio/mp4',
  'audio/m4a'
]
where id = 'family-files';

-- ---------------------------------------------------------------------------
-- 2. What deliberately did not change
-- ---------------------------------------------------------------------------
--
-- Recorded because the next reader will wonder whether something was missed.
--
-- **`file_size_limit` stays at 10MB.** The preset records 128 kbit/s, so ten
-- megabytes is about ten minutes of audio. The app caps a recording at five,
-- which lands near 4.8MB — comfortably inside, and capped in the recorder rather
-- than discovered at upload, which is the worst possible place to learn it.
--
-- **No per-type size limit.** Postgres could express one; the bucket cannot, and
-- inventing a second enforcement point for a rule the recorder already keeps
-- would be two places to disagree.
--
-- **No RLS change of any kind.** `owns_memory_object` and
-- `can_read_memory_object` do not look at `mime_type`, so a recording is
-- governed by its memory's visibility exactly as a photograph is — including the
-- part that matters most for a voice note, which is that a `private` memory's
-- recording is audible to nobody but its author.
