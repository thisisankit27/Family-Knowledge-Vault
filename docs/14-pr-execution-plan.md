# 🎥 Mobile-First PR Execution Plan

**Project:** Family Knowledge Vault

**Version:** 1.0

**Status:** Draft

---

# 1. Purpose

This document is the day-to-day execution guide for building Family Knowledge Vault live on YouTube, one Pull Request per stream.

`docs/12-pr-roadmap.md` defines *what* gets built and in what order. This document defines *how it fits into a real streaming cadence*: platform and backend decisions, free-tier constraints, sizing rules, and time-boxed estimates for every PR. Where the two disagree on scope or sizing, this document is authoritative for day-to-day planning; `12-pr-roadmap.md` remains the historical record of the original vision-level sequencing.

---

# 2. Why This Document Exists

Streaming imposes constraints the original roadmap didn't account for:

- **One PR per day, ~2 hours per stream.** A PR that can't be built, tested, and demoed in that window isn't a stream-sized PR, no matter how clean it looks on paper.
- **Vertical slices only.** The audience needs visible, working progress every session — never ten days of backend followed by ten days of frontend. Every PR touches UI, data, and (where relevant) tests together.
- **Resumability across many separate Claude sessions.** The user works in short daily sessions ("start PR 3") and needs instant context recovery — see `CLAUDE.md` and `.claude/current-session.md`.

---

# 3. Locked-In Stack Decisions

## 3.1 Platform — React Native + Expo

One codebase for iOS and Android. Chosen over a web-first (Next.js) approach and over building both platforms in parallel.

Why mobile fits this product specifically: camera-based document/receipt capture, voice memories, one-tap Emergency Mode, push/local reminders, and biometric-locked sensitive records are all mobile-native strengths that a web app has to work around. Expo specifically (not bare React Native, not native Swift/Kotlin) gives instant on-device preview for streaming, first-party modules for camera/notifications/biometrics/secure storage, and an escape hatch to web later via `react-native-web` without a rewrite if ever needed.

Building both web and mobile in parallel from day one was explicitly rejected — it doubles UI work on every PR and breaks the 2-hour budget almost immediately.

## 3.2 Backend — Supabase (Postgres + Auth + Storage + RLS)

Chosen over Firebase (NoSQL fights the relationship-heavy data model in `docs/08-database-design.md`) and over a custom Node/Express backend (every PR would need backend-plumbing time before feature time).

Row-Level Security policies map directly onto the "family is the tenant boundary" principle from the Database Design doc, and double as the implementation mechanism for two still-open risks from the Checkpoint 1 review: the per-record permission matrix and cross-family sharing.

**Hard constraint: stay on Supabase's free tier to start.** See §4.

## 3.3 Testing Split

- **Backend** (services, DB functions, RLS policies, business logic): Claude writes and owns automated tests every PR — non-negotiable.
- **UI**: shared responsibility. Manual verification live on-stream (which doubles as the demo for the audience) plus lightweight component tests where they're cheap to add. Full e2e suites are deferred until core flows stabilize (naturally revisited around Phase 10, Trust & Security).

---

# 4. Free-Tier Guardrails (Supabase)

Approximate current free-tier limits — verify at supabase.com/pricing before PR-001, since these shift over time: ~500MB database space, ~1GB file storage, ~5GB bandwidth/month, 50K monthly active users, project auto-pauses after ~1 week of no API activity (manually resumable), no point-in-time recovery, no guaranteed `pg_cron`.

Consequences designed into the plan below rather than discovered mid-stream:

- **Reminders/Notifications (Phase 7)** use Expo's **local, on-device scheduled notifications** instead of server-side cron + push. No server scheduler needed, entirely free, and actually a better fit for personal reminders like "insurance renews in 4 days."
- **AI features (Phase 9) and the Story Generator (Phase 11)** depend on pay-per-use external APIs (an LLM for the assistant, an OCR service). These are a separate cost from Supabase hosting — flagged now so it isn't a surprise ~9 weeks into the roadmap.
- **Storage growth** (photos, videos, voice notes) will approach the 1GB free cap well before meaningful scale. Phase 12's "Storage Management" PR is the designated checkpoint to revisit upgrading.
- **Development should stop consuming any of this.** From Phase 3 onward the local Supabase stack (`npx supabase start`) is the standard development environment — real Postgres, real Auth, real Storage, real RLS, in Docker, free. The hosted project is production. Decided in `docs/17` §12, after a development-only storage provider was proposed and declined for being unable to exercise `storage.objects` policies at all. **Verified end to end on 2026-08-07** — both test suites and the app on a physical phone, all against local.

---

# 5. Working Principles

- **Vertical slice rule** — every PR ships a working, demoable end-to-end feature (UI + data + logic). Never a layer in isolation.
- **2-hour sizing rule** — if a PR's scope can't be built, tested, and demoed in ~2 hours, split it before starting. Don't cut corners mid-stream to force a fit.
- **Testing rule** — backend/business-logic tests are mandatory and Claude's responsibility every PR; UI verification happens live, together, with the audience.
- **Resumability rule** — read `CLAUDE.md` then `.claude/current-session.md` at the start of every session before doing anything else. Update `.claude/current-session.md` before ending any session, and follow the established git workflow (commit only complete work, ask before committing, Conventional Commits).

---

# 6. Phase 1 — "Welcome Home" (detailed)

| PR | Title | Est. | Scope |
|----|-------|------|-------|
| 1 | Repo & Environment Init | 2h | Expo (TypeScript) app scaffold; Supabase project on free tier; env config; basic CI (lint + typecheck via GitHub Actions); app icon/splash placeholder. Demo: app boots on simulator/device and confirms a live Supabase connection. |
| 2 | Marketing Landing Page | 2h | A small, separate static one-pager (not part of the app codebase) — vision summary, GitHub link, waitlist. Hosted free (Vercel/Netlify). One-and-done artifact, mainly to hype the series early. |
| 3 | Authentication | 2h (tight — may spill password-reset to a small follow-up) | Supabase Auth: sign up / login / logout, auth vs. app navigation stacks, tokens in Expo SecureStore. Backend tests: default RLS/auth policies exist and reject unauthenticated access. **Built — see §6.1 for three corrections made during the build.** |
| 3b | Password Reset | ~1h | Deliberately split out of PR-3 to protect the 2h cap. "Forgot password" screen, Supabase reset email, and the deep-link handler that receives the callback — the first thing in the app that needs the `familyvault://` scheme. |
| 4 | App Shell & Navigation | 2h | Bottom-tab navigation scaffold matching the IA domains (Dashboard, Family, Documents, etc. as empty placeholder screens), warm-neutral theme from the UI/UX doc, Dashboard layout shell. |
| 5 | Create Family | 2h | `families` table + RLS ("owner sees only their family"), family creation flow, family profile screen. Backend tests: RLS isolation test — Family A cannot read Family B's row. This is the multi-tenancy boundary from the Database Design doc; test it seriously. |
| 6 | Invite Members | 2h | Invitation table + join-by-code/link flow, member list screen, role assignment (Owner/Member default). Backend tests: invitation-token validation logic, member-level RLS. |

## 6.1 Corrections made while building PR-3

This plan was written before any application code existed. Three things in the PR-3 row turned
out to be wrong once the code was real. Recorded here rather than silently edited away, because
the reasoning matters more than the correction.

**Expo Router replaces React Navigation.** The row named React Navigation. Expo Router is the
default for SDK 54 and is built on React Navigation, so this is a change of interface, not of
engine. It was chosen because the auth split *is* a routing concern: `app/(auth)` and `app/(app)`
are route groups whose layouts hold the guard, so a new signed-out screen inherits protection by
being placed in the folder — there is no per-screen check for anyone to forget. It also gives
deep linking for free, which PR-3b needs for the password-reset callback and Phase 10 needs for
email confirmation. Cost: it dictates the folder layout PR-4 builds its tab shell inside.

**No tables, so no RLS to test yet.** The row promised "backend tests: default RLS/auth policies
exist and reject unauthenticated access." There is nothing to apply RLS *to* — `docs/08-database-design.md`
§3–4 defines no `User` or `Profile` entity, because the model is `auth.users` (Supabase-managed
account) → `Member` (family-scoped identity). Inventing a `profiles` table purely to have
something to test would have contradicted the database design. **RLS testing moves to PR-5**,
where `families` becomes the first real table and the tenant boundary is genuinely at stake.
PR-3's backend tests instead cover the auth service and the SecureStore adapter.

**Email confirmation is off, and that is a carried risk.** Turning it on means every demo
account needs a working inbox, which is unworkable live. So nothing currently proves a person
owns the address they signed up with. This is scheduled into **Phase 10 (Trust & Security)** as
a visible deliverable rather than left as invisible plumbing. The app already handles the
confirmation-required path (`signUp` returns success with a null session and an explanatory
message), so switching the toggle back on does not break the UI.

## 6.2 Decisions made while building PR-4

**Twelve IA domains, five tab slots.** `docs/06-information-architecture.md` §3 names twelve
primary domains; `docs/10-ui-ux-design.md` §18 asks for comfortable one-handed targets, which
caps a phone tab bar at about five. Four domains earned a permanent tab — **Home (Dashboard),
Family, Documents, Memories** — chosen to match the build order, so tabs fill with real content
as Phases 3 and 4 land rather than sitting empty for months. The remaining eight live behind
**More**.

Rejected: a "Vault" tab merging Documents + Medical + Recipes + Inventory (fewer top-level
concepts, but it puts every stored thing one tap further away than the IA's browse path), and a
four-tab bar (roomier targets, but it denies Memories a slot despite Memories being an entire
phase of work).

**The domain split is data, not markup.** `src/navigation/domains.ts` declares all twelve; the
tab bar and the More list both render from it, and `domains.test.ts` asserts every IA domain is
reachable exactly once, that the bar never exceeds five slots, and that no domain outside the IA
appears. This is what keeps a UI-only PR honestly testable, and it makes IA §12's "new domains
integrate without restructuring" concrete: adding Pets means appending to one array.

**Empty states, never sample data.** Each tab states what will live there and which phase brings
it. Inventing a placeholder passport would make the product look further along than it is, which
is the wrong thing for a build-in-public project to show.

**Light theme only.** `app.json` already sets `userInterfaceStyle: "light"`. A dark palette
doubles every colour decision and is worth more once there are real screens to cover.

## 6.3 What PR-5 discovered about Postgres RLS

Two things in this PR were only found by running tests against the real database. Both would
have shipped silently.

**RLS applies the SELECT policy to `RETURNING`, and `RETURNING` is projected before `AFTER ROW`
triggers fire.** The natural design — insert a family, let an `after insert` trigger add the
creator as its first member — cannot work when the SELECT policy is membership-based. At the
moment Postgres asks "may this caller see the row it just inserted?", the membership row does
not exist yet, so creation fails every time.

Creation is therefore a single `SECURITY DEFINER` function, `create_family(family_name)`, doing
both inserts. Three consequences, all improvements: the ordering question disappears; creation
is atomic, so no family can exist without an owner; and `created_by` is read from `auth.uid()`
*inside* the function rather than accepted from the client, so no request shape can create a
family in someone else's name. That is a stronger guarantee than a `WITH CHECK` policy, which
can only validate what the client chose to send. Neither table needs an INSERT policy as a
result — RLS denies by default, and the function is the only way in.

**Policies are not privileges.** Every policy was correct and every query still failed with
`42501 permission denied`. RLS only ever *narrows* what SQL privileges already permit; without a
`GRANT`, the `authenticated` role cannot touch the table at all. Supabase's default privileges
attach to objects created by the `postgres` role — which is why dashboard-created tables "just
work" — but the CLI runs migrations under its own login role, so migration-created tables
inherit nothing. Fixed in a second migration rather than by editing the first, since the first
was already applied and history should record what actually happened.

**The wider point for the roadmap:** every table from PR-6 onward sits behind these same
policies and needs its own grants. The RLS suite is not optional ceremony — it is the only thing
that caught either of these.

**Testing shape established here.** Tests split in two: unit tests run in CI, and
`*.rls.test.ts` integration tests are excluded via `testPathIgnorePatterns` and run deliberately
with `npm run test:rls`. Destructive attempts are checked twice — the attacker must receive zero
affected rows *and* the victim's own session must confirm the data is untouched, because under
RLS an UPDATE or DELETE matching no visible row reports success rather than an error. A suite
asserting only "no error was thrown" would pass against completely broken policies.

## 6.4 PR-6 — what invitations changed, and what they did not

**The INSERT hole PR-5 predicted was never opened.** §6.3 said PR-6 would add "a narrowly scoped
INSERT policy on family_members for redeemed invitations". It did not need to.
`redeem_invitation()` is a second `SECURITY DEFINER` function with its own rules, so membership
still cannot be inserted by any client under any policy. Keeping the table write-closed is
strictly stronger than a narrow policy, and the pattern now has two instances — worth reaching
for again whenever a write has preconditions a policy cannot express.

**Codes over links.** Rejected a `familyvault://` deep link: in Expo Go it takes an
`exp://…/--/join?code=…` form that behaves differently from a real build, so it costs budget and
demos worse than the thing it replaces. An 8-character code avoids `I`, `O`, `0` and `1` — the
characters people misread when copying by hand — giving 32 symbols and 40 bits, single-use, with
a 7-day expiry. Generated from `gen_random_uuid()` rather than `random()`: `random()` is a seeded
PRNG, and an invitation code is a bearer credential for a family's records.

**Joining a second family is refused, deliberately.** The schema permits multiple memberships,
but with no switcher UI a second family would be joined and then invisible — which reads as data
loss. The rule lives in `redeem_invitation()` as four lines to delete when family switching
ships, not as a schema constraint.

**Reading the member list needed its own function.** `auth.users` is not client-readable, so a
member list would otherwise show bare UUIDs. `list_family_members()` is `SECURITY DEFINER` with
an `is_family_member` check *inside the query* — without that check it would let any signed-in
user dump the email address of every member of any family id they could guess.

**A capability with no UI is a gap, not a feature.** Revocation shipped only because it was asked
for during review: the owner-only DELETE policy and its RLS test already existed, so the feature
looked complete while being unreachable. **The same is currently true of removing a member** —
`family_members` has an owner-only DELETE policy and a passing test, and no interface. That
belongs to **PR-9 (Roles & Permissions)**; see §7.

---

# 7. Phases 2–12 — Condensed, Time-Boxed

All estimates assume the 2-hour/day cadence and the testing split in §3.3. "Split" flags PRs likely too big as originally scoped in `docs/12-pr-roadmap.md`; "Reuses" notes where an earlier pattern carries over and keeps a later phase fast.

| Phase | PRs | Est. each | Adjustment notes |
|---|---|---|---|
| 2 — Meet the Family (7–10) | Family Profiles, Family Relationships, Roles & Matrix, Membership Lifecycle, Activity Feed | 2h, except PR-9a | **Five PRs, not four** — see §7.1. PR-8 was renamed from "Family Tree": it ships the relationships data model + list view, and the visual graph is pushed to Phase 6+, because shipping a "Family Tree" that draws no tree contradicts the honesty standard on the landing page. PR-9 was **split into 9a (Roles & Matrix) and 9b (Membership Lifecycle)** at ~3h30 combined. PR-9a is where the Checkpoint 1 "no permission matrix" risk is resolved as a real deliverable — `docs/15-permission-matrix.md`. 9b owns removing a member and leaving a family: PR-5 shipped the owner-only DELETE policy with a passing RLS test and no interface, so the capability exists and is unreachable. |
| 3 — Preserve What Matters (11–15) | Document Library, Categories, Detail, Upload (14a) + Preview (14b), **Sharing** | 2h each; 14 split in two | **Shipped 11–14b as of 2026-08-12.** All of §3.2's storage decisions and §6's four contradictions are settled — see `docs/16` §9 and `docs/17`. Two corrections happened mid-phase and both matter more than the features: **every document is author-only** after a privilege escalation (`docs/15` §8.4), and **PDFs open in the device's own reader** because Android's WebView cannot render them (`docs/16` §5). ~~**PR-15 Sharing was vacated on 08-07 and un-vacated on 08-09** — it is the last PR of the phase and the most consequential, because nothing currently reaches anybody but its author.~~ **PR-15 shipped 2026-08-13 and split in two.** *15a — Sharing:* `visibility` gets a control (*Only me* / *Everyone in the family*); the model is **reading widens, writing never does**, so the 08-09 escalation cannot recur — and the whole database change is one function plus one replaced policy on `storage.objects`, because `docs/15` §8.1 froze the right things. *15b — One document, one form:* the slot's remaining budget went to a defect sharing exposed rather than to specific-person sharing — the settings a document has were spread across two screens that had already drifted, so filing now configures the document and the detail screen edits the same set. Specific-person sharing stays in Phase 10 (`docs/15` §10). **Phase 3 closes with PR-16, the landing-page update.** |
| 4 — Family Memories (16–20) | Memories, Albums, Stories, Voice Memories, Memory Timeline | 2h | Voice via Expo AV — natural fit. Reuses the upload pattern from Phase 3. |
| 5 — Family Health (21–25) | Medical Dashboard, Reports, Doctors, Medicines, Vaccinations | 2h | Reuses the Documents CRUD pattern almost directly — low risk, likely the fastest phase. |
| 6 — Home & Living (26–30) | Recipes, Recipe Gallery, Inventory, Warranty, Household Knowledge | 2h | Reuses Documents/Memories patterns. Good phase to land the deferred Family Tree graph polish and the Checkpoint 1 "re-add Finance Dashboard/Map/Pets" items if there's spare capacity. |
| 7 — Family Timeline (31–35) | Timeline Events, Milestones, Calendar, Reminders, Notifications | 2h | Reminders/Notifications use local Expo notifications, not server cron (see §4). |
| 8 — Find Everything (36–40) | Global Search, Filters, Advanced Search, Suggestions, Relationship Nav | 2h | Postgres full-text search (`tsvector`) — free-tier friendly, no external search service needed yet. Semantic/AI search is explicitly deferred to Phase 9. |
| 9 — Family Intelligence (41–45) | OCR, Metadata Extraction, Smart Categorization, AI Search, AI Assistant | 2–3h | First phase needing paid external APIs (LLM + OCR) — see §4. Not a blocker now. |
| 10 — Trust & Security (46–50) | Security Center, Audit History, Backup & Restore, Emergency Mode, Advanced Permissions | 2h, Emergency Mode may need 2 PRs | Emergency Mode is where the Checkpoint 1 "non-member caregiver access" open risk must finally be resolved (design + build together). Backup & Restore is limited by the free tier (no PITR) — document the limitation rather than solving it here. **This phase owns the move to an EAS dev build** — deep linking is needed here for grant redemption, and Phase 3 deliberately declined to take it on (`docs/16` §5). **Export (`docs/17` §11) lands here**, alongside Backup & Restore — both answer "get my data out". It was going to take PR-15's vacated slot until that slot was reclaimed for sharing on 2026-08-09. |
| 11 — Legacy (51–55) | Digital Legacy, Letters, Life Instructions, Story Generator, Yearly Review | 2h, Digital Legacy split into 2 | Digital Legacy needs true client-side end-to-end encryption (per the Checkpoint 1 decision) — likely PR-51a (encryption infra) + PR-51b (UI), the most technically involved pair in the whole roadmap. Story Generator is a Phase-9-style paid-API PR. |
| 12 — Premium (56–60) | Premium Dashboard, Advanced AI, Storage Management, Analytics, Production Readiness | 2h | Storage Management is explicitly the checkpoint to revisit the free-tier ceiling and decide on upgrading. **This is also where bring-your-own-storage belongs if it is ever built** — reviewed and declined as a Phase 3 foundation in `docs/17`, and sequenced **Dropbox/OneDrive first, Google Drive second** (they have real app folders; Google does not). Gated on a dev build existing. iCloud can never be supported — there is no third-party API. |

## 7.1 What the pre-PR-9a review changed (2026-08-04)

Before implementing PR-9a, the four decisions that are expensive to reverse — the role model, the
permission matrix, the last-owner guard and the record visibility model — were reviewed against
the whole roadmap rather than against Phase 2 alone. The full result is
**`docs/15-permission-matrix.md`**, which is authoritative from PR-9a onward. Three things about
the *plan* changed and belong here.

**PR-9a cannot be a simple enum change, because widening the role model opens two holes.** Both are
latent in the schema today and go live the moment `can_manage_members` includes `'admin'`:

- The UPDATE and DELETE policies on `family_users` are gated only by `can_manage_members(family_id)`
  and pin neither the target row nor the new value, so an Admin could `set role = 'owner'` on
  themselves, or delete every owner.
- `create_invitation` checks *who may invite* and *what role may be invited* as two unrelated
  conditions, so an Admin could mint an owner-role code and redeem it on a second account.

Neither is a defect in shipped behaviour, and neither can be deferred: the fix has to land in the
same PR as the widening or the widening ships a privilege-escalation path. Details and reasoning:
`docs/15-permission-matrix.md` §6.

**PR-9a is ~2h40, over the cap, and that was accepted deliberately.** The alternative was to defer
the record-visibility groundwork to Phase 3, which would put permission design on the critical path
of a stream that is already building an upload flow. The four record helpers cost ~20 minutes and
are testable by direct call before any record table exists. Cut lines are recorded in the PR-9a
checkpoint in `.claude/current-session.md`; **none of the security items are cuttable.**

**The "zero policies" claim in the Phase 2 planning checkpoint was too strong.** It said PR-9a would
edit four function bodies and no policies. It removes two and replaces them with a definer
function. The intent-helper mechanism still did its job — nine of eleven policies are untouched, and
the whole record layer in Phase 3 inherits it — but the number was wrong and is corrected here
rather than quietly.

## 7.2 What building PR-9a changed (2026-08-05)

The review's estimate held — PR-9a came in around its ~2h40 — and every security item shipped. What
did not hold was three statements the review made about *behaviour*, each found by writing the test
rather than by re-reading the document: the invitation rank cap was specified two incompatible ways,
`set_family_role` turned out to need no rank comparison at all, and `can_see_record` needed a
`has_family_access` gate the spec omitted. All three are corrected in place in
`docs/15-permission-matrix.md` (now v1.1) and explained in the PR-9a checkpoint in
`.claude/current-session.md`.

**The reusable point for later phases:** a written contract is a hypothesis until something
executes it. The matrix survived precisely because §11 required it to ship as a test fixture — the
prose alone would have been wrong in three places and nobody would have known until Phase 3.

## 7.3 What building PR-9b changed (2026-08-06)

PR-9b gave `family_users` its remaining two writers — `remove_family_access` and `leave_family` —
and gave the `families` DELETE policy, which has worked and been untouchable since PR-5, an
interface at last.

**The matrix was wrong twice more, and once was the same mistake as PR-9a.** §4.2's "rank on
removal" implied one comparison; no single comparison works, because `>` blocks an Owner removing a
co-owner and `>=` lets an Admin remove another Admin. §7.1 path 5 promised a locked
`transfer_ownership` function; transfer is not a database primitive at all now that owners are
plural, because the state between the two role changes is *two owners*, which is valid. It ships as
a service-layer macro whose only job is to encode the promote-before-demote order.

The document is v1.2. Five corrections across two PRs, three of them the same reach for a
`role_rank` comparison that §5.2 already forbids.

**Scope grew by one item and it was the right call.** A sole owner cannot leave — the last-owner
guarantee correctly refuses it — so without a way to delete a family, "Leave family" dead-ends for
exactly the person most likely to press it. Deleting needed no migration, only a screen: a typed
confirmation, an itemised list of what goes, and plain language that nothing comes back. That is
the app's first irreversible action and the first thing `Alert.alert` could not express.

**`family_members.deleted_at` stays deliberately unreachable.** Removing an account's access and
removing a person from the family are different domain operations; coupling them would make
"remove" mean two things. Recorded as *reserved* in matrix §10, against a future Person Lifecycle
PR.

## 7.4 What building PR-10 closed the phase with (2026-08-06)

The activity feed is the first table to inherit the record contract, and it inherited it whole: its
SELECT policy is a **single `can_see_record` call**, no role name appears in the migration, and the
Guest exclusion required by §4.5 falls out of `'family'` visibility delegating to
`can_read_records`. That is the proof PR-9a's early helpers were worth their 2h40 — Phase 3's record
tables copy the same one-line policy.

**Two findings worth carrying forward.**

`now()` is *transaction* time, so every row a transaction writes shares a `created_at` and cannot be
ordered. `create_family` writes two events and they tied, letting the feed show somebody joining a
family that did not exist yet. `clock_timestamp()` fixes it, in a second migration rather than an
edit to the applied one — **migration history is append-only.** Every Phase 3 trigger that logs
alongside a record write will hit this.

The **cascade guard appeared for the third time**. PR-7's backfill, PR-9a's `enforce_last_owner`,
and now four logging triggers that would each have made family deletion fail. The question to ask of
any trigger or migration is *what does this mean for rows that already exist, or are on their way
out?*

**End-of-phase ritual, both halves done.** The landing page Progress section had drifted a whole
phase — 9 pull requests against a real 18, 163 tests against 453, and a gap listed as missing that
PR-9b had shipped. And `docs/16-phase-3-brief.md` was written for Phase 3 on the `docs/15`
precedent: it records five storage decisions that exist nowhere in the repo and four contradictions
between existing documents, rather than leaving them to be discovered mid-stream.

---

# 8. How Resumption Works

Each day, the user says "start PR N." A future session should:

1. Read `CLAUDE.md`, then `.claude/current-session.md`.
2. Confirm PR N's scope against this document (§6 or §7).
3. Implement the vertical slice, with backend tests as described in §3.3.
4. Demo on-stream (shared UI verification).
5. Update `.claude/current-session.md` with what's done and what's next.
6. Propose a commit per the established git workflow — never commit automatically without asking.

---

# 9. Next Document

This document has no fixed successor — it will be revised as phases complete and real timing data replaces estimates. Treat estimates in §7 as directional until Phase 1 produces real data points to calibrate against.
