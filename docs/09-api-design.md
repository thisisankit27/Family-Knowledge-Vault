# 🌐 API Design

**Project:** Family Knowledge Vault

**Version:** 1.0

**Status:** **SUPERSEDED — do not read this as a contract.** Marked 2026-08-17, during the Phase 4
brief (`docs/18` §7.5).

> This document describes a per-domain **REST API** — a "Memory API responsible for Stories, Photos,
> Videos, Albums, Voice Notes", an Auth API, a Document API — for a system that **has no server**.
>
> `docs/17` §4.3 states the policy in as many words: *"There is no server, by written policy."* The
> shipped architecture is **Postgres + Row-Level Security**, reached directly by the mobile client
> through PostgREST and `supabase-js`, with `SECURITY DEFINER` functions for the operations a policy
> cannot express, and a per-domain `XGateway` TypeScript interface as the only seam. Authorisation is
> **function bodies and policies**, not middleware — `docs/15` §5 and §8.
>
> Nothing in this document has ever been built, and the names it uses do not correspond to anything
> in the codebase.
>
> **What is still useful:** the *responsibilities* it assigns to each domain are a reasonable
> inventory of what the product does, and §1's "technology-agnostic" framing is why it aged this way
> rather than being wrong on day one. Treat it as an early domain sketch.
>
> **Authoritative instead:** `docs/15` for permissions, `docs/17` for storage, `docs/16` and
> `docs/18` for what each phase actually builds, and `src/services/*.ts` for the real interfaces.

---

# 1. Purpose

This document defines the API architecture for Family Knowledge Vault.

Its objective is to establish a consistent, secure, scalable, and technology-agnostic communication model between clients, business domains, and platform services.

This document intentionally focuses on API responsibilities rather than implementation-specific endpoint definitions.

---

# 2. API Design Principles

The platform APIs shall follow these principles.

- API First
- Domain Driven
- Stateless Communication
- Secure by Default
- Consistent Structure
- Predictable Responses
- Backward Compatibility
- Versioned APIs
- Extensible Contracts

---

# 3. API Architecture

```
                Clients

        Web
        Mobile
        Future Apps

              │

              ▼

        API Gateway / Router

              │

 ┌────────────┼────────────┐

 ▼            ▼            ▼

Family      Document      Medical

Service      Service      Service

 ▼            ▼            ▼

Timeline    Inventory     Recipe

Service      Service      Service

              │

              ▼

      Shared Platform Services

Authentication

Authorization

Search

Notifications

Storage

Audit

AI

              │

              ▼

          Data Layer
```

---

# 4. API Layers

The platform exposes APIs through multiple logical layers.

## Client Layer

Responsible for:

- Authentication
- Requests
- User Interaction

---

## Application Layer

Responsible for:

- Request Routing
- Workflow Coordination
- Validation

---

## Domain Layer

Responsible for:

- Business Logic
- Entity Management
- Rules

---

## Platform Layer

Provides shared capabilities including:

- Authentication
- Search
- AI
- Notifications
- Storage

---

# 5. Domain APIs

Every business domain owns its own API surface.

---

## Family API

Responsible for

- Family Creation
- Invitations
- Member Management
- Roles
- Permissions

---

## Document API

Responsible for

- Upload
- Download
- Preview
- Search
- Sharing
- Categorization

---

## Medical API

Responsible for

- Reports
- Prescriptions
- Medicines
- Vaccinations
- Doctors

---

## Memory API

Responsible for

- Stories
- Photos
- Videos
- Albums
- Voice Notes

---

## Timeline API

Responsible for

- Events
- Milestones
- Family History

---

## Recipe API

Responsible for

- Recipes
- Ingredients
- Instructions
- Voice Recipes

---

## Inventory API

Responsible for

- Household Assets
- Warranty
- Service Records

---

## Calendar API

Responsible for

- Events
- Reminders
- Renewals

---

## AI API

Responsible for

- AI Assistant
- Semantic Search
- OCR
- Metadata Extraction
- Smart Suggestions

---

# 6. Shared Platform APIs

These APIs are available across every domain.

---

## Authentication

Functions

- Register
- Login
- Logout
- Password Reset
- MFA

---

## Authorization

Functions

- Permission Evaluation
- Role Validation
- Resource Access

---

## Search

Functions

- Global Search
- Semantic Search
- Suggestions
- Filters

---

## Notification

Functions

- Email
- Push
- In-App Notifications
- Reminder Scheduling

---

## Audit

Functions

- Activity Logs
- Security Events
- Permission Changes

---

## Storage

Functions

- File Upload
- File Download
- File Versioning
- File Deletion

---

# 7. API Communication Model

Every request follows a common lifecycle.

```
Client

↓

Authentication

↓

Authorization

↓

Validation

↓

Business Logic

↓

Data Access

↓

Response
```

No request should bypass this flow.

---

# 8. Standard Request Flow

Example

```
User Uploads Passport

↓

Authentication

↓

Permission Check

↓

Document API

↓

Storage Service

↓

Metadata Processing

↓

Search Index

↓

Audit Log

↓

Success Response
```

---

# 9. API Response Principles

Every API should return a consistent response structure.

Responses should include:

- Success Indicator
- Data
- Errors
- Metadata
- Pagination (where applicable)

Clients should never need different parsing logic for different services.

---

# 10. Error Handling

Errors should be:

- Predictable
- Actionable
- Human-readable
- Consistent

Examples

- Authentication Failed
- Permission Denied
- Validation Failed
- Resource Not Found
- Duplicate Resource
- Internal Error

Sensitive implementation details should never be exposed.

---

# 11. Authentication Strategy

Every protected API requires authentication.

Authentication establishes:

- User Identity
- Family Membership
- Session Context

Authentication should be independent of business domains.

---

# 12. Authorization Strategy

Every request evaluates permissions before business logic executes.

Permissions are determined by:

- User
- Family
- Role
- Resource
- Requested Action

Authorization is enforced centrally.

---

# 13. Versioning Strategy

Public APIs should support versioning.

```
Version 1

↓

Version 2

↓

Version 3
```

Breaking changes should never invalidate existing clients without a migration path.

---

# 14. Idempotency

Operations that may be retried should remain safe.

Examples

- Invitation Acceptance
- Reminder Scheduling
- Upload Completion
- Notification Delivery

Repeated requests should not create duplicate resources.

---

# 15. Pagination

Collection APIs should support pagination.

Examples

- Documents
- Memories
- Timeline
- Recipes
- Notifications

This ensures consistent performance regardless of data volume.

---

# 16. Filtering & Sorting

Collection APIs should support:

Filtering

- Category
- Date
- Family Member
- Tags

Sorting

- Created Date
- Updated Date
- Name
- Relevance

---

# 17. Search Integration

Every searchable domain contributes data to the Search API.

```
Documents

Medical

Recipes

Timeline

Inventory

↓

Search Service

↓

Client
```

Search remains independent from individual domains.

---

# 18. AI Integration

AI consumes information through platform APIs rather than direct database access.

```
AI Assistant

↓

Search API

↓

Business APIs

↓

Knowledge

↓

Response
```

This keeps AI isolated from storage implementation.

---

# 19. Observability

Every API request should support:

- Request Logging
- Correlation IDs
- Performance Metrics
- Audit Events
- Error Tracking

This improves debugging and operational visibility.

---

# 20. Security Considerations

Every API should enforce:

- Authentication
- Authorization
- Input Validation
- Rate Limiting
- Audit Logging
- Secure Transport

Security is mandatory for every domain.

---

# 21. API Evolution

Future APIs should integrate without disrupting existing domains.

Examples

- Estate Planning
- Healthcare
- Government Services
- Smart Home
- Insurance
- Financial Planning

New APIs should follow the same architectural principles.

---

# 22. API Summary

The Family Knowledge Vault API architecture is built around independent domain services connected through shared platform capabilities.

Every API is:

- Consistent
- Secure
- Stateless
- Versioned
- Extensible

This approach enables future web, mobile, desktop, and third-party integrations while maintaining a stable business architecture.

---

# 23. Next Document

> **10-ui-ux-design.md**

This document defines the visual language, navigation patterns, design system, wireframes, interaction principles, responsive behavior, and user experience guidelines that will shape the Family Knowledge Vault interface.