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

---

# 7. Phases 2–12 — Condensed, Time-Boxed

All estimates assume the 2-hour/day cadence and the testing split in §3.3. "Split" flags PRs likely too big as originally scoped in `docs/12-pr-roadmap.md`; "Reuses" notes where an earlier pattern carries over and keeps a later phase fast.

| Phase | PRs | Est. each | Adjustment notes |
|---|---|---|---|
| 2 — Meet the Family (7–10) | Family Profiles, Family Tree, Roles & Permissions, Activity Feed | 2h, except Family Tree | Family Tree as a real interactive graph is too big for 2h on mobile — **split**: PR-8 ships relationships data model + simple list view; a visual tree graph becomes a stretch/polish item, pushed to Phase 6+. Roles & Permissions is where the Checkpoint 1 "no permission matrix" open risk gets resolved as a real deliverable. |
| 3 — Preserve What Matters (11–15) | Document Library, Categories, Viewer, Upload, Sharing | 2h, viewer maybe 2.5h | Upload via Expo ImagePicker/DocumentPicker + Supabase Storage — straightforward. PDF viewer needs a native lib (react-native-pdf); budget slightly over on that one PR only. |
| 4 — Family Memories (16–20) | Memories, Albums, Stories, Voice Memories, Memory Timeline | 2h | Voice via Expo AV — natural fit. Reuses the upload pattern from Phase 3. |
| 5 — Family Health (21–25) | Medical Dashboard, Reports, Doctors, Medicines, Vaccinations | 2h | Reuses the Documents CRUD pattern almost directly — low risk, likely the fastest phase. |
| 6 — Home & Living (26–30) | Recipes, Recipe Gallery, Inventory, Warranty, Household Knowledge | 2h | Reuses Documents/Memories patterns. Good phase to land the deferred Family Tree graph polish and the Checkpoint 1 "re-add Finance Dashboard/Map/Pets" items if there's spare capacity. |
| 7 — Family Timeline (31–35) | Timeline Events, Milestones, Calendar, Reminders, Notifications | 2h | Reminders/Notifications use local Expo notifications, not server cron (see §4). |
| 8 — Find Everything (36–40) | Global Search, Filters, Advanced Search, Suggestions, Relationship Nav | 2h | Postgres full-text search (`tsvector`) — free-tier friendly, no external search service needed yet. Semantic/AI search is explicitly deferred to Phase 9. |
| 9 — Family Intelligence (41–45) | OCR, Metadata Extraction, Smart Categorization, AI Search, AI Assistant | 2–3h | First phase needing paid external APIs (LLM + OCR) — see §4. Not a blocker now. |
| 10 — Trust & Security (46–50) | Security Center, Audit History, Backup & Restore, Emergency Mode, Advanced Permissions | 2h, Emergency Mode may need 2 PRs | Emergency Mode is where the Checkpoint 1 "non-member caregiver access" open risk must finally be resolved (design + build together). Backup & Restore is limited by the free tier (no PITR) — document the limitation rather than solving it here. |
| 11 — Legacy (51–55) | Digital Legacy, Letters, Life Instructions, Story Generator, Yearly Review | 2h, Digital Legacy split into 2 | Digital Legacy needs true client-side end-to-end encryption (per the Checkpoint 1 decision) — likely PR-51a (encryption infra) + PR-51b (UI), the most technically involved pair in the whole roadmap. Story Generator is a Phase-9-style paid-API PR. |
| 12 — Premium (56–60) | Premium Dashboard, Advanced AI, Storage Management, Analytics, Production Readiness | 2h | Storage Management is explicitly the checkpoint to revisit the free-tier ceiling and decide on upgrading. |

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
