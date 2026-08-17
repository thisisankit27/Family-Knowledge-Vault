# Family Knowledge Vault — Project Context

A digital home that preserves everything a family knows, owns, celebrates, and wants to pass on. Full vision: `docs/01-vision.md`. Full planning corpus: `docs/01` through `docs/18`.

**Read `docs/14-pr-execution-plan.md` first** — it's the authoritative day-to-day execution guide. Then the four documents written *during* building, which override the earlier corpus wherever they disagree with it (check the date):

- **`docs/15-permission-matrix.md`** — roles, the record spine, and `can_see_record`. Authoritative on permissions and visibility for every phase. It ships as a test fixture, so it cannot silently rot.
- **`docs/16-phase-3-brief.md`** — what Phase 3 decided and what it cost. Scope-closed.
- **`docs/17-storage-architecture-review.md`** — authoritative on storage. Declines bring-your-own-storage for Phase 3.
- **`docs/18-phase-4-brief.md`** — Phase 4 (Memories), and the four decisions settled before PR-17. **Its §13 records an open architectural question — does authored content belong to the user or to the family? — that must be decided at the end of Phase 4, before Phase 5 copies the current answer. §13.6 lists what PR-18/19/20 must not cement. Read it before writing any migration in Phase 4 or 5.**

`docs/09-api-design.md` is **superseded** — it describes a REST API for a system with no server. Everything else in `docs/01`–`docs/13` is the reasoning behind the plan, and predates implementation.

**Read this file, then `.claude/current-session.md`, before doing anything else in any session.**

---

## Project Nature

This is a **solo-founder, build-in-public project streamed live on YouTube**. One Pull Request per stream, each stream capped at ~2 hours. That constraint shapes everything below — it is not incidental.

- Design like a startup expecting growth (clean modular architecture, clear domain boundaries), but **implement like a solo founder**: no microservices, no Kubernetes, no event buses in early phases.
- "Millions of households" and similar scale language in the docs is a long-term north star, not a near-term literal target.

## Stack (locked in)

- **Mobile app**: React Native via **Expo** (TypeScript). One codebase, iOS + Android. No web app for now (may add `react-native-web` later without a rewrite if ever needed).
- **Backend**: **Supabase** (Postgres + Auth + Storage + Row-Level Security). RLS policies implement the "family is the tenant boundary" model — see `docs/08-database-design.md`.
- **Hard constraint: stay on Supabase's free tier to start.** See `docs/14-pr-execution-plan.md` §4 for the specific limits and how later phases work around them (local Expo notifications instead of server cron; paid external AI/OCR APIs are a separate, later concern from Phase 9 onward).
- **Development runs against a local Supabase stack in Docker** (`npx supabase start`), not the hosted project — real Postgres, Auth, Storage and RLS, consuming no free-tier quota. `.env.local` selects it; renaming that file returns to hosted — both directions verified 2026-08-07. Setup, the `ufw` rule and the LAN-IP caveat are in the README. **Storage is app-owned (Supabase Storage); bring-your-own-storage was reviewed and declined for Phase 3** — see `docs/17-storage-architecture-review.md`.
- **Marketing site**: a small separate static one-pager, not part of the app codebase.

## Working Cadence

- One PR per day, ~2 hours per stream.
- **Vertical slices only** — every PR ships a working, demoable end-to-end feature (UI + data + logic together). Never build backend-only or frontend-only for multiple days in a row.
- If a PR's scope can't be built, tested, and demoed in ~2 hours, split it before starting rather than cutting corners mid-stream.
- Full PR-by-PR breakdown and time estimates: `docs/14-pr-execution-plan.md`.

## End of Every Phase: Update the Landing Page

`landing/index.html` carries a **Progress** section, and it is updated as the last act of every
phase — not when someone remembers. It is the public record of whether this project is real, so
its whole value rests on being accurate.

Four edits, all in the `#progress` section unless noted:

1. **Stats row** — pull requests merged (`gh pr list --state merged` count), total automated
   tests (`npm test` plus the RLS suite), phases planned.
2. **"What works today"** — only things a stranger could actually do in the app.
3. **"What does not work yet"** — the honest list. Source it from the *Open items* and
   *Deliberate gaps* sections of `.claude/current-session.md`; those are written every PR, so
   this costs nothing to keep current.
4. **Phase list** — move the finished phase to `class="phase shipped"` and the next one to
   `class="phase building"`. Also update the `.status` line in the *Follow along* section.

**Rules for this section, in priority order:**

- **Every number must match what a reader finds when they check.** The stats sit directly above
  a link to the merged pull requests; if the count disagrees with that list, the page has done
  the opposite of its job.
- **Never claim a capability that has no interface.** "The database supports it" is not
  shipped — this project has twice built something reachable only by tests.
- **The gaps list is not optional and does not get quietly shortened.** It is the strongest
  trust signal on the page; anyone can publish wins.
- Verify rendering at 1280px and 390px, in both colour schemes, before committing.

Screenshots of real screens are the intended next addition — deferred from Phase 1, not dropped.

## Testing Responsibility

- **Backend** (services, DB functions, RLS policies, business logic): Claude writes and owns automated tests every PR — non-negotiable.
- **UI**: shared responsibility — manual verification live on-stream (doubles as the demo) plus lightweight component tests where cheap. Full e2e suites are deferred until core flows stabilize.

## Git Workflow

Full detail lives in Claude's persistent memory (git-workflow / session-resumability entries), summarized here so it's also visible in-repo:

- Treat Git history as project documentation, not just version control.
- Conventional Commits. Self-check before every commit: complete? reviewable? documented? understandable in six months?
- Never bundle unrelated work into one commit. Never commit incomplete work — document what remains instead.
- Never rewrite history (rebase/amend/force-push) unless explicitly asked.
- **Always ask before creating a commit** — never commit automatically.
- Planning doc updates, architectural decisions, and review checkpoints are valid commit boundaries, not just code.
- If a commit completes one roadmap PR, prepare a full PR description (Objective, User Stories, Requirements satisfied, Implementation summary, Testing performed, Documentation updated, Remaining follow-up).
- **PR creation: Claude raises the PR via `gh pr create`; the user merges.** After pushing a day's branch, open the pull request yourself with the full description (Objective, Requirements satisfied, Implementation, Testing performed, Documentation updated, Remaining follow-up), then hand the user the URL. **Never merge** — merging into `master` is the user's call, always. (This reverses the earlier web-UI-only rule, changed on 2026-07-31 after PR #6.)

## Resumability

Work happens across many separate, context-limited Claude sessions. Continuity comes from two places, not from conversation memory:

1. **This file (`CLAUDE.md`)** — stable conventions and decisions (rarely changes).
2. **`.claude/current-session.md`** — the living checkpoint: what's done, what's in progress, what's next. Update it before ending any significant piece of work. If work is intentionally incomplete, document what remains there instead of committing a partial state.

When the user says "start PR N": read both files above, confirm PR N's scope against `docs/14-pr-execution-plan.md`, implement the vertical slice, test per the split above, demo on-stream, update the checkpoint, then propose (don't assume) a commit.
