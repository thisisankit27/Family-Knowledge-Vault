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
3. **Record visibility decided in PR-9a, applied from Phase 3** — a `visibility text default 'family' check (in ('family','private'))` column on every record table *at creation time*. Retrofitting it across documents, medical, memories and recipes later is a migration plus a policy rewrite on each. *(Corrected 2026-08-06: this line said `'restricted'` until PR-10. PR-9a renamed the value to `private`, because "restricted" is developer language and never says restricted to whom — see `docs/15-permission-matrix.md` §8.2.)*
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

---
---

# PR-9a Complete — Roles, Permissions & Visibility (2026-08-05)

**Status: built, migration applied to the live project, 237 CI tests and 118 RLS tests passing,
bundle verified. Not yet demoed on device — that is the stream.**

## What shipped

- **`20260805090000_roles_and_permission_matrix.sql`** — the whole PR-9a scope in one migration:
  both role check constraints widened to four values, `role_rank`, the helpers rewritten as
  allow-lists plus `can_read_records` / `can_write_records` / `can_delete_records`,
  `can_see_record`, `family_users` write-closed with `set_family_role` as its only writer,
  `create_invitation` rank-capped, the last-owner backstop trigger with its cascade guard, and
  `families.created_by` pinned.
- **`src/services/role.ts`** + 26 unit tests — labels, descriptions, `roleRank`, `invitableRoles`,
  the UI-gating predicates, `setRole`, `describeRoleError`, gateway.
- **`src/services/permissions.rls.test.ts`** — 58 tests against the real database.
- **`app/(app)/(tabs)/family/[memberId]/role.tsx`** — the change-role screen; role chips on the
  invite card; `ROLE_LABELS` wherever a role is drawn.

## Three things the specification got wrong, found by building it

`docs/15-permission-matrix.md` was written before implementation and is now v1.1. Each correction
is marked in place in that document rather than quietly rewritten.

**1. The invitation rank cap was stated two incompatible ways** — "a role *below* their own" and
"Owner may invite any role", in the same paragraph. Strictly-below forbids an Owner inviting an
Owner, which is the only way a family acquires a second owner and is behaviour PR-6 already
shipped. Built as `role_rank(invited) <= role_rank(inviter)`. An Admin inviting an Admin is
lateral, not an escalation; what the cap closes is an Admin minting an *Owner* code.

**2. `set_family_role` has no rank comparison, deliberately.** The plan said "refuse acting on an
equal-or-higher rank". The function is gated on `can_manage_family`, which is Owner-only — so every
caller is rank 3 and every Owner target is rank 3, and that clause would have refused every
owner-to-owner change including self-demotion. The last-owner assertion would have been unreachable
and the concurrency test unpassable. **What stops an Admin is the Owner gate, not a hierarchy.**

**3. `can_see_record` needed a `has_family_access` gate the spec did not have.** `record_author =
auth.uid()` stays true forever, so without the gate somebody removed from a family in PR-9b would
keep reading every private record they had ever written. Access to the tenant is a precondition of
every branch, not an alternative to one.

The general lesson: **all three were found by trying to write the test, not by re-reading the
prose.** A document asserting behaviour is a hypothesis until something executes it.

## The concurrency test is the one worth keeping

`the last-owner guarantee › lets exactly one of two concurrent self-demotions through` is the only
test in the suite that would fail if the `select … for update` on the family row were removed.
Under READ COMMITTED both transactions read `count(*) = 2` — neither sees the other's uncommitted
write — so both pass their check, both commit, and the family is left with no owner. A trigger
cannot help: it runs in the same transaction on the same snapshot and is equally blind.

Two owners, `Promise.all`, exactly one succeeds. Everything else about the guarantee is a `count`.

## Five existing tests changed, and why that is not a regression

- **Two in `family.rls.test.ts`** — Alice's cross-family `update`/`delete` on `family_users` now
  return `42501` instead of an RLS-filtered empty result, because the privileges are revoked
  outright. That is a *stronger* refusal: it does not depend on a policy expression being right.
  What both tests actually pin — that Bob's row is untouched — is unchanged.
- **Three in `invitation.rls.test.ts`** plus two unit assertions — `'Only an owner can invite'`
  became `'Not allowed to invite people to this family'`, because inviting stopped being
  owner-only the moment Admins arrived and the old message was simply untrue.

## Gotchas from this session

- **`curl http://localhost:8081/index.bundle` returns 404** on this project and the note in the
  PR-1 checkpoint is stale. Expo Router's entry is
  `/node_modules/expo-router/entry.bundle?platform=android&dev=true` (or
  `/.expo/.virtual-metro-entry.bundle?…`). Both return 200 when the bundle compiles.
- **The constraint-name warning was real and the guess was right.** `family_users` did still carry
  `family_members_role_check`. The migration drops it *without* `if exists` on purpose — a silent
  no-op would have left the two-value constraint live and every new role would have been rejected
  at runtime, on a device.
- **The last-owner tests must clean up from both accounts.** Each one demotes an owner, and a
  demoted account cannot delete the family it created, so clearing only the creator leaves the
  other account stuck inside a family that outlives the test.

## Deliberate gaps

- **No record table exists yet.** `can_see_record` and the three record helpers are tested by
  direct call. PR-11 is the first to use them, and its only job on this front is to copy the spine
  from `docs/15-permission-matrix.md` §8.2 — it does no permission design.
- **No UI removes access, transfers ownership, or lets anyone leave.** All three are PR-9b, and all
  three take the same family-row lock.
- **A Guest still reads `date_of_birth` and `blood_group`** straight from PostgREST, because
  `family_members`' SELECT policy is `has_family_access`. Recorded as a known gap in the matrix
  §10, not a fix — masking them in `list_family_members` would be theatre while the table is
  readable directly. Resolves structurally in Phase 5.
- **Nobody can be invited as an Owner from the UI without also being able to invite everyone else**
  — the chips offer whatever `invitableRoles` returns, which is correct, but there is no
  confirmation step on handing out ownership.

## Next action

**PR-9b — Membership Lifecycle**: remove a member, leave a family, transfer ownership. Every one
changes the owner count, so all three take `select … from families … for update` as their first
statement, exactly as `set_family_role` does. Removal deletes only the `family_users` row and
**leaves `family_members.user_id` intact**, so a rejoining member is matched rather than
duplicated. Removal is also where the *rank* rule finally earns its place: an Admin may not remove
an Owner or another Admin.

Then PR-10 (Activity Feed — entries referencing a record must inherit that record's visibility, or
a row reading "Ankit added *Therapy notes*" leaks a private record through its title), then the
end-of-Phase-2 landing page update per the `CLAUDE.md` checklist.

---
---

# PR-9b Complete — Membership Lifecycle (2026-08-06)

**Status: built, migration applied, 265 CI tests and 136 RLS tests passing, bundle verified.
Not yet demoed on device — that is the stream.**

## What shipped

- **`20260806090000_membership_lifecycle.sql`** — `remove_family_access` and `leave_family`, the
  remaining two writers of the write-closed `family_users`. Both take the family-row lock as their
  first statement, exactly as `set_family_role` does.
- **`src/services/access.ts`** + 22 unit tests — `removeAccess`, `leaveFamily`,
  `transferOwnership`, `canRemoveAccess`, `describeAccessError`, gateway.
- **`src/services/membership.rls.test.ts`** — 18 tests against the real database.
- **`deleteFamily`** on the existing `FamilyGateway` — a plain policy-gated delete, no RPC.
- **UI** — "Remove access" and "Make owner and step down" on the member detail card; "Leave
  family" in the More tab's account panel; a new `family/delete.tsx` with a typed confirmation;
  a quiet owner-only "Delete this family" at the foot of the Family tab.

## Deleting a family needed no migration at all

The `families` DELETE policy (`can_manage_family`) and its grant have worked since PR-5 and are
asserted by `permissions.rls.test.ts`. The capability existed and was simply unreachable — the
third time this project has found a shipped-but-unwired capability, after invitation revocation
(PR-6) and the access-table DELETE policy (PR-5, since removed).

**Worth checking for at the end of every phase:** what does the database already permit that no
screen offers?

## The matrix was wrong twice more — and once identically to PR-9a

**1. "Rank on removal" is not a rank comparison.** §4.2 said "an Admin may not remove an Owner or
another Admin" and gave the helper as `can_manage_members` **+ rank**, implying one comparison.
Neither works: `rank(actor) > rank(target)` blocks an Owner removing a co-owner — the case removal
exists for — and `rank(actor) >= rank(target)` lets an Admin remove another Admin. It is two
clauses. **This is the third time a single `role_rank` comparison has been assumed to express an
authorisation rule**, after `set_family_role` and the invitation cap. §5.2 of the matrix already
forbids exactly this and the warning was not enough on its own.

**2. Transfer is not a database primitive.** §7.1 path 5 promised "one locked function". Once
owners are plural, the state between the two role changes is *two owners* — which the product
supports — so a half-finished transfer leaves nothing broken and needs no transaction. It ships as
`transferOwnership` in `access.ts`: two `set_family_role` calls, and the **only** place the
promote-before-demote order is written down. Demoting yourself first is refused by the last-owner
guarantee, so the ordering is the entire value.

Matrix is now **v1.2**. Five corrections across two PRs, all five found by writing the test.

## A test that passed for the wrong reason, caught and fixed

`refuses to remove the last owner` passed on the first run — but the actor had already been removed
from the family, so the refusal was "not allowed to remove this person", not the last-owner rule.
Exactly what PR-6 recorded: *an assertion that something was refused only means something if
nothing else could have refused it.*

Investigating it produced a better finding: **the last-owner branch inside `remove_family_access`
is unreachable.** Only an owner may remove an owner, so if the target is the last owner the actor
is either that same person — caught by the self-check, which redirects to `leave_family` — or
somebody who may not remove an owner at all. There is no third case. The branch stays as a
backstop, with a comment saying so, because the reasoning that makes it unreachable lives in two
*other* clauses and either of them moving would make it load-bearing. The test now asserts both
real doors instead of pretending to test the dead one.

## The bug the first device test found — three states, not two

Removing somebody made the people list show them as **"No account"**, next to placeholder relatives
who genuinely have none. The code had been asking `member.role ? label : 'No account'` since PR-7,
which was correct only while losing access was impossible.

Having an **account** and having **access to this family** are different things, and there are
three states:

| `userId` | `role` | Means | Label |
|---|---|---|---|
| `null` | `null` | A person somebody typed in | *No account* |
| set | set | Has access | the role |
| set | `null` | Left, or was removed | *No longer has access* |

The label was the visible half. The other half was worse: the third state still rendered **"Change
role"** and **"Make owner and step down"**, both gated on `!!member.userId`, and both would have
failed with *"That person does not have access to this family"* — the exact class of always-failing
button PR-9a removed. The change-role screen had the same guard and would have shown a full picker
that saved into a refusal.

Fixed by moving the distinction into `member.ts` — `memberAccess`, `hasFamilyAccess`,
`describeMemberAccess` — so no screen decides it independently, with five unit tests. Every control
that acts on a role is now gated on `hasFamilyAccess`, never on `userId`.

**The copy deliberately does not say "left" or "was removed".** Nothing in the schema records which
of the two happened, and guessing would be a claim about a person. A test asserts the string
contains neither word. PR-10's activity feed is where that distinction can legitimately come from.

**The general lesson:** when a PR makes a previously impossible state reachable, every ternary that
assumed two states is now wrong, and none of them will fail a test or a typecheck — `role` was
already nullable. Grep for the old assumption rather than trusting the compiler.

## Deliberate gaps

- **`family_members.deleted_at` is still unreachable, on purpose.** Recorded as *reserved* in
  matrix §10 against a future **Person Lifecycle** PR. Revoking an account's access and removing a
  person from the family are different domain operations; coupling them would make "remove" mean
  two things. That PR also has to decide what happens to the person's relationships and, from
  Phase 3, their records.
- **No recovery for a deleted family.** `families` has no `deleted_at`; the cascade is real. The
  delete screen says so in those words rather than implying a trash can exists.
- **Leaving does not offer to hand over first.** A sole owner is told to choose a new owner and
  given a button to the people list, but the two flows are not joined into one wizard.
- **A removed member's own device keeps showing the family until it re-reads.** `FamilyProvider`
  has no push channel; their next fetch returns nothing.
- **The migration file was edited after `db push`** to improve one comment inside a function body.
  Behaviour is identical and the tests pass, but `pg_get_functiondef` on the live database will
  differ from the file by that comment until a fresh environment applies the migrations.

## Next action

**PR-10 — Activity Feed**, the last PR of Phase 2. One `family_activity` table, triggers, and a
Dashboard feed. Two constraints already recorded and both easy to miss:

1. **Triggers must target the renamed tables** (`family_users` for access, `family_members` for
   people).
2. **Feed entries referencing a record must inherit that record's visibility** — matrix §9.5. A row
   reading "Ankit added *Therapy notes*" leaks a private record through its title, and the feed is
   the first place visibility can escape the table that protects it.

Then **end of Phase 2: update the landing page Progress section** per the `CLAUDE.md` checklist —
stats (`gh pr list --state merged` count, `npm test` plus the RLS suite), "What works today",
"What does not work yet" sourced from the *Deliberate gaps* sections above, and the phase list.

Then the **Release Gate** before any external tester: password reset (PR-3b), email verification,
and a production email provider — all three blocked on the same email-infrastructure decision.

---
---

# PR-10 Complete — Activity Feed (2026-08-06)

**Status: built, two migrations applied, 312 CI tests and 151 RLS tests passing, bundle verified,
landing page updated. Not yet demoed on device — that is the stream.**

## What shipped

- **`20260807090000_family_activity.sql`** — the table, one SELECT policy, four cascade-guarded
  trigger functions on `families`, `family_members`, `family_users` and `family_relationships`.
- **`20260807093000_activity_clock_timestamp.sql`** — the correction below.
- **`src/lib/relativeTime.ts`** + 17 tests; **`src/services/activity.ts`** + 27 tests;
  **`src/services/activity.rls.test.ts`** (15 tests).
- **Dashboard** — a "Recent activity" card loaded on focus. `'Family activity'` left
  `PLANNED_SECTIONS`, because a roadmap that still promises what has shipped is the same dishonesty
  as a landing page that does.

## The two properties that make this table safe

**A row stores references, never prose.** Action, actor, subject id — the sentence is assembled on
the device from the current member list. Names therefore never go stale, and, the reason that
matters, **a row physically cannot hold a record title.** From Phase 3 a feed entry reading "Ankit
added *Therapy notes*" would leak a private record through its own name (matrix §9.5). Storing the
title nowhere is a stronger guarantee than remembering not to show it. A unit test asserts no
rendered sentence can contain an id.

**The SELECT policy is a single `can_see_record` call.** That one expression delivers the whole of
matrix §4.5: outsiders refused by `has_family_access`, **Guests refused because `'family'`
visibility delegates to `can_read_records`**, private rows filtered to author-or-subject. No role
name appears anywhere in this migration. That is the payoff for PR-9a shipping the resolver before
any table needed it, and it is the pattern every Phase 3 record table copies.

## `now()` is transaction time — the finding worth keeping

The RLS suite asserted the feed opens with the family being created, and it failed about half the
time. `create_family` writes two events in one transaction — `family_created`, then
`access_granted` for its creator — and **`now()` returns the transaction start, so both rows got an
identical `created_at` and ordering between them was arbitrary.** The feed could show somebody
joining a family that did not exist yet.

`clock_timestamp()` reads the wall clock per statement. Fixed in a second migration rather than by
editing the first, which was already applied: **migration history is append-only.**

This will recur. Transferring ownership writes two `role_changed` rows in one transaction, and every
Phase 3 trigger that logs alongside a record write will do the same.

## The cascade guard, for the third time

Deleting a family cascades to three tables that now carry logging triggers, each of which would try
to insert a row referencing a family already gone inside the transaction — a foreign-key violation
whose symptom is that families quietly become undeletable. `log_family_event` checks the family
still exists before inserting, and an RLS test is named for it.

**Three appearances now**: PR-7's backfill defect, PR-9a's `enforce_last_owner`, and this. The
question to ask of any trigger or migration is *what does this mean for rows that already exist, or
are on their way out?*

## The feed can tell leaving from being removed

PR-9b's people list deliberately refuses to guess — a person row records no reason, and guessing
would be a claim about a person. The feed stored both the actor and the subject, so comparing them
answers it: same person means "Priya left the family", different means "You removed Priya's access".
The promise made in PR-9b's checkpoint, delivered.

## The device test found the half of the feed that was still third-person

The actor rendered as "You"; the subject never did. Read as Priya, a role change said *"Ankit made
Priya an admin"* — news about somebody else, and that is the half of the feed a person most wants
to notice.

The subject now gets the same courtesy, and it needs **two** forms rather than one:
`${subject}'s details` renders "you's details", so there is a separate `subjectPossessive` giving
"your". A test asserts no action can produce `you's` for any input.

The comparison is `person.userId && person.userId === viewerUserId` — the left-hand guard matters,
because most people in a family have a null `user_id` and a null-to-null match would make every
placeholder relative read as "you" to a signed-out viewer. There is a test for that too.

## Deliberate gaps

- **No realtime.** The feed loads on screen focus. Supabase Realtime would suit it and costs free-tier
  connections; unscheduled.
- **No pagination.** Ten rows, newest first. No "show more", and no retention policy — the table
  grows forever, which the free-tier database ceiling will eventually notice.
- **Relationship events do not say what the relationship was.** "Ankit added a relationship for
  Nani" — the type and the other person are not in the row, because a row carries one subject.
- **No filtering by kind or person**, and the feed is not reachable from anywhere but the Dashboard.
- **A Guest sees no feed at all**, which is correct per matrix §4.5 but reads as an empty card
  rather than an explanation.

---
---

# Phase 2 Close-out — "Meet the Family" (2026-08-06)

**Five PRs: PR-7 Family Profiles, PR-8 Family Relationships, PR-9a Roles & Permission Matrix,
PR-9b Membership Lifecycle, PR-10 Activity Feed. 18 pull requests merged in total, 312 CI tests and
151 RLS tests, ten migrations.**

## What a stranger can now do

Create an account, create a family, invite people by role with single-use codes, join, add relatives
who will never sign in, record who is whose parent, spouse or sibling, hand out one of four roles,
change them, remove somebody's access, leave, hand the family over, delete it behind a typed
confirmation, and see a history of all of it.

## The three bug shapes this phase taught

Each cost real time and each will recur in Phase 3:

1. **"What about rows that already exist — or are on their way out?"** PR-7 shipped a table with no
   backfill and every pre-existing family lost its member list. PR-9a and PR-10 both needed a
   cascade guard so that deleting a family did not trip a trigger written for the living case.
2. **An authorisation rule is rarely a single rank comparison.** Three separate corrections to
   `docs/15-permission-matrix.md` came from assuming otherwise. `role_rank` compares *actors*; it
   must never appear in a permission check.
3. **A capability with no interface is not shipped.** Invitation revocation (PR-6), the access-table
   DELETE policy (PR-5), and family deletion (PR-5) all existed with passing tests and no way to
   reach them. **Ask at the end of every phase: what does the database already permit that no screen
   offers?**

## What the phase deliberately did not do

Person deletion (`family_members.deleted_at` is reserved for a future Person Lifecycle PR),
multi-family switching, recovery of a deleted family, realtime, the visual family tree (Phase 6+),
and per-record ACLs (Phase 10).

## Still open, unchanged

The **Release Gate** before any external tester — password reset (PR-3b), email verification, and a
production email provider, all three blocked on the same email-infrastructure decision. Plus
Checkpoint 1's findings #4 (cross-family sharing), #5 (DPDP/compliance), #6, #7, #8 and #10.

---
---

# Phase 3 Kickoff — read this first

**`docs/16-phase-3-brief.md` is the entry point for Phase 3.** It was written at the close of Phase 2
for the same reason `docs/15` was written before PR-9a, and it carries the things a cold session
cannot derive:

- The record spine and the mandatory SELECT policy, copied verbatim — **PR-11 does no permission
  design.**
- The storage path contract, and the five storage decisions that **do not exist anywhere in the
  repo**: bucket name, MIME allow-list, size cap, thumbnails, filename sanitisation.
- The free-tier ceiling Phase 3 is the first to consume.
- **Four contradictions in the existing docs** that must be resolved rather than silently decided:
  what "Document Sharing" means, whether a document belongs to one member or several, archive versus
  soft delete, and versioning.
- **`react-native-pdf` is not an Expo module** and this project demos on Expo Go pinned to SDK 54.
  PR-13 has a workflow decision before it has code.

Its §9 is a five-item checklist to settle before the first line of PR-11. Three of the five change
the schema.

> **Superseded 2026-08-07 — read the next section instead.** All five items (plus two the checklist
> had dropped) are settled, and `docs/16` now carries each resolution inline. The storage decisions
> no longer "do not exist anywhere in the repo".

---
---

# Storage Architecture Review + Local Dev Environment (2026-08-07)

**No application code changed. `docs/16` §9 is now fully settled, and development has moved off the
hosted project.**

## What happened

Before PR-11 started, a proposal arrived to replace Supabase Storage with **user-owned Google
Drive** — FKV as an intelligence layer over bytes it does not hold, with three AI privacy modes. It
was reviewed rather than accepted. The full record is **`docs/17-storage-architecture-review.md`**.

**Verdict: Architecture A (Supabase Storage) ships. Architecture C (provider-portable data model) is
adopted at near-zero cost. Google Drive is declined as a foundation and recorded as a Phase 12
candidate, sequenced Dropbox/OneDrive first.**

## The three findings that decided it

1. **There is no folder-scoped OAuth for Drive.** `drive.appdata` is a *hidden* folder; `drive.file`
   is *per-file* and can never see a file the user adds themselves; full `drive` is a **restricted
   scope** requiring an annual ~$540 CASA assessment. The recovery path — Google Picker — is
   **web-only, no mobile SDK**.
2. **Digital Legacy breaks outright.** Files in a personal Drive die with the person. Google deletes
   accounts after two years of inactivity, Inactive Account Manager is Google's own mechanism FKV
   cannot audit, and **consumer accounts cannot create Shared Drives** — so the "family folder" is
   always one mortal individual's. *A vault that dies with the person is not a vault.*
3. **It breaks the delivery model on day one.** Expo Go cannot do Google OAuth (the same `exp://`
   redirect problem that already forced invitations away from deep links), there is no server to hold
   a refresh token, and unverified apps have refresh tokens **expire every 7 days**.

**The reframe worth remembering:** privacy is bought with *encryption*, not storage location — Google
reads Drive too, so B adds a party rather than removing one. Ownership is bought with *export*.
Only the cost win was real, and the free tier is escapable for $25/month.

## The three-mode privacy model was restructured

Modes 1 and 2 are a **consent flag**; Mode 3 is an **encryption tier**. They are different kinds of
thing and are no longer one three-way choice. `ai_processing` ships in PR-11 — retrofitting consent
in Phase 9 is the backfill bug class this project has already been bitten by.

## `docs/16` §9 — all settled

| Item | Decision |
|---|---|
| PR-15 "Sharing" | Within-family only → **PR-15's slot is vacated** *(reversed two days later — see the PR-12/13 entry below: author-only documents mean nothing is shared, so PR-15 designs sharing)* |
| Members per document | Multiple, via `document_members` — **explicitly not permission-bearing** |
| Archive vs soft delete | Separate columns: `archived_at` and `deleted_at` |
| Bucket / MIME / size | Private `family-files`; images + PDF; **10MB**; created **by migration**, not `config.toml` |
| PDF strategy | WebView. **Demo stays on Expo Go**; the dev build moves to Phase 10 *(the WebView half was wrong — Android cannot render PDFs. Corrected in PR-14b)* |
| Thumbnails *(dropped from the checklist)* | Deferred — `document_files.kind` reserves the slot |
| Filename sanitisation *(dropped from the checklist)* | Dissolved: the path segment is a uuid, never user input |

**`docs/15` §9.1 is amended** for the uuid filename (segment 1 unchanged, so `has_family_access` is
untouched), and **§9.6 is new**: OCR text and embeddings carry their source row's policy, and
withdrawn consent must *delete* derived artefacts, not merely ignore them.

## Local Supabase is now the standard development environment

A **`LocalStorageProvider`** for dev/testing was proposed and **declined** (`docs/17` §12) — it
cannot exercise `storage.objects` RLS, which *is* the Phase 3 security model; a self-authored second
implementation validates nothing; and device-local storage is single-device, which kills the
multi-account demo.

What replaced it: `npx supabase start` — the **real** Storage and RLS, locally, free.

- `supabase/config.toml`: `[analytics]` and `[edge_runtime]` disabled (RAM; no Edge Functions exist).
- `jest.setup.js` (new) + `setupFiles` in package.json — loads `.env.local` ahead of `.env`.
  **Without it the app would run local while the 151 RLS tests silently wrote to hosted.**
- `.env.local` selects local; renaming it returns to hosted. **The hosted project stays one rename
  away** if the stack misbehaves mid-stream.
- **Use the LAN IP, not `127.0.0.1`** — the phone cannot reach loopback. It is DHCP-assigned and
  will change.

## Open items

- **Export placement** — Phase 3, PR-15's vacated slot, or Phase 10. Deliberately deferred. *(Settled later: Phase 10, once PR-15's slot was reclaimed for sharing.)*
- **Shared vs per-domain file tables** — `document_files` ships now; **Phase 4 must decide before
  `memory_files` exists.** At two tables it is a rename, at six a rewrite.
- **Phase 9 vs Phase 11** — one ships bytes to an OCR vendor, the other commits to E2EE the server
  cannot read. Nobody has written down where the line falls. Predates this review.
- Key management for the encrypted tier; metadata scope per AI mode; consent when the uploader is
  not the subject; the features Mode 3 silently disables.

## Deliberate gaps

No application code, no migrations, no `src/` changes. Wiring the RLS suite into CI became *possible*
once the stack is reproducible — `ci.yml` still never runs those 151 tests — but it was recorded
rather than bundled.

---

## Environment status at end of session

| Thing | State |
|---|---|
| **Docker Engine** | **Installed and verified** — 29.7.2, Compose v5.4.0, daemon `active`, `ankit` is in the `docker` group (gid 970) |
| **Docker without sudo** | **Works only in a new login session.** The group was added after this shell started, so `docker info` still fails here. A fresh terminal tomorrow fixes it — no reinstall, no further sudo |
| **Supabase CLI** | 2.111.0, linked to the hosted project |
| **Local stack** | **Up and verified.** 9 containers; all ten migrations apply from scratch; ports publish on `0.0.0.0` |
| **`.env.local`** | **Written** — LAN IP + publishable key, gitignored. The `sb_secret_` key is deliberately absent |
| **Both suites vs local** | **312 + 151 pass.** Confirmed genuinely local: the throwaway accounts land in the local `auth.users`, and hosted gained none |
| **App on the phone** | **Works** over the LAN in Expo Go |
| **Hosted fallback** | **Proven** — renaming `.env.local` returns the app to hosted, and back |
| **`jest.setup.js`** | Done and verified: 312 tests pass, no dotenv noise |
| **`config.toml`** | `[analytics]` and `[edge_runtime]` disabled |
| Machine | Ubuntu 26.04, 8 cores, 14GB RAM (~6.5GB free), 130GB disk. Ports 54321–54324 free |

## Next session — start here

**The environment is done. Start PR-11 directly** — its full scope is fixed in `docs/16` §9.1 and
needs no further design.

Before going live, only:

1. `npx supabase start` (fast now — images are cached) and confirm the LAN IP still matches
   `.env.local`. It is DHCP-assigned; a router reboot changes it.
2. `npm test` as a smoke check.

**Of the three risks flagged before first run, two were non-issues** — the containers publish on
`0.0.0.0` and Expo Go accepts cleartext HTTP to a LAN address. **Only `ufw` needed a rule**, now
recorded in the README:

```
sudo ufw allow from 192.168.x.0/24 to any port 54321:54324 proto tcp
```

## Risks and assumptions — do not lose these

- **The phone cannot reach `127.0.0.1`.** Use the LAN IP (was `192.168.29.40`). It is DHCP-assigned
  and **will change**; when uploads suddenly fail, check this first.
- **`ufw` is active and blocks the stack by default.** The allow rule above is scoped to the LAN
  subnet, so it does not survive a change of network range. This was the only one of the three
  predicted first-run problems that turned out to be real.
- **RAM is the real constraint, not disk.** 14GB shared between the stack, Metro, a browser and OBS.
  `supabase stop` when not developing. If a stream gets tight, that is the first lever.
- **The hosted project is now production.** `db push` is a deploy, not a dev step.
- **`storage.buckets` must be created by a migration**, never by `config.toml` — the latter
  provisions local only, and the divergence surfaces as a failed upload *after* deploy.
- **`document_members` must never grant visibility.** If it did, any member could link themselves to
  a private document and read it. Write that into the migration's comments, not just the docs.
- **`supabase status` also prints an `sb_secret_` service-role key.** It is deliberately absent from
  `.env.local`, with a comment saying so. It bypasses RLS, and the risk is the habit, not this
  database.

---
---

# PR-11 Complete — Document Library (2026-08-08)

**The first record table. Phase 3 has begun.** 350 CI tests (+38), 173 RLS tests (+22), eleven
migrations. Demoed on a physical phone against the local stack.

## What shipped

A `documents` tab that files, lists, archives, restores and deletes — end to end, with nothing
reachable only by tests.

**Three tables, and the split is the decision worth remembering:**

| Table | Holds |
|---|---|
| `documents` | The record — the §8.2 spine plus `archived_at` and `ai_processing` |
| `document_files` | The bytes. **Empty until PR-14**; its *shape* is the expensive part |
| `document_members` | Additional subjects, for filtering — **explicitly not permission-bearing** |

A `storage_path text` column on `documents` was the obvious shorter design and was rejected: it
cannot express one document with several files (`docs/08` §15), and it bakes one provider's
addressing into the record. Splitting a column into a table after a thousand files exist is a data
migration plus a rewrite of every query; doing it while both tables are empty costs nothing.

## The lesson this PR actually taught: RLS filters, it does not error

Assumed twice, wrong twice, in one session:

1. **A Guest's read.** I expected `permission denied`. A Guest holds the `select` grant, so the read
   *succeeds* and returns zero rows — byte-identical to a family that owns nothing. The screen
   showed "Nothing filed yet", which is a false claim about somebody else's data. **No screen can
   distinguish empty from forbidden by looking at the result**; it must ask `canReadRecords(role)`.
   That is what `src/components/LockedNotice.tsx` exists for.
2. **A delete that matches no visible row.** It reports success having changed nothing, so "no error"
   proves nothing. Every RLS write test asserts twice — what the attacker got back, *and* what the
   victim can still see.

**This reversed a PR-10 decision.** The dashboard deliberately let a Guest see "Nothing has happened
yet"; the old comment called it "the truth from where they are standing". It was not — the history
exists. Both screens now show a lock, and the reversal is recorded in the code rather than silently
applied.

## A test caught me being wrong

I asserted an Owner could delete a private document they cannot read. The DELETE policy gates on
`can_see_record` *first*, so they cannot. The policy is right and stricter than I assumed; the
assertion changed, not the policy. The Owner's real escape hatch is deleting the family, which
cascades and is auditable in a way a silent single-row delete is not.

## Decisions worth not relitigating

- **`ai_processing` defaults to `'denied'`.** Consent never given is not consent, and Phase 9 must
  not read documents filed before anybody was asked. It ships now because retrofitting consent means
  backfilling a value on behalf of every existing row — the PR-7 defect exactly.
- **`archived_at` and `deleted_at` are different columns.** Archive is reversible, delete is not;
  one column would make them the same act.
- **The provider column carries a single-value check constraint.** It makes adding a second provider
  a deliberate migration rather than an accidental insert.
- **The policies name no role.** The SELECT policy is the frozen §8.2 expression. Guest exclusion
  falls out of PR-9a's resolver — the payoff for shipping it early.

## Deliberate gaps

- **`documents.deleted_at` exists and nothing sets it.** Soft delete needs a restore screen to mean
  anything. Delete is currently hard, offered on archived documents only, behind a confirmation.
- **`document_files` has no INSERT policy or grant** — PR-14 adds both with the upload flow that
  allocates the path. A client that could describe bytes before they exist would leave the catalog
  claiming files nobody can fetch.
- **No categories** (PR-12), **no viewer** (PR-13), **no upload** (PR-14).
- **No bucket, no `storage.objects` policies, no path-constructing function.** Deferred to PR-14 for
  the same reason: they have no caller until upload exists.
- The document form files a title only — no subject picker, no visibility toggle. Both columns work
  and are tested; neither has a control yet.

## Next

**PR-12 Categories.** `docs/16` §4: decide a column with a check constraint versus a table — a fixed
list of six argues for the column.

Still open from `docs/17` §13, unchanged: export placement, the shared-vs-per-domain file table
question (**Phase 4 must settle it before `memory_files` exists**), and the Phase 9 / Phase 11
encryption contradiction.

**The landing page is now two PRs stale** (it says 18 merged; 21 after this). `CLAUDE.md` schedules
that for the end of a phase, so it is correct to leave — but it is the first thing to fix when
Phase 3 closes.

---
---

# PR-12 + PR-13 — Categories, the detail screen, and a privilege escalation (2026-08-09)

**382 CI tests, 191 RLS tests, thirteen migrations.** PR-12 merged as #22. PR-13 is this branch.

## PR-12 — categories

Six shelves as a **check-constrained column, not a table**, and the deciding argument was already in
the repo: `docs/08` §16 defines a Tagging Model as the free-form user-chosen axis, so category could
be the fixed one. A table would have needed six seed rows per family — the PR-7 backfill shape — and
would have built the tag system twice.

**Mandatory, not nullable.** An uncategorised bucket is the junk drawer the product exists to
replace. That required deleting existing rows, which was safe exactly once and the migration records
why rather than leaving a reader to wonder.

**"Archived" is not the seventh value** even though IA §4 lists it beside the six. It is a timestamp,
and a document can be Medical *and* archived.

## PR-13 — sequenced backwards, then reshaped

**"Viewer — open a document" was scheduled before "Upload", so there was nothing to open.** Caught
before starting. FR-014's six actions split cleanly — Preview and Download need bytes, Rename, Move,
Archive and Delete need only the record — so PR-13 opens the *record*, and Preview/Download join
PR-14.

## The hole, and what it changed

Demoing the subject picker exposed a privilege escalation **in PR-11 code I wrote**. The UPDATE
policy was `can_see_record(...) and can_write_records(...)` — **seeing implied editing**. Since
`can_see_record` grants a private record to its author *or its subject* (§8.3), naming somebody in
"About" handed them write access to a document they had not filed, including the ability to set
`visibility` back to `'family'` and **publish it to the whole household**.

**Found on a device, not by the 35 RLS tests** — several of which were cheerfully asserting the
buggy behaviour was correct. That is the part worth remembering: a test suite written against a
wrong model defends the wrong model.

Migration `20260810090000` corrects the model rather than patching the policy:

| | |
|---|---|
| Read / write / delete | **The author. Nobody else** — not the family Owner, not the subject |
| `member_id` | A **pure label**, "Belongs to". No permission effect at all |
| `visibility` | Defaults `private`; **no UI can set `family`** |
| `created_by` | Immutable, and already was — `pin_created_by` since PR-11 |
| Sharing | **PR-15**, which is un-vacated and now has a real job |

**The mechanism is one argument, not a rewrite:** every documents policy passes **`null`** where the
resolver expects a subject, so §8.3's subject branch cannot match. `can_see_record` itself is
untouched, and Phase 4–6 tables still get the subject branch if they want it.

## The lesson, generalised

*"Who is this record about"* and *"who may read this record"* are different questions. **A column
answering both is a privilege escalation waiting to be noticed.** Phases 4, 5 and 6 all reuse this
table's shape, so this is the third time a Phase-3 shortcut would have been taken three times.

## Deliberate gaps

- `setDocumentVisibility` was **deleted**, not left unreachable — PR-15 re-adds it with a design.
- Cards show "Filed by You" for everything until sharing exists. Built now so the card does not
  change shape later.
- The filing form still has no "Belongs to" picker; a document starts unassigned.
- `documents.deleted_at` still unset by anything; delete is hard, archived-only, confirmed.
- `document_files` still has no INSERT policy — PR-14.

## Next

**PR-14 Upload.** Bucket, `storage.objects` policies, the path-constructing function, picker,
progress (NFR-007), storage RLS tests. Likely needs splitting — it is the heaviest PR of the phase.

---
---

# PR-14a Complete — Upload, bytes in (2026-08-11)

**416 CI tests, 212 RLS tests, fourteen migrations.** The first bytes this project stores.

## Split

**14a is bytes in** — bucket, storage policies, path allocator, picker, upload with a real
percentage. **14b is bytes out** — preview and download, FR-014's last two actions, landing in a
detail screen that already exists.

## The frozen storage predicate was unsafe, and this is where it was corrected

`docs/15` §9.1 specified `has_family_access((storage.foldername(name))[1]::uuid)` — tenant-level and
**role-blind**, written when documents were family-visible. After PR-13 made every document
author-only, it would have let any family member fetch the bytes of a row they cannot read. §9.1's
own sentence is the indictment: *"an invisible row does not make its file unreachable."*

**The policies now also check the author on segment 2**, via `owns_document_object(name)` — a
`SECURITY DEFINER` helper, because joins inside policy bodies are where storage RLS goes slow. §9.1
pinned segment 1 as unchanged; it never forbade adding conjuncts.

Five RLS tests exist purely for this: a second member of the *same family* refused an upload, a
download, a listing, a removal, and a file row. Every one would have passed under the frozen
predicate.

## Two things the platform taught, both found by tests rather than reasoning

**1. `storage.objects` defends itself, and the first backstop trigger broke family deletion.**
Supabase ships `protect_objects_delete`, raising *"Direct deletion from storage tables is not
allowed"* unless `storage.allow_delete_query` is set. Deleting a family cascaded to documents, fired
the trigger, hit the guard, and rolled the whole delete back — **families quietly became
undeletable**, the same shape as PR-7, PR-9a and PR-10, arriving from a direction none of them came
from. The setting is the platform's own escape hatch and is now set transaction-locally.

**2. `unique (document_id, kind, version)` blocked multiple attachments.** A passport is one document
with two pages; that constraint forced the second page to claim it *superseded* the first. `version`
still means revision and stays at 1; uniqueness moved to the object.

## Decisions taken

| | |
|---|---|
| **Progress** | Real percentage via `XMLHttpRequest`. supabase-js exposes none on React Native, and a bar on a timer would be a lie NFR-007 does not ask for |
| **Files per document** | Several |
| **Orphans** | Client deletes first; trigger backstops the cascade no screen sees |
| **`base64-arraybuffer`** | **Not needed.** SDK 54's `new File(uri).bytes()` returns a `Uint8Array` — Supabase's own RN guide predates that API |

## The two-phase write, and why the order is that way

Allocate → upload → attach. The row is written **after** the object exists, and
`attach_document_file` *verifies* it rather than trusting it — possible only because
`storage.objects` is an ordinary table. PR-11 wanted exactly this when it withheld an INSERT policy.

`document_files` therefore still has **no INSERT policy and no INSERT grant**; the RPC is the only
writer, and the PR-11 test asserting it is unwritable stays green.

A failed attach orphans an object: quota spent, nothing readable. Chosen over the reverse, where a
row would describe bytes that are not there — a catalogue that lies is worse than one that wastes.

## Deliberate gaps

- **Preview and download** — 14b. *(It turned out not to need `react-native-webview` at all.)*
- **Orphaned bytes.** The trigger removes rows, not bytes; Phase 12 sweeps by diffing a bucket
  listing against `document_files.provider_file_id`, which stays computable however many rows go.
  Privacy is unaffected — `owns_document_object` resolves through a `documents` row that is gone.
- **Thumbnails** deferred; `kind` reserves the slot.
- **Replacing a file** — `version` increments in principle, no interface reaches it.
- `mime_type` has no check constraint on `document_files`; the allow-list lives on the bucket and in
  `validateFile`. A third copy was not worth it.

## Two more bugs, both found on the device after the suite was green

**1. The remove button removed half a file.** It deleted the storage object and left the
`document_files` row, so the file reappeared on the next read. `document_files` also had no DELETE
policy and no grant — INSERT was withheld deliberately (a row must not describe bytes that are not
there) and that reasoning has no delete equivalent, so its absence was simply an omission.

**21 storage RLS tests passed while this was broken.** Every one asserted the *object* was gone;
not one re-listed the rows. The same shape as PR-13's escalation — **the tests encoded the
assumption rather than the requirement.** Three regression tests now cover it, including a
before-and-after row count.

**2. Android dialogs take at most three buttons.** The source chooser passed four — camera, library,
files, cancel — so Cancel was silently dropped and hardware-back was the only way out. Replaced with
an inline chooser, which is more discoverable anyway: the three sources are visible before
committing to any of them.

## A recurring operational note

**The LAN IP changed mid-session** (`192.168.29.40` → `10.206.245.211`) and every RLS test failed
with `fetch failed`. Exactly what the environment checkpoint warned about. When tests or the phone
suddenly cannot reach the stack, check `ip -4 addr` against `.env.local` **first**.

## Next

**PR-14b** — preview and download. Then PR-15, sharing.

---
---

# PR-14b Complete — Preview and download (2026-08-12)

**437 CI tests, 218 RLS tests, fourteen migrations.** No migration in this PR — the policies 14a
shipped already govern everything it does.

## It corrected a documented decision before honouring it

`docs/16` §5 settled on *"images plus PDF in a WebView"* to avoid a dev build. **Android's WebView
cannot render a PDF.** iOS can; the demo device cannot. That decision was made without the platform
fact, and following it would have shipped a blank box on stream.

**The usual workaround is rejected on privacy grounds, not weighed against them.** Google's document
viewer renders any PDF it can fetch, which means handing a family's private papers to Google — the
same reasoning `docs/17` used to decline Google Drive.

**PDFs open in the device's own reader** via the share sheet. Private, Expo Go, no dev build, and it
uses software the user already trusts. **`react-native-webview` was never installed** — it was the
only package §8 still listed as pending, now removed rather than deferred.

## `docs/17` §10.1's outstanding requirement is finally built

Every PR since the storage review deferred this: *"never store a URL — store the identifier and mint
on demand"*, and *"signed-URL expiry must not reach the components."*

`fileUrl(gateway, file)` takes the **row**, not a path, so no caller can hand it something they
built — path construction is the database's job. The TTL is 300s and lives in one constant. Expiry
is contained in a single `onError` handler that re-mints **once**, not a loop.

Authorisation is inherited, not re-implemented: `createSignedUrl` goes through the storage SELECT
policy, so an RLS test now proves **another member of the same family cannot mint a URL** for a file
they cannot read. A signed URL that bypassed the policy would be a way *around* it rather than an
expression of it.

## UI decisions, and the consistency argument behind each

| | |
|---|---|
| **Pushed route** | `documents/[documentId]/[fileId]`, matching the Family tab's `[memberId]` shape. Tab bar stays — opening a file never feels like leaving the section |
| **Not a dark lightbox** | `theme.ts` is light-only by decision; a dark viewer would be the first screen to break it |
| **Rows became links** | The attachment row lost its `x` and gained a chevron, exactly like a library card. PR-13's reasoning one level down: *"piling icons onto a list row is what makes an app feel like a file manager"* |
| **Remove moved to the viewer** | Beside Share, where "Delete permanently" sits on the document screen. One more tap, one less crowded row |
| **No download progress** | `downloadFileAsync` exposes no progress callback, and `ProgressBar`'s own comment forbids the alternative — *"a bar animated on a timer would look identical and mean nothing."* A spinner is the honest control. The upload earned its percentage because NFR-007 asks; nothing asks here |

## Deliberate gaps

- **In-app PDF rendering** — needs bundled `pdf.js` (~1MB, its own PR) or Phase 10's dev build. What
  is ruled out *permanently* is sending the file to a third party to render.
- **Zoom and pan** on images.
- **Thumbnails** still deferred; `kind` reserves the slot.
- **Cached downloads** are overwritten rather than reused; staleness is not worth reasoning about at
  a 10MB cap.

## Next

**PR-15 — Sharing**, and Phase 3 is done. It is un-vacated (`docs/16` §4) and carries real weight:
every document is currently author-only, so PR-15 decides how one reaches anybody else. Read the
`docs/15` §8.4 amendment first — the last attempt at this shipped a privilege escalation.

---
---

# PR-15a Complete — Sharing (2026-08-13)

**447 CI tests, 240 RLS tests, fifteen migrations.** The first document that reaches somebody other
than the person who filed it.

## The whole model is one sentence

> **Reading widens. Writing never does.**

`visibility` gets a control — *Only me* / *Everyone in the family* — on the document detail screen.
That is the feature. What makes it safe is that the two halves of "access" were already separate
predicates, so widening one could not widen the other:

| | Predicate | Changed? |
|---|---|---|
| SELECT on `documents`, `document_files`, `document_members` | `can_see_record(family_id, visibility, **null**, created_by)` | **no** |
| UPDATE / DELETE on `documents` | `created_by = auth.uid() and can_write_records(family_id)` | **no** |
| SELECT on `storage.objects` | was author-pinned → now `can_read_document_object(name)` | **yes, only this** |
| INSERT / DELETE on `storage.objects` | `owns_document_object(name)` | **no** |

**`can_see_record` was not touched**, so `permissions.rls.test.ts`'s 58 assertions and `docs/15` §11's
fixture stayed green throughout. That is the §8.1 bet — freeze *the columns and the one function*,
not the vocabulary — paying out in full: the 'family' branch had been sitting there since PR-9a
waiting for something to set the column.

## The one thing that was actually broken

`owns_document_object` pins `created_by = auth.uid()` and **served all three storage policies**. Share
a document and the recipient reads the row, sees the attachment listed, taps it, gets nothing — a
*visible* row whose file is unreachable. `docs/15` §9.1's warning (*"an invisible row does not make
its file unreachable"*) read backwards.

The one-line fix — widen that function — is wrong, because widening it lets a reader upload into and
delete from somebody else's document. **Reading and writing stopped having the same answer, so one
function could no longer express both.** `20260813090000` adds `can_read_document_object` for SELECT
and leaves the other two alone. The naming is the durable part: `owns_` vs `can_read_` means the next
phase cannot reach for the wrong one by accident.

## Four tests were defending an assumption, and it was caught in advance this time

The storage suite asserted *"another member of the same family cannot reach these bytes."* The
requirement was *"only somebody who can read the row can reach its bytes."* **Those two sentences
agreed exactly while every document was author-only** — and a suite cannot tell which one it is
defending while they agree.

Renamed to say `private` out loud (reading, listing, minting a URL, seeing the file rows), each with a
shared-document counterpart. Three others were left alone because they were always about *writing*,
which did not widen: uploading, removing an object, detaching a row.

**The two groups are a mutual negative control.** An author-only predicate fails the new tests; a
role-blind one (`has_family_access`) fails the private ones. Both groups passing is the proof, which
is why no schema was temporarily broken to check.

Same shape as PR-14a's own lesson ("21 storage RLS tests passed while this was broken") and PR-13's
before it. **The instruction that generalises: name the condition a test depends on, in the test's
name.**

## Ten call sites, none of which would have failed anything

`canEdit = canWriteRecords(role)` appeared **10 times** across the documents screens. Every one became
wrong the moment a member could open a document they had not filed — role says you may write records
in general, not *this* one. It typechecks. 655 tests passed.

This is PR-9b's lesson arriving for the second time: *when a PR makes a previously impossible state
reachable, every boolean that assumed two states is now wrong, and neither the compiler nor the suite
will say so.* Found by grepping for the old assumption, which is the only thing that finds it.

Now `document.createdBy === session?.user.id && canWriteRecords(role)` — the same two parts, in the
same order, as the UPDATE policy. `can_write_records` stays in the conjunction because it is what
excludes a Guest and what takes the controls away from an author whose role was later reduced.

**The dividend:** PR-13 had already written a read-only branch for every `Field` on the detail screen,
so a non-author gets a working read-only document almost for free. The file viewer needed one extra
fetch — it only had the `DocumentFile` and had to load the document to know its author. Hiding that
Remove button is not cosmetic: under RLS a delete matching no visible row *reports success*, so a
reader would have seen it work and the file would still be there.

## Found on the device, and it was the same bug wearing different clothes

All eighteen manual checks passed, and the demo still turned up a defect: **a reader saw the AI
consent field as a disabled checkbox.**

Every other field on the detail screen falls back to a statement for a non-author. This one rendered
`<Toggle disabled={!canEdit}>` — and that `disabled` prop was **unreachable code written when only
the author could open the screen.** Sharing made it reachable, and a disabled control is the worst of
the three options: it asks a question, displays an answer, and refuses the interaction it just
invited. A reader cannot tell it apart from one that is broken or still loading.

So it is the *eleventh* instance of the `canWriteRecords(role)` bug, not a separate one — a branch that
was dead while every reader was also the author. The ten I found by grepping were the ones that
changed a *permission*; this one changed a *presentation*, which is why grep did not surface it and a
person looking at a screen did.

**The rule, and it is worth carrying into Phases 4–6 because they reuse these screens' shape:**

> A setting has two audiences once records can be shared. The person who may change it gets a
> **control**. Everybody else gets **the decision**, as a sentence. Never a disabled control.

Fixed by giving the field the read-only branch the other four already had, with the wording moved into
`AI_PROCESSING_LABELS` beside `VISIBILITY_LABELS` so the library card and the detail screen cannot
describe the same privacy flag differently. `Toggle`'s `disabled` prop was **deleted** rather than left
unused — an unreachable branch is where the next defect hides, and that one is a standing invitation to
re-introduce exactly this.

The labels say **"AI may not read this"**, never "cannot". The server can read the bytes; this is a
promise kept by code, and the only thing that would make it a guarantee is Phase 11's encryption. A
test asserts the word "cannot" never appears in either label.

## A second thing the demo found, in PR-9b's code rather than this PR's

Deleting a family logged **"POP_TO_TOP was not handled by any navigator"** on every success. The
cascade itself was perfect — after the delete, `families`, `documents`, `document_files`,
`document_members` and `storage.objects` were all at zero rows with no orphans, so
`documents_remove_objects` fired correctly through the cascade. Purely a navigation defect, and it has
been there since PR-9b.

`app/(app)/(tabs)/family/delete.tsx` did `await refresh()` and *then* `router.dismissAll()`. `refresh()`
sets `family` to `null`, the Family tab re-renders into join-or-create, and this modal's stack goes
with it — so the dismissal is dispatched at a navigator that no longer exists. **Fixed by swapping the
two lines**: dismiss while the navigator is mounted, then let the provider catch up. The delete has
already succeeded by that point and the tab re-reads on focus anyway.

**Then grepped the other four `await refresh()` sites rather than assuming**, since the class is
"navigating after the provider drops the thing the screen depended on":

| Site | Verdict |
|---|---|
| `family/[memberId]/index.tsx` transfer ownership | Safe — role changes, `family` survives, stack stays mounted |
| `family/[memberId]/role.tsx` | Safe, same reason |
| `more.tsx` leave family | Safe — nulls `family` but never navigates; it is a tab root |
| `family/index.tsx` join / create | Safe — no navigation |

So `delete.tsx` was genuinely the only one. **This is unrelated to sharing and belongs in its own
commit** — it is PR-9b's bug, found by PR-15a's test script.

## Three decisions that were deliberately not taken

- **`member_id` did not go back into the resolver.** `20260810090000`'s own header speculated that
  "PR-15 restores it here by passing `member_id` again". It should not: read-granting through a
  labelling field is the same *about* / *may-read* conflation, just with a smaller blast radius now
  that writes are separately gated. The subject position is still `null`.
- **No third visibility value and no shares table.** Per-record ACLs stay in Phase 10 (`docs/15` §10),
  re-argued rather than inherited: no story has failed the two-value model, and §8.1 keeps it a
  one-function edit. The picker renders `DOCUMENT_VISIBILITIES`, so a third option needs no UI work.
- **`private` stayed the default**, which promotes it from PR-13 stopgap to product decision — and
  therefore into `docs/15` §8.5 as a documents-specific divergence from the frozen `family` default.
  Documents are the most sensitive table this product has, and `docs/07` §76 already said *"assume
  data is private unless explicitly shared."*

## Two small things worth keeping

**`DOCUMENT_VISIBILITIES` is ordered `['private', 'family']`, and the order is load-bearing** —
`VisibilityPicker` renders it, so the narrower option is the first chip read. Broadening access should
not be the thing the eye lands on. Started as a weak test about defaults; became a design decision.

**The "Private" badge PR-11 deleted is back as "Shared", for the opposite reason.** It was dropped
because every document was private and a badge that is always on says nothing. Both states exist now,
and the one worth marking is the exception — it is how an author sees at a glance which of their
documents they have published.

## Deliberate gaps

- **Specific-person sharing** — Phase 10.
- **Cross-family sharing** — still undesigned; only the within-family half was ever un-vacated.
- **Documents are not in the activity feed.** `family_activity.action`'s check constraint has no
  document actions, so there is no §9.5 leak to fix and adding one is its own PR. Note that sharing is
  the point at which a feed *would* start needing visibility inheritance.
- **`documents.deleted_at`** still set by nothing; delete stays hard, archived-only, confirmed.
- **The filing form is still title + category only** — that is PR-15b's whole job.

## Docs reconciled, and one drift found

`docs/15` → v1.3 (§8.4 amendment, §8.5 divergence, §9.1 **third** amendment, §10 reconciled, §12 gains
three flagged inconsistencies). `docs/16` → v1.3. `docs/12` and `docs/14` record what shipped.

**Found while doing it:** `docs/16` §3.1 still described the storage predicate as
`has_family_access` and still carried *"anything that mints a signed URL must read the row first"* —
superseded by PR-14a on 08-11. That file's own amendment log had the 08-11 entry; the section it
pointed at was never updated. Fixed, and recorded as late rather than quietly.

**Flagged, not silently fixed:** FR-014 lists no Share action (the trace is UR-014 / US-007); US-007's
actor is "Family Owner" when only the author can share; `docs/15` §9.6 says derived text inherits the
*subject's* visibility, which is stale for documents.

## Next

**PR-15b — one document, one form.** Title, category, Belongs to, *Who can see it*, AI consent and
attachments configured at filing time; the same settings editable on the detail screen. `VisibilityPicker`
is already controlled, so it drops into the form unchanged. The honest limit to keep: **filing cannot be
one transaction** — the storage path embeds the document id, so the row must exist before any byte
uploads. One user-facing operation over a sequence, and **no rollback**: a failed attachment leaves the
document and the metadata, which is the more valuable half.

Then **PR-16 — the landing page**, and Phase 3 closes. It is stale by seven PRs (says 18 merged and
463 tests; actual 25 and 687) and lists no Documents capability at all.
