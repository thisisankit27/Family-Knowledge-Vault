# 🗄️ Storage Architecture Review — before PR-11

**Project:** Family Knowledge Vault

**Version:** 1.0

**Status:** Written 2026-08-06, after `docs/16-phase-3-brief.md`, before PR-11 starts.

---

# 1. Purpose

Phase 3 is the first phase that writes a byte to disk. Before it started, a proposal arrived to
change the foundation: **stop being a storage provider, and let users bring their own Google Drive.**

This document is the record of that review — the verdict, the evidence, and the decisions that
follow. It exists for the same reason `docs/15` and `docs/16` exist: so that nobody re-opens a
settled question without first reading why it was settled, and so that if the answer ever changes,
the change is deliberate.

**Where this document and an earlier one disagree, check the date.** This one is authoritative on
storage architecture. `docs/15` remains authoritative on permissions, and §9.1 of it is **amended
here** (see §10.3).

---

# 2. What was proposed

Three architectures were on the table.

| | Description |
|---|---|
| **A** | *(status quo)* Family Knowledge Vault owns storage — Supabase Storage plus metadata in Postgres. |
| **B** | Users own their storage. They connect Google Drive; FKV becomes an intelligence and orchestration layer over bytes it does not hold. Three AI privacy modes govern what the app may read. |
| **C** | *(raised during the review)* Ship on Supabase, but avoid hard-coding Supabase assumptions into the data model, so a second provider stays possible. |

A fourth idea — a **`LocalStorageProvider`** for development and testing only — was raised last and is
answered in §12.

---

# 3. Verdict

**Architecture A ships in Phase 3. Architecture C is adopted, at near-zero cost. Architecture B is
declined as a foundation and recorded as a Phase 12 candidate.**

The proposal was trying to buy three things: **privacy**, **user ownership**, and **escape from the
1GB free tier**. It is a good instinct aimed at the wrong lever.

- **Storage location does not deliver privacy.** Google can read a user's Drive. Moving bytes there
  adds a party rather than removing one. Privacy comes from **encryption** — which `docs/14` §7
  already commits to for Digital Legacy.
- **Storage location does not deliver ownership.** **Export** does, and that is roughly one PR.
- **It does deliver cost relief.** That is the one real win, and §9 explains why the price is one
  this project specifically cannot pay.

---

# 4. Can Google Drive support the proposed architecture?

**No — and the reason is structural, not a matter of effort.**

## 4.1 There is no folder-scoped OAuth

The proposal assumes "grant access to one dedicated folder." Google does not offer that shape. It
offers two others:

| Scope | What it is | Why it fails |
|---|---|---|
| `drive.appdata` | A **hidden** folder, invisible in the Drive UI | Defeats the premise — the user cannot see or manage "their own files" |
| `drive.file` | **Per-file.** Granted when the app *creates* a file, or when the user picks one via the Google Picker | The app can never see a file the user adds to the folder themselves |
| `drive` / `drive.readonly` | Whole-Drive access | **Restricted scope.** Annual CASA security assessment, ~$540/yr floor, recurring. Non-starter for a solo founder |

`drive.file` is the only viable option — it is classified *non-sensitive* and needs only basic OAuth
verification, no security assessment. But it is per-file, not per-folder, and the consequence is
severe:

> **A user who drops a document into the "Family Knowledge Vault" folder from the Drive app has
> created a file the vault cannot see, index, search, or mention — silently, and permanently.**

Google's escape hatch is the **Google Picker**, which is a **web-only JavaScript API with no iOS or
Android SDK**. In React Native that means a WebView. The one recovery path for the one unavoidable
failure mode is the least native part of a mobile-first product.

## 4.2 The rest of the API, assessed honestly

| Operation | Verdict |
|---|---|
| Upload / download / rename / move / delete | Fine, for app-created files |
| Change detection | `changes.list` works — but only for files the app can already see |
| Preview | Thumbnails and `webViewLink` work; both point at Google's UI, not ours |
| Versioning | **Better than Supabase** — Drive has native file revisions. The one genuine technical win |
| Sharing | Fails our requirements — see §7 |
| Offline | No worse; the repo has no offline story at all |
| Rate limits | Not a constraint. Weighted quota units since May 2026; 1M/min per project, 325k/min per user; 1TB/day egress |
| Quota | Files count against the user's **15GB Google account**, shared with their Gmail and Photos |

## 4.3 Where it collides with *this* codebase

- **Expo Go cannot do Google OAuth.** Google rejects the `exp://` proxy redirect; the callback needs
  a real bundle ID. **This project already hit this exact class of problem** and rejected deep links
  for invitations because of it (PR-6 checkpoint), and PR-1 rejected EAS dev builds mid-stream as too
  slow. Architecture B forces that migration on day one of Phase 3 — *before* PR-13, which was
  already the identified dev-build pressure point.
- **There is no server, by written policy.** `.env.example`: *"Never add the `secret` key… This
  project has no server-side component that would need it."* A refresh token cannot live in a client
  bundle, so B forces the first Edge Function **and** the first secret-custody problem — breaking the
  "Postgres is the only backend" invariant that both test suites rest on.
- **Unverified-app limits would break the stream weekly.** Publishing status "Testing" caps at 100
  users and **expires every refresh token after 7 days**. Escaping that needs OAuth verification,
  which needs a homepage, domain ownership, and a **privacy policy this repo does not have.**
- **Terms of Service exposure.** The Drive API ToS prohibits, without consent, *"Backup of user or
  app content from a developer's app or project to Drive."* An architecture defined as "we write your
  content into your Drive" sits inside that clause's blast radius. Probably survivable — the user
  uploads their own documents — but it makes Google's goodwill a *foundation* dependency.

---

# 5. Where metadata and embeddings live

**Metadata: entirely inside Family Knowledge Vault.** Not a close call, and true under *any* storage
architecture.

- The permission model *is* Postgres. `can_see_record(family, visibility, subject, author)` is a SQL
  function and RLS is the enforcement. Metadata outside Postgres cannot be governed by it.
- Drive's `appProperties` is a small key-value bag — no ranges, no joins, no ordering. Every list
  screen becomes an N+1 call to Google.
- Metadata in the provider is lost the moment a user disconnects. That sounds like a privacy feature
  and is actually catalog destruction.

**Embeddings: also FKV — and they need their own RLS.** `docs/15` §9.3 already states the governing
rule for `tsvector`: *"a second copy of every record with no RLS on it."* An embeddings table is
exactly that, and embeddings are invertible enough to be treated as content rather than as an opaque
index. **This is now recorded as `docs/15` §9.6.**

Note the question arrives about six phases early: the repo contains no pgvector plan at all. Phase 8
is `tsvector` only; Phase 9 defers semantic search.

---

# 6. The three-mode privacy model

The instinct is right. The structure needs one change.

**Modes 1 and 2 are not security boundaries.** They differ only in whether FKV *chooses* to run AI.
If the server can read the bytes, "AI must not read this" is a promise kept by code discipline. That
is normal and acceptable — **but the UI must never imply a cryptographic guarantee it does not
have.** `docs/15` §8.4 already sets this standard: *"a UI that says 'private' while an Admin reads
the row is exactly the claim this project has committed not to make."*

**Mode 3 is a different kind of thing.** "Highly confidential" is only real if FKV cannot decrypt it,
which means client-side encryption — an architecture tier, not a preference.

**Decision: two orthogonal controls, not one three-way choice.**

- **AI consent** — per document, with a family default. Modes 1 and 2. **Ships in PR-11** as an
  `ai_processing` column, because retrofitting consent onto existing rows in Phase 9 is the backfill
  bug class this project has already been bitten by, and Phase 9 is far too late to ask a user
  whether their passport may be read.
- **Vault** — client-side encrypted, FKV holds ciphertext only. Mode 3, and the same machinery
  Phase 11's Digital Legacy already requires.

**Open concerns, recorded in §13:** leakage through metadata, the features Mode 3 silently disables,
non-retroactive downgrades, key management, and consent when the uploader is not the subject.

**All three modes behave identically under A and B.** The privacy model does not require the storage
change that motivated it.

---

# 7. Sharing, Emergency Mode, and Digital Legacy

**This is where B stops being a trade-off and becomes a blocker.**

Drive's sharing semantics cannot express what Phases 10 and 11 already commit to:

- `expirationTime` applies to **user and group permissions only** — not link sharing — caps at one
  year, and on folders only the `reader` role may expire.
- **Non-Google recipients need Workspace "visitor sharing."** Consumer Gmail accounts cannot do it.
- **Consumer accounts cannot create Shared Drives at all.** That is a Workspace feature.

Against that, `docs/15` §3.1 requires Emergency Mode to grant **time-boxed, curated, audited** access
to someone with **no account at all** — an ER doctor — and `docs/03` requires it *within seconds*,
plausibly while the account owner is unconscious. Drive cannot express *"for 24 hours, these five
documents, to this stranger, audited."* FKV would have to proxy the bytes anyway, at which point it
is a storage provider with extra steps and *"we never touch your files"* is false.

**And Digital Legacy — the product's emotional core — is broken outright.** Files in a personal Drive
die with the person: Google deletes accounts after two years of inactivity, Inactive Account Manager
is Google's own opt-in mechanism that FKV cannot orchestrate or audit, and with no Shared Drives the
"family folder" always belongs to one mortal individual.

> **A vault that dies with the person is not a vault.**

**Conclusion: sharing must be abstracted above the storage provider regardless.** That is true under
A as well, and it argues for §10 — not for B.

---

# 8. Beyond Google Drive

If a provider abstraction is built, these are the candidates. They differ in exactly the places that
matter:

| Provider | Reality |
|---|---|
| **Dropbox** | A genuine **App folder** access type — scoped, visible, user-managed. *Better than Google* |
| **OneDrive** | `Files.ReadWrite.AppFolder`. Also a genuine app folder |
| **Google Drive** | **No app folder that is both visible and scoped.** The worst of the three |
| **iCloud Drive** | **No third-party API.** CloudKit is Apple-platform-only and addresses your app's container, not the user's Drive. Nothing on Android. Effectively impossible |
| **S3 / NAS / self-hosted** | Technically easiest; requires handing a grandparent an access key. Off-persona |

Two consequences worth stating once, plainly: **Google Drive is the worst provider to build this on
first**, the opposite of the proposal's sequencing. And **iCloud can never be supported**, so a
"bring your own storage" promise permanently carries an asterisk for half of an iPhone-owning family.

---

# 9. A versus B

| Dimension | A (FKV owns storage) | B (user owns storage) |
|---|---|---|
| **Security** | One trust boundary, enforced at the object layer by `storage.objects` RLS | **Worse.** FKV custodies refresh tokens for N Google accounts — a higher-value target than the documents. Object-layer tenant isolation disappears; every check becomes procedural |
| **Privacy** | Server can read bytes | **No better.** Google can too. One more party, not one fewer |
| **User trust** | Requires believing FKV's policy | Strong narrative — undercut the moment Emergency Mode proxies bytes |
| **Operational cost** | 1GB free → **$25/mo Pro = 100GB** | Near-zero. **The one genuine win** |
| **Vendor lock-in** | Supabase — but the spine has *no storage columns*, so it is shallow | Trades Supabase lock-in for **Google lock-in plus ToS exposure** |
| **AI capabilities** | Unconstrained | Every OCR/embedding job needs a per-user Drive token, colliding with `docs/15` §9.4 |
| **Complexity** | Low | **High.** Dev build + Edge Function + token custody + reconciliation + verification |
| **Maintainability** | One provider, one failure mode | A per-provider capability matrix and a permanent support burden |

**Two product-level objections beyond the table:**

1. **B makes the product its own antagonist.** `docs/01-vision.md` lists **Google Drive first** among
   the scattered places family information lives today. `docs/10` §2: *"Users should never feel like
   they are managing files."* An account picker, a folder and Drive filenames is the product becoming
   the thing it was built to replace.
2. **B deletes the business model.** Monetization is priced on storage tiers — Free *"Limited
   storage"* → Plus *"Larger storage"* → Phase 12 *"Expanded Storage."* Survivable, but a deliberate
   business-model change rather than a free win.

**The decisive economic point:** the free tier is escaped for **$25/month.** Architecture B costs a
dev-build migration, an Edge Function, OAuth verification, token custody, a reconciliation
subsystem, and a permanent support surface — paid in the only currency this project is short of,
**2-hour streams.** `CLAUDE.md` says design like a startup, *implement like a solo founder*.

---

# 10. Architecture C — what is actually adopted

**The service-layer half is already built.** Every existing service declares a narrow `XGateway`
interface with a `createSupabaseXGateway(client)` adapter — `src/services/family.ts` calls it *"the
only place that knows how families are stored."* A `createSupabaseStorageGateway(client)` is the
house style, not a new pattern. No registry, no strategy objects, no dependency-injection framework.

So the question reduces to which **schema and naming** decisions are irreversible:

| Decision | Reversible later? | Verdict |
|---|---|---|
| `document_files` as its own table, not a `storage_path` column | **No.** Splitting a column into a table means a data migration plus rewriting every query, service and test | **Now** |
| Path construction confined to one `SECURITY DEFINER` function | **No.** Once clients build paths, the convention ships inside app bundles on users' phones | **Now** |
| Naming it `provider_file_id`, not `storage_path` | Cheap in SQL, **expensive in habits** | **Now** |
| A `provider` column | **Yes, cheaply** — `add column … not null default` is metadata-only | Now, as documentation |

Only the first two are load-bearing, and **both are already justified without any portability
argument** — `document_files` is required by `docs/08` §15 and by versioning, and the
`SECURITY DEFINER` rule is the project's existing convention for writes with preconditions.
Portability is a free byproduct.

## 10.1 Two leaks the Gateway pattern does not catch

1. **Never store a URL — store the identifier and mint URLs on demand.** A signed URL in a row bakes
   the provider's domain and TTL into the data itself.
2. **Signed-URL expiry must not reach the components.** If screens hold a URL in state for
   `<Image source={{ uri }}>`, then TTL — a Supabase-specific concept — lives in every component.
   One accessor that takes a file id and re-mints on expiry contains it. Free now, at zero screens.

Also: record `mime_type`, `size_bytes` and `checksum` at upload time rather than reading them back
from `storage.objects`, which is a Supabase-owned table.

## 10.2 What would be over-engineering

- **Do not build a second provider to "validate" the interface.** See §12.
- **Do not shape the interface to the least-capable provider.** Their intersection has no signed URLs
  with TTL, no bucket-level MIME or size enforcement, and no object RLS — the three things the
  Phase 3 security model rests on. **The interface is shaped by what FKV requires; a provider that
  cannot meet it does not get supported.**
- **Do not let `provider` enter an RLS policy.** The row governs access, always, wherever the bytes
  sit. A policy branching on provider is a second permission model.

## 10.3 Amendment to `docs/15` §9.1

§9.1 fixed storage paths as `<family_id>/<record_id>/<filename>`. **The final segment becomes a
generated uuid plus extension**, with the user's `original_filename` kept as an ordinary column for
display:

```
<family_id>/<document_id>/<uuid>.<ext>
```

**Reason:** it dissolves the filename-sanitisation problem entirely — there is no user input in the
path — and it matches `docs/10` §13, *"Context is more valuable than filenames,"* since the UI shows
metadata rather than filenames anyway.

**Segment 1 is unchanged, so the storage RLS predicate
`has_family_access((storage.foldername(name))[1]::uuid)` is untouched.** This refines the contract
rather than violating it.

---

# 11. Where BYO-storage goes instead

**Recorded as a Phase 12 candidate**, beside *Storage Management* — which `docs/14` §4 already
designates as the free-tier checkpoint. Gated on a dev build existing, and **sequenced
Dropbox/OneDrive first, Google Drive second** (§8).

**And the cheaper way to buy what the proposal actually wanted: escrow-grade export.** "Download
everything" — the family's files plus a human-readable manifest, written to the device via
`expo-file-system` and `expo-sharing`, both Expo Go compatible, from which the user saves wherever
they like.

That delivers the entire emotional payload of Architecture B — *your files are always yours, readable
without us, and they outlive this company* — for roughly one PR, with zero OAuth, zero dev build,
zero token custody, and **no iCloud asterisk**. It strengthens Emergency Mode and Digital Legacy
instead of breaking them, and it satisfies `docs/03` §6 *"Keep user ownership of all uploaded data"*
literally rather than rhetorically.

It is also a better build-in-public story than a Google integration: **we made it easy to leave.**

**Placement is open** — ~~PR-15's vacated slot~~ **that slot no longer exists.** PR-15 was un-vacated
on 2026-08-09 and is now real sharing work, because `20260810090000` made every document author-only
(`docs/15` §8.4). Export's remaining home is **Phase 10, alongside *Backup & Restore*** (PR-48),
which is where it always fitted best — both answer "get my data out". Recorded in `docs/14` so it
cannot be lost.

---

# 12. `LocalStorageProvider` — considered and declined

A test-and-development-only provider was proposed, to cut cost and cloud dependency while building.

**Declined.** Three reasons, each sufficient:

1. **It cannot exercise what Phase 3 is building.** The storage security model *is* an RLS policy on
   `storage.objects`. A local filesystem has no policies, no tenancy, no authorization. Developing
   and demoing against a provider with no authorization, then shipping to one where authorization is
   the entire design, means **the policy is never exercised until production.** This project has been
   bitten twice by *"a capability with no interface is not shipped"*; this installs the mirror image.
2. **A self-authored second implementation validates nothing.** It satisfies any interface you write
   because you write both sides. Google Drive fails on signed URLs, on folder scoping, and on
   per-file access — **not one of which a local filesystem provider would surface.** Two
   implementations where one is a strawman are worse than one honest implementation, because they
   launder a guess into a false certainty.
3. **Device-local storage is single-device, which destroys the demo case.** `expo-file-system` writes
   to the app sandbox. Dad uploads, Mum sees it — impossible. The stream demo is inherently
   multi-account.

Further: `getPreview()` has no honest local analogue — a signed URL and a `file://` path are not
interchangeable in `<Image>`, a WebView PDF viewer, or a share sheet. And there would be no MIME
allow-list, no size cap, and different error shapes, so development would accept what production
rejects.

**The useful core already exists.** The 312-test CI suite runs against hand-rolled fake gateways with
no network — a real local-filesystem provider would be *slower*. A test double belongs in
`src/services/document.test.ts` as a ten-line object literal, which is how every existing test
already works.

**What serves the instinct properly is `supabase start`** — the *real* Supabase Storage with *real*
RLS, running locally and free. That is now the project's standard development environment; see the
README.

---

# 13. Still open

Recorded rather than resolved, so none of it is rediscovered mid-stream.

| Item | Where it belongs |
|---|---|
| **Export placement** | **Phase 10, with *Backup & Restore*.** PR-15's slot was reclaimed for sharing on 2026-08-09 |
| **Shared vs per-domain file tables** | `document_files` ships in Phase 3. **Phase 4 must decide before `memory_files` exists** — at two tables it is a rename, at six a rewrite |
| **Phase 9 vs Phase 11 contradiction** | Phase 9 ships bytes to a third-party OCR/LLM vendor; Phase 11 commits to E2EE the server cannot read. Nobody has written down where the line falls. Predates this review |
| **Key management for the encrypted tier** | Phase 11. Per-family wrapping, rotation on member removal, and recovery when the key holder is the person who died |
| **Metadata scope per AI mode** | A denied document's title, category, subject and expiry date remain readable and still feed AI answers. Needs a rule before Phase 9 |
| **Consent when the uploader is not the subject** | Mode is chosen by whoever uploads; the document may be *about* another member. The spine already models `member_id` as the subject |
| **Features Mode 3 silently disables** | No thumbnail, no OCR, no content search, no duplicate detection. Users will choose it for the passport — the document they most need to find later. The cost must be visible at the moment of choosing |

---

# 14. Next Document

None. Phase 3's checkpoints go in `.claude/current-session.md`. The decisions this review produced
are recorded in `docs/16-phase-3-brief.md` §9, which is now settled.
