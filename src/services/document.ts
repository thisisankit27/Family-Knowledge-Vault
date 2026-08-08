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

/** Mirrors `documents.visibility`. */
export const DOCUMENT_VISIBILITIES = ['family', 'private'] as const;
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number];

export interface FamilyDocument {
  id: string;
  title: string;
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
  /** The person it is about. Null means it belongs to the household. */
  memberId?: string | null;
  visibility?: DocumentVisibility;
  aiProcessing?: AiProcessing;
}

export interface DocumentGateway {
  listDocuments(familyId: string): Promise<GatewayResult<FamilyDocument[]>>;
  createDocument(input: CreateDocumentInput): Promise<GatewayResult<FamilyDocument>>;
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

interface DocumentRow {
  id: string;
  title: string;
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
  'id, title, member_id, visibility, archived_at, ai_processing, created_by, created_at, updated_at';

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

    async createDocument({ familyId, title, memberId, visibility, aiProcessing }) {
      // `created_by` is sent explicitly because the INSERT policy requires it
      // to equal auth.uid() — the database will not infer it, and a default
      // would let a client file a document in somebody else's name.
      const { data: session } = await client.auth.getUser();

      const { data, error } = await client
        .from('documents')
        .insert({
          family_id: familyId,
          title,
          member_id: memberId ?? null,
          visibility: visibility ?? 'family',
          ai_processing: aiProcessing ?? 'denied',
          created_by: session.user?.id ?? null,
        })
        .select(DOCUMENT_COLUMNS)
        .maybeSingle<DocumentRow>();

      return { data: data ? toDocument(data) : null, error };
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
