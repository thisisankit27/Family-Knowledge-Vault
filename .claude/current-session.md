# Family Knowledge Vault — Planning Session State

**Last updated:** 2026-07-28 (Checkpoint 2)

**Status:** Planning complete for Phase 1. Stack locked in. No application code written yet — next real action is implementing PR-1 whenever the user says "start PR 1."

---

## How to use this file

Read `CLAUDE.md` first, then this file, before re-reading `docs/*` or re-deriving anything. This file is the continuation point — don't re-derive the reasoning below from scratch. Checkpoint 1 (below) is the critical-review history; Checkpoint 2 (further below) is the current state and next action.

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

Per the git workflow, the two new docs from this session (`docs/14-pr-execution-plan.md`, `CLAUDE.md`) have **not** been committed yet — propose a commit before ending this session if none has happened since they were written.
