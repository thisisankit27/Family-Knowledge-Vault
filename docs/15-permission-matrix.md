# 🔐 Permission Matrix & Visibility Model

**Project:** Family Knowledge Vault

**Version:** 1.2

**Status:** Decided 2026-08-04, **implemented in PR-9a (2026-08-05) and PR-9b (2026-08-06).**
Authoritative for every phase from here onward.

Two rounds of corrections, each found by building the thing the document described, each marked in
place rather than silently rewritten:

- **v1.1, PR-9a** — the invitation rank cap (§4.2), the absence of a rank check in
  `set_family_role` (§7.1), and the `has_family_access` gate on `can_see_record` (§8.3).
- **v1.2, PR-9b** — the rank rule on removal (§4.2) and transfer not being one locked function
  (§7.1 path 5).

Three of the five were the *same mistake*: assuming a single `role_rank` comparison expresses an
authorisation rule. It does not, and §5.2 already said so.

---

# 1. Purpose

This document defines **who may do what** inside a family, and **who may see what** inside it.

It exists because `docs/03-product-requirements.md` FR-008 names four roles and stops there, and
because `.claude/current-session.md` Checkpoint 1 carried "no permission matrix exists" as an open
risk for four weeks. It closes that risk (finding #3) and answers the harder one alongside it —
privacy *within* the family (finding #1).

It was written before PR-9a was implemented, deliberately. Every record table from Phase 3 onward
inherits the contract in §8, and retrofitting it across Documents, Medical, Memories, Recipes and
Inventory would be a migration and a policy rewrite on each.

**Where this document and any earlier one disagree, this one is correct.** Corrections it makes to
earlier documents are listed in §12.

---

# 2. The Governing Principle

> **A role answers "what may you do *to* the family."**
> **Visibility answers "what may you see *inside* it."**

These are two axes and they must never be collapsed into one.

The temptation is to keep adding roles until each answers a privacy question — a "Child" role, a
"Restricted Member" role, an "Emergency" role. That path ends with a dozen roles, none of which is
quite right, and a policy layer nobody can reason about.

The reason it is the wrong path is specific to this product: **a family is four to fifteen people
who mostly trust each other.** They do not need a fine-grained capability grid. What they need is
that one medical record is not visible to a brother-in-law. That is a property of the *record*, not
of the *person reading it*.

So: four roles, fixed (§3), and a visibility column on every record (§8).

---

# 3. Role Hierarchy

Four roles, stored as `family_users.role text` with a `check` constraint. **Not a Postgres `enum`**
— `ALTER TYPE … ADD VALUE` cannot be used in the transaction that adds it, removing a value is
near-impossible, and an enum's implicit ordering invites the `role >= 'member'` comparison that §5
forbids.

| Role | Who this is | In one sentence |
|---|---|---|
| **Owner** | The person who created the family, and anyone they promote | Owns the family itself: renaming it, deleting it, settings, billing, and who holds which role. |
| **Admin** | A second parent, an adult sibling who shares the load | Runs the family day to day — invites, removes, manages people and records — but cannot change roles or delete the family. |
| **Member** | Most adults in the household | Full participation: adds people, relationships and records, deletes their own. |
| **Guest** | An extended relative, a domestic helper | Sees who the family is. No records at all. |

**Owners are plural.** A couple co-owning is the normal case, and it is already reachable via an
owner invitation. This is why the guarantee in §7 is a count check rather than a transfer-only
model.

## 3.1 Two actors that are deliberately *not* roles

| Actor | Why it is not a role |
|---|---|
| **Emergency Contact / Caregiver** (Persona 6, Phase 10) | Time-bounded, may belong to someone with **no account at all** (a neighbour, an ER doctor), and grants a curated subset — blood group, allergies, emergency contacts. A role column has no expiry, and an `'emergency'` value would inherit `has_family_access`, i.e. **every document in the family**. Phase 10 gives it a separate grant table with `expires_at` and its own resolver. |
| **Digital Legacy recipient** (Phase 11) | The content is end-to-end encrypted; the server cannot read it, so no policy can govern it. Access is cryptographic. The role model's job here is to stay out of the way. |

## 3.2 The Child / Teenager case (Persona 5)

A teenager is a **Member**. Their constraint is *which records they can see and which of theirs
others can see* — which is §8, not a role. Inventing a role for them is the collapse §2 warns
against.

---

# 4. The Permission Matrix

One row per **capability**, not per feature. All content domains share the single **Records**
block, so adding Recipes in Phase 6 or Inventory in Phase 6 adds **zero rows** to this table. That
is the property that stops it rotting.

## 4.1 Family

| Capability | Owner | Admin | Member | Guest | Helper |
|---|:--:|:--:|:--:|:--:|---|
| See the family and its name | ✓ | ✓ | ✓ | ✓ | `has_family_access` |
| Rename the family | ✓ | — | — | — | `can_manage_family` |
| Delete the family | ✓ | — | — | — | `can_manage_family` |
| Family settings | ✓ | — | — | — | `can_manage_family` |
| Billing / plan *(Phase 12)* | ✓ | — | — | — | `can_manage_family` |

## 4.2 Access & Roles

| Capability | Owner | Admin | Member | Guest | Helper |
|---|:--:|:--:|:--:|:--:|---|
| See who has access | ✓ | ✓ | ✓ | ✓ | `has_family_access` |
| Create an invitation | ✓ | ✓ | — | — | `can_manage_members` **+ rank cap** |
| Revoke an invitation | ✓ | ✓ | — | — | `can_manage_members` |
| Remove someone's access | ✓ | ✓ | — | — | `can_manage_members` **+ rank** |
| Change a role | ✓ | — | — | — | `can_manage_family` |
| Leave the family | ✓* | ✓ | ✓ | ✓ | self |

**Rank cap** — `role_rank(invited) <= role_rank(inviter)`. Nobody hands out more access than they
hold: an Owner may invite any role including Owner, an **Admin may invite Admin, Member or Guest,
and no Admin may mint an Owner code.** See §6.2.

> **Corrected 2026-08-05, during PR-9a.** This paragraph originally said "a role *below* their own"
> in the same breath as "Owner may invite any role", and the two cannot both be true — strictly-
> below forbids an Owner inviting an Owner, which is the only way a family acquires a second owner
> and is behaviour PR-6 already shipped. `<=` is the comparison that actually closes §6.2; an Admin
> inviting an Admin is lateral, not an escalation.

**Rank on removal** — an Owner may remove anyone; an **Admin may remove strictly below
themselves**, so neither an Owner nor another Admin.

> **Corrected 2026-08-06, during PR-9b.** This originally read only "an Admin may not remove an
> Owner or another Admin", left the Owner-on-Owner case unstated, and gave the helper as
> `can_manage_members` **+ rank** — implying one comparison. **No single comparison is the rule**,
> and this is the same trap that caught `set_family_role` in PR-9a:
> `rank(actor) > rank(target)` blocks an Owner removing a co-owner, which is the case removal
> exists for; `rank(actor) >= rank(target)` lets an Admin remove another Admin, which this row
> forbids. It is two clauses — `can_manage_family(actor)` **or**
> (`can_manage_members(actor)` and `role_rank(target) < role_rank(actor)`). What stops an Owner
> emptying the family is §7, not a hierarchy.

**\*** An Owner may leave only if another Owner remains. See §7.

## 4.3 People & Relationships

| Capability | Owner | Admin | Member | Guest | Helper |
|---|:--:|:--:|:--:|:--:|---|
| View people and relationships | ✓ | ✓ | ✓ | ✓ | `has_family_access` |
| Add / edit a person | ✓ | ✓ | ✓ | — | `can_edit_people` |
| Add / remove a relationship | ✓ | ✓ | ✓ | — | `can_edit_people` |
| Soft-delete a person | ✓ | ✓ | — | — | `can_manage_members` |

A person carries records from Phase 3 onward, so removing one is a managerial act, not an editing
one.

## 4.4 Records — one block for **all** content domains

Applies identically to Documents, Medical, Memories, Recipes, Inventory, Timeline Events and
Calendar Events.

| Capability | Owner | Admin | Member | Guest | Helper |
|---|:--:|:--:|:--:|:--:|---|
| Read a `family`-visibility record | ✓ | ✓ | ✓ | — | `can_read_records` |
| Read a `private` record | — | — | — | — | `can_see_record` — **author or subject only** |
| Create a record | ✓ | ✓ | ✓ | — | `can_write_records` |
| Edit any record | ✓ | ✓ | — | — | `can_write_records` + ownership |
| Edit own record | ✓ | ✓ | ✓ | — | `created_by = auth.uid()` |
| Delete any record | ✓ | ✓ | — | — | `can_delete_records` |
| Delete own record | ✓ | ✓ | ✓ | — | `created_by = auth.uid()` |

**`private` has no role branch at all.** Not Owner, not Admin. See §8.3 for why, and for the
recovery paths that make it safe.

## 4.5 Activity, Emergency, Legacy

| Capability | Owner | Admin | Member | Guest | Note |
|---|:--:|:--:|:--:|:--:|---|
| View the activity feed *(PR-10)* | ✓ | ✓ | ✓ | — | **filtered by record visibility** — see §9.5 |
| Audit history *(Phase 10)* | ✓ | ✓ | — | — | |
| Emergency access *(Phase 10)* | — | — | — | — | No role grants it. Separate time-boxed grant. |
| Digital Legacy *(Phase 11)* | — | — | — | — | Cryptographic. Roles do not apply. |

---

# 5. The Helper Contract

Every RLS policy calls an **intent-named** helper — *what may this person do* — and never names a
role directly. This is the mechanism that let the role model widen from two values to four in PR-9a
while touching almost no policies, and it is why the matrix above can change without a schema
migration.

| Helper | Owner | Admin | Member | Guest |
|---|:--:|:--:|:--:|:--:|
| `has_family_access(family)` | ✓ | ✓ | ✓ | ✓ |
| `can_manage_family(family)` | ✓ | — | — | — |
| `can_manage_members(family)` | ✓ | ✓ | — | — |
| `can_edit_people(family)` | ✓ | ✓ | ✓ | — |
| `can_read_records(family)` | ✓ | ✓ | ✓ | — |
| `can_write_records(family)` | ✓ | ✓ | ✓ | — |
| `can_delete_records(family)` | ✓ | ✓ | — | — |

## 5.1 Three rules that make this survive twelve phases

**1. Allow-lists, never deny-lists.** Every body is `role in ('owner','admin')`. Never
`role <> 'guest'`. A deny-list means every role invented in a later phase **silently inherits every
permission written before it existed** — the single most likely way this model fails.

The one deliberate exception is `has_family_access`, which is role-blind on purpose: it answers
"are you inside the tenant boundary", and all four roles are.

**2. Two helpers with identical bodies are fine.** `can_write_records` and `can_edit_people` agree
today. That costs eight lines. One helper doing two jobs costs a rewrite the day they diverge.

**3. A helper is `SECURITY DEFINER` with `set search_path = ''`.** Definer because reading
`family_users` from inside a `family_users` policy recurses; the empty search path because without
it a caller can shadow a table and have it read with elevated rights.

## 5.2 `role_rank()` — for comparing actors, never for permissions

```
owner 3 · admin 2 · member 1 · guest 0 · anything else −1
```

Used only for "may I act on this person" and "may I invite at this level". The `−1` default means
an unrecognised role ranks below everything and fails closed.

> **`role_rank` must never appear in a permission check.** `role_rank(x) >= 1` is a deny-list
> wearing a disguise, and it re-opens rule 1 above.

---

# 6. Security Decisions — 2026-08-04

Two privilege-escalation holes were found during the pre-PR-9a review. Neither was a defect in
shipped behaviour; both are **latent in the current schema and open the moment
`can_manage_members` includes `'admin'`**. They are recorded here because the reasoning matters
more than the fix.

## 6.1 An Admin could promote themselves to Owner

`20260801101500_grant_family_privileges.sql` granted `select, update, delete` on the table PR-7
renamed to `family_users` — grants follow a rename. Two policies gated it:

```sql
"Managers can change roles"  UPDATE  using / with check (can_manage_members(family_id))
"Managers can remove access" DELETE  using             (can_manage_members(family_id))
```

Neither expression pins **which row** or **what value**. Widen the helper and both of these
succeed:

```sql
update public.family_users set role = 'owner' where family_id = :f and user_id = :self;
delete from public.family_users where family_id = :f and role = 'owner';
```

Self-promotion, and decapitation of the family in one statement.

**Decision: `family_users` becomes fully write-closed** — no INSERT, UPDATE or DELETE policy, and
UPDATE/DELETE revoked from `authenticated`. Every change goes through a `SECURITY DEFINER`
function: `set_family_role()` in PR-9a, `remove_family_access()` and `leave_family()` in PR-9b.
**All three shipped**; all three take the family-row lock as their first statement.

**Shipped in PR-9a**, `20260805090000_roles_and_permission_matrix.sql` §5, asserted by
`permissions.rls.test.ts` → *hole 1*, which checks both the direct `update` and the direct `delete`
and confirms afterwards from the victim's own session that nothing moved.

**Why not a tighter policy?** It is expressible —
`using (can_manage_members(family_id) and role <> 'owner')` plus a `with check` on the new value —
but it ends as an unreadable expression stating four rules, and it still cannot hold the row lock
§7 requires. This is the third instance of a rule the project already knows: *writes with
preconditions belong in a definer function, not a policy* (`create_family`, `redeem_invitation`).

## 6.2 An Admin could mint an Owner invitation

`create_invitation` checks `can_manage_members(target_family)`, then separately checks
`invited_role in ('owner','member')`. **The two conditions are unrelated.** Once Admins may invite,
an Admin creates an owner-role code and redeems it on a second account they control — the same
escalation through a different door.

**Decision: the invited role is capped by the inviter's rank** (§5.2) —
`role_rank(invited) <= role_rank(inviter)`. Owner may invite any role; Admin may invite Admin,
Member or Guest, and never Owner. See the correction note in §4.2 for why the cap is `<=` and not
`<`.

**Shipped in PR-9a**, `20260805090000_roles_and_permission_matrix.sql` §6, asserted by
`permissions.rls.test.ts` → *hole 2*.

## 6.3 `families.created_by` is pinned

PR-5 recorded: *"created_by is not pinned here; once PR-6 allows a second owner, an owner could
rewrite it. Close it then."* That moment is now. A `with check` cannot see `OLD`, so it takes a
small `before update` trigger.

---

# 7. The Last-Owner Guarantee

**A family must never have zero owners.**

## 7.1 Every path to zero, and what covers it

| # | Path | Covered by |
|---|---|---|
| 1 | The last owner demotes themselves | check inside the function |
| 2 | The last owner's access is removed, or they leave *(PR-9b)* | check inside the function |
| 3 | **Two owners demote each other concurrently** | **the row lock — nothing else** |
| 4 | An owner's `auth.users` row is deleted → cascade on `family_users` | backstop trigger |
| 5 | Transfer implemented as demote-then-promote | promote first — see the note below |
| 6 | An Admin demotes an Owner | `can_manage_family` — changing a role is Owner-only |
| 7 | The family is deleted → its access rows cascade to zero owners | **must not** trip the guard |

> **Corrected 2026-08-06, during PR-9b.** Path 5 originally said "one locked function". Transfer
> is **not** a database primitive and did not get one. Owners are plural, so the state between the
> two role changes is *two owners* — which the product already supports — and a transfer that stops
> halfway therefore leaves nothing broken and needs no transaction. It ships as
> `transferOwnership` in `src/services/access.ts`, two `set_family_role` calls, which is the one
> place the promote-before-demote order is written down. What it does owe the user is an honest
> report when only the second call fails: "they are now an owner, and so are you."

> **Corrected 2026-08-05, during PR-9a.** Path 6 originally said "rank check". `set_family_role`
> has **no rank comparison at all**, deliberately. It is gated on `can_manage_family`, so every
> caller is an Owner and every Owner target is of equal rank — a rank check would refuse every
> owner-to-owner change *including self-demotion*, making paths 1 and 3 unreachable and the whole
> guarantee below untestable. What stops an Admin is the Owner gate, not a hierarchy. Rank governs
> invitations (§6.2) and, in PR-9b, removal.

## 7.2 Why path 3 needs a lock and a trigger cannot help

Under `READ COMMITTED`, two concurrent transactions each demoting the *other* owner both read
`count(*) = 2` — neither sees the other's uncommitted change — both pass their check, both commit,
and the family has no owner. **A trigger runs inside the same transaction on the same snapshot and
is equally blind.**

**Layer 1 — serialise per family.** `select 1 from public.families where id = target for update;`
as the first statement of every function that can change the owner count. The second transaction
blocks, then re-reads and correctly refuses. This is the same technique `redeem_invitation`
already uses on the invitation row.

**Layer 2 — the check, after the write**, inside the function, so the error is a sentence a person
can act on rather than a constraint name.

**Layer 3 — a backstop trigger** `after update or delete on family_users for each row`, because
path 4 goes through no function at all. (`insert` is not in the list as built: an insert can only
ever add an owner, never remove the last one.)

**As built,** the trigger fires at the end of the `update` statement — that is, *before* layer 2's
count check runs — so in practice it is the trigger's message that reaches the client on paths 1
and 3. Both raise the identical sentence, so which one wins is invisible to whoever is holding the
phone, and layer 2 remains the guarantee if the trigger is ever dropped.

## 7.3 The trigger's cascade guard — the detail that costs an hour

```sql
if exists (select 1 from public.families
           where id = coalesce(new.family_id, old.family_id)) then …
```

Without it, deleting a family cascade-deletes its access rows, the trigger sees zero owners, raises,
and **family deletion breaks**. During a cascade the parent row is already gone within the
transaction, so `exists` correctly evaluates false and the guard skips.

Path 4 is partly closed already: `families.created_by references auth.users on delete restrict`
blocks deleting the account that created a family. The trigger covers a co-owner who did not create
it.

---

# 8. The Record Visibility Contract

**Frozen before Phase 3.** Every record table from PR-11 onward inherits it.

## 8.1 The reframing that makes this cheap to change later

> **Adding a visibility value later is a trivial `alter table`. Rewriting every record policy that
> spelled out `visibility = 'family' or …` is not.**

So what is frozen is **the columns every record table carries** and **the one function every record
policy calls** — not the vocabulary. With a single resolver, Phase 10's "Advanced Permissions" adds
a `shared` value by editing **one function body** and zero tables.

This is the §5 intent-helper lesson applied a second time.

## 8.2 The spine every record table copies

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

| Column | Why it must exist at creation time |
|---|---|
| `created_by` | **The one column that genuinely cannot be added later** — there is no way to backfill who created an existing row. It carries "delete own only" and private authorship. `on delete set null` so deleting an account never erases records. |
| `member_id` + composite FK | Reuses PR-8's proof: referencing `(id, family_id)` rather than `id` makes a record about another family's person **structurally impossible**, not merely policy-refused. Nullable, because a house deed belongs to the family and to no one person. |
| `visibility` | Retrofitting it across five record tables is a migration plus a policy rewrite on each. |
| `unique (id, family_id)` | So attachments, tags and timeline links can be tenant-scoped the same way. |
| `updated_at` | Reuses the generic `public.touch_updated_at()` trigger written in PR-7. |
| `deleted_at` | `docs/08-database-design.md` §20 soft delete. A record is never hard-deleted while anything may reference it. |

Two values, `family` and `private` — both are words a user can be shown. **"restricted" was
rejected**: it is developer language and it does not say restricted *to whom*.

## 8.3 `can_see_record` — the single resolver

```
can_see_record(target_family, record_visibility, subject_member, record_author) → boolean

  has_family_access(target_family) AND
    'family'   → can_read_records(target_family)
    'private'  → record_author = auth.uid()
                 OR subject_member is a family_members row whose user_id = auth.uid()
    anything   → false          -- unknown value fails closed
```

**The `has_family_access` gate was added during PR-9a and is not optional.** Without it,
`record_author = auth.uid()` stays true forever, so somebody removed from a family by PR-9b would
go on reading every private record they had ever written. Access to the tenant is a precondition of
every branch, not an alternative to them.

Every record table's SELECT policy is exactly:

```sql
using (public.can_see_record(family_id, visibility, member_id, created_by)
       and deleted_at is null)
```

## 8.4 Why `private` excludes even the Owner — decided 2026-08-04

**Decision: no role reads a private record.**

- It is the only reading that makes the word true. `docs/01-vision.md` puts "privacy and security
  above convenience", and the landing page now carries an honesty standard; a UI that says
  "private" while an Admin reads the row is exactly the claim this project has committed not to
  make.
- It is the only option that serves **Persona 5**, the teenager whose parent holds the Admin role —
  the precise case Checkpoint 1's finding #1 raised and left unresolved.
- The failure mode is **data being unreachable, never data leaking**. That is the safe direction. An
  Owner can still delete the family (cascade), which destroys rather than exposes.
- The recovery paths already exist in the roadmap and are *designed and auditable*: **Emergency
  Mode** (Phase 10) and **Digital Legacy** (Phase 11).
- And it is reversible. Owner visibility is `or public.can_manage_family(target_family)` — one line,
  in one function. Choosing the strict reading now forecloses nothing.

> **Amended 2026-08-09 — `documents` went further, and for a reason worth recording.**
>
> §8.3 grants a private record to its author **or its subject**. PR-11's `documents` table paired
> that with an UPDATE policy of `can_see_record(...) and can_write_records(...)`, so **seeing implied
> editing**: naming somebody in the subject field handed them write access to a document they had not
> filed — including the ability to set `visibility` back to `'family'` and publish it to the
> household. Found on a device during the PR-13 demo, not by the 35 RLS tests, several of which were
> asserting the buggy behaviour was correct.
>
> Migration `20260810090000` corrects it: **every document is private, and only its author may read,
> write or delete it.** The mechanism is one argument rather than a rewrite — the documents policies
> pass **`null`** in the subject position, so the §8.3 subject branch cannot match. **This function is
> unchanged**, and Phase 4–6 record tables still get the subject branch if they want it.
>
> The lesson generalises beyond this table: *"who is this record about"* and *"who may read this
> record"* are different questions, and a column answering both is a privilege escalation waiting for
> someone to notice. Sharing is designed properly in PR-15.

## 8.5 Defaults

**`family` everywhere in v1, including Medical.** "Mum's medications" is exactly what a household
needs at 2am, and defaulting Medical to private would make the module useless on the day it ships.
The column lets Phase 5 revisit the *default* per table with no change to the model.

---

# 9. Cross-Cutting Rules for Later Phases

Each is a place the model in §8 can be defeated by a phase that does not know about it. They are
recorded now because each is cheap to honour and expensive to retrofit.

**9.1 Storage paths are `<family_id>/<record_id>/<filename>`** *(Phase 3)*
`storage.objects` has its own policy system: **an invisible row does not make its file
unreachable.** The storage policy checks
`has_family_access((storage.foldername(name))[1]::uuid)`. Files belonging to `private` records rely
on signed URLs issued only after a successful row read. Decided now because moving files later is
expensive.

> **Amended 2026-08-06 (`docs/17` §10.3).** The final segment is a generated uuid plus extension —
> `<family_id>/<document_id>/<uuid>.<ext>` — with the user's `original_filename` kept as an ordinary
> column for display. This removes user input from the path entirely, which dissolves the
> filename-sanitisation problem rather than solving it, and matches `docs/10` §13 (*"Context is more
> valuable than filenames"*).
>
> **Segment 1 is unchanged, so the `has_family_access` predicate above is untouched.** This refines
> the contract; it does not violate it. Everything else in §9.1 stands.

> **Amended again 2026-08-11 — the predicate itself was no longer safe.**
>
> `has_family_access((storage.foldername(name))[1]::uuid)` is tenant-level and **role-blind**. It was
> written when documents were family-visible by default, and §8.4's amendment made every document
> author-only. Under that model the frozen predicate would have let any family member fetch the bytes
> of a document whose row they cannot read — the exact failure the paragraph above names: *"an
> invisible row does not make its file unreachable."*
>
> Confidentiality would then have rested entirely on never minting a URL. That is a promise kept by
> code in a place where a policy was available, and this project has already paid once for preferring
> the promise (PR-11's UPDATE policy, §8.4).
>
> **`20260811090000_document_storage.sql` adds an author conjunct.** Segment 1 still carries the
> tenant and is still checked; segment 2 carries the document id, and the policy now also requires
> `created_by = auth.uid()` on it. The work is in a `SECURITY DEFINER` helper —
> `public.owns_document_object(name)` — rather than inline, because joins inside policy bodies are
> where storage RLS goes slow.
>
> This section pinned segment 1 as unchanged. It never forbade *adding* conjuncts, and adding one is
> what a frozen contract is supposed to allow.
>
> **Two things went with it**, both worth knowing before Phase 4 reuses this shape. `document_files`
> still has no INSERT policy and no INSERT grant: `attach_document_file` is the only writer, and
> because `storage.objects` is an ordinary table it can *verify the object exists* rather than trust
> that it does — which is what PR-11 wanted when it withheld the policy. And an `after delete`
> trigger on `documents` removes the matching `storage.objects` rows, catching the cascade a client
> never sees when a whole family is deleted. It clears metadata, not the backing bytes; those wait
> for Phase 12's Storage Management, which is a quota cost rather than a privacy one.

**9.2 Any view over a record table must be `with (security_invoker = true)`** *(Phase 8)*
Otherwise it executes as its owner and bypasses RLS **entirely**. This is the classic Supabase
footgun and search is where it will first be reached for.

**9.3 Search queries base tables or invoker views** *(Phase 8)*
Never a denormalised copy without its own policy. A `tsvector` table built by a trigger is a second
copy of every record with no RLS on it.

**9.4 The AI assistant runs under the caller's JWT, never `service_role`** *(Phase 9)*
`service_role` bypasses RLS by definition, so an assistant using it can quote a private record back
in an answer to someone who may not read it.

**9.5 Activity rows referencing a record inherit that record's visibility** *(PR-10)*
A feed entry reading *"Ankit added Therapy notes"* leaks a private record through its title. The
feed is the first place visibility can escape the table it protects.

**9.6 Derived content carries its source row's policy** *(Phase 9, added 2026-08-06)*
§9.3 says a `tsvector` table built by a trigger is *"a second copy of every record with no RLS on
it."* **OCR text and embeddings are the same thing, and worse.** Extracted document text is the
document. An embedding is invertible enough to be treated as content rather than as an opaque index,
so neither may be stored in a table that merely references `family_id` — both need the same
`can_see_record` predicate as the row they were derived from.

Two consequences for Phase 9, recorded now because they are cheap here and expensive there. A
document whose `ai_processing` consent is withdrawn must have its derived artefacts **deleted**, not
merely ignored — the model does not unlearn. And derived text inherits the *subject's* visibility,
not the uploader's, since §8.3 already treats `member_id` as the subject.

---

# 10. Deliberately Not Solved

| Item | Where it belongs |
|---|---|
| Per-record ACLs — "share this with Mum and Dad specifically" | Phase 10, *Advanced Permissions*. Adds a `shared` visibility value and a `record_shares` table; §8.1 makes it one function-body edit. |
| Emergency access for a non-member caregiver | Phase 10, *Emergency Mode*. Checkpoint 1 finding #2. Separate time-boxed grant table, never a role. |
| Cross-family sharing | Still open — Checkpoint 1 finding #4. `docs/08` §22 asserts "unless explicitly shared" with no mechanism designed. Revisit when it first blocks a real use case. |
| Custom / user-defined roles | Not planned. §2 explains why the axis is wrong for this product. |
| **Soft-deleting a person** | **Reserved, not forgotten.** `family_members.deleted_at` and the `deleted_at is null` filter in its SELECT policy have existed since PR-7 with nothing able to set the column. Deliberately left that way in PR-9b: revoking an *account's access* and removing a *person* from the family are different domain operations, and coupling them would mean "remove" meant two things. Belongs to a future **Person Lifecycle** PR, which also has to decide what happens to that person's relationships and, from Phase 3, their records. |
| Recovering a deleted family | Not planned. `families` has no `deleted_at`; deletion is a hard cascade and the delete screen says so in those words. |
| Column-level privacy for Guests | **Known gap.** `family_members`' SELECT policy is `has_family_access`, so a Guest reads `date_of_birth` and `blood_group` straight from PostgREST. Masking them in `list_family_members` would be theatre — the table is readable directly. Resolves structurally in Phase 5, where blood group arguably belongs to the medical record rather than the person row. |

---

# 11. How This Document Stays True

**The matrix ships as a test fixture, not only as prose.**

`src/services/permissions.rls.test.ts` holds one data structure mirroring §5's table, signs in as
each of four role-holders, and asserts every helper returns the matrix value — 4 roles × 7 helpers
= 28 assertions. The day someone edits a helper body without editing this document, the suite
fails.

A permission matrix that lives only in Markdown is wrong within two phases. This one cannot drift
without breaking a test.

**It earned that on the first day, and again on the second.** Five of this document's own claims
were wrong when checked against a running database — three in PR-9a, two in PR-9b — and all five
are marked in place above. Every one was found by trying to write the test, not by re-reading the
prose.

Three of the five were the same mistake, which is the useful part: reaching for a single
`role_rank` comparison to express an authorisation rule. §5.2 already warns that `role_rank`
compares *actors* and must never appear in a permission check, and the warning was still not
enough on its own. If a sixth correction lands here, start at that line.

---

# 12. Corrections to Earlier Documents

| Document | Correction |
|---|---|
| `docs/03-product-requirements.md` FR-008 | "Supported roles **may** include" is now settled: the four roles in §3 are the model, and the matrix in §4 is what each may do. |
| `docs/08-database-design.md` §6 | "Ownership determines visibility" is true of the *family* tenant boundary but not of records. Record visibility is the explicit column and resolver in §8, not an implication of ownership. |
| `docs/08-database-design.md` §4 | Lists `Role` and `Permission` as core entities. There is no permission table and there will not be one — permissions are function bodies (§5). |
| `.claude/current-session.md` Phase 2 checkpoint | Claims PR-9a "edits four function bodies and **zero policies**." It removes two policies (§6.1) and replaces them with a function. Nine of eleven policies are untouched; the mechanism worked, but the claim was too strong. |
| `.claude/current-session.md` Checkpoint 1 | Finding #1 (privacy within the family) → answered by §8. Finding #3 (no permission matrix) → closed by this document. |
| `docs/14-pr-execution-plan.md` §7 | Phase 2 is five PRs, not four; PR-8 is *Family Relationships*, not *Family Tree*; PR-9 is split into 9a and 9b. See §7.1 of that document. |

---

# 13. Next Document

This document has no successor. It is revised whenever the role model or the visibility model
changes, and §11's test is what forces the revision to happen.
