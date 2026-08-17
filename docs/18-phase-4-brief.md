# 📸 Phase 4 Brief — "Family Memories"

**Project:** Family Knowledge Vault

**Version:** 1.0

**Status:** Written 2026-08-17 at the close of Phase 3, before PR-17 starts. Four blocking decisions
were open when this document began; all four are settled in §3 and §6, and none of them may be
quietly revisited mid-phase.

**Phase 3 shipped:** PR-11 through PR-16 — library, categories, detail, upload, preview, sharing,
filing flow, landing page. 29 merged pull requests, 472 CI tests, 240 RLS tests, fifteen migrations.

---

# 1. Purpose

This document exists so that a session starting Phase 4 does not re-derive Phase 3's conclusions, and
does not discover Phase 4's unmade decisions halfway through a stream.

It is the third instrument of its kind. `docs/15` was written before PR-9a and found two
privilege-escalation holes before they shipped. `docs/16` was written before PR-11 and settled six
decisions that would each have been expensive to reverse. **Both paid for themselves.** That is the
precedent and the justification.

**Read in this order:** `CLAUDE.md` → `.claude/current-session.md` (jump to the last checkpoint) →
this file → `docs/15-permission-matrix.md` §8 and §9. Everything else in `docs/` is background.

**Where this document and an earlier one disagree, check the date.** `docs/15` remains authoritative
on permissions and visibility; `docs/17` remains authoritative on storage architecture; this one is
authoritative on what Phase 4 builds and what it must decide.

---

# 2. The good news: almost nothing new has to be invented

Phase 3 did not just ship documents. It ship­ped the *shape* of a record domain, and Phase 4 is the
first proof that the shape works. Concretely, Phase 4 needs:

| | |
|---|---|
| New permission helpers | **Zero** |
| Edits to `can_see_record` | **Zero** |
| New rows in the `docs/15` §4 matrix | **Zero** — §4.4 is *"one block for **all** content domains… applies identically to Documents, Medical, **Memories**, Recipes"* |
| New storage buckets | **Zero** |
| New path conventions | **Zero** |
| New upload mechanism | **Zero** |

What Phase 4 adds is four tables, four small SQL functions per attachment type, one package, and the
screens.

## 2.1 The spine, copied verbatim — `docs/15` §8.2

```sql
id          uuid primary key default gen_random_uuid(),
family_id   uuid not null references public.families (id) on delete cascade,
member_id   uuid,                    -- the person it is about; null = the family's
visibility  text not null default 'family' check (visibility in ('family','private')),
created_by  uuid references auth.users (id) on delete set null,
created_at  timestamptz not null default now(),
updated_at  timestamptz not null default now(),
deleted_at  timestamptz,
foreign key (member_id, family_id)
  references public.family_members (id, family_id) on delete set null,
unique (id, family_id)
```

And the SELECT policy every record table carries, unchanged since PR-9a:

```sql
using (public.can_see_record(family_id, visibility, member_id, created_by)
       and deleted_at is null)
```

## 2.2 What Phase 3 proved about writing to these tables

- `can_write_records(family_id)` for INSERT, plus `created_by = (select auth.uid())`.
- `created_by = (select auth.uid())` for UPDATE and DELETE — **author-only**, and a
  `pin_created_by()` trigger so authorship cannot be transferred or stolen.
- `can_write_records` stays *alongside* the authorship test rather than being replaced by it: it is
  what excludes an author whose role was reduced to Guest after they filed the record.

---

# 3. The four decisions, settled 2026-08-17

## 3.1 Shared vs per-domain file tables — `docs/17` §13's blocking question

> *"`document_files` ships in Phase 3. **Phase 4 must decide before `memory_files` exists** — at two
> tables it is a rename, at six a rewrite."*

### Decided: **per-domain tables, shared upload *code*.**

`memory_files` mirrors `document_files`. A single polymorphic `record_files` table was considered and
declined on two grounds, both structural rather than aesthetic:

- **It cannot express the composite foreign key.** `(record_id, family_id) → parent(id, family_id)`
  is what makes an attachment belonging to another family's record *structurally impossible* rather
  than policy-refused. That is PR-8's proof, reused by every record table since. A polymorphic parent
  cannot reference two tables, so the guarantee would degrade into a policy check — and the whole
  point of the composite key is that no policy has to check for it.
- **It puts a discriminator inside an RLS policy.** `case record_type when 'document' … when
  'memory' …` is precisely the shape `docs/17` §10.2 bans for `provider`: *"Do not let `provider`
  enter an RLS policy."* The reason generalises. A policy that branches on a type column is a policy
  with an unreachable branch waiting to be added wrongly.

**But the duplication that would actually have hurt is not the table — it is the upload path**, and
that is shared. `src/services/storage.ts` is document-shaped in its *names*, not its logic: allocate
→ read bytes → `XMLHttpRequest` with progress → attach. Only two RPC names differ.

```ts
interface RecordFileKind {
  allocateRpc: string;   // 'allocate_memory_file_path'
  attachRpc:   string;   // 'attach_memory_file'
  parentParam: string;   // 'target_memory'
}
uploadRecordFile(gateway, kind, parentId, candidate, readBytes, onProgress)
```

**This is done as a refactor of the existing document path in PR-18, when the second caller actually
arrives** — not written ahead of it. `docs/16`'s closing habit applies directly: *"when adding a
second caller for anything, read what the first one already does about the same problem."*

So `docs/17` §13's *"at six a rewrite"* is answered where the rewrite would have happened, and the
SQL stays four small honest functions per type.

## 3.2 Five capabilities, four PR slots

`docs/14` §7 lists Phase 4 as *"Memories, Albums, Stories, Voice Memories, Memory Timeline"* across
**PRs 16–20**. But PR-16 shipped as the landing page when Phase 3 closed. Four slots, five
capabilities.

### Decided: **Stories are a field. Memory Timeline moves to Phase 7.**

Neither is a cut. Both are corrections.

- **Stories.** `docs/08` §4 already settles this: the core entities are **`Memory` and `Album`** —
  *"Story" is not an entity; it is a field.* FR-027 says memories *support* stories, which a `story`
  column does. It ships in PR-17.
- **Memory Timeline.** `src/navigation/domains.ts` already registers `timeline` as its own IA domain
  with `arrivesIn: 'Phase 7'` — *"Your family's life, in order."* A Phase 4 "Memory Timeline" would
  have squatted on that name and built a narrower version of the same surface twice. **Phase 4 ships
  the data a timeline needs; Phase 7 builds the surface, once, across every domain that has dated
  rows.** FR-024's *"events shall be displayed chronologically"* is satisfied in PR-17 by a list
  sorted on `occurred_on`.

**Phase 4 is therefore PR-17 Memories, PR-18 Memory Photos, PR-19 Voice Memories, PR-20 Albums.**

## 3.3 Video

`docs/16` §3.2 anticipated *"Phase 4 adds audio and video"*.

### Decided: **audio only. Video deferred to Phase 12.**

The bucket caps files at 10MB (`20260811090000`), against a ~1GB free tier. **At 10MB a video is
roughly fifteen seconds** — not a feature, a tease, and the kind of thing a family discovers at the
moment they most wanted it to work. `expo-video` is also a second player surface with its own
failure modes, in a phase already adding a recorder.

Phase 12's *Storage Management* is where the file-size cap and the free-tier ceiling are revisited
anyway (`docs/14` §4). Video belongs in the same conversation as the constraint that makes it
useless, not one phase earlier.

## 3.4 Does a memory's subject read a private memory?

`can_see_record`'s `private` branch grants to the author **or the subject**. Documents pass `null` in
the subject position, killing the branch. `20260810090000` left it alive on purpose: *"This function
is unchanged, and Phase 4–6 record tables still get the subject branch if they want it."* Memories
are the first table that could take it.

### Decided: **pass `null`. "Belongs to" grants nothing, anywhere in the product.**

- **One rule beats two.** Taking the branch would mean *who is this about* grants read on memories
  and not on documents. Every future reader would have to hold both.
- **It re-opens the PR-13 escalation in miniature.** That defect was exactly the conflation of *about*
  and *may-read*. The blast radius is smaller now that writes are separately gated, but the shape is
  identical, and this project has already paid for the shape once.
- **`docs/15` §9.6 stays coherent.** It says derived content inherits the *subject's* visibility.
  With memories passing `null` too, §9.6 describes no shipped table — which is a documentation
  problem (§7.4), not a licence to create divergence in the schema to match stale prose.
- **The cost is near zero**, because memories default to `family` (§4.1). Private memories are the
  rare case, not the common one.

The branch stays alive in the function for a future table with a real reason to want it.

---

# 4. The data model

## 4.1 `memories`

```sql
create table public.memories (
  -- docs/15 §8.2 spine, verbatim
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references public.families (id) on delete cascade,
  member_id    uuid,
  visibility   text not null default 'family'
                 check (visibility in ('family','private')),
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  foreign key (member_id, family_id)
    references public.family_members (id, family_id) on delete set null,
  unique (id, family_id),

  -- the memory itself
  title        text not null check (length(btrim(title)) between 1 and 120),
  story        text check (length(story) <= 10000),
  occurred_on  date,
  occurred_precision text not null default 'day'
                 check (occurred_precision in ('day','month','year')),
  location     text check (length(btrim(location)) <= 120),
  archived_at  timestamptz,
  ai_processing text not null default 'denied'
                 check (ai_processing in ('allowed','denied'))
);

create index memories_family_idx
  on public.memories (family_id, occurred_on desc nulls last)
  where deleted_at is null;
```

### `visibility` defaults to `family`, and this diverges from documents on purpose

`docs/15` §8.5 froze `family` everywhere in v1 and recorded `documents` as the documented exception,
because *"a document is the most sensitive thing this product holds."*

**A memory is the opposite.** It exists to be shared. A memories tab where every photo defaults to
invisible would ship a family album that nobody in the family can see — the failure mode is not a
leak, it is a product that does nothing. §8.5's own sentence — *"the column lets each table revisit
the default with no change to the model"* — is exactly this case.

Recorded here so a later reader does not "fix" it to match documents.

### `ai_processing` ships now, at `denied`, for the reason it did in PR-11

There is no defensible value to backfill *consent* with. Asking at creation is the only honest
moment. It gates nothing until Phase 9 — and per `docs/15` §9.6, when Phase 9 arrives, withdrawing
consent must **delete** derived artefacts, not merely ignore them.

### What is derived, never stored

Photo counts, album counts, "on this day". **A stored counter is a second copy of a
permission-filtered fact**, and it would disclose the existence of private memories to people who
cannot read them — `docs/15` §9.3's tsvector warning in a smaller costume.

## 4.2 `memory_members` — additional subjects, and NOT a permission

An exact copy of `document_members`, **including its header comment**, which must be reproduced at
the point the table is created:

> A link here grants nothing. If it did, any member could insert a row naming themselves against a
> private memory and read it.

PK `(memory_id, member_id)`; composite FKs to `memories(id, family_id)` and
`family_members(id, family_id)`.

## 4.3 `memory_files`

`document_files`, with one addition:

- `duration_seconds integer` — nullable, for audio.
- `kind` stays `('original','thumbnail')`. **A voice note is an `original`.** `kind` describes an
  object's *role*, not its media type; the media type lives in `mime_type`, which is where the bucket
  allow-list already checks it. Thumbnails remain deferred (`docs/16` §3.2).
- The unique constraint is `(memory_id, provider_file_id)`, matching the correction
  `20260811090000` made after `(document_id, kind, version)` forbade a two-page passport.

## 4.4 `albums` and `album_memories`

`albums` copies the spine and adds `title` and `cover_memory_id`. `album_memories` carries
`(album_id, memory_id, family_id, position, created_at)`.

## 4.5 The timeline is not an entity

A memory has a date. Ordering is `order by occurred_on desc nulls last, created_at desc`.

`docs/08` §9 asks only for *"One Date"*. No FR requires a timeline entity, and `docs/14`'s own note
that Phase 4 should stay inside the 2-hour cadence argues against building an event engine to sort a
list.

**No table. No view.** If a view is ever added it must be `with (security_invoker = true)` — without
it the view executes as its owner and **bypasses RLS entirely** (`docs/15` §9.2, and the classic
Supabase footgun).

`occurred_precision` handles the cases a family actually has:

| Stored | Rendered |
|---|---|
| `1998-07-12`, `'day'` | 12 July 1998 |
| `1998-07-01`, `'month'` | July 1998 |
| `1998-01-01`, `'year'` | 1998 |
| `null` | "Date unknown", sorted last under its own heading |

A memory whose date nobody remembers is still a memory. Stamping it with today's date to make it
sortable would be the product lying about the one fact it exists to preserve.

---

# 5. Storage

**Reuse Phase 3's architecture exactly.** Same private bucket `family-files`, same path shape
`<family_id>/<record_id>/<uuid>.<ext>`, same three-phase upload, same signed-URL discipline (mint on
demand, 300s TTL, never store a URL, never let expiry reach a component — `docs/17` §10.1).

Two things change:

1. **The bucket MIME allow-list gains audio** — `audio/mp4`, `audio/m4a` — in PR-19, mirrored in
   `ALLOWED_MIME_TYPES` in `src/services/storage.ts`. The duplication is deliberate and documented:
   *"a cap enforced only in an app bundle is a cap until somebody points curl at the endpoint."*
2. **A memory-specific SQL surface**, mirroring the document one one-for-one:
   `allocate_memory_file_path()`, `attach_memory_file()`, `owns_memory_object()`,
   `can_read_memory_object()`, and an `after delete` trigger `remove_memory_objects()`.

## 5.1 Sharing the bucket is safe, and segment 1 still carries the tenant

Documents and memories both write `<family_id>/<record_id>/<uuid>.<ext>` into `family-files`. Each
predicate joins to its own table, so a memory path fails closed under the document policies and vice
versa. `docs/15` §9.1's pin — segment 1 is the tenant and is always checked — is honoured, and its
2026-08-11 amendment already established that *adding* conjuncts is what a frozen contract is
supposed to allow.

## 5.2 Phase 4 gets the read/write split right in the first migration

Documents needed **three amendments** to arrive at two predicates:

| | |
|---|---|
| `docs/15` §9.1 as frozen | `has_family_access(segment 1)` — tenant-level, role-blind |
| Amended 08-11 | Unsafe once documents became author-only → `owns_document_object` |
| Amended 08-13 | One predicate could not answer two questions → `can_read_document_object` for SELECT, `owns_document_object` for INSERT/DELETE |

**Memories start at the end of that road.** `owns_memory_object` guards INSERT and DELETE;
`can_read_memory_object` delegates to `can_see_record` and guards SELECT only. The naming is the
durable part — `owns_` and `can_read_` say which question each answers, so the next phase cannot
reach for the wrong one by accident.

## 5.3 Two habits inherited from `20260811090000`

- **`memory_files` gets no INSERT policy and no INSERT grant.** `attach_memory_file()` is the only
  writer, because as an ordinary table it can *verify the object exists* rather than trust that it
  does.
- **The `after delete` trigger needs `set_config('storage.allow_delete_query', 'true', true)`.**
  Omitting it is what made families quietly undeletable in PR-14a — `storage.objects` carries a
  statement-level trigger that otherwise raises *"Direct deletion from storage tables is not
  allowed."* It clears metadata, not bytes; bytes wait for Phase 12.

---

# 6. Security — who may do what

| | Read | Create | Edit | Delete |
|---|---|---|---|---|
| `memories` | `can_see_record(family_id, visibility, null, created_by)` and `deleted_at is null` | `can_write_records` + `created_by = auth.uid()` | author only | author only |
| `memory_files` | resolves through the parent memory | **no grant** — `attach_memory_file()` only | — | author of parent |
| `memory_members` | resolves through the parent memory | author of parent | — | author of parent |
| `albums` | same as `memories` | `can_write_records` | author only | author only |
| `album_memories` | **album AND memory both visible** | author of album | — | author of album |
| `storage.objects` | `can_read_memory_object(name)` | `owns_memory_object(name)` | *no UPDATE policy* | `owns_memory_object(name)` |

Answers to the questions worth asking out loud:

- **Guest** reads nothing. `can_read_records` is an allow-list of owner/admin/member; no policy has
  to mention guests, and none does.
- **Owner and Admin** read `family` memories like anyone else, **cannot read a `private` one at
  all**, and cannot edit or delete another member's memory. `docs/15` §8.4: *no role reads a private
  record.*
- **Another family member editing:** no. *Reading widens with `visibility`; writing never does.*
- **Can a signed URL bypass the row permission?** No. `createSignedUrl` goes through the
  `storage.objects` SELECT policy, which calls the same `can_see_record` the row policy calls.
  Confidentiality is a policy, not a promise kept by code — the distinction `docs/15` §9.1 paid for
  twice.
- **Can an attachment outlive its parent's reachability?** No, in all four directions: soft delete,
  hard delete, `visibility` flipped back to `private`, and family deletion all resolve through the
  same memory row, because all four predicates call the same function.
- **Author loses family access:** `can_see_record`'s leading `has_family_access` gate means
  authorship stops granting anything the instant the `family_users` row disappears. Already proven
  for documents (`membership.rls.test.ts:334`).
- **A person is removed / a memory names an inactive person:** `member_id` is `on delete set null`,
  and because it grants nothing, **nothing about who may read the memory changes.** This is decision
  3.4 paying for itself immediately.

## 6.1 The album leak, and why `album_memories` needs both conditions

If `album_memories`' SELECT resolved only through the album, a member could read the memory **ids**
inside a `family` album that happens to contain someone's `private` memory. That is existence
disclosure, and it is the same failure `20260810090000` §5 named: **the row hidden, the things
hanging off it not.**

The policy must require visibility of **both** sides. Album photo counts are therefore computed from
the visible join and never stored (§4.1).

This is the one genuinely new security question Phase 4 raises. Everything else is Phase 3's model
applied to a second noun.

---

# 7. Contradictions in the existing docs — flag, do not silently resolve

## 7.1 "Voice via Expo AV" is wrong on this SDK

`docs/14` §7's Phase 4 row says *"Voice via Expo AV — natural fit."* It is the only occurrence of
"Expo AV" in the repository, and nothing ever validated it against the pinned SDK.

**`expo-av` is unmaintained from SDK 54 and removed in SDK 55.** This project pins `expo ~54.0.0`.
Adopting it would mean writing code with a published removal date, one SDK ahead.

### Decided: **`expo-audio`.** Stable, **included in Expo Go** on SDK 54, records `.m4a`/AAC on both platforms.

```ts
useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  → prepareToRecordAsync() → record() → stop() → recorder.uri
useAudioPlayer(source) + useAudioPlayerStatus(player)   // isLoaded, playing, duration, currentTime
AudioModule.requestRecordingPermissionsAsync()
setAudioModeAsync({ allowsRecording, playsInSilentMode })
```

Install with `npx expo install expo-audio`, which resolves against the pin rather than latest —
`docs/16` §8's rule, and the reason `base64-arraybuffer` turned out to be unnecessary.

**`docs/14` §7's Phase 4 row is corrected in place and dated, in this pass.** The original wording is
struck through rather than removed, so the reason the line existed survives alongside its
replacement.

## 7.2 Phase 4's PR numbers collide with what shipped

`docs/14` §7 says both *"Phase 3 closes with PR-16, the landing-page update"* and
*"4 — Family Memories **(16–20)**"*. `docs/12` assigns PR-016 to "Memories Module". PR-16 shipped as
the landing page.

### Resolved by §3.2: Phase 4 is **PR-17 → PR-20**. `docs/12`'s PR numbering is off by one from PR-016 onward and is annotated rather than renumbered — it is the historical record, and rewriting it would destroy the evidence of the collision.

## 7.3 `docs/15` §4.4's table is now wrong for two record types, not one

§4.4 says a `private` record is readable by *"author or subject"*. Documents pass `null`, and after
§3.4 memories do too. The §8.4 amendment says so; **the §4.4 table itself was never edited.**

A reader who stops at the table gets the wrong model for every record type that exists. §4.4 is
corrected in this pass — not by changing the model, but by making the table say what the amendments
below it already say.

## 7.4 `docs/15` §9.6 now describes no shipped table

> *"derived text inherits the **subject's** visibility, not the uploader's, since §8.3 already treats
> `member_id` as the subject."*

`docs/15` §12 already flags this as stale for documents. After §3.4 it is stale for memories too, so
it describes **zero** tables. Phase 9 must not read it as written. Annotated, not deleted — the
*principle* (derived content carries its source row's policy) is correct and load-bearing; only the
sentence about which column supplies it is wrong.

## 7.5 `docs/09` is fiction for this codebase

It describes a REST *"Memory API — Stories, Photos, Videos, Albums, Voice Notes"*, with per-domain
service boundaries. There is no HTTP API layer and no server — `docs/17` §4.3: *"There is no server,
by written policy."* The architecture is Postgres + RLS + `XGateway` adapters.

Marked superseded at the head of the document so a future phase does not read it as a contract.

## 7.6 `docs/08` §15 claims attachments are reusable across contexts

> *"Attachments should be reusable across the platform. **One uploaded file may appear in multiple
> contexts.**"*

Nothing implements this, and §3.1 moves deliberately **away** from it. Either §15 is wrong or it
describes a Phase 12 feature. Flagged for the owning document to answer; **not** silently deleted,
because it is the strongest existing argument for the shared-file-table design that §3.1 declined,
and a future reader is entitled to see it.

---

# 8. What the product must feel like

`docs/10` §2 and §4 are the constraint, and Memories is the phase most obliged to honour them:

> *"Users should never feel like they are managing files. They should feel like they are preserving
> their family's story."*
>
> *"The application should feel more like: **a family album** / a memory book / a personal journal."*

`docs/10` §13's rule, which `docs/16` §7 called *"the constraint most likely to be lost while wiring
an upload flow"*, applies with more force here than it did to documents: **context is more valuable
than filenames.** A memory card shows *Diwali at Nani's house · November 2019 · 8 photos · Added by
you*, never `IMG_4471.HEIC`.

And `docs/16`'s two-audience rule is inherited along with the screens:

> The person who may change a setting gets a **control**. Everybody else gets **the decision**, as a
> sentence. Never a disabled control.

---

# 9. The four PRs

| PR | Delivers | Est. |
|---|---|---|
| **17** | Memories — table, story, date + precision, list / detail / create | ~2h |
| **18** | Memory photos — `memory_files`, storage surface, grid, viewer | ~2h |
| **19** | Voice memories — `expo-audio`, recorder, playback, audio MIME | ~2h |
| **20** | Albums — collections over existing memories | ~2h |

```
PR-17 Memories ──┬── PR-18 Photos ── PR-19 Voice
                 └── PR-20 Albums
```

PR-18 and PR-20 depend only on PR-17 and may swap. **PR-19 depends on PR-18** for the upload path.

**Do not stack the branches.** One PR per day into `master`, branched from `master`. PR-15b and PR-16
were stacked, both read MERGED, and `master` received neither — *"a stacked PR that says MERGED is
indistinguishable from a shipped one until somebody checks `master`."*

## PR-17 — Memories

**Purpose.** Write down a moment — title, story, when it happened, who it is about, who may see it —
and see them listed with the honest date.

**Why this boundary.** The whole vertical slice minus bytes, exactly as PR-11 was for documents.

**Database.** `memories` + `memory_members`, one migration. **Storage.** None.
**RLS.** The policies in §6. `can_see_record` unedited; zero new helpers.

**App.** `src/services/memory.ts` — gateway, vocabulary (`VISIBILITY_LABELS`, `VISIBILITY_HINTS`,
precision labels), validation, `describeMemoryError`, and pure view helpers. `MemoryFields.tsx` built
on `ChipGroup`. List, detail and a `new.tsx` modal under `app/(app)/(tabs)/memories/`.

**Tests.** `memory.test.ts` (gateway fakes) + `memory.rls.test.ts`: author-only write, guest reads
nothing, private invisible to the owner, a revoked author loses their own private memory, and the
positive case beside each.

**Reuse.** `ChipGroup`, `Screen`, `EmptyState`, `LockedNotice`, `Button`, `TextField`,
`relativeTime.ts`, the `save()` + `useFocusEffect` pattern, and the field shapes in
`DocumentFields.tsx`.

**Edge cases.** Unknown date sorts last under its own heading. A future `occurred_on` is allowed. A
memory with a title and nothing else is valid.

**Cut line.** The archive/restore pair. Delete and the honest confirmation stay; archiving is the
first thing that can wait without leaving anything incorrect.

## PR-18 — Memory Photos

**Purpose.** Attach photos to a memory, see them as a grid, open one, share it out.

**Why this boundary.** Bytes are their own risk surface; PR-14 taught that upload and viewing are two
PRs, not one.

**Database.** `memory_files`. **Storage.** The four functions and the trigger from §5.
**RLS.** Read/write split from the first migration (§5.2).

**App.** The `uploadRecordFile` refactor (§3.1), a photo grid on the detail screen, a viewer route
following `[fileId].tsx`.

**Tests.** `memory-storage.rls.test.ts` — and **name each test after the condition it depends on.**
PR-15a's four storage tests said *"another member cannot reach these bytes"* when the requirement was
*"only somebody who can read the row can reach its bytes"*; the two agreed exactly until sharing
shipped, and *"a suite cannot tell which one it is defending while they agree."*

**Edge cases.** **Compress at pick time** (`quality` on `expo-image-picker`) — at 10MB per file
against a 1GB ceiling this is a requirement, not polish. A failed attach orphans bytes by design
(Phase 12 sweeps). Reload the list in `finally`, never on the success path — *"the list is least
trustworthy at exactly the moment something went wrong."*

**Cut line.** The full-screen viewer. A grid that uploads and shares out is the honest minimum.

## PR-19 — Voice Memories

**Purpose.** Record a voice note into a memory, and play it back.

**Database.** `memory_files.duration_seconds`; bucket `allowed_mime_types` extended with audio,
mirrored in `ALLOWED_MIME_TYPES`. **Storage.** Nothing new — same allocator, attach RPC and
predicates. **RLS.** No change. *That is the evidence §3.1 and §5.2 were right.*

**App.** `npx expo install expo-audio`. `NSMicrophoneUsageDescription` and the config plugin in
`app.json` for production builds — **Expo Go already carries the permission, so the stream demo works
without a dev build.** A `VoiceRecorder` (record / stop / re-record / discard, elapsed time) and a
`VoicePlayer` (play / pause, progress).

**Tests.** Duration and MIME validation in `memory.test.ts`; one RLS test that an audio object obeys
the same read predicate as a photo. Recorder and player are **device-verified on stream** — they need
hardware, and `docs/16` records that airplane mode is not a usable failure-injection technique
because it kills Metro too.

**Edge cases.** Permission denied → explain, never fail silently. Recording interrupted by a call.
**Cap the duration (~5 minutes)** — an unbounded recorder against a 10MB file cap fails at *upload*,
which is the worst possible place to discover it. Leaving the screen mid-recording must stop and
discard.

**Cut line.** Playback progress. Play/pause alone is honest.

## PR-20 — Albums

**Purpose.** Group memories into a named collection with a cover, and browse it.

**Database.** `albums` + `album_memories`. **Storage.** None — a cover references a memory's existing
photo.

**RLS.** Album policies mirror memories. **`album_memories` requires both sides visible** (§6.1), and
the headline test of this PR is that a `family` album containing a `private` memory does not disclose
that memory's id to another member.

**Edge cases.** A memory may sit in several albums. Deleting an album must not delete its memories.
A deleted cover memory falls back rather than dangling.

**Cut line.** `position` and manual reordering — date order is a good default.

---

# 10. Test strategy

- **Every PR ships RLS tests.** Non-negotiable per `CLAUDE.md`.
- **Name each test after the condition it depends on**, not the outcome it happens to produce (§7.1
  of `docs/16`, and PR-18 above).
- **Assert twice on every write attack** — what the attacker got back (`data: []`, `error: null`) and
  what the victim still sees. Under RLS a delete matching no visible row *reports success*.
- **Always pair a positive case.** A policy that denies everything passes every negative test while
  making the product unusable.
- **Check the bytes and the row together.** PR-14a's 21 storage tests passed while the feature was
  broken, because not one of them re-listed the rows.
- Recorder, player and photo grid are **device-verified on stream** — the demo doubles as the test,
  per `CLAUDE.md`'s testing split.

---

# 11. Deliberately deferred

| Item | Where it belongs |
|---|---|
| **Video** | Phase 12, with the file-size cap it depends on (§3.3) |
| **Memory Timeline surface** | Phase 7, where `timeline` is already an IA domain (§3.2) |
| **Transcription, AI summarisation, waveforms, background recording, streaming audio** | Phase 9 at the earliest; no FR requires any of them |
| **Thumbnails** | Slot reserved by `memory_files.kind`; Supabase image transforms are Pro-only |
| **Per-record ACLs** ("just Mum and Dad") | Still Phase 10, `docs/15` §10 — unchanged and re-argued, not inherited |
| **Tags, locations as entities, faces, "on this day"** | Unscheduled. None is required by an FR |
| **Soft-delete UI** | `deleted_at` remains set by nothing, as with documents. It needs a restore screen to mean anything |
| ~~**`location` on a memory**~~ | ~~Cut from §4.1. `docs/08` §9 wants it, but a free-text field with no map, no geocoding and no search is a string that looks like a feature~~ **Reversed 2026-08-17, on the product owner's instruction, and shipped in PR-17.** The objection was to the *implied* feature, not the column, and it is answered by scoping the column honestly rather than by omitting it: `location` is free text, the field is labelled "Where", and there is no map, no geocoding and no search over it — none of which is claimed anywhere in the UI. It costs one nullable column and appears in the line under a memory's title, where "Nani's house" is exactly the context `docs/10` §13 asks for. Geocoding, a map and place-based search remain unscheduled and are not implied by this |

---

# 12. Before the first line of PR-17

- [x] Shared vs per-domain file tables (§3.1)
- [x] Five capabilities into four slots (§3.2)
- [x] Video in or out (§3.3)
- [x] Subject branch on private memories (§3.4)
- [x] Which audio package, verified against SDK 54 (§7.1)
- [x] `src/navigation/domains.ts` said `documents.arrivesIn: 'Phase 3'`. **Fixed in PR-17** →
      `'Shipped'`. `memories` deliberately stays `'Phase 4'`: the field records where a domain *gets
      built*, and the phase is not finished — PR-17 shipped memories, PR-18 to PR-20 ship
      photographs, voice and albums. It becomes `'Shipped'` at PR-20. Note that after PR-17 the
      field is no longer rendered for any tab domain at all; only `MORE_DOMAINS` shows it.
- [ ] Run `npm ci && npm run typecheck && npm test` before pushing anything that touched
      dependencies. `npm install` and `npm ci` disagree, and CI runs the second.
- [ ] Check the LAN IP in `.env.local` against `ip -4 addr` **first** when RLS tests die with
      `fetch failed`. It is DHCP-assigned and has changed twice.

---

# 13. Next Document

None planned. This document is revised whenever a Phase 4 decision above is reversed, with the
original kept in place and the reversal dated beneath it — the convention `docs/16` established and
was vindicated by five times over.
