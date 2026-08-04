# Family Knowledge Vault — Planning Session State

**Last updated:** 2026-08-04 (PR-9a Architecture Review)

**Status:** Phase 1 shipped. Phase 2 is three PRs in — PR-7 and PR-8 built and merged/open, PR-9a
fully specified and not yet started. 210 CI tests, 60 RLS tests, six migrations applied to the live
Supabase project.

---

## How to use this file

Read `CLAUDE.md` first, then this file, before re-reading `docs/*` or re-deriving anything. This file is the continuation point — don't re-derive the reasoning below from scratch.

**Sections are append-only and chronological. The last one is the current state.** Jump to the
final checkpoint — *PR-9a Architecture Review (2026-08-04)* — for what to do next; read backwards
from there only for the reasoning behind a specific decision. Checkpoint 1 is the original
critical-review history and several of its open findings have since been resolved; where an early
section and a later one disagree, **the later one is correct.**

---

## What has happened so far

Read all 13 planning documents in `docs/` in full:

`01-vision.md`, `02-user-requirements.md`, `03-product-requirements.md`, `04-user-personas.md`, `05-user-stories.md`, `06-information-architecture.md`, `07-system-design.md`, `08-database-design.md`, `09-api-design.md`, `10-ui-ux-design.md`, `11-roadmap.md`, `12-pr-roadmap.md`, `13-release-notes.md`.

Performed a critical review: challenged assumptions, identified contradictions and risks, and asked the user four blocking clarifying questions. All four were answered and are now **decided** (see below). A longer list of **unresolved** findings was also produced and is not yet decided (see below).

No files under `docs/` have been edited yet — the review surfaced issues but corrective edits to the docs themselves are future work (see "Recommended next steps").

---

## Decisions made (resolved — treat as settled going forward)

### 1. Build philosophy: solo/small-team, streaming-driven

- Design like a startup expecting growth (clean modular architecture, clear domain boundaries) but **implement like a solo founder**.
- Explicitly **rejected** for early phases: microservices, Kubernetes, event buses everywhere.
- "Millions of households," full RBAC/audit/versioning as literally scoped in the docs, and the 60-PR "~1 PR/day" pace are a **long-term north star / narrative structure**, not near-term literal commitments. Don't over-engineer Phase 1–2 against millions-of-users scale.

### 2. Encryption model: two-tier

- **Normal content** (documents, medical records, recipes, memories, inventory) → strong **server-side encryption at rest and in transit**. Server can decrypt to run OCR / semantic search / AI assistant.
- **Digital Legacy module only** → true **end-to-end encryption**. Server never sees plaintext. AI is intentionally unavailable for this content.
- This resolves the earlier contradiction between "privacy above convenience" / "end-to-end encryption where appropriate" (Vision) and the AI Assistant/OCR/semantic search needing to read content server-side.
- **Action still needed:** Vision (`01-vision.md`) and PRD (`03-product-requirements.md`) should be updated to state this two-tier model explicitly instead of the vague "end-to-end encryption where appropriate" line.

### 3. Digital Legacy release trigger (v1): manual only

- No dead-man's-switch, no inactivity detection, no multi-party attestation in v1.
- Owner or an explicitly designated trustee must **actively** unlock/share legacy content.
- Rationale: avoids the unsolved problem of verifying someone has died/is incapacitated. Can be revisited in a later phase once the product has traction and legal/process rigor to support something more automatic.

### 4. Dropped-from-vision modules: oversight, will be re-added

- `Family Finance Dashboard`, `Family Map`, and `Pets` appear in `01-vision.md` (modules 13, 15, 16) but vanished from PRD, User Stories, Roadmap, PR Roadmap, and are absent even from the URS "Out of Scope" list.
- Confirmed: this was an **oversight**, not an intentional cut.
- **Action still needed:** re-add them to later-phase planning docs — most naturally alongside `11-roadmap.md` Phase 7 "Platform Expansion" and the equivalent section of `12-pr-roadmap.md`, next to Estate Planning / Insurance / Healthcare / Smart Home (they share the same "expand beyond core vision" character). Not needed for MVP.

---

## Unresolved findings (open — need a decision in a future session, not yet acted on)

Roughly in priority order:

1. **Medical/sensitive-record privacy *within* the family is unaddressed.** Role model (Owner/Admin/Member/Guest) is family-wide. Real households need finer-grained privacy (e.g., a teenager's medical record hidden from siblings but visible to parents; one spouse's records not automatically visible to everyone). Current data model (family → member → records, family-wide roles) doesn't obviously support per-record or per-relationship ACLs. **Blocks:** finalizing Database Design and any Permission Matrix.
2. **Emergency Mode's auth model for non-member caregivers is undefined.** Persona 6 (Emergency Contact/Caregiver) is explicitly *not necessarily* a registered family member (neighbor, ER doctor, etc.), yet "privacy and security above convenience" is a stated principle. No mechanism is described for how an outsider gets emergency access (time-limited link? QR code? curated public subset of data?). Needs an explicit design, not just a feature bullet.
3. **No permission matrix exists.** FR-008 names four roles (Owner/Admin/Member/Guest) but no doc defines what each can actually do per domain (can a Guest view medical records? can a Member invite others? can an Admin delete another member's documents?). Needed before auth/authorization implementation starts.
4. **Cross-family data sharing isn't supported by the current multi-tenancy model.** `08-database-design.md` §22 states families "must remain completely isolated... no data should ever cross tenant boundaries unless explicitly shared" — but real usage needs it (e.g., a married couple sharing a joint document between their own family workspace and their parents' workspace). "Explicitly shared" is asserted with no mechanism designed.
5. **Regulatory/compliance gap.** Docs explicitly reference Indian identity documents (Aadhaar, PAN), medical records, and children as primary users (Persona 5). This strongly implies India's DPDP Act 2023 (and possibly child-specific consent requirements) applies — but no doc mentions consent flows, parental consent for minors, data localization, or any compliance posture at all. Worth a dedicated pass once the target market/jurisdiction is reconfirmed.
6. **NFR realism vs. build philosophy.** NFR-006 ("search results within one second... for indexed content") is plausible for keyword search but optimistic for AI/semantic search once vector lookups + reranking are involved. Given the now-confirmed "solo founder, no over-engineering" philosophy, treat these NFRs as directional targets, not contractual, until real infra exists to benchmark against.
7. **Data export/portability has no FR.** Vision's Security & Privacy list mentions "Data export" and URS UR-039 asserts data ownership, but no FR in the PRD's Functional Requirements section actually specifies an export/download-everything capability. Traceability gap — either add an FR or explicitly defer it.
8. **Terminology drift across three "Timeline" concepts.** "Family Timeline" (life events/milestones), "Medical Timeline" (FR-021), and "Memory Timeline" (UR-021) are used as if distinct, but Information Architecture's Timeline domain folds Memories, Birthdays, and Life Events together while Medical keeps a separate timeline. Unclear whether this is one filterable UI component or genuinely separate features. Needs clarifying before UI/IA work is finalized.
9. **Minor documentation drift:** `05-user-stories.md`'s "Next Document" pointer says `06-user-flows.md`, but the actual next file is `06-information-architecture.md` — no user-flows doc exists in `docs/`. Harmless, worth a one-line fix eventually.
10. **Vision's monetization "Free = one family" vs. joint-family reality.** Low priority. The whole product philosophy centers on joint/multi-generational families sharing one workspace (fine under free tier), but a user belonging to *two* families (their own + their spouse's parents') may hit the "one family" free-tier limit awkwardly. Flag for the monetization pass, not blocking now.

> **Status update, 2026-08-04.** **#3 is closed** and **#1 is answered** — both by
> `docs/15-permission-matrix.md`, written during the PR-9a review (see the final checkpoint).
> Privacy within the family turned out not to need a finer role model at all: it needs a
> per-record `visibility` column, because role and visibility are two axes and #1 conflated them.
> **#2 (emergency access) is narrowed** — decided that it is *not* a role, still undesigned, still
> Phase 10. #4, #5, #6, #7, #8, #10 remain open. #9 is cosmetic and still unfixed.

---

## Recommended next steps (pick one to continue with)

In order of leverage:

1. **Update `01-vision.md` and `03-product-requirements.md`** to reflect the two-tier encryption model (decision #2 above) and the corrected scope (re-add Finance Dashboard/Map/Pets into later-phase roadmap docs per decision #4; add explicit Out-of-Scope entries only for whatever genuinely stays cut for good).
2. **Draft a lightweight Permission Matrix** (role × domain × action table) — this unblocks unresolved findings #1 and #3 at once (privacy-within-family and missing role definitions).
3. **Draft a short Emergency Mode access design note** resolving unresolved finding #2 (non-member caregiver access).
4. **Only after the above:** move on to whatever comes after the PR roadmap — i.e., actual implementation starting at PR-001 — per the user's future direction.

**Do not start implementation (code) until the user explicitly asks for it.** This and the prior session's scope was strictly documentation review and planning.

---
---

# Checkpoint 2 (2026-07-28)

## What happened

The user asked for a self-roadmap before coding starts: a concrete, day-sized PR execution plan, since this project streams live on YouTube (one PR/day, ~2 hour streams, visible progress required every session — no multi-day backend-only stretches). Also asked for a platform decision (leaning mobile) and to update `CLAUDE.md` with full context for future sessions.

Produced and got approval on:

1. **`docs/14-pr-execution-plan.md`** — the new authoritative day-to-day execution guide. Supersedes `docs/12-pr-roadmap.md` for pacing/sizing (that doc remains the historical high-level vision/sequencing).
2. **`CLAUDE.md`** (project root) — stable conventions: stack, cadence, testing split, git workflow summary, resumability instructions. Read this at the start of every session.
3. This update to `.claude/current-session.md`.

No application code, no Expo project, no Supabase project exist yet.

## Decisions confirmed this session

1. **Platform: React Native + Expo** (mobile-first, iOS + Android, one codebase). Web-first and "both in parallel" were both considered and rejected (parallel explicitly breaks the 2-hour/day budget).
2. **Backend: Supabase** (Postgres + Auth + Storage + RLS). **Hard constraint: free tier only to start** — see `docs/14-pr-execution-plan.md` §4 for the specific limits and how later phases (reminders, AI, storage growth) are designed around them.
3. **Testing split**: backend (services/DB functions/RLS/business logic) = Claude's responsibility, automated, every PR, non-negotiable. UI = shared responsibility (live manual verification during the stream + lightweight component tests where cheap).

## Where things stand vs. Checkpoint 1's open items

Two of Checkpoint 1's unresolved findings now have a concrete home in the roadmap instead of being purely open questions:

- **#3 (no permission matrix)** → will be resolved as a real deliverable in Phase 2, PR-9 "Roles & Permissions" (see `docs/14-pr-execution-plan.md` §7).
- **#2 (Emergency Mode non-member caregiver access)** → will be resolved in Phase 10, the Emergency Mode PR (§7).

The rest of Checkpoint 1's unresolved findings (medical privacy within family, cross-family sharing, DPDP/compliance gap, NFR realism, data-export FR, Timeline terminology drift, doc-numbering typo, free-tier "one family" tension) are still open and not yet scheduled — revisit opportunistically, most naturally around the PRs that touch them (e.g., medical privacy during Phase 5, cross-family sharing whenever it first blocks a real use case).

## Next action

The next real action is **implementing PR-1 (Repo & Environment Init)** from `docs/14-pr-execution-plan.md` §6, whenever the user says "start PR 1." That PR: Expo (TypeScript) scaffold, Supabase project on free tier, env config, basic CI, app icon/splash placeholder — demo is the app booting on a simulator/device with a confirmed live Supabase connection.

`docs/14-pr-execution-plan.md`, `CLAUDE.md`, and this checkpoint update were all committed (3 separate commits, see `git log`).

---
---

# Pre-PR-1 Readiness Check (2026-07-29)

Before starting PR-1, did an environment/permissions audit and gathered external prerequisites. Findings:

## Environment confirmed

- Node v22.22.1, npm 9.2.0 — compatible with current Expo. `npx expo` works with no global install.
- Git push auth already cached and working — confirmed via existing history: `origin/master` already has PR #1 (a real `local` → `master` GitHub merge, done via web UI, predates this session's involvement). No branch conflicts.
- **Linux machine — no iOS Simulator possible (Xcode is Mac-only), no Android SDK/emulator installed.** Primary device-testing plan: **Expo Go on a physical phone** (scan QR from `expo start`), not an emulator.

## Claude Code permissions configured

`.claude/settings.local.json` now allowlists the commands PR-1 and the general day-to-day workflow need: `npm install/ci`, `npx create-expo-app/expo/eas/tsc/eslint/supabase`, `git push/checkout/switch/pull`, `gh pr view` (not `gh pr create` — see PR workflow decision below). Added explicit **deny** rules for `git push --force`, `git reset --hard`, `git clean -f`, `git checkout --`, `git branch -D` as a guardrail consistent with the "never rewrite history" rule.

## PR workflow decision

Asked whether to install/auth `gh` CLI, keep using GitHub's web UI, or skip formal PRs entirely. **User chose: keep using the web UI**, same as PR #1. Recorded in `CLAUDE.md`'s Git Workflow section: each PR day, push the branch and hand the user a ready-to-paste PR title/description (using the template in `docs/12-pr-roadmap.md` §3); don't attempt `gh pr create`.

## External prerequisites — status

1. **Supabase account + project: DONE.** User created a free-tier Supabase project and has the Project URL, Publishable key, and legacy anon/public key saved securely on their end (not in this repo, not pasted in chat — correct handling). These go into a local, gitignored `.env` (with a committed `.env.example` template) as part of PR-1 itself — not before. The `secret`/`service_role`-equivalent key is not needed client-side and should never be pasted anywhere, chat included.
2. **Expo Go on a physical phone: NOT YET CONFIRMED.** Still needed before PR-1's demo step (app booting + live Supabase connection check) can actually be shown. Confirm before or at the start of PR-1.

## Uncommitted work

One small edit to `CLAUDE.md` (the PR-workflow-via-web-UI line above) is uncommitted as of this checkpoint — propose committing it (either standalone or bundled with PR-1's first commit) next session.

## Next action (updated)

Once Expo Go is confirmed ready on a phone, implement **PR-1** per `docs/14-pr-execution-plan.md` §6.

---
---

# PR-1 Complete — Repo & Environment Init (2026-07-30)

**Status: built, tested, and demoed live on a physical phone. Supabase connection confirmed working (~100 ms round trip from the device).**

## What shipped

- **Expo TypeScript app** at the repo root (`App.tsx`, `index.ts`, `app.json`, `assets/`), app identity set to "Family Knowledge Vault" with bundle/package id `com.vibethroughcode.familyknowledgevault`.
- **`src/lib/env.ts`** — resolves and validates Supabase credentials. Prefers the newer publishable key, falls back to the legacy anon key. Lazy + memoised via `getSupabaseEnv()`.
- **`src/lib/supabase.ts`** — shared client via `getSupabase()`, also lazy. Session persistence deliberately left at default; PR-3 wires it to Expo SecureStore.
- **`src/services/connection.ts`** — `checkSupabaseConnection()` with injectable deps (url, key, fetchFn, now, timeoutMs) so it is directly unit-testable, plus a production-wired `checkConnection()`.
- **`src/theme.ts`** — warm-neutral design tokens from `docs/10-ui-ux-design.md`; PR-4 expands this.
- **`App.tsx`** — connection status screen with loading/success/error states and a "Check again" button.
- **`.github/workflows/ci.yml`** — typecheck + tests on push/PR.
- **README** — stack, setup, env-var handling, project structure, and the SDK-pin rationale.

## Test status

14 tests passing across `src/lib/env.test.ts` and `src/services/connection.test.ts`. Typecheck clean.

## Two real bugs caught during the build (worth remembering)

1. **Eager env resolution.** `supabaseEnv` was originally a module-level `const`, so *importing* any consuming module threw wherever `.env` was absent — which would have broken CI on its first run and did break the test suite immediately. Fixed by making resolution lazy and memoised. The lazy pattern is load-bearing for CI; don't "simplify" it back to a top-level const.
2. **Wrong health endpoint.** The first connectivity check probed `/rest/v1/` and got 401 with valid credentials. Nearly misdiagnosed as a bad publishable key — ruled out by testing all four key/header combinations and seeing all fail. Cause: newer Supabase projects restrict the PostgREST OpenAPI root. **`/auth/v1/health` with only the `apikey` header** is the correct check (200 with key, 401 without, so it genuinely validates credentials). `Authorization: Bearer` is for a signed-in user's JWT and must not carry the publishable key. A regression test locks both mistakes out.

## Expo SDK pinned to 54 — deliberate, not accidental

The project was scaffolded on SDK 57, but **Expo Go on the Play Store was still on 54.x** and refused to open the project ("Project is incompatible with this version of Expo Go"). This is a widely-reported store-lag issue, not a local misconfiguration. Since every stream demos on a real phone, the SDK is pinned to what Expo Go can actually run.

Downgrade was clean: `expo@~54.0.0` + `jest-expo@~54.0.0`, then `npx expo install --fix` realigned React 19.2.3 → 19.1.0, RN 0.86.2 → 0.81.5, TypeScript 6.0.3 → 5.9.2. **Zero application code changed** — all 14 tests and typecheck passed immediately after. Rationale is documented in the README so it doesn't look accidental later.

Alternatives rejected for a live stream: an EAS dev build (needs an Expo account plus a 10–20 min cloud build) and sideloading a newer Expo Go APK (fiddly, risky on air). Revisit the pin when the store app catches up, or if the project later moves to a custom dev build.

## Environment notes for future sessions

- **LAN mode is the working setup**: `npx expo start --lan`, then enter `exp://<LAN-IP>:8081` manually in Expo Go. Get the IP with `ip route get 1.1.1.1 | grep -oP 'src \K[0-9.]+'` — it was `192.168.29.40` on 2026-07-30 but may change.
- **Tunnel mode (`--tunnel`) does not work out of the box** — it needs `@expo/ngrok` and prompts interactively, which fails in a non-interactive shell.
- **Don't run `npm install` while Metro is running.** It crashed the dev server once (`ENOENT ... watch .jest-message-util-*`) because the file watcher followed a temp dir that npm deleted mid-install. Watchman is not installed, so Metro uses the more fragile fallback watcher.
- Verifying the bundle without a phone: `curl "http://localhost:8081/index.bundle?platform=android&dev=true"` — HTTP 200 means it compiles.

## Next action

**PR-2 — Marketing Landing Page** per `docs/14-pr-execution-plan.md` §6: a small separate static one-pager (vision summary, GitHub link, waitlist), hosted free, deliberately *not* part of the app codebase. ~2h.

Note PR-2 is the one PR in Phase 1 that ships no mobile-app code. If a demoable app change matters more on that particular stream day, consider swapping it with PR-3 (Authentication) — the execution plan's ordering is not load-bearing here.

---
---

# PR-2 Complete — Marketing Landing Page (2026-07-30)

**Status: built and verified. PR-1 and PR-2 shipped the same day.**

The "swap PR-2 for PR-3" suggestion above was raised and **declined** — correctly, since the concern was only that PR-2 alone would mean a stream with no visible app progress, and PR-1 had already delivered that on the same day.

## What shipped

- **`landing/index.html`** — semantic one-pager: hero, the problem, six module cards, four principles, follow-along section, footer.
- **`landing/styles.css`** — palette copied deliberately from `src/theme.ts` so site and app read as one product. Light + dark via `prefers-color-scheme`, responsive grids, `prefers-reduced-motion` support, visible focus rings.
- **`vercel.json`** — static deploy config.
- **README** — landing section with local preview and deploy notes.

## Decisions worth remembering

- **No waitlist / no email capture.** Chosen over a Supabase-backed waitlist table and over third-party form services. The product is one screen old with nothing yet to notify anyone about, and skipping capture means no personal-data surface on a public page. Revisit when there's a real launch to announce — a Supabase table with insert-only RLS is the natural implementation and would be a good on-stream RLS demo.
- **Plain HTML/CSS, no build step, no dependencies, no external network requests** (system fonts only). Keeps the marketing site completely isolated from the Expo app — it cannot affect the bundle, typecheck, or CI. Verified: 14/14 tests and typecheck still clean after adding it.
- **`vercel.json` sets `buildCommand: null` and `installCommand: null`.** Without this Vercel finds the root `package.json` and tries to build the React Native app. This is the non-obvious part of the config — don't remove it.
- **Hero CTA priority: YouTube primary, GitHub secondary.** For a build-in-public page the stream is the main draw; source is for the smaller slice who want it.
- Channel URL is `https://www.youtube.com/@vibethroughcode` — used in hero, follow-along section, and footer.

## Verification performed

Rendered and screenshot-checked at 1280px and 390px widths, in both light and dark themes. All three external links return HTTP 200. All local assets serve 200. App tests and typecheck unaffected.

## Deployed — live

**Custom domain: https://family.vibethroughcode.com/** (canonical)
Vercel default, still serving: `https://family-knowledge-vault.vercel.app/`

Vercel is connected to the repo and auto-deploys on every push to `master`. Verified after deploy on both hostnames: HTTP 200, valid SSL, `styles.css` and `favicon.png` 200 with correct MIME types, all three security headers present (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`), `http://` 308-redirects to `https://`, all external links correct, desktop and mobile rendering identical to local.

**Both hostnames answer 200 with identical content**, which is duplicate content from a search engine's perspective. Mitigated in markup: `landing/index.html` carries `<link rel="canonical">` and `og:url` pointing at the custom domain. If you'd rather fix it at the edge, Vercel's Domains settings can redirect the `.vercel.app` hostname to the primary domain instead — the canonical tag is the lighter-touch fix and doesn't break the fallback URL.

Vercel project settings that matter, in case it's ever reconnected:
- **Root Directory must stay `./`**, not `landing`. Vercel reads `vercel.json` from the Root Directory — pointing it at `landing/` would make it look for `landing/vercel.json`, which doesn't exist, silently discarding the output directory, headers, and disabled build.
- **Application Preset "Other" is correct** — it reflects `"framework": null` in `vercel.json`. There's no framework to detect.
- **No environment variables.** The page is pure static HTML and makes no network calls; Supabase keys belong only in the app's local `.env`.

## Next action

**PR-3 — Authentication** per `docs/14-pr-execution-plan.md` §6. Done — see below.

---
---

# PR-3 Complete — Authentication (2026-07-31)

**Status: built, tested, and verified on a physical phone via Expo Go. All seven manual checks passed, including the one that matters — kill the app completely, reopen, and land straight on the home screen with no login.**

## Decisions taken at the start (user-confirmed)

1. **Email confirmation OFF** in Supabase. Instant demo accounts, no inbox in the loop on stream. Carried risk, scheduled into Phase 10 — see `docs/14-pr-execution-plan.md` §6.1.
2. **Password reset deferred to PR-3b.** The plan already flagged it as the thing to spill; keeping it out protected the 2h cap and avoided pulling deep-link handling into this PR.
3. **Expo Router instead of React Navigation.** Reasoning in `docs/14-pr-execution-plan.md` §6.1. This decides the folder layout PR-4 builds inside.

## What shipped

- **`app/`** — Expo Router file tree. `_layout.tsx` (providers + root Stack), `index.tsx` (entry decision), `(auth)/login.tsx`, `(auth)/signup.tsx`, `(app)/index.tsx`. The guard lives in `(auth)/_layout.tsx` and `(app)/_layout.tsx`.
- **`src/lib/secureStore.ts`** — chunked SecureStore adapter. The non-obvious part of this PR; see below.
- **`src/services/auth.ts`** — `signUp` / `signIn` / `signOut` / `getSession`, plus `validateCredentials` and `describeAuthError`. Gateway-injected, UI-free, fully unit tested.
- **`src/providers/AuthProvider.tsx`** — single source of truth for the session; also drives `startAutoRefresh` / `stopAutoRefresh` off `AppState`.
- **`src/components/`** — `Button`, `TextField`, `CredentialsForm`, `AuthScreen`.
- **`src/lib/supabase.ts`** — now wires `storage`, `persistSession`, `autoRefreshToken`.
- **`app.json`** — `scheme: "familyvault"` (PR-3b needs it), `expo-router` + `expo-secure-store` plugins.
- **Deleted `App.tsx` and `index.ts`** — entry point is `expo-router/entry` via `package.json` `main`.

## Test status

**51 tests passing** (was 14), typecheck clean. New: `src/lib/secureStore.test.ts` (11), `src/services/auth.test.ts` (26).

## The SecureStore trap — the thing worth remembering

Expo SecureStore is backed by the iOS keychain / Android EncryptedSharedPreferences and warns above **~2048 bytes per value**. A Supabase session (access JWT + refresh token + user record) routinely exceeds that once user metadata fills in. Storing it whole works on day one and **starts failing silently as the payload grows** — users randomly signed out, no error to trace. Worst possible failure mode for auth.

`createChunkedSecureStore` splits values across `key.0`, `key.1`, … and stores the chunk *count* at `key`. Three details that are each covered by a test and each easy to get wrong:

1. **Never split a surrogate pair.** A display name with an emoji or non-BMP script can put one on a chunk boundary; splitting it yields two lone surrogates that don't round-trip.
2. **Delete orphaned chunks when a value shrinks.** Otherwise a later, longer write reads back a mix of old and new data.
3. **A missing chunk returns `null`, not a truncated string.** Handing Supabase half a token is worse than asking for a fresh login.

Don't "simplify" this back to a plain `setItemAsync`.

## `npm install` and `npm ci` do not agree — CI caught what local didn't

PR #6's first CI run failed at **Install dependencies**, after local tests and typecheck were green.

`expo-router` declares `react-dom` as an **optional peer with no version constraint**, so npm resolved it to `react-dom@19.2.8`, which requires `react@^19.2.8`. React is pinned at **19.1.0** for Expo SDK 54 alignment. `npm install` downgrades that conflict to an `ERESOLVE` warning and proceeds; **`npm ci` refuses outright**. So the break was invisible locally and unavoidable in CI.

Fixed with `"overrides": { "react-dom": "19.1.0" }` in `package.json` rather than adding `react-dom` as a direct dependency — this project has no web target, and declaring `react-dom` would imply one.

**The habit to keep:** before pushing anything that touched dependencies, run the CI sequence, not the dev sequence — `npm ci && npm run typecheck && npm test`. Stop Metro first; `npm ci` wipes `node_modules` and Metro's watcher dies with it (the PR-1 crash).

## Why there are no database tables in this PR

`docs/08-database-design.md` §3–4 defines no `User`/`Profile` entity — the model is `auth.users` → `Member` (family-scoped). So PR-3 creates no tables, and there is no RLS to test yet. **RLS testing belongs to PR-5**, where `families` is the first real table. Full reasoning in `docs/14-pr-execution-plan.md` §6.1.

Note the layout guards in `app/(app)/_layout.tsx` are a *convenience* boundary, not a security one — they decide what is drawn. Real protection is RLS in Postgres, arriving in PR-5.

## Open items carried forward

- **No email ownership verification** (confirmation is off) → Phase 10.
- **No password reset** → PR-3b.
- **MFA (FR-004)** untouched → Phase 10.
- Rate limiting on sign-in attempts is entirely Supabase's defaults right now; not reviewed.

## Environment notes from this session

- The **Android emulator works** on this machine (Android Studio SDK at `~/Android/Sdk`, `Pixel_7` AVD, Android 36.1 Play Store image, KVM available). It runs with **software rendering** — usable for debugging, noticeably less smooth than the phone. `ANDROID_HOME` is **not** in the shell profile; export it inline or `npm run android` won't find `adb`.
- Physical-device testing uses `npx expo start --lan` → `exp://192.168.29.40:8081` (same Wi-Fi). Tunnel mode still fails non-interactively — see PR-1 notes.

## Next action

PR-4 was chosen over PR-3b — see the PR-4 section below for why. Merged as PR #6.

---
---

# PR-4 Complete — App Shell & Navigation (2026-07-31)

**Status: built and verified on a physical phone via Expo Go. PR-3 and PR-4 shipped the same day.**

## Why PR-4 came before PR-3b

Not stream aesthetics — **password reset needs a real inbox**. Every account we can create right now uses a fake address, because email confirmation is off. On top of that, Supabase's free tier rate-limits built-in auth emails to a handful per hour. So PR-3b live would mean burning a real address, hitting a rate limit mid-stream, or stopping to configure custom SMTP.

**PR-3b is blocked on an email-infrastructure decision** (use a real test inbox vs. configure custom SMTP). Settle that before starting it.

## What shipped

- **`app/(app)/(tabs)/`** — five-slot tab bar: `index.tsx` (Dashboard), `family.tsx`, `documents.tsx`, `memories.tsx`, `more.tsx`, plus `_layout.tsx`.
- **`src/navigation/domains.ts`** — the registry all navigation renders from. See below.
- **`src/components/Screen.tsx`** — safe-area scroll chrome with a title block; bottom padding clears the tab bar.
- **`src/components/EmptyState.tsx`** — designed empty state with an "Arriving in …" badge.
- **`src/theme.ts`** — expanded: `surfaceSunken`, `primarySoft`, `warning`, `info`, `spacing.xs/xxl`, `radius.sm/full`, `typography.display/heading/subheading`, `touchTarget`.
- **Deleted `app/(app)/index.tsx`** — it would collide with `(tabs)/index.tsx` on the same path. Its account panel and connection check moved into the More tab.

## Test status

**69 tests passing** (was 51), typecheck clean. New: `src/navigation/domains.test.ts` (18).

## How a UI-only PR stayed testable — the idea worth reusing

Twelve IA domains, five tab slots. Rather than hard-coding that split across five screen files, `src/navigation/domains.ts` declares it as data; the tab bar and the More list both render from it. `domains.test.ts` then asserts:

- every domain in `docs/06-information-architecture.md` §3 is reachable **exactly once**
- the tab bar never exceeds five slots
- no domain outside the IA appears
- the first tab is `dashboard` (Expo Router maps it to `index.tsx`)

So a later PR that adds a tab and forgets to remove it from More — or silently drops Inventory — fails a test instead of shipping an unreachable corner of the product. **When a PR looks like "just UI", look for the decision inside it that can be expressed as data.**

Full reasoning, including the rejected "Vault" tab and four-tab options: `docs/14-pr-execution-plan.md` §6.2.

## Deliberate omissions

- **More rows are not tappable.** A row that opens a blank screen is worse than one that says "Phase 5".
- **No sample data anywhere.** A placeholder passport would overstate progress.
- **Light theme only** — dark mode doubles every colour decision; better spent once real screens exist.

## Gotcha found this session

**`npm ci --dry-run` deletes `node_modules` before resolving.** It wiped the toolchain mid-build and `tsc` vanished with it. Use a real `npm ci` at the end of a dependency change rather than the dry run, and expect a full reinstall either way.

## Next action

PR-5 was taken next; PR-3b remains deferred. See below.

---
---

# PR-5 Complete — Create Family (2026-08-01)

**Status: built, migrations applied to the live project, 13 RLS tests passing against the real database, verified on a physical phone.**

## Decisions taken at the start (user-confirmed)

1. **Supabase CLI for migrations**, not dashboard paste — migrations are versioned files reviewable in the PR diff.
2. **`families` + `family_members` shipped together**, with policies checking membership rather than ownership, so PR-6 adds invitations without rewriting a policy.
3. **RLS tests cover all four verbs** (SELECT/INSERT/UPDATE/DELETE), at the user's request — not just read isolation.

## What shipped

- **`supabase/config.toml`** + two migrations:
  - `20260801093000_create_families.sql` — tables, membership helpers, `create_family()`, policies.
  - `20260801101500_grant_family_privileges.sql` — table and function privileges (see below).
- **`src/services/family.ts`** — `createFamily` / `listMyFamilies`, validation, error wording, plus `createSupabaseFamilyGateway` as the only place that knows how families are stored.
- **`src/providers/FamilyProvider.tsx`** — current family, scoped to the signed-in stack.
- **`app/(app)/(tabs)/family.tsx`** — create form when there is no family, profile when there is.
- **`app/(app)/(tabs)/index.tsx`** — Dashboard resolves to the family name.
- **`package.json`** — `dotenv` devDependency and a `test:rls` script.

## Test status

**90 CI tests** (was 69) plus **13 RLS integration tests** run separately. Typecheck clean.

## Two real bugs the RLS tests caught — the reason they exist

**1. RLS applies the SELECT policy to `RETURNING`, before `AFTER ROW` triggers fire.** The first design inserted a family and let an `after insert` trigger add the creator as owner. Because the SELECT policy is membership-based, Postgres asks "may you see this row?" while the membership row still does not exist — so **creation would have failed every single time**.

Creation is now one `SECURITY DEFINER` function, `create_family(family_name)`, doing both inserts. Side benefits: atomic (no family without an owner), and `created_by` comes from `auth.uid()` *inside* the function, so **no request shape can create a family in someone else's name** — stronger than a `WITH CHECK` policy, which can only validate what the client sent. Neither table has an INSERT policy as a result.

**2. Policies are not privileges.** Every policy was correct and every query returned `42501 permission denied`. RLS only narrows what SQL privileges already allow. Supabase's default privileges attach to objects created by the `postgres` role (hence dashboard tables "just work"), but **the CLI runs migrations under its own login role**, so migration-created tables inherit nothing and need explicit `grant`s.

**Carry this into every future table:** new tables need both policies *and* grants, and only an integration test will tell you which is missing.

## The recursion fix — still the load-bearing idea

`families` SELECT needs "am I a member?" (reads `family_members`); `family_members` SELECT needs the same of itself → `infinite recursion detected in policy`. Broken with `SECURITY DEFINER` helpers `is_family_member()` / `is_family_owner()`, which bypass RLS inside the function. `set search_path = ''` on those is mandatory, not stylistic — without it a caller could shadow `family_members` and have the function read it with elevated rights.

## Testing shape to reuse

- Unit tests in CI; `*.rls.test.ts` excluded via `testPathIgnorePatterns`, run with `npm run test:rls`.
- **Every destructive attempt is asserted twice**: the attacker gets zero affected rows, *and* the victim's own session confirms the data is untouched. Under RLS an UPDATE/DELETE matching no visible row **reports success**, so "no error thrown" proves nothing.
- There is a positive test (`lets Bob rename his own family`). Without one, a policy denying everything passes every isolation test while making the product unusable.
- The suite creates `rls-a@example.com` / `rls-b@example.com` on first run and deletes its families afterwards. No setup required.

## Gotchas found this session

- **`npm ci --dry-run` deletes `node_modules`** before resolving (found in PR-4, hit again).
- **`--testPathIgnorePatterns=` with an empty value matches every path**, so it silently selects nothing. Use `--testPathIgnorePatterns=/node_modules/`.
- **`supabase link` writes `.temp/` relative to the current directory.** Run it inside the project, or the link lands in `~/supabase/`. That directory also caches the database password in `pooler-url`.
- Docker warnings during `db push` are only about caching a local schema catalog — irrelevant for a remote push.

## Deliberate gaps

- **Multi-family membership** is representable; `FamilyProvider` picks the first. No switcher UI, unscheduled.
- **`created_by` is not pinned on UPDATE.** Once PR-6 allows a second owner, an owner could rewrite it. Close it then.
- **No leave-family / delete-family UI**, though the policies permit both for owners.

## Next action

PR-6 was taken next. See below.

---
---

# PR-6 Complete — Invite Members (2026-08-01)

**Status: built, migration applied to the live project, 31 RLS tests passing against the real database, verified on a physical phone with two accounts.**

## Decisions taken at the start (user-confirmed)

1. **Short code, not a deep link.** In Expo Go a `familyvault://` link takes an `exp://…/--/join?code=…` form that behaves differently from a real build — more budget, worse demo.
2. **Refuse joining a second family**, since there is no switcher UI and a joined-but-invisible family reads as data loss.

## What shipped

- **`supabase/migrations/20260801140000_create_invitations.sql`** — `family_invitations`, `generate_invitation_code()`, `create_invitation()`, `redeem_invitation()`, `list_family_members()`, policies, and grants.
- **`src/services/invitation.ts`** — code normalisation, validation, error wording, create/redeem/revoke/list.
- **`src/components/InviteCode.tsx`** — the code display, copy-to-clipboard, revoke.
- **`app/(app)/(tabs)/family.tsx`** — join-or-create when family-less; member list + invite management when in a family.

## Test status

**132 CI tests** (was 90) and **31 RLS tests** (was 13). Typecheck clean.

## The prediction from PR-5 that turned out wrong — in a good way

PR-5's checkpoint said PR-6 would give `family_members` "a narrowly scoped INSERT policy for redeemed invitations". **It did not need one.** `redeem_invitation()` is a second `SECURITY DEFINER` function with its own preconditions, so membership still cannot be inserted by any client under any policy.

**The reusable shape:** when a write has preconditions a policy cannot express — "this code exists, is unspent, is unexpired, and you are not already in a family" — a definer function beats widening the policy. Two instances now (`create_family`, `redeem_invitation`).

## Design details worth keeping

- **Code alphabet excludes I, O, 0, 1** — the pairs people misread. 32 symbols × 8 chars = 40 bits, single-use, 7-day expiry.
- **Generated from `gen_random_uuid()`, not `random()`.** `random()` is a seeded PRNG; observing a few codes can reveal the sequence, and a code is a bearer credential.
- **`list_family_members()` exists because `auth.users` is not client-readable.** Its `is_family_member` check is inside the query — without it, SECURITY DEFINER would let any signed-in user dump the email of every member of any family id they could guess. There is a test for exactly that.
- **A refused redemption does not spend the code**, otherwise anyone who learns a code could destroy it by trying it.
- **The screen refetches on tab focus, not just on mount.** Joining happens on another device, so a mount-only load leaves a dead code on screen looking live.

## A test-quality mistake I made and fixed

Two RLS tests were named for properties they did not check: the "already used" case passed because the *already-in-a-family* rule fired first, so single-use was never actually tested. Fixed by adding a fourth account (`rls-latecomer@example.com`) that belongs to no family, for whom nothing else can refuse.

**The rule:** an assertion that something was refused only means something if nothing *else* could have refused it.

## Capabilities that exist but have no UI — check for these

Revocation shipped only because the user asked during review. The owner-only DELETE policy and its RLS test already existed, so the feature looked complete while being unreachable.

**Still true of removing a member and leaving a family.** `family_members` has an owner-only DELETE policy and a passing test, and no interface. Scheduled into **PR-9 (Roles & Permissions)** — recorded in `docs/14-pr-execution-plan.md` §7.

## Not testable from a client

**Expiry.** There is no UPDATE policy on `family_invitations` (deliberately), so nothing can backdate one. Unit tests cover the message; the SQL comparison is one line.

## Next action

Phase 2 planning followed. See the Phase 2 checkpoint below.

---
---

# Phase 2 Planning Checkpoint — "Meet the Family" (2026-08-03)

**Status: planning complete and approved. PR-7 in progress. Full review in the approved plan; this is the operative summary — do not redo the analysis.**

## The finding that reshaped the phase

`docs/08-database-design.md` §8 defines a **Member** as *"a person within the family"* who owns Documents, Medical Records, Recipes, Memories and Timeline Events. FR-010 gives them birthdays and blood groups; FR-011 attaches records to them.

**A person is not an account.** A grandmother who never installs the app, a child, a deceased ancestor — all are members and all will own records. The `family_members` table shipped in PR-5 is `(family_id, user_id, role)`: an *access grant*. It cannot represent a person without a login and it is misnamed for what the rest of the product means by "member".

Every record table from Phase 3 points at the person, so this is fixed now, while exactly five functions reference the table and nothing else does.

## Confirmed decisions

1. **Rename `family_members` → `family_users`** (accounts + role). New `family_members` = people. Future tables read `documents.member_id → family_members.id`.
2. **Phase 2 is five PRs:** PR-7, PR-8, PR-9a, PR-9b, PR-10. PR-9 split because it was ~3.5h.
3. **Record visibility decided in PR-9a, applied from Phase 3** — a `visibility text default 'family' check (in ('family','restricted'))` column on every record table *at creation time*. Retrofitting it across documents, medical, memories and recipes later is a migration plus a policy rewrite on each.
4. **PR-3b is a release gate, not a roadmap item** (user's reframing — better than inserting it mid-phase). See the gate below.

## The mechanism that stops PR-9a rewriting PR-7 and PR-8

**Every policy from PR-7 onward calls an intent-named helper, never a role-named one.**

| Helper | PR-7 body | PR-9a body |
|---|---|---|
| `has_family_access(family_id)` | any row in `family_users` | unchanged |
| `can_manage_family(family_id)` | owner | owner |
| `can_manage_members(family_id)` | owner | owner, admin |
| `can_edit_people(family_id)` | any member | owner, admin, member |

PR-9a edits four function bodies and **zero policies**. This is why the roadmap order survives; without it PR-9a would have to come first, opening the phase with a backend-only stream and breaking the vertical-slice rule.

> **Corrected 2026-08-04.** "Zero policies" is wrong. PR-9a **removes two** — the UPDATE and DELETE
> policies on `family_users` — and replaces them with a definer function, because widening
> `can_manage_members` to include Admin would otherwise let an Admin promote themselves to Owner.
> Nine of the eleven policies are untouched and the mechanism did its job, but the number was too
> strong. See the PR-9a Architecture Review checkpoint at the end of this file.

**PR-7 must therefore also migrate the eight existing policies** (on `families`, `family_users`, `family_invitations`) off `is_family_member` / `is_family_owner` and onto the new helpers, then drop the old two. Postgres will refuse to drop a function a policy depends on, so the order inside the migration matters.

## PR order and one-line scope

| PR | Scope | Budget |
|---|---|---|
| **7 Family Profiles** | rename; people table with `deleted_at`, `updated_at`, unique `(id, family_id)`; four helpers; auto-provision on create/join; list + add/edit | ~2h15 |
| **8 Family Relationships** | `parent_of` / `spouse_of` / `sibling_of`; composite FKs; list + add form | ~2h15 |
| **9a Roles & Matrix** | four roles; permission matrix doc; last-owner guard; role badges + change role; **the visibility decision** | ~2h25 |
| **9b Membership Lifecycle** | remove member, leave family, transfer ownership | ~1h55 |
| **10 Activity Feed** | one `family_activity` table, triggers, Dashboard feed | ~2h10 |

**PR-8 should be renamed from "Family Tree"** — the visual tree is deferred to Phase 6+, and shipping a "Family Tree" that draws no tree contradicts the honesty standard now published on the landing page.

## Cut lines (never cut the first three items)

`deleted_at`, `updated_at`, and unique `(id, family_id)` are cheap now and migrations later — they survive any time pressure. Cuttable: PR-7's date of birth and blood group (ship name only); PR-8's `sibling_of`; PR-9a's matrix prose; PR-10's trigger sources beyond two tables.

## Hidden dependencies

1. **PR-7's rename rewrites five PR-5/PR-6 functions.** The 31 existing RLS tests are the regression gate and must pass unchanged.
2. **PR-7 must add unique `(id, family_id)`** or PR-8's composite FK is impossible.
3. **PR-7 must update `src/services/invitation.ts`** — `list_family_members` changes shape. `listMembers` and `FamilyMember` move to the new `member.ts`.
4. **Removing a member must not delete the person** (9b). Their records survive; the confirmation copy must say so.
5. **Correction to the plan, made during PR-7:** removal deletes only the `family_users` row and **leaves `family_members.user_id` intact**. The plan originally said to null it, which would make rejoin-relinking impossible — there would be nothing to match on. Keeping the link means `redeem_invitation` finds the existing person and creates no duplicate.
6. **PR-9a's visibility decision blocks Phase 3**, not Phase 2.
7. **PR-10's triggers must target the renamed tables.**

## Release Gate — before any external tester

Not a phase, not a PR. Must be fully green before anyone who is not the author signs in.

- [ ] **Password reset** (PR-3b) — a forgotten password is currently a permanent lockout.
- [ ] **Email verification enabled** — currently off, so nothing proves address ownership.
- [ ] **Production email provider** — Supabase's built-in sender is rate-limited to a handful per hour. All three share this one dependency, which is why they are one gate.
- [ ] **First external testers** — the outcome, once the above hold.

Flagged as candidates, not assumed: auth rate-limit review, a data-handling statement (Checkpoint 1 finding #5, DPDP), account deletion / data export (finding #7).

## Draft permission matrix (input to PR-9a)

| Action | Owner | Admin | Member | Guest |
|---|---|---|---|---|
| View family, people, relationships | ✓ | ✓ | ✓ | ✓ |
| Rename / delete family | ✓ | — | — | — |
| Add / edit a person | ✓ | ✓ | ✓ | — |
| Add / edit relationships | ✓ | ✓ | ✓ | — |
| Create / revoke invitations | ✓ | ✓ | — | — |
| Change roles | ✓ | — | — | — |
| Remove a member | ✓ | ✓ (not owners) | — | — |
| Leave the family | ✓ (unless last owner) | ✓ | ✓ | ✓ |
| Transfer ownership | ✓ | — | — | — |
| View activity | ✓ | ✓ | ✓ | — |
| View records *(Phase 3+)* | ✓ | ✓ | ✓ | — |
| View `restricted` records | ✓ | ✓ | subject only | — |
| Delete records *(Phase 3+)* | ✓ | ✓ | own only | — |

## Branch note

PR #11 (landing theme toggle) was pushed just after PR #10 merged, so it missed that merge and is open on `local`. **PR-7 is therefore on `pr-7-family-profiles`, branched from `master`** — a deviation from the one-branch convention, taken so PR-7's diff is not bundled with the toggle. Merge #11, then this branch merges cleanly too.

---
---

# PR-7 Complete — Family Profiles (2026-08-03)

**Status: built, three migrations applied, 172 CI tests and 45 RLS tests passing, verified on a physical phone with both a new and a pre-existing account.**

## What shipped

- **`20260803090000_family_members_as_people.sql`** — renames the access table to `family_users`; creates `family_members` as people with `deleted_at`, `updated_at` and unique `(id, family_id)`; introduces the four intent helpers; moves all eight existing policies onto them and drops `is_family_member` / `is_family_owner`; adds `add_family_member` / `update_family_member`; redefines `list_family_members` to return people.
- **`20260803120000_backfill_people_and_provision_on_access.sql`** — the defect fix, below.
- **`src/services/member.ts`** + 39 unit tests; `src/services/member.rls.test.ts` (14 RLS tests).
- **`src/components/MemberForm.tsx`**; `app/(app)/(tabs)/family/` is now a nested stack (`index`, `new`, `[memberId]`).
- `FamilyRole` moved to `family.ts`; `listMembers` moved out of `invitation.ts` into `member.ts`.

## The regression gate held, with one correction to the plan

The rename rewrote five PR-5/PR-6 functions. All 31 existing RLS tests pass with **behaviour unchanged** — but three needed their *table name* updated, so the plan's phrasing ("must pass unchanged") was wrong in the literal sense. Tests that name a renamed table obviously move with it; what must survive untouched is what they assert.

## The defect that shipped and was caught on device — remember this class

Migration `...090000` created the people table empty and taught `create_family()` / `redeem_invitation()` to provision a person. **Both only run for new families and new joiners**, so every pre-existing family had access rows and no people: the member list was empty and the owner could not see themselves.

Worse, the screen derived "am I the owner?" from that member list, so the owner **silently lost their invite controls** — no error, the buttons were simply absent.

Two fixes, and the second matters more than the first:

1. **Backfill**, `NOT EXISTS`-guarded so re-running is harmless.
2. **Provisioning is now an `after insert` trigger on `family_users`**, not a step inside two functions. That duplication is *why* the case was missed — the rule lived in the two places that happened to exist when it was written. As a trigger it covers every future path that grants access, including PR-9b's ownership transfer.
3. **Role now comes from `FamilyProvider`, read from the access table.** A failed read returns `null` (no permission) rather than a guess; a test pins that.

**Standing rules taken from this** (also saved to persistent memory as `migration-backfill-bug-class`):
- A migration adding a table that existing rows need entries in **must** include a backfill in the same migration. Ask: *what does this mean for data that already exists?*
- "On X, also create Y" belongs in a trigger, not in each caller.
- Authorization must read the record that grants it. Never infer it from a list or from derived UI state. On a failed read, deny.

## Known gap, deliberately not closed here

There is **no test asserting the invariant "every account with access has a person row."** Nothing in the suite would have caught this, and the class recurs whenever a later phase adds a table existing families need rows in. Worth adding early in PR-8.

## Deliberate omissions

Photos (needs Storage — Phase 3), contact fields, notes, deleting a person, and a native date picker (the birthday is a validated `YYYY-MM-DD` text field).

## Next action

PR-8 followed. See below.

---
---

# PR-8 Complete — Family Relationships (2026-08-03)

**Status: built, migration applied, 210 CI tests and 60 RLS tests passing, verified on a physical phone.**

**Renamed from "Family Tree"** in the roadmap. The visual tree stays deferred to Phase 6+, and shipping something called a family tree that draws no tree would contradict the honesty standard published on the landing page.

## What shipped

- **`20260803150000_create_family_relationships.sql`** — the table, the reciprocal-parent trigger, `add_family_relationship`, policies and grants.
- **`src/services/relationship.ts`** + 38 unit tests; **`src/services/relationship.rls.test.ts`** (15 RLS tests, including the PR-7 invariant test).
- **`app/(app)/(tabs)/family/[memberId]/`** is now a directory: `index.tsx` (detail), `edit.tsx` (the old form), `relationship.tsx` (add).

## The two properties that make this table correct

**Cross-family links are structurally impossible.** The foreign keys reference `(member_id, family_id)` rather than `member_id` alone, so a relationship spanning two families cannot be inserted at all — not "is caught by a policy", *cannot exist*. This is why PR-7 had to add the unique `(id, family_id)` on `family_members`.

**Symmetric pairs are stored once.** `spouse_of` and `sibling_of` are canonicalised with the lower id first, so (A,B) and (B,A) cannot both exist and "are they married?" is one lookup. **The ordering happens inside the database function, never in the client** — a unit test asserts the service does *not* sort, because two implementations of the same rule eventually disagree and duplicates appear.

## Three stored types, four UI choices

`parent_of`, `spouse_of`, `sibling_of`. Grandparent, cousin, aunt and in-law are all derivable; enumerating relationship names is a list that grows forever and still misses cases.

**Added beyond the plan:** the screen offers **four** choices over those three types. Building it made the gap obvious — with only "Parent of", standing on your grandmother's page you could never say "Nani is the *child* of X" without reasoning backwards about arrow direction, which is how data gets entered wrong. "Child of" swaps the arguments and produces the identical row. `resolveRelationshipArguments` is the only place direction is decided, and a test asserts both phrasings converge.

## Deliberate gaps

- **Derived relationships are not computed.** Nani's page reads "Sunita — Child", never "Ankit — grandchild". Ships with the tree view.
- **Longer cycles (A→B→C→A) are not prevented.** Only direct reciprocal parenthood is. Detection needs a recursive walk on every insert, and a looping tree is a data-entry mistake rather than an attack.
- **No relationship metadata** (marriage dates, adoption status).
- **No soft delete** — unlike people, a relationship carries no records and is trivially re-created.

## The PR-7 promise, delivered

`relationship.rls.test.ts` → `data invariants` asserts **every account with access has a person row**. Nothing in the suite asserted it before, and it is the only kind of test that would have caught PR-7's backfill defect. Add an equivalent whenever a later phase introduces a table that existing families need rows in.

## Next action

**PR-9a — Roles & Permission Matrix.** Widen `family_users.role` to `owner | admin | member | guest`, write the matrix into `docs/`, add the last-owner guard, and **record the record-visibility decision that blocks Phase 3**.

PR-9a was then reviewed in depth before implementation. **Read the checkpoint below instead of
this paragraph** — the review found that PR-9a cannot be a simple enum change, and the draft matrix
in the Phase 2 checkpoint has been superseded by `docs/15-permission-matrix.md`.

---
---

# PR-9a Architecture Review — Roles, Permissions & Visibility (2026-08-04)

**Status: review and planning only. No application code, no migration, no schema change. PR-9a is
fully specified and has not been started.** The only changes on disk are documentation.

## Read these before writing a line of PR-9a

1. **`docs/15-permission-matrix.md`** — created this session. Authoritative for the role model, the
   permission matrix, the last-owner guarantee, and the record visibility contract. Where it and
   any earlier document disagree, it wins.
2. **`docs/14-pr-execution-plan.md` §7.1** — what the review changed about the *plan*.
3. This checkpoint — scope, cut lines, and next steps.

## Why the review happened

The user asked for one architecture review before PR-9a, limited to decisions that are hard to
change later: the four-role model, the permission matrix, the last-owner guard, and record
visibility. Everything from Phase 3 onward is governed by this model, so the cost of getting it
wrong is a migration on every record table.

The review paid for itself: it found **two privilege-escalation holes that the PR-9a widening
itself creates**.

## The governing principle (the single most important idea here)

> **A role answers "what may you do *to* the family." Visibility answers "what may you see
> *inside* it."**

Two axes, never collapsed into one. The temptation is to keep adding roles until each answers a
privacy question — a Child role, a Restricted Member role, an Emergency role. That ends with a
dozen roles, none quite right.

It is the wrong axis *for this product specifically*: a family is four to fifteen people who mostly
trust each other. They do not need a finer capability grid; they need one medical record hidden
from a brother-in-law. That is a property of the record, not of the reader.

## Decisions finalised, and why

**1. Four roles — Owner, Admin, Member, Guest. No fifth.**
Emergency Contact (Persona 6) must **never** be a role: it is time-bounded, may belong to someone
with no account at all (an ER doctor), and an `'emergency'` value would inherit `has_family_access`
— i.e. every document in the family. It becomes a separate grant table with `expires_at` in Phase
10. Digital Legacy (Phase 11) is cryptographic; roles cannot govern content the server cannot read.
A teenager (Persona 5) is a **Member** whose constraint is visibility, not role.

Guest was challenged hardest — it has no persona and FR-008 says roles "*may* include" it. Kept
anyway, because without a read-only role the first request for limited access invents one later,
and every helper written in the meantime has already implicitly decided what it can do.

**2. Owners are plural.** A couple co-owning is normal and already reachable via an owner
invitation. This is why the last-owner guarantee is a count check, not a transfer-only model.

**3. `text` + `check`, not a Postgres `enum`.** `ALTER TYPE … ADD VALUE` cannot be used in the
transaction that adds it, removing a value is near-impossible, and an enum's implicit ordering
invites the `role >= 'member'` comparison that decision 4 forbids.

**4. Every helper body is an allow-list, never a deny-list.** `role in ('owner','admin')`, never
`role <> 'guest'`. A deny-list means every role invented in a later phase silently inherits every
permission written before it existed — the single most likely way this model fails.
`has_family_access` is the one deliberate exception: it is role-blind because it answers "are you
inside the tenant boundary", which all four roles are.

**5. Three new helpers ship in PR-9a** — `can_read_records`, `can_write_records`,
`can_delete_records` — so Phase 3's first PR does zero permission design and cannot inline a role
check into a policy. They are testable by direct call before any record table exists.

**6. Two security holes, both fixed in PR-9a** (full detail: `docs/15-permission-matrix.md` §6):

- **An Admin could promote themselves to Owner.** The PR-5 grant of `select, update, delete`
  followed the rename onto `family_users`, and both write policies are gated only by
  `can_manage_members(family_id)` — pinning neither the target row nor the new value. Widen that
  helper and `update family_users set role='owner' where user_id = :self` succeeds, as does
  `delete … where role='owner'`. **Fix: `family_users` becomes fully write-closed** (no INSERT,
  UPDATE or DELETE policy; UPDATE/DELETE revoked) with `set_family_role()` as the only writer. This
  is the third instance of the rule the project already knows — *writes with preconditions belong
  in a definer function, not a policy.*
- **An Admin could mint an Owner invitation.** `create_invitation` checks *who may invite* and
  *what role may be invited* as two unrelated conditions. **Fix: cap the invited role by the
  inviter's rank** — Owner may invite any role, Admin may invite Member or Guest only.

Neither is a defect in shipped behaviour; both go live the moment `can_manage_members` includes
`'admin'`, which is why they must ship in the same PR as the widening.

**7. The last-owner guarantee needs a row lock — a trigger alone cannot provide it.**
Under READ COMMITTED, two owners demoting each other concurrently both read `count(*) = 2` (neither
sees the other's uncommitted change), both pass, both commit, zero owners. **A trigger runs in the
same transaction on the same snapshot and is equally blind.** Three layers:
(1) `select 1 from public.families where id = target for update` first in every function that can
change the owner count — the same technique `redeem_invitation` already uses;
(2) the check after the write, inside the function, so the message is a sentence;
(3) a backstop trigger for the `auth.users` cascade path, which goes through no function.

**The trigger's cascade guard is the detail that costs an hour:** it must skip when the family row
is already gone (`if exists (select 1 from public.families where id = coalesce(new.family_id,
old.family_id))`), or deleting a family cascade-deletes its access rows, the trigger sees zero
owners, and **family deletion breaks.**

**8. The record visibility reframing.** The Phase 2 checkpoint proposed
`visibility in ('family','restricted')` on every record table. The correction:

> Adding a visibility value later is a trivial `alter table`. Rewriting every record policy that
> spelled out `visibility = 'family' or …` is not.

So what is frozen before Phase 3 is **the columns every record table carries** and **the one
function every record policy calls** — not the vocabulary. With a single `can_see_record()`
resolver, Phase 10's Advanced Permissions adds a `shared` value by editing one function body and
zero tables. This is the intent-helper lesson applied a second time.

`created_by` is the column that genuinely cannot be added later — there is no way to backfill who
created an existing row. "restricted" was renamed to `private`: both `family` and `private` are
words a user can be shown, and "restricted" never says restricted *to whom*.

**9. The matrix ships as a test fixture, not only as prose.** One data structure in
`permissions.rls.test.ts` mirroring the doc; four role-holders × seven helpers = 28 assertions. A
permission matrix that lives only in Markdown is wrong within two phases.

## The two decisions the user made explicitly

**`private` means private — no role reads it, not Owner, not Admin.** Reasoning: it is the only
reading that makes the word true (the landing page now carries an honesty standard); it is the only
option that serves Persona 5, the teenager whose parent holds Admin — precisely Checkpoint 1's
finding #1; the failure mode is data unreachable rather than data leaked, which is the safe
direction; recovery paths already exist in the roadmap as *designed and auditable* features
(Emergency Mode, Phase 10; Digital Legacy, Phase 11); and it is reversible in one line of one
function if the product later needs owner recovery.

**PR-9a absorbs the record-visibility groundwork at ~2h40, over the 2h cap.** The alternative was
deferring it into Phase 3, putting permission design on the critical path of a stream already
building an upload flow.

## Still unresolved, and why each stays open

| Open item | Why it is still open |
|---|---|
| **Per-record ACLs** — "share this with Mum and Dad specifically" | No user story yet that the two-value model fails. §8.1 of the matrix makes it a one-function edit whenever one appears. Scheduled: Phase 10, *Advanced Permissions*. |
| **Emergency access for a non-member caregiver** (Checkpoint 1 #2) | Needs a real design — token? QR? expiry length? — that is Phase 10's whole job. Decided *now* only that it is **not** a role. |
| **Cross-family sharing** (Checkpoint 1 #4) | `docs/08` §22 asserts "unless explicitly shared" with no mechanism. Deliberately untouched: designing it before a real use case blocks on it would be guessing. |
| **Column-level privacy for Guests** | `family_members`' SELECT policy is `has_family_access`, so a Guest reads `date_of_birth` and `blood_group` straight from PostgREST. Masking them in `list_family_members` would be theatre — the table is readable directly. Resolves structurally in Phase 5, where blood group arguably belongs to the medical record rather than the person row. Recorded as a **known gap**, not a fix. |
| **DPDP / compliance posture** (Checkpoint 1 #5) | Untouched. Still belongs to the Release Gate discussion. |
| **Whether Medical should default to `private`** | Deferred to Phase 5 on purpose: "Mum's medications" is exactly what a household needs at 2am, and the column allows the default to change per table with no model change. |

## What PR-9a implements

**Migration — `supabase/migrations/<ts>_roles_and_permission_matrix.sql`**

1. Widen both role check constraints to `('owner','admin','member','guest')`. **Gotcha:**
   `alter table … rename` does *not* rename constraints, so `family_users` still carries
   `family_members_role_check` from PR-5. Confirm with `\d family_users`, and **do not use
   `drop constraint if exists`** — a silent no-op leaves the two-value constraint in place and every
   new role is rejected at runtime, on device. `family_invitations_role_check` needs the same
   widening. No backfill: both existing values stay legal.
2. `role_rank(text) → int` — `immutable`, `else -1` so unknown roles fail closed. Comment must say
   it compares **actors**, never permissions; `role_rank(x) >= 1` is a deny-list in disguise.
3. `create or replace` the four helpers as allow-lists (`has_family_access` unchanged); add
   `can_read_records`, `can_write_records`, `can_delete_records`.
4. `can_see_record(uuid, text, uuid, uuid)` — the visibility resolver, unknown value → `false`.
5. **Hole 1:** drop `"Managers can change roles"` and `"Managers can remove access"`;
   `revoke update, delete on public.family_users from authenticated`; add
   `set_family_role(target_family, target_user, new_role)` — lock the family row `for update`,
   require `can_manage_family`, validate the role, refuse acting on an equal-or-higher rank, update,
   assert an owner still exists.
6. **Hole 2:** `create or replace create_invitation` with the rank cap and a reworded error.
7. Last-owner backstop trigger **with the cascade guard**.
8. Pin `families.created_by` with a `before update` trigger (PR-5's explicitly deferred item).
9. Grants for every new function. The RLS suite is the only thing that catches a missing one.

**Application layer**

| File | Change |
|---|---|
| `src/services/family.ts` | `FamilyRole` → four values; `ROLE_LABELS`; client-side predicates for UI gating only |
| `src/services/role.ts` *(new)* | `setRole`, `describeRoleError`, gateway — mirroring `member.ts` |
| `src/services/invitation.ts` | invitable roles derived from the caller's role |
| `app/(app)/(tabs)/family/index.tsx` | role badge on each person who has an account |
| `app/(app)/(tabs)/family/[memberId]/index.tsx` | replace the hard-coded `role === 'owner' ? 'Owner' : 'Member'` (line 122) with the label map; add "Change role" |
| `app/(app)/(tabs)/family/[memberId]/role.tsx` *(new)* | change-role modal, registered in `family/_layout.tsx` |

Reuse `Button`, `Screen`, and the choice-chip pattern from `[memberId]/relationship.tsx`.

**Tests**

Unit (`role.test.ts`): label map, rank ordering, invitable-role derivation, error wording, gateway
shape.

RLS (`permissions.rls.test.ts`, accounts `rls-role-{owner,admin,member,guest,outsider}@example.com`
— every suite uses its own prefix, and fresh accounts sidestep the "already in a family" rule):

- **the matrix as data** — 4 roles × 7 helpers = 28 assertions
- `can_see_record` — `family` visible to Member not Guest; `private` invisible to **Owner and
  Admin**, visible to author, visible to subject; unknown value → false
- **Hole 1** — an Admin's direct `update … set role='owner'` and `delete … where role='owner'` each
  affect zero rows, *and* the victim's own session confirms the row is untouched
- **Hole 2** — an Admin creating an `owner` invitation is refused; a `member` one succeeds
- **Last owner** — self-demotion refused, and **the concurrent race**: two owners, `Promise.all`,
  exactly one succeeds
- **Family deletion still works** with the backstop trigger installed — this is the test that fails
  if the cascade guard is wrong
- `created_by` cannot be rewritten by an owner

**Documentation:** update `docs/15-permission-matrix.md` if implementation contradicts it, add a
PR-9a checkpoint here, and add the write-closed-`family_users` rule and the record contract to
`README.md` **only once they exist in code**.

## Cut lines, in order

1. The matrix **prose** in the doc (keep the table and the test).
2. The role badge on the people list (keep it on the detail screen).
3. `can_read_records` / `can_write_records` / `can_delete_records` — **if cut, PR-11 must add them
   rather than inline a role check in a policy.**

**Never cut:** the two escalation fixes, the family-row lock, the trigger's cascade guard, or
`created_by` on the record contract.

## Next steps, in priority order

1. **Merge PR #13** (PR-8, Family Relationships) — open with all checks green at
   https://github.com/thisisankit27/Family-Knowledge-Vault/pull/13. PR-9a branches from `master`
   after it lands.
2. **Merge the documentation PR** this session raises (see the branch note below).
3. **Implement PR-9a** exactly as scoped above. Start with the migration, then the RLS tests, then
   the UI — the tests are what prove the two holes are actually closed.
4. **PR-9b — Membership Lifecycle**: remove a member, leave a family, transfer ownership. Every one
   of those changes the owner count, so all three take the family-row lock. Removal deletes only the
   `family_users` row and **leaves `family_members.user_id` intact**, so a rejoining member is
   matched rather than duplicated.
5. **PR-10 — Activity Feed.** Its triggers must target the renamed tables, and **feed entries
   referencing a record must inherit that record's visibility** — a row reading "Ankit added
   *Therapy notes*" leaks a private record through its title.
6. **End of Phase 2: update the landing page Progress section** per the `CLAUDE.md` checklist —
   stats, "What works today", "What does not work yet" (source it from the *Open items* and
   *Deliberate gaps* sections of this file), and the phase list.
7. **Release Gate** before any external tester: password reset (PR-3b), email verification,
   production email provider.

## Branch note

The review produced documentation only. It is committed on **`pr-9a-planning`**, branched from
`pr-8-family-relationships` so it does not wait on PR #13. If #13 merges first, this branch rebases
onto `master` cleanly — it touches no file PR-8 touched except `.claude/current-session.md`.
