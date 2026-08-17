# 🚀 Pull Request (PR) Roadmap

**Project:** Family Knowledge Vault

**Version:** 1.0

**Status:** Draft

---

# 1. Purpose

This document defines the implementation roadmap for Family Knowledge Vault.

Development is organized into small, sequential Pull Requests (PRs), where each PR delivers a complete, demonstrable improvement to the product.

Each PR is intended to be completed in approximately one development stream.

The roadmap prioritizes visible user value over technical milestones.

---

# 2. Development Principles

Every PR should:

- Deliver visible progress.
- Complete one logical capability.
- Keep the application deployable.
- Improve the product for real users.
- Be independently reviewable.
- Build naturally upon previous PRs.

---

# Phase 1 — Welcome Home

Goal:

Create a beautiful foundation that introduces users to their digital home.

---

## PR-001

Repository Initialization

Deliverables

- Repository Structure
- Documentation
- Development Environment
- CI/CD
- Branding Assets

Visible Progress

Professional project foundation.

---

## PR-002

Landing Page

Deliverables

- Homepage
- Hero Section
- Features
- Vision
- Responsive Layout

Visible Progress

Users understand the product.

---

## PR-003

Authentication

Deliverables

- Sign Up
- Login
- Password Reset

Visible Progress

Users can create accounts.

---

## PR-004

Application Shell

Deliverables

- Sidebar
- Header
- Navigation
- Theme
- Dashboard Layout

Visible Progress

Real application experience.

---

## PR-005

Create Family

Deliverables

- Family Creation
- Family Profile
- Family Dashboard

Visible Progress

Users own their digital home.

---

## PR-006

Invite Members

Deliverables

- Invitations
- Join Flow
- Member List

Visible Progress

Families can collaborate.

---

# Phase 2 — Meet the Family

Goal:

Bring people into the platform.

---

## PR-007

Family Profiles

---

## PR-008

Family Tree

---

## PR-009

Roles & Permissions

---

## PR-010

Family Activity Feed

Visible Progress

The platform feels alive.

---

# Phase 3 — Preserve What Matters

Goal:

Start preserving knowledge.

---

## PR-011

Document Library

---

## PR-012

Document Categories

---

## PR-013

Document Viewer

---

## PR-014

Upload Experience

---

## PR-015

Document Sharing

> **Amended 2026-08-07 — this slot is vacated.** "Sharing" resolved to two different things:
> *within* a family is already served by `visibility`, and *between* families has no designed
> mechanism and is not a 2-hour PR. Per-record ACLs belong to Phase 10. See `docs/16` §6.1 and
> `docs/17`. Candidates for the slot: the document detail screen, or export.
>
> **Un-vacated 2026-08-09, and this is now the most consequential PR in the phase.** The amendment
> above was written when documents were family-visible by default, so within-family sharing was
> already handled. It is not any more: migration `20260810090000` made **every document readable only
> by its author**, after a privilege escalation was found on a device (`docs/15` §8.4). Nothing
> reaches anybody else today, so PR-15 is where "who can see this" gets designed rather than
> inherited.
>
> **Read `docs/15` §8.4's amendment before starting it.** The last attempt at sharing shipped an
> escalation by answering "who is this about" and "who may read this" with one column.
>
> **Shipped 2026-08-13, and split in two.**
>
> **PR-15a — Sharing.** `visibility` gets a control: *Only me* / *Everyone in the family*. The model
> is one sentence — **reading widens, writing never does** — and the escalation warned about above is
> structurally impossible as a result: read goes through `can_see_record`, write stays pinned to
> `created_by`, and the subject position is still `null`, so "Belongs to" grants nothing. No new
> table, no new visibility value, no policy edits outside `storage.objects`.
>
> **PR-15b — One document, one form.** The slot's remaining budget went to a defect the sharing work
> made obvious rather than to specific-person sharing: the settings a document has were spread across
> two screens that each decided independently what they were, and had already drifted. Filing a
> document now configures it — title, category, Belongs to, who can see it, AI consent and
> attachments — and the detail screen edits the same set.
>
> **Specific-person sharing stays Phase 10** (`docs/15` §10). No requirement has needed it yet, and
> §8.1 keeps it a one-function edit for whenever one does. Cross-family sharing remains undesigned.

Visible Progress

Families can safely preserve documents.

---

# Phase 4 — Family Memories

Goal:

Preserve life's important moments.

> **Annotated 2026-08-17 — the PR numbers below are off by one, and the scope changed.** Kept as
> written because this document is *"the historical record of the original vision-level sequencing"*
> (`docs/14` §1); renumbering it would destroy the evidence of the collision.
>
> **PR-016 shipped as the landing-page update** that closed Phase 3, not as the Memories Module. So
> Phase 4 is **PR-17 → PR-20**, and every number below is one higher than it reads.
>
> **Two of the five titles are also wrong**, settled in `docs/18-phase-4-brief.md` §3.2:
> *Stories* is not a PR — `docs/08` §4 says *"Story is not an entity; it is a field"*, so it ships as
> a `story` column in PR-17. *Memory Timeline* moves to **Phase 7**, where
> `src/navigation/domains.ts` already registers `timeline` as its own domain.
>
> **As built:** PR-17 Memories · PR-18 Memory Photos · PR-19 Voice Memories · PR-20 Albums.

---

## PR-016

Memories Module

---

## PR-017

Photo Albums

---

## PR-018

Stories

---

## PR-019

Voice Memories

---

## PR-020

Memory Timeline

Visible Progress

Families begin preserving their history.

---

# Phase 5 — Family Health

Goal:

Centralize medical information.

---

## PR-021

Medical Dashboard

---

## PR-022

Medical Reports

---

## PR-023

Doctors

---

## PR-024

Medicines

---

## PR-025

Vaccinations

Visible Progress

Medical information is organized.

---

# Phase 6 — Home & Living

Goal:

Manage the household.

---

## PR-026

Recipes

---

## PR-027

Recipe Gallery

---

## PR-028

Home Inventory

---

## PR-029

Warranty Tracking

---

## PR-030

Household Knowledge

Visible Progress

The platform becomes useful every day.

---

# Phase 7 — Family Timeline

Goal:

Connect everything together.

---

## PR-031

Timeline Events

---

## PR-032

Family Milestones

---

## PR-033

Calendar

---

## PR-034

Reminders

---

## PR-035

Notifications

Visible Progress

The family history comes alive.

---

# Phase 8 — Find Everything

Goal:

Search becomes effortless.

---

## PR-036

Global Search

---

## PR-037

Filters

---

## PR-038

Advanced Search

---

## PR-039

Search Suggestions

---

## PR-040

Relationship Navigation

Visible Progress

Users find information instantly.

---

# Phase 9 — Family Intelligence

Goal:

Introduce AI thoughtfully.

---

## PR-041

OCR Processing

---

## PR-042

Metadata Extraction

---

## PR-043

Smart Categorization

---

## PR-044

AI Search

---

## PR-045

Family AI Assistant

Visible Progress

The platform becomes intelligent.

---

# Phase 10 — Trust & Security

Goal:

Strengthen confidence.

---

## PR-046

Security Center

---

## PR-047

Audit History

---

## PR-048

Backup & Restore

---

## PR-049

Emergency Mode

---

## PR-050

Advanced Permissions

Visible Progress

Families trust the platform.

---

# Phase 11 — Legacy

Goal:

Preserve generations.

---

## PR-051

Digital Legacy

---

## PR-052

Letters

---

## PR-053

Life Instructions

---

## PR-054

Family Story Generator

---

## PR-055

Yearly Family Review

Visible Progress

The platform becomes timeless.

---

# Phase 12 — Premium Experience

Goal:

Deliver premium value.

---

## PR-056

Premium Dashboard

---

## PR-057

Advanced AI

---

## PR-058

Storage Management

---

## PR-059

Analytics

---

## PR-060

Production Readiness

Visible Progress

Version 1.0 is complete.

---

# 3. PR Template

Every Pull Request should contain:

## Objective

What problem does this PR solve?

---

## User Stories

Which user stories are completed?

---

## Requirements

Which UR and FR items are satisfied?

---

## Implementation Summary

High-level technical overview.

---

## UI Changes

Screens introduced or modified.

---

## Testing

How was the feature verified?

---

## Documentation

Updated documentation.

---

## Screenshots

Before / After

---

## Demo

Short video or GIF.

---

# 4. Stream Format

Every stream should naturally follow the same structure.

```
Yesterday

↓

Today's Goal

↓

Planning

↓

Implementation

↓

Testing

↓

Demo

↓

Commit

↓

PR

↓

Tomorrow
```

This creates consistency for viewers.

---

# 5. Definition of Done

A PR is complete when:

- Feature is fully functional.
- UI is polished.
- Tests pass.
- Documentation is updated.
- Code review is complete.
- Application builds successfully.
- The feature can be demonstrated live.

---

# 6. Long-Term Outcome

By following this roadmap, the repository evolves through clearly visible stages:

```
Empty Repository

↓

Landing Page

↓

Family Platform

↓

Knowledge Platform

↓

Memory Platform

↓

AI Platform

↓

Family Operating System
```

Each PR contributes one meaningful step toward that vision.

---

# 7. Roadmap Summary

This roadmap intentionally favors **small, high-quality, user-visible pull requests** over large implementation batches.

Every development stream should leave the audience with something new to explore, while steadily transforming Family Knowledge Vault from an idea into a trusted digital home for families around the world.

---

# 8. Next Steps

Planning documentation is now complete.

The next activity is to begin implementation by executing the roadmap from **PR-001** onward, validating each milestone against the Vision, User Requirements, Product Requirements, and User Stories defined throughout the planning phase.