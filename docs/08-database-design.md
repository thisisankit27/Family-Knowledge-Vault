# 🗄️ Database Design

**Project:** Family Knowledge Vault

**Version:** 1.0

**Status:** Draft

---

# 1. Purpose

This document defines the logical data model for Family Knowledge Vault.

The objective is to identify the core business entities, their relationships, ownership, and lifecycle.

This document intentionally avoids database-specific implementation details such as SQL syntax, data types, indexes, or storage engines.

Those decisions belong to implementation.

---

# 2. Design Principles

The database architecture should follow these principles.

- Family-first ownership
- Domain-driven organization
- Relationship-oriented data model
- Strong consistency for critical information
- Extensible entity design
- Auditability
- Privacy by default
- Minimal duplication

---

# 3. Root Entity

Every piece of information belongs to exactly one Family.

```
Family

│

├── Members

├── Documents

├── Medical

├── Memories

├── Recipes

├── Inventory

├── Timeline

├── Calendar

├── Notifications

└── Settings
```

The Family entity acts as the tenant boundary for the platform.

No information should exist outside a family workspace.

---

# 4. Core Entities

The system is composed of the following primary entities.

```
Family
Member
Invitation
Role
Permission

Document
Category
Tag

MedicalRecord
Prescription
Doctor
Medicine

Memory
Album

Recipe
Ingredient

InventoryItem
Warranty

TimelineEvent

CalendarEvent

Notification

LegacyItem

AuditLog

Attachment
```

Each entity represents a business concept rather than a database table.

---

# 5. Entity Relationships

```
Family

├── Members

│     ├── Documents

│     ├── Medical Records

│     ├── Memories

│     ├── Recipes

│     ├── Timeline Events

│     └── Inventory

│

├── Calendar

├── Notifications

└── Settings
```

Relationships are first-class citizens within the system.

---

# 6. Entity Ownership

Every entity has exactly one owner.

Example

```
Family

↓

Member

↓

Medical Record
```

Ownership determines:

- Visibility
- Permissions
- Security
- Sharing
- Audit history

> **Refined 2026-08-04.** Ownership determines these for the *family* — it is the tenant boundary.
> It does **not** determine visibility *within* a family: a record's visibility is an explicit
> column resolved by one function, not an implication of who owns it. Likewise, `Role` and
> `Permission` in §4 are business concepts, not tables — permissions are function bodies. Both are
> specified in `docs/15-permission-matrix.md`, which is authoritative on this subject.

---

# 7. Document Model

A document represents any uploaded file.

Documents may include:

- Identity Documents
- Property Papers
- Medical Reports
- Legal Documents
- Education Records
- Financial Statements
- Insurance

A document may relate to:

- Family
- Multiple Members
- Timeline Events
- Medical Records
- Inventory Items

Documents are reusable across domains without duplication.

---

# 8. Family Member Model

A member represents a person within the family.

A member may own or relate to:

- Documents
- Medical Records
- Recipes
- Memories
- Timeline Events
- Emergency Contacts

Every relationship should be represented rather than duplicated.

---

# 9. Memory Model

A memory represents a meaningful family experience.

A memory may contain:

- Story
- Photos
- Videos
- Voice Notes

A memory may relate to:

- Multiple Family Members
- One Location
- One Date
- One Timeline Event

---

# 10. Medical Model

Medical information belongs to a family member.

Medical entities include:

- Reports
- Doctors
- Medicines
- Prescriptions
- Vaccinations

Medical information should remain isolated and permission-controlled.

---

# 11. Recipe Model

Recipes preserve family traditions.

A recipe consists of:

- Ingredients
- Instructions
- Photos
- Videos
- Voice Notes
- Story

Recipes may relate to:

- Creator
- Family Members
- Timeline
- Memories

---

# 12. Inventory Model

Inventory tracks household assets.

Each inventory item may contain:

- Purchase Information
- Warranty
- Invoice
- Service History
- Attachments

Inventory items may link directly to uploaded documents.

---

# 13. Timeline Model

Timeline Events represent important moments.

Examples include:

- Birth
- Graduation
- Marriage
- New Home
- Vacation
- Retirement

Timeline events may connect:

- Members
- Documents
- Memories
- Recipes
- Photos
- Locations

---

# 14. Calendar Model

Calendar Events represent scheduled activities.

Examples

- Birthdays
- Appointments
- Renewals
- Medical Visits
- Family Gatherings

Calendar entries may reference any business entity.

---

# 15. Attachment Model

Attachments represent uploaded media.

Examples

- Photos
- Videos
- PDFs
- Audio
- Scanned Documents

Attachments should be reusable across the platform.

One uploaded file may appear in multiple contexts.

> **Flagged 2026-08-17, not resolved — this section asks for something the schema deliberately does
> not do** (`docs/18` §7.6).
>
> Attachments are **per-domain**, not shared. `document_files` shipped in PR-11; `memory_files`
> follows the same shape in PR-18. `docs/17` §13 named this as the decision Phase 4 had to make
> before the second table existed, and `docs/18` §3.1 made it: **per-domain tables, shared upload
> code.**
>
> The reason is structural rather than a preference. A shared `record_files` table cannot express the
> composite foreign key `(record_id, family_id) → parent(id, family_id)`, which is what makes an
> attachment belonging to another family's record *impossible to represent* rather than merely
> policy-refused — the proof PR-8 established and every record table has reused since. It would also
> force a `record_type` discriminator into an RLS policy, the shape `docs/17` §10.2 bans.
>
> So **no file is currently reachable from two parents**, and nothing plans to make one so.
>
> This paragraph is left standing rather than deleted because it is the strongest existing argument
> for the design that was declined, and a future reader deciding whether to revisit it is entitled to
> see the original claim. **The owning question — is §15 wrong, or is it describing a Phase 12
> feature? — has not been answered**, and should be by whoever next revises this document.

---

# 16. Tagging Model

Every entity may support tags.

Examples

Vacation

Insurance

Grandpa

Medical

Finance

Education

Tags improve discoverability without affecting ownership.

---

# 17. Relationship Model

The platform is graph-oriented.

Example

```
Grandpa

↓

Passport

↓

Insurance

↓

Medical Reports

↓

Timeline Events

↓

Memories
```

Instead of storing disconnected records, entities reference one another.

This enables intelligent navigation and AI reasoning.

---

# 18. Search Model

Every searchable entity contributes metadata to the global search index.

Examples

- Family Members
- Documents
- Medical Records
- Recipes
- Memories
- Inventory
- Calendar
- Timeline

Search indexes information rather than replacing the primary database.

---

# 19. Audit Model

Every critical action generates an audit record.

Examples

- Login
- Upload
- Delete
- Share
- Permission Change
- Invitation
- Legacy Access

Audit records improve accountability and security.

---

# 20. Soft Delete Strategy

Critical information should not be permanently removed immediately.

Deletion lifecycle:

```
Active

↓

Archived

↓

Soft Deleted

↓

Permanent Deletion
```

This reduces accidental data loss.

---

# 21. Versioning Strategy

Certain entities should preserve history.

Examples

- Documents
- Recipes
- Legacy Items
- Settings

Version history allows users to restore previous information.

---

# 22. Multi-Tenancy

Every entity belongs to exactly one Family.

```
Family A

↓

Own Data

-----------------

Family B

↓

Own Data
```

Families must remain completely isolated from one another.

No data should ever cross tenant boundaries unless explicitly shared.

---

# 23. Data Lifecycle

Every entity follows a common lifecycle.

```
Create

↓

Update

↓

Reference

↓

Share

↓

Archive

↓

Restore

↓

Delete
```

This lifecycle should remain consistent across all domains.

---

# 24. Scalability Considerations

The logical model should support:

- Millions of families
- Billions of documents
- Long-term historical data
- Independent domain evolution
- Future integrations

The schema should remain extensible without breaking existing relationships.

---

# 25. Database Summary

The Family Knowledge Vault database is designed around **business entities and relationships**, not tables.

Its foundation is:

- One Family
- Multiple Domains
- Shared Relationships
- Secure Ownership
- Searchable Information
- Long-Term Preservation

This logical model provides a stable foundation for future physical database implementation.

---

# 26. Next Document

> **09-api-design.md**

This document defines the public and internal APIs exposed by each domain, including request flows, endpoint responsibilities, authentication, authorization, and integration contracts.