# 📄 Phase 3 Brief — "Preserve What Matters"

**Project:** Family Knowledge Vault

**Version:** 1.0

**Status:** Written 2026-08-06, at the close of Phase 2, before PR-11 starts.

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

# 3. Storage — decided, and undecided

## 3.1 Decided (matrix §9.1), and expensive to change later

> Storage paths are **`<family_id>/<record_id>/<filename>`**. `storage.objects` has its own policy
> system: **an invisible row does not make its file unreachable.** The storage policy checks
> `has_family_access((storage.foldername(name))[1]::uuid)`. Files belonging to `private` records
> rely on signed URLs issued only after a successful row read.

Note the asymmetry deliberately baked in: the *bucket* policy is `has_family_access` — tenant-level,
role-blind — while the *row* policy is `can_see_record`. A private record's file is therefore
protected by never handing out a URL for it, not by the storage policy. **Anything that mints a
signed URL must read the row first.**

## 3.2 Undecided, and blocking PR-14 at the latest

Nothing in the repository names any of these. They are the brief's real work:

| Decision | Why it matters | Suggested default |
|---|---|---|
| **Bucket name and public/private** | Cannot be changed without moving every file | One private bucket, e.g. `family-files` |
| **MIME allow-list** | An unrestricted bucket accepts anything a phone can produce | Images + PDF for Phase 3; widen per phase |
| **Maximum file size** | The free tier is ~1GB total, for every family | Pick a number and enforce it in the bucket, not just the client |
| **Thumbnails** | A document list that downloads full-size scans burns the bandwidth cap on scrolling | Consider deferring; note the cost |
| **Filename sanitisation** | A user-supplied filename becomes part of a storage path | Decide before the first upload lands |

## 3.3 The free-tier ceiling is a real constraint, not a footnote

From `docs/14` §4: **~500MB database, ~1GB file storage, ~5GB bandwidth per month.**

> "Storage growth (photos, videos, voice notes) will approach the 1GB free cap well before
> meaningful scale. Phase 12's 'Storage Management' PR is the designated checkpoint to revisit
> upgrading."

Phase 3 is the first phase that consumes this. Two consequences worth designing around now: a
document list should not fetch originals, and the demo account on stream will accumulate files
across sessions.

---

# 4. The five PRs

`docs/14` §7 gives one line for the whole phase. This is the operative reading of it.

| PR | Scope | Notes |
|---|---|---|
| **11 Document Library** | `documents` table on the spine, list screen, service + RLS tests | The vertical slice must include *something* reaching the screen. No permission design. |
| **12 Categories** | Identity / Medical / Finance / Property / Education / Legal, per IA §4 | Decide: a column with a check constraint, or a table. A fixed list argues for the column. |
| **13 Viewer** | Open a document | **Budget over 2h.** See §5 on `react-native-pdf`. |
| **14 Upload** | Expo ImagePicker / DocumentPicker → Supabase Storage | Where §3.2's decisions come due. NFR-007 requires visible progress. |
| **15 Sharing** | **Undefined — see §6.1** | Do not start this PR until it means something specific. |

Phase 4 (Memories) and Phase 5 (Medical) both explicitly reuse this phase's upload and CRUD
patterns, so a shortcut taken here is taken three times.

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

---

# 6. Contradictions in the existing docs — flag, do not silently resolve

## 6.1 "Document Sharing" (PR-15) means two different things

- **Within a family** — already served by `visibility`, and per-record ACLs are explicitly scheduled
  for Phase 10 (matrix §10: "adds a `shared` visibility value and a `record_shares` table").
- **Between families** — `docs/08` §22 says families "must remain completely isolated… unless
  explicitly shared", and matrix §10 records that **no mechanism has ever been designed**.

If PR-15 means the second, it is not a 2-hour PR and it changes the schema. Settle this before
PR-11, because the answer affects what `documents` carries.

## 6.2 A document may relate to *multiple* members

`docs/08` §7: *"A document may relate to: Family / **Multiple Members** / Timeline Events / Medical
Records / Inventory Items"* and *"Documents are reusable across domains without duplication."*

The frozen spine gives one nullable `member_id`. These do not agree. Options are a join table
(`document_members`), or accepting one primary member for now and recording the gap. **The spine is
frozen; a join table is additive and does not violate it.** Decide explicitly.

## 6.3 Archive is not soft delete

FR-014 lists **Archive** as a document action. IA §4 lists **Archived** as a peer of the six
categories. `docs/08` §20 defines the lifecycle as `Active → Archived → Soft Deleted → Permanent`.
The spine has only `deleted_at`.

Three different models. Pick one and write it down.

## 6.4 Versioning

FR-015: *"Documents shall maintain version history where applicable."* `docs/08` §21 lists documents
first among entities that should preserve history. Nothing in Phase 3's plan mentions it. Either
schedule it or record it as deferred — it is the kind of thing that is very expensive to add after
a thousand files exist.

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

None of these are installed yet: `expo-image-picker`, `expo-document-picker`, `expo-file-system`,
and — subject to §5 — `react-native-pdf` or a WebView. Check each against **Expo SDK 54**, not
latest; the SDK pin is deliberate and documented in the README.

Run `npm ci && npm run typecheck && npm test` before pushing anything that touched dependencies.
`npm install` and `npm ci` disagree, and CI runs the second (see the PR-3 checkpoint).

---

# 9. Before the first line of PR-11

- [ ] Decide what PR-15 "Sharing" means (§6.1).
- [ ] Decide single vs multiple members per document (§6.2).
- [ ] Decide archive vs soft delete (§6.3).
- [ ] Decide the bucket name, MIME allow-list and size cap (§3.2).
- [ ] Decide the PDF strategy, and therefore whether the demo stays on Expo Go (§5).

The first three change the schema. The last two change the stream.

---

# 10. Next Document

None. Phase 3's own checkpoints go in `.claude/current-session.md`, and any decision this brief
lists as open should be recorded there when it is made — or here, if it turns out to govern the
whole phase.
