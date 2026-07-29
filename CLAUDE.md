# Family Knowledge Vault — Project Context

A digital home that preserves everything a family knows, owns, celebrates, and wants to pass on. Full vision: `docs/01-vision.md`. Full planning corpus: `docs/01` through `docs/14` (read `docs/14-pr-execution-plan.md` first — it's the authoritative day-to-day execution guide; the rest is the reasoning behind it).

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
- **Marketing site**: a small separate static one-pager, not part of the app codebase.

## Working Cadence

- One PR per day, ~2 hours per stream.
- **Vertical slices only** — every PR ships a working, demoable end-to-end feature (UI + data + logic together). Never build backend-only or frontend-only for multiple days in a row.
- If a PR's scope can't be built, tested, and demoed in ~2 hours, split it before starting rather than cutting corners mid-stream.
- Full PR-by-PR breakdown and time estimates: `docs/14-pr-execution-plan.md`.

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
- **PR creation: GitHub web UI, not `gh` CLI.** After pushing a day's branch, provide the ready-to-paste PR title/description and let the user open the PR on github.com themselves (same as PR #1). Don't attempt `gh pr create`.

## Resumability

Work happens across many separate, context-limited Claude sessions. Continuity comes from two places, not from conversation memory:

1. **This file (`CLAUDE.md`)** — stable conventions and decisions (rarely changes).
2. **`.claude/current-session.md`** — the living checkpoint: what's done, what's in progress, what's next. Update it before ending any significant piece of work. If work is intentionally incomplete, document what remains there instead of committing a partial state.

When the user says "start PR N": read both files above, confirm PR N's scope against `docs/14-pr-execution-plan.md`, implement the vertical slice, test per the split above, demo on-stream, update the checkpoint, then propose (don't assume) a commit.
