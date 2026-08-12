# 📄 Phase 3 Brief — "Preserve What Matters"

**Project:** Family Knowledge Vault

**Version:** 1.2

**Status:** Written 2026-08-06 at the close of Phase 2, and amended four times as the phase taught
things the brief could not have known. **PR-11 through PR-14b are shipped; PR-15 is the last.**

Original problem statements are kept in place with their dated resolutions appended, so the reasoning
survives alongside the answer — and where a resolution was later *reversed*, both are shown. Two were:

| Amended | What changed, and why it matters |
|---|---|
| 08-07 | Every open §9 decision settled — see `docs/17` |
| 08-09 | **Every document became author-only** after a privilege escalation found on a device (`docs/15` §8.4). This reversed §6.1: PR-15 had been vacated because "within a family is already served by `visibility`", which stopped being true |
| 08-11 | The `has_family_access` storage predicate in §3.1 was **unsafe** under the new model and gained an author conjunct (`docs/15` §9.1) |
| 08-12 | §5's "PDF in a WebView" **could never have worked** — Android's WebView cannot render PDFs |

**The pattern worth carrying into Phase 4:** three of those four came from running the app on a real
device, not from the 655 automated tests. Twice the tests were *asserting the wrong behaviour was
correct*.

---

# 1. Purpose

This document exists so that a session starting Phase 3 does not have to re-derive Phase 2's
conclusions, and does not have to discover Phase 3's unmade decisions halfway through a stream.

It is the same instrument as `docs/15-permission-matrix.md`, which was written before PR-9a and
found two privilege-escalation holes before they shipped. That is the precedent and the
justification.

**Read in this order:** `CLAUDE.md` → `.claude/current-session.md` (jump to the last checkpoint) →
this file → `docs/15-permission-matrix.md` §8 and §9. Everything else in `docs/` is background.

**Where this document and an earlier one disagree, check the date.** `docs/15` is authoritative on
permissions and visibility; this one is authoritative on what Phase 3 must decide.

---

# 2. The good news: the permission work is done

`.claude/current-session.md` recorded this as PR-9a's whole point, and it held:

> **PR-11 is the first to use them, and its only job on this front is to copy the spine from
> `docs/15-permission-matrix.md` §8.2 — it does no permission design.**

Shipped and tested by direct call in `permissions.rls.test.ts`:

| Helper | Owner | Admin | Member | Guest |
|---|:--:|:--:|:--:|:--:|
| `can_read_records(family)` | ✓ | ✓ | ✓ | — |
| `can_write_records(family)` | ✓ | ✓ | ✓ | — |
| `can_delete_records(family)` | ✓ | ✓ | — | — |
| `can_see_record(family, visibility, member, author)` | the single resolver | | | |

**Do not write a new helper, and do not put a role name in a policy.** If a record table seems to
need a permission the helpers do not express, that is a finding worth raising, not a reason to
inline `role = 'admin'` somewhere.

## 2.1 The spine every record table copies — verbatim from §8.2

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

And the SELECT policy is exactly this, on every record table, with no additions:

```sql
using (public.can_see_record(family_id, visibility, member_id, created_by)
       and deleted_at is null)
```

`created_by` is the one column that genuinely cannot be added later — there is no way to backfill
who created an existing row. `public.touch_updated_at()` already exists from PR-7; reuse it.

## 2.2 What Phase 2 proved about writing to these tables

- **Writes with preconditions belong in a `SECURITY DEFINER` function, not a policy.** Four
  instances now: `create_family`, `redeem_invitation`, `set_family_role`, `remove_family_access`.
  A policy can gate *who* writes but cannot pin *which row*, *what value*, or hold a lock.
- **New tables need both policies and grants.** RLS only narrows what SQL privileges already allow,
  and CLI-created tables inherit nothing. Only an integration test tells you which is missing.
- **Every definer function sets `search_path = ''`** and fully qualifies every object.

---

# 3. Storage

*As written, this section had one decided item and five open ones. All six are now settled; the
original framing is preserved below with each resolution appended.*

## 3.1 Decided (matrix §9.1), and expensive to change later

> Storage paths are **`<family_id>/<record_id>/<filename>`**. `storage.objects` has its own policy
> system: **an invisible row does not make its file unreachable.** The storage policy checks
> `has_family_access((storage.foldername(name))[1]::uuid)`. Files belonging to `private` records
> rely on signed URLs issued only after a successful row read.

Note the asymmetry deliberately baked in: the *bucket* policy is `has_family_access` — tenant-level,
role-blind — while the *row* policy is `can_see_record`. A private record's file is therefore
protected by never handing out a URL for it, not by the storage policy. **Anything that mints a
signed URL must read the row first.**

> **Amended 2026-08-06 (`docs/17` §10.3).** The final path segment is now a generated uuid plus
> extension — `<family_id>/<document_id>/<uuid>.<ext>` — with the user's `original_filename` kept as
> an ordinary column for display. **Segment 1 is unchanged, so the `has_family_access` predicate
> above is untouched.** Everything else in §3.1 stands.

## 3.2 Was undecided, and blocking PR-14 at the latest

Nothing in the repository named any of these. They were the brief's real work:

| Decision | Why it matters | Suggested default |
|---|---|---|
| **Bucket name and public/private** | Cannot be changed without moving every file | One private bucket, e.g. `family-files` |
| **MIME allow-list** | An unrestricted bucket accepts anything a phone can produce | Images + PDF for Phase 3; widen per phase |
| **Maximum file size** | The free tier is ~1GB total, for every family | Pick a number and enforce it in the bucket, not just the client |
| **Thumbnails** | A document list that downloads full-size scans burns the bandwidth cap on scrolling | Consider deferring; note the cost |
| **Filename sanitisation** | A user-supplied filename becomes part of a storage path | Decide before the first upload lands |

### Decided, 2026-08-06 (during the review recorded in `docs/17`)

| Decision | Settled as |
|---|---|
| **Bucket** | One **private** bucket, `family-files` |
| **MIME allow-list** | `image/jpeg`, `image/png`, `image/heic`, `image/webp`, `application/pdf`. Phase 4 adds audio and video |
| **Maximum file size** | **10MB per file**, enforced at the bucket *and* validated client-side for a legible error. The arithmetic, stated plainly: 1GB ÷ 10MB ≈ 100 files **across every family**. Honest, not comfortable — Phase 12 is the designated revisit |
| **Thumbnails** | **Deferred** (Supabase image transformation is Pro-only). The *slot* is created now: `document_files.kind in ('original','thumbnail')`, so adding them later is rows rather than a migration of every file |
| **Filename sanitisation** | **Dissolved, not solved.** The stored name is never user-supplied — see the §3.1 amendment |

**The bucket is created by a migration, not by `config.toml`.** A `[storage.buckets.*]` block
provisions the *local* stack only; production would be missing it, and the divergence would surface
as a failed upload after deploy. `insert into storage.buckets (…)` in a migration provisions both and
travels with `db push` — the append-only migration rule, applied to storage.

> **Built 2026-08-11 in `20260811090000_document_storage.sql`** — not the PR-11 migration this
> section originally named. Every decision above is enforced there: private bucket, the 10MB cap on
> the bucket row (`config.toml`'s 50MiB global is only a ceiling), and the five-MIME allow-list.

## 3.3 The free-tier ceiling is a real constraint, not a footnote

From `docs/14` §4: **~500MB database, ~1GB file storage, ~5GB bandwidth per month.**

> "Storage growth (photos, videos, voice notes) will approach the 1GB free cap well before
> meaningful scale. Phase 12's 'Storage Management' PR is the designated checkpoint to revisit
> upgrading."

Phase 3 is the first phase that consumes this. Two consequences worth designing around now: a
document list should not fetch originals, and the demo account on stream will accumulate files
across sessions.

> **Amended 2026-08-07.** The second consequence no longer applies. Development moved to a **local
> Supabase stack in Docker**, so streams, tests and experiments consume none of the hosted free tier
> — only real users do. The first consequence stands, and now stands on its own merits rather than
> on quota anxiety: a list that downloads full-size scans is bad on a phone regardless of who pays.
> See `docs/17` §12.

---

# 4. The five PRs

`docs/14` §7 gives one line for the whole phase. This is the operative reading of it.

| PR | Scope | Notes |
|---|---|---|
| **11 Document Library** | `documents` table on the spine, list screen, service + RLS tests | The vertical slice must include *something* reaching the screen. No permission design. |
| **12 Categories** | Identity / Medical / Finance / Property / Education / Legal, per IA §4 | Decide: a column with a check constraint, or a table. A fixed list argues for the column. |
| **13 Viewer** | ~~Open a document~~ → **Document detail: rename, re-file, visibility, AI consent, archive, delete.** See the amendment below. | The over-2h budget no longer applies — it existed only for `react-native-pdf`, and §5 settled on a WebView. |
| **14a Upload** | Bucket, `storage.objects` policies, path allocator, picker, upload with real progress | Where §3.2's decisions come due. **Split confirmed — see the amendment below.** |
| **14b Preview** | Open an attached file; images preview in-app, PDFs open in the device's own reader; share sheet for "Download" | FR-014's last two actions. **No WebView** — see §5's correction. |
| **15 Sharing** | **Un-vacated 2026-08-09 — sharing, properly.** Every document is now author-only, so this is the PR that decides how one reaches anybody else. | Restores `visibility` to the UI and either `member_id` or a `record_shares` table (matrix §10) to the resolver. Read the §8.4 amendment first. |

Phase 4 (Memories) and Phase 5 (Medical) both explicitly reuse this phase's upload and CRUD
patterns, so a shortcut taken here is taken three times.

### Amendment, 2026-08-09: PR-13 and PR-14 were sequenced backwards

**"Viewer — open a document" came before "Upload", so there was nothing to open.** Caught before
PR-13 started rather than during it.

The fix is not a reordering, because FR-014's six actions split cleanly along exactly this line:

| Needs a file | Does not |
|---|---|
| Preview, Download | Rename, **Move** (re-file), Archive, Delete |

So **PR-13 opens the *record*** — the detail screen those four actions belong on — and **Preview and
Download join PR-14**, slotting into a screen that already exists rather than being invented
alongside an upload flow.

Two things this also fixes. `setDocumentCategory` shipped in PR-12 with a policy and tests and **no
control**, which is the "capability with no interface" pattern this project has now hit four times;
the detail screen is where it belongs. And `visibility` and `ai_processing` have been columns since
PR-11 with no way to change them — same screen, same reason.

Swapping 13 and 14 instead was considered and rejected: PR-14 is already the heaviest PR of the
phase (bucket, `storage.objects` policies, the path function, picker, progress, storage RLS tests)
and would still have had to invent a detail screen afterwards.

### And then PR-13 found a hole, which changed the model

Demoing the subject picker showed that **naming somebody in "About" granted them read *and write***
— including the ability to publish a private document to the whole family. See the `docs/15` §8.4
amendment for the mechanism.

The correction, in migration `20260810090000`:

- **Every document is private. Only its author reads, writes or deletes it** — not the family Owner,
  not the person it is about.
- **`member_id` is now a pure label**, renamed "Belongs to", with no permission effect whatsoever.
- **`visibility` has no control.** The column keeps both values so PR-15 has somewhere to go, but
  nothing in the UI can publish a document before sharing has been designed.
- **PR-15 is un-vacated**, and is where "who can see this" gets thought through rather than falling
  out of a subject column.

The generalisable lesson, since Phases 4–6 reuse this table's shape: *"who is this record about"* and
*"who may read this record"* are different questions. A column answering both is an escalation
waiting to be noticed.

### And PR-14 split, 2026-08-11 — bytes in, then bytes out

**14a is bytes in**: the bucket, the `storage.objects` policies, the path allocator, the picker and
upload with a real percentage. **14b is bytes out**: preview and download, FR-014's last two actions.

Each is demoable on its own, and 14b lands in a detail screen that already exists rather than being
invented alongside an upload flow.

**Three things 14a changed that were decided elsewhere and are worth finding from here:**

1. **The §9.1 storage predicate was unsafe and is corrected.** `has_family_access(segment 1)` is
   tenant-level and role-blind; after 20260810090000 it would have let any family member fetch the
   bytes of a document they cannot read. The policies now also check the author on segment 2. See the
   `docs/15` §9.1 amendment.
2. **`unique (document_id, kind, version)` was replaced.** It forced the second page of a passport to
   claim it superseded the first. `version` still means *revision* and stays at 1; uniqueness is now
   on the object.
3. **NFR-007 is met with a real percentage**, via `XMLHttpRequest` rather than supabase-js, which
   exposes no upload progress on React Native.

---

# 5. The one thing that changes the workflow

**`react-native-pdf` is not an Expo module.** It needs a native build — a dev client or a prebuild —
and this project demos on **Expo Go, pinned to SDK 54** because that is what the Play Store version
could open (see the PR-1 checkpoint). No document mentions this.

So PR-13 has a decision before it has code:

- Render PDFs in a `WebView` (works in Expo Go, worse experience), or
- Move to an EAS dev build (better viewer, but every future stream needs the new client, and PR-1
  rejected EAS builds mid-stream as too slow), or
- Ship images-only in Phase 3 and defer PDF rendering.

Whichever is chosen, **decide it before the stream starts**, not during PR-13.

### Decided, 2026-08-06: images plus PDF in a WebView. **The demo stays on Expo Go.**

The storage architecture review removed the *other* reason Phase 3 might have needed a dev build —
Google OAuth is off the table (`docs/17` §4.3) — and PR-1 already rejected EAS builds mid-stream as
too slow.

**The dev build gets a natural home instead: Phase 10**, where `docs/14` already records that deep
linking is needed for Emergency Mode grant redemption. One migration, one phase, one decision —
rather than two half-reasons in Phase 3.

### Corrected 2026-08-12: the WebView never could have worked

**Android's WebView cannot render a PDF.** iOS has a built-in viewer; Android does not, so a PDF
handed to a WebView downloads instead of displaying. The decision above chose a WebView to avoid a
dev build and was made without that fact — on the one platform this project demos on, it would have
shipped a blank box.

**The usual workaround is rejected on privacy grounds, not weighed against them.** Google's document
viewer (`docs.google.com/gview?url=…`) renders any PDF it can fetch, which means handing it a URL to
a family's private papers. For a product whose thesis is that a family's information stays theirs,
that is disqualifying — the same reasoning `docs/17` used to decline Google Drive.

**PDFs open in the device's own reader**, via the share sheet: private, works in Expo Go on both
platforms, needs no dev build, and uses software the user already trusts. Images still preview
in-app.

Two consequences worth carrying forward:

- **`react-native-webview` is not needed at all.** It was the only package §8 still listed as
  pending, and it is now removed rather than deferred.
- **In-app PDF rendering is still possible later**, by bundling `pdf.js` (~1MB of assets, its own PR)
  or with Phase 10's dev build. What is ruled out permanently is sending the file to a third party
  to be rendered.

---

# 6. Contradictions in the existing docs — flag, do not silently resolve

## 6.1 "Document Sharing" (PR-15) means two different things

- **Within a family** — already served by `visibility`, and per-record ACLs are explicitly scheduled
  for Phase 10 (matrix §10: "adds a `shared` visibility value and a `record_shares` table").
- **Between families** — `docs/08` §22 says families "must remain completely isolated… unless
  explicitly shared", and matrix §10 records that **no mechanism has ever been designed**.

If PR-15 means the second, it is not a 2-hour PR and it changes the schema. Settle this before
PR-11, because the answer affects what `documents` carries.

### Decided, 2026-08-06: **within-family only — which leaves PR-15 with nothing to build.**

Within a family is already served by `visibility` on the spine. Per-record ACLs stay in Phase 10,
where matrix §8.1 makes them one function-body edit. Cross-family sharing stays undesigned and out
of Phase 3.

**PR-15's slot is therefore vacant.** Candidates: the document detail/edit screen, or the export
feature (`docs/17` §11). Recorded as open rather than quietly filled.

> **Superseded 2026-08-09 — the premise stopped being true.** This decision rested on *"within a
> family is already served by `visibility`"*. It is not: migration `20260810090000` made every
> document readable **only by its author**, so nothing is shared with anybody by any mechanism.
> PR-15 is un-vacated and is now where sharing gets designed. The detail screen went to PR-13
> instead, and export is re-homed (see §4's amendment).

## 6.2 A document may relate to *multiple* members

`docs/08` §7: *"A document may relate to: Family / **Multiple Members** / Timeline Events / Medical
Records / Inventory Items"* and *"Documents are reusable across domains without duplication."*

The frozen spine gives one nullable `member_id`. These do not agree. Options are a join table
(`document_members`), or accepting one primary member for now and recording the gap. **The spine is
frozen; a join table is additive and does not violate it.** Decide explicitly.

### Decided, 2026-08-06: **multiple — but the extra links are not permission-bearing.**

Both requirements survive:

- **`member_id` on the spine stays the *primary subject*** and remains the only thing
  `can_see_record(family, visibility, subject, author)` consults. The resolver is unchanged.
- **A `document_members` join table adds further links, for organisation and filtering only.**

> **This distinction is load-bearing and must be documented at the point the table is created.** If a
> join-table link granted visibility, any member could link themselves to a private document and read
> it — a privilege-escalation hole of exactly the kind `docs/15` was written to catch, and a third
> instance of *"an authorisation rule is rarely a single rank comparison."*

## 6.3 Archive is not soft delete

FR-014 lists **Archive** as a document action. IA §4 lists **Archived** as a peer of the six
categories. `docs/08` §20 defines the lifecycle as `Active → Archived → Soft Deleted → Permanent`.
The spine has only `deleted_at`.

Three different models. Pick one and write it down.

### Decided, 2026-08-06: **they are different columns, and all three models survive.**

- **`deleted_at`** — soft delete. Already in the spine, already filtered by the mandatory SELECT
  policy. Untouched.
- **`archived_at`** — new, nullable. Archived rows stay *visible to the policy* and are filtered in
  the query and the UI, which is what lets "Archived" work as a peer of the six categories in IA §4
  while remaining an action per FR-014.

Additive to the spine; the mandatory SELECT policy gains nothing.

## 6.4 Versioning

FR-015: *"Documents shall maintain version history where applicable."* `docs/08` §21 lists documents
first among entities that should preserve history. Nothing in Phase 3's plan mentions it. Either
schedule it or record it as deferred — it is the kind of thing that is very expensive to add after
a thousand files exist.

### Decided, 2026-08-06: **the schema makes room; the feature is deferred.**

`document_files` carries `version` and `kind` from PR-11, so multiple objects per document are
representable on day one. **No versioning UI ships in Phase 3.** This is the cheap half of the
expensive problem: the thing that costs money after a thousand files is the *table shape*, not the
screen.

---

# 7. What the product must feel like

`docs/10` §13 is the constraint most likely to be lost while wiring an upload flow:

> Instead of `Passport.pdf`, users should see:
> **Dad's Passport** · Expires March 2033 · Verified · Last updated two months ago
>
> **Context is more valuable than filenames.**

And §2: *"Users should never feel like they are managing files."* §15 asks empty states to educate
rather than report: *"Let's begin preserving your family's important documents."*

`src/lib/relativeTime.ts` was written in PR-10 and already produces "two months ago" for exactly
this.

---

# 8. Packages Phase 3 will add

~~None of these are installed yet:~~ **Installed in PR-14a** via `npx expo install`, which resolves
against the pinned SDK rather than latest: `expo-image-picker` ~17.0.11, `expo-document-picker`
~14.0.8, `expo-file-system` ~19.0.23. **14b added `expo-sharing` ~14.0.8 and nothing else.**

~~Still pending for **14b**: `react-native-webview`, per §5's WebView decision.~~ **Not needed** —
§5's correction means PDFs open in the device's own reader rather than in a WebView that could not
have rendered them on Android.

**`base64-arraybuffer` is not needed**, though Supabase's own React Native storage guide recommends
it. SDK 54's rewritten `expo-file-system` gives `new File(uri).bytes()` returning a `Uint8Array`
directly — the guide predates that API. Check each against **Expo SDK 54**, not latest; the SDK pin
is deliberate and documented in the README.

Run `npm ci && npm run typecheck && npm test` before pushing anything that touched dependencies.
`npm install` and `npm ci` disagree, and CI runs the second (see the PR-3 checkpoint).

---

# 9. Before the first line of PR-11

**All settled 2026-08-06, during the storage architecture review (`docs/17`).**

- [x] Decide what PR-15 "Sharing" means (§6.1) → ~~within-family only; PR-15's slot is vacated~~
      → **reopened 2026-08-09. Every document is author-only, so PR-15 designs sharing.** See §6.1.
- [x] Decide single vs multiple members per document (§6.2) → **multiple, via a
      `document_members` join table that is explicitly *not* permission-bearing.**
- [x] Decide archive vs soft delete (§6.3) → **separate columns: `archived_at` and `deleted_at`.**
- [x] Decide the bucket name, MIME allow-list and size cap (§3.2) → **private `family-files`;
      images + PDF; 10MB.** Created by migration, not `config.toml`.
- [x] Decide the PDF strategy, and therefore whether the demo stays on Expo Go (§5) → ~~WebView~~
      **corrected 2026-08-12: Android's WebView cannot render PDFs, so they open in the device's own
      reader. The demo still stays on Expo Go.** See §5. Originally: **WebView.
      The demo stays on Expo Go; the dev build moves to Phase 10.**

**Plus the two items §3.2 listed and this checklist originally dropped:**

- [x] **Thumbnails** → deferred, but `document_files.kind` reserves the slot.
- [x] **Filename sanitisation** → dissolved: the stored name is a uuid, never user input (§3.1
      amendment).

The first three changed the schema. The last two changed the stream.

## 9.1 What PR-11 therefore carries

- `documents` — the spine, plus `archived_at` and `ai_processing`.
- `document_files` — `provider`, `provider_file_id`, `kind`, `version`, `mime_type`, `size_bytes`,
  `checksum`, `original_filename`. **Named `provider_file_id`, never `storage_path`** — the name is
  what teaches every future service whether that value is an opaque identifier or a path
  (`docs/17` §10).
- `document_members` — the join table, documented as non-permission-bearing.
- ~~The `family-files` bucket and its `storage.objects` policies, **in the migration**, with a
  matching `storage.rls.test.ts`.~~
- ~~**One `SECURITY DEFINER` function that is the only thing in the system constructing a storage
  path.** No client ever builds one.~~
- `src/services/document.ts` following the existing `XGateway` + `createSupabaseXGateway` shape.

> **Corrected 2026-08-11.** The two struck items never belonged to PR-11 and were not built by it.
> PR-11's own migration says so at the top: *"No bucket and no storage.objects policies here. Those
> arrive in PR-14 with the upload flow that gives them a caller — this project has three times
> shipped a capability reachable only by its tests, and an empty bucket governed by untested
> policies would be the fourth."*
>
> The migration is later than this list and is the shipped reality. **PR-14a owns the bucket, the
> storage policies, the path allocator and `storage.rls.test.ts`**, and has now built all four. This
> is recorded rather than quietly deleted because a session reading the list would have assumed the
> work existed and skipped it.

`ai_processing` ships now rather than in Phase 9 deliberately: retrofitting consent onto existing
rows is the backfill bug class this project has already been bitten by, and Phase 9 is far too late
to ask a user whether their passport may be read.

---

# 10. Next Document

None. Phase 3's own checkpoints go in `.claude/current-session.md`, and any decision this brief
lists as open should be recorded there when it is made — or here, if it turns out to govern the
whole phase.
