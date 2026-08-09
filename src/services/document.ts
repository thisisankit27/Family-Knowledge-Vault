/**
 * Documents business logic.
 *
 * Same shape as every other service — rules here, UI-free, gateway injected —
 * so validation and error wording are tested without a network or a device.
 *
 * This service does **no permission work**. `can_see_record` decides what comes
 * back and `can_write_records` decides what goes in, both in Postgres. A filter
 * written here would be a second permission model that the RLS suite does not
 * test, and the first place the two disagreed would be a leak.
 *
 * The model those policies enforce, as of 20260810090000: **a document belongs
 * to whoever filed it, and to nobody else.** Not the family Owner, not the
 * person it is about. Sharing arrives in PR-15.
 *
 * What it does own is the vocabulary the UI speaks: a document has a *title*
 * and a *subject*, never a filename and a folder. `docs/10-ui-ux-design.md` §13
 * — "context is more valuable than filenames" — is a product constraint, and
 * this is the layer that keeps it true.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { GatewayResult } from './family';

export const MAX_DOCUMENT_TITLE_LENGTH = 120;

/**
 * Whether AI may read this document.
 *
 * A consent flag, not an encryption tier — the two were deliberately separated
 * in `docs/17-storage-architecture-review.md` §6. This is a promise kept by
 * code; it is not a guarantee the server cannot read the bytes, and no copy in
 * the UI may imply otherwise.
 */
export const AI_PROCESSING_MODES = ['allowed', 'denied'] as const;
export type AiProcessing = (typeof AI_PROCESSING_MODES)[number];

/**
 * Mirrors `documents.visibility`.
 *
 * **Nothing sets this today.** Every document is `private` by default and only
 * its author can read it; the second value survives so PR-15 has somewhere to
 * put sharing rather than needing a constraint change on top of a design.
 */
export const DOCUMENT_VISIBILITIES = ['family', 'private'] as const;
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number];

/**
 * The six shelves, from `docs/06-information-architecture.md` §4.
 *
 * Product vocabulary, identical for every household — which is why it is a
 * check constraint rather than a table a family owns rows in. The open,
 * user-chosen axis is tags (`docs/08` §16), not this.
 *
 * Order is the order they appear in the filter row, and it is the IA's order
 * rather than alphabetical: Identity first because it is what a family reaches
 * for most, Legal last because it is the rarest.
 *
 * "Archived" is deliberately absent. It is a timestamp on the row, not a shelf
 * — a document can be Medical *and* archived, and making them exclusive would
 * lose its meaning the moment it was filed away.
 */
export const DOCUMENT_CATEGORIES = [
  'identity',
  'medical',
  'finance',
  'property',
  'education',
  'legal',
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  identity: 'Identity',
  medical: 'Medical',
  finance: 'Finance',
  property: 'Property',
  education: 'Education',
  legal: 'Legal',
};

/**
 * What belongs on each shelf, in the words a family would use.
 *
 * These are examples rather than definitions on purpose: the six are broad, the
 * boundaries are fuzzy, and somebody deciding where an insurance policy goes is
 * better served by "policies, statements, tax papers" than by a rule.
 */
export const CATEGORY_HINTS: Record<DocumentCategory, string> = {
  identity: 'Passports, Aadhaar, PAN, licences, birth certificates',
  medical: 'Reports, prescriptions, vaccination records, insurance',
  finance: 'Bank statements, policies, tax papers, investments',
  property: 'Deeds, agreements, tax receipts, utility connections',
  education: 'Certificates, mark sheets, degrees, admission papers',
  legal: 'Wills, contracts, affidavits, court papers',
};

export function isDocumentCategory(value: unknown): value is DocumentCategory {
  return (
    typeof value === 'string' && (DOCUMENT_CATEGORIES as readonly string[]).includes(value)
  );
}

export interface FamilyDocument {
  id: string;
  title: string;
  category: DocumentCategory;
  memberId: string | null;
  visibility: DocumentVisibility;
  archivedAt: string | null;
  aiProcessing: AiProcessing;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDocumentInput {
  familyId: string;
  title: string;
  /** Required. The column is `not null`; there is no "uncategorised" shelf. */
  category: DocumentCategory;
  /** Whose document it is. A label only — see `setDocumentMember`. */
  memberId?: string | null;
  aiProcessing?: AiProcessing;
}

export interface DocumentGateway {
  listDocuments(familyId: string): Promise<GatewayResult<FamilyDocument[]>>;
  createDocument(input: CreateDocumentInput): Promise<GatewayResult<FamilyDocument>>;
  getDocument(documentId: string): Promise<GatewayResult<FamilyDocument>>;
  setCategory(
    documentId: string,
    category: DocumentCategory,
  ): Promise<{ error: { message: string } | null }>;
  setTitle(documentId: string, title: string): Promise<{ error: { message: string } | null }>;
  setMember(
    documentId: string,
    memberId: string | null,
  ): Promise<{ error: { message: string } | null }>;
  setAiProcessing(
    documentId: string,
    aiProcessing: AiProcessing,
  ): Promise<{ error: { message: string } | null }>;
  archiveDocument(documentId: string, archived: boolean): Promise<{ error: { message: string } | null }>;
  deleteDocument(documentId: string): Promise<{ error: { message: string } | null }>;
}

export type DocumentOutcome =
  | { ok: true; document: FamilyDocument }
  | { ok: false; message: string };

export function validateDocumentTitle(raw: string): { message: string } | null {
  const title = raw.trim();

  if (title.length === 0) {
    return { message: 'Give this document a name.' };
  }
  if (title.length > MAX_DOCUMENT_TITLE_LENGTH) {
    return { message: `Keep it under ${MAX_DOCUMENT_TITLE_LENGTH} characters.` };
  }
  return null;
}

/**
 * Postgres speaks to developers. This speaks to whoever is holding the phone.
 *
 * The row-level-security branch matters most here for a reason specific to this
 * table: a Guest can reach the documents tab and read nothing, because
 * `can_read_records` excludes them. "You do not have permission to do that" is
 * the honest answer, and it must not be softened into "no documents yet" —
 * telling somebody a shelf is empty when it is merely locked is the kind of
 * claim this project has committed not to make.
 */
export function describeDocumentError(message: string): string {
  const normalised = message.toLowerCase();

  if (normalised.includes('row-level security') || normalised.includes('permission denied')) {
    return 'You do not have permission to do that.';
  }
  if (normalised.includes('not authenticated')) {
    return 'Your session has expired. Sign in again.';
  }
  if (normalised.includes('documents_title_check')) {
    return `Use between 1 and ${MAX_DOCUMENT_TITLE_LENGTH} characters.`;
  }
  if (normalised.includes('documents_ai_processing_check')) {
    return 'That privacy setting is not recognised.';
  }
  if (normalised.includes('documents_visibility_check')) {
    return 'That visibility setting is not recognised.';
  }
  if (normalised.includes('documents_category_check')) {
    return 'That is not a category.';
  }
  if (normalised.includes('null value in column "category"')) {
    // The constraint speaking, not the service check above — reachable only if
    // a caller bypassed createDocument.
    return 'Choose where this belongs.';
  }
  if (normalised.includes('documents_member_id_family_id_fkey')) {
    // The subject was removed from the family between opening the form and
    // submitting it. Naming the person would be a guess; naming the cause is not.
    return 'That person is no longer in this family.';
  }
  if (normalised.includes('network') || normalised.includes('fetch')) {
    return 'Cannot reach the server. Check your connection and try again.';
  }
  return message;
}

/**
 * Live documents for a family, newest first.
 *
 * Archived rows are included: they are still visible to the policy, and hiding
 * them here would make "archive" indistinguishable from "delete" to every
 * caller. Splitting the list is the screen's job — see `partitionDocuments`.
 *
 * An empty list and a refused read are different answers and are returned
 * differently, so the UI can tell "nothing filed" from "not allowed".
 */
export async function listDocuments(
  gateway: DocumentGateway,
  familyId: string,
): Promise<{ ok: true; documents: FamilyDocument[] } | { ok: false; message: string }> {
  const { data, error } = await gateway.listDocuments(familyId);
  if (error) return { ok: false, message: describeDocumentError(error.message) };
  return { ok: true, documents: data ?? [] };
}

export async function createDocument(
  gateway: DocumentGateway,
  input: CreateDocumentInput,
): Promise<DocumentOutcome> {
  const invalid = validateDocumentTitle(input.title);
  if (invalid) return { ok: false, message: invalid.message };

  // Checked here as well as by the constraint, because the two failures read
  // very differently to whoever is holding the phone: this one names the thing
  // they forgot, the constraint names a column.
  if (!isDocumentCategory(input.category)) {
    return { ok: false, message: 'Choose where this belongs.' };
  }

  const { data, error } = await gateway.createDocument({
    ...input,
    title: input.title.trim(),
  });

  if (error) return { ok: false, message: describeDocumentError(error.message) };
  if (!data) {
    // The insert succeeded and the SELECT policy declined to return the row.
    // Reporting success would leave the list showing nothing and the user
    // filing the same document twice.
    return { ok: false, message: 'The document was not filed. Please try again.' };
  }

  return { ok: true, document: data };
}

/**
 * Archive is reversible; delete is not. They are separate columns for that
 * reason (`docs/16-phase-3-brief.md` §6.3), and separate functions here so no
 * caller can reach the irreversible one by passing a flag.
 */
export async function setDocumentArchived(
  gateway: DocumentGateway,
  documentId: string,
  archived: boolean,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await gateway.archiveDocument(documentId, archived);
  if (error) return { ok: false, message: describeDocumentError(error.message) };
  return { ok: true };
}

export async function deleteDocument(
  gateway: DocumentGateway,
  documentId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await gateway.deleteDocument(documentId);
  if (error) return { ok: false, message: describeDocumentError(error.message) };
  return { ok: true };
}

/**
 * One document, or a clear reason why not.
 *
 * `null` data with no error is the interesting case: the row exists, and
 * `can_see_record` declined to return it. That is not an error condition — it
 * is what privacy looks like from outside — so it gets its own message rather
 * than being reported as a failure.
 */
export async function getDocument(
  gateway: DocumentGateway,
  documentId: string,
): Promise<DocumentOutcome> {
  const { data, error } = await gateway.getDocument(documentId);
  if (error) return { ok: false, message: describeDocumentError(error.message) };
  if (!data) return { ok: false, message: 'That document is no longer available.' };
  return { ok: true, document: data };
}

/**
 * Rename a document.
 *
 * Validated with the same function that guards creation, so the rule lives in
 * one place — a title that could not be filed must not become reachable by
 * editing one that already was.
 */
export async function renameDocument(
  gateway: DocumentGateway,
  documentId: string,
  title: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const invalid = validateDocumentTitle(title);
  if (invalid) return { ok: false, message: invalid.message };

  const { error } = await gateway.setTitle(documentId, title.trim());
  if (error) return { ok: false, message: describeDocumentError(error.message) };
  return { ok: true };
}

/**
 * Say who a document is *about* — whose passport this is.
 *
 * Distinct from who filed it, which is `created_by` and is not editable. With
 * four passports in a household, "Dad's" is the fact that makes the library
 * usable; who happened to photograph it is provenance, not identity.
 *
 * `null` means the household owns it — a property deed or an electricity
 * connection belongs to no one person.
 *
 * **It grants nothing.** This used to be the opposite: `can_see_record` gives a
 * private record to its author *or its subject*, so naming somebody here handed
 * them read *and* write access to a document they had not filed — the hole
 * 20260810090000 closed. The documents policies now pass `null` in the subject
 * position, so this column is inert to permissions and is only a label.
 *
 * Keeping the two ideas apart is the whole repair. "Whose passport is this" and
 * "who may open this" are different questions, and answering both with one
 * column is what produced a privilege escalation nobody wrote on purpose.
 */
export async function setDocumentMember(
  gateway: DocumentGateway,
  documentId: string,
  memberId: string | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await gateway.setMember(documentId, memberId);
  if (error) return { ok: false, message: describeDocumentError(error.message) };
  return { ok: true };
}

/**
 * Change whether AI may read this document.
 *
 * A consent flag, and the UI must not overstate it: this is a promise kept by
 * code, not a guarantee the server cannot read the bytes. The encryption tier
 * that *would* be such a guarantee is Phase 11's, and is a different control.
 */
export async function setDocumentAiProcessing(
  gateway: DocumentGateway,
  documentId: string,
  aiProcessing: AiProcessing,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!AI_PROCESSING_MODES.includes(aiProcessing)) {
    return { ok: false, message: 'That privacy setting is not recognised.' };
  }

  const { error } = await gateway.setAiProcessing(documentId, aiProcessing);
  if (error) return { ok: false, message: describeDocumentError(error.message) };
  return { ok: true };
}

/**
 * Re-file a document onto a different shelf.
 *
 * Separate from archiving for the same reason archive is separate from delete:
 * a caller should not be able to reach one by passing a flag to the other.
 */
export async function setDocumentCategory(
  gateway: DocumentGateway,
  documentId: string,
  category: DocumentCategory,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isDocumentCategory(category)) {
    return { ok: false, message: 'That is not a category.' };
  }

  const { error } = await gateway.setCategory(documentId, category);
  if (error) return { ok: false, message: describeDocumentError(error.message) };
  return { ok: true };
}

/**
 * Narrow a list to one shelf. `null` means "All" and returns everything.
 *
 * A pure function over a list the screen already holds, rather than a second
 * query. The whole family's documents are fetched once for the active/archived
 * split; filtering in memory keeps one round trip and one source of truth. When
 * a family has enough documents for that to be the wrong trade, this moves into
 * the query and takes an index with it.
 */
export function filterByCategory(
  documents: FamilyDocument[],
  category: DocumentCategory | null,
): FamilyDocument[] {
  if (!category) return documents;
  return documents.filter((document) => document.category === category);
}

/**
 * How many live documents sit on each shelf.
 *
 * Counts exclude archived rows so a filter row cannot advertise "Medical 3"
 * and then show an empty list — the count and the thing it counts must be the
 * same set.
 */
export function countByCategory(
  documents: FamilyDocument[],
): Record<DocumentCategory, number> {
  const counts = Object.fromEntries(
    DOCUMENT_CATEGORIES.map((category) => [category, 0]),
  ) as Record<DocumentCategory, number>;

  for (const document of documents) {
    if (document.archivedAt) continue;
    counts[document.category] += 1;
  }

  return counts;
}

/** Active and archived, in one pass, order preserved. */
export function partitionDocuments(documents: FamilyDocument[]): {
  active: FamilyDocument[];
  archived: FamilyDocument[];
} {
  const active: FamilyDocument[] = [];
  const archived: FamilyDocument[] = [];

  for (const document of documents) {
    (document.archivedAt ? archived : active).push(document);
  }

  return { active, archived };
}

/**
 * The line under a document's title.
 *
 * Deliberately says nothing about files. In Phase 3 there are none yet, and
 * once PR-14 adds them the answer still should not be "1 file, 2.4 MB" — the
 * product's stated goal is that a document reads as *Dad's Passport · expires
 * March 2033*, not as a row in a file manager.
 */
export function describeDocumentSubject(
  document: FamilyDocument,
  peopleById: Map<string, string>,
): string {
  if (!document.memberId) return 'The whole family';
  return peopleById.get(document.memberId) ?? 'Someone in this family';
}

/**
 * Who filed this document, from the reader's point of view.
 *
 * "You" when it is you, the same courtesy the activity feed already extends.
 * Degrades to "Someone" rather than an id: the account may simply have been
 * deleted, and the document is still theirs to have filed. Dropping the line
 * would be worse than softening the name.
 */
export function describeDocumentAuthor(
  document: FamilyDocument,
  people: { userId: string | null; displayName: string }[],
  viewerUserId: string | null,
): string {
  if (!document.createdBy) return 'Someone';
  if (document.createdBy === viewerUserId) return 'You';

  const person = people.find((candidate) => candidate.userId === document.createdBy);
  return person?.displayName ?? 'Someone';
}

interface DocumentRow {
  id: string;
  title: string;
  category: DocumentCategory;
  member_id: string | null;
  visibility: DocumentVisibility;
  archived_at: string | null;
  ai_processing: AiProcessing;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function toDocument(row: DocumentRow): FamilyDocument {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    memberId: row.member_id,
    visibility: row.visibility,
    archivedAt: row.archived_at,
    aiProcessing: row.ai_processing,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const DOCUMENT_COLUMNS =
  'id, title, category, member_id, visibility, archived_at, ai_processing, created_by, created_at, updated_at';

/** The only place that knows how documents are stored. */
export function createSupabaseDocumentGateway(client: SupabaseClient): DocumentGateway {
  return {
    async listDocuments(familyId) {
      // A plain select, not an RPC. There is no precondition to enforce beyond
      // what the SELECT policy already expresses, and `deleted_at is null`
      // lives in the policy rather than here so that no caller can forget it.
      const { data, error } = await client
        .from('documents')
        .select(DOCUMENT_COLUMNS)
        .eq('family_id', familyId)
        .order('created_at', { ascending: false })
        .returns<DocumentRow[]>();

      return { data: data ? data.map(toDocument) : null, error };
    },

    async createDocument({ familyId, title, category, memberId, aiProcessing }) {
      // `created_by` is sent explicitly because the INSERT policy requires it
      // to equal auth.uid() — the database will not infer it, and a default
      // would let a client file a document in somebody else's name.
      const { data: session } = await client.auth.getUser();

      const { data, error } = await client
        .from('documents')
        .insert({
          family_id: familyId,
          title,
          category,
          member_id: memberId ?? null,
          ai_processing: aiProcessing ?? 'denied',
          created_by: session.user?.id ?? null,
        })
        .select(DOCUMENT_COLUMNS)
        .maybeSingle<DocumentRow>();

      return { data: data ? toDocument(data) : null, error };
    },

    async getDocument(documentId) {
      // `maybeSingle`, not `single`: a row the policy hides is a legitimate
      // answer, and `single` would turn it into an error the caller cannot
      // distinguish from a real one.
      const { data, error } = await client
        .from('documents')
        .select(DOCUMENT_COLUMNS)
        .eq('id', documentId)
        .maybeSingle<DocumentRow>();

      return { data: data ? toDocument(data) : null, error };
    },

    async setTitle(documentId, title) {
      const { error } = await client
        .from('documents')
        .update({ title })
        .eq('id', documentId);

      return { error };
    },

    async setMember(documentId, memberId) {
      const { error } = await client
        .from('documents')
        .update({ member_id: memberId })
        .eq('id', documentId);

      return { error };
    },

    async setAiProcessing(documentId, aiProcessing) {
      const { error } = await client
        .from('documents')
        .update({ ai_processing: aiProcessing })
        .eq('id', documentId);

      return { error };
    },

    async setCategory(documentId, category) {
      const { error } = await client
        .from('documents')
        .update({ category })
        .eq('id', documentId);

      return { error };
    },

    async archiveDocument(documentId, archived) {
      const { error } = await client
        .from('documents')
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq('id', documentId);

      return { error };
    },

    // A hard delete. `documents.deleted_at` exists and the SELECT policy
    // already filters on it, but nothing sets it yet: soft delete needs a
    // restore interface to mean anything, and shipping the column without one
    // would be a capability with no way to reach it. PR-14 owns that, together
    // with what happens to the stored object.
    async deleteDocument(documentId) {
      const { error } = await client.from('documents').delete().eq('id', documentId);
      return { error };
    },
  };
}
