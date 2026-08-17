/**
 * Files: validation, upload, and the row that records them.
 *
 * A separate service from `document.ts` rather than a widened `DocumentGateway`,
 * for three reasons that are all about shape. It talks to `client.storage`
 * rather than `client.from`. It needs progress, which the `Promise<{ error }>`
 * shape every other mutation returns cannot express. And it is a two-phase
 * write — bytes, then row — arbitrated by a database function.
 *
 * `docs/17-storage-architecture-review.md` §10 calls this the house style:
 * "a `createSupabaseStorageGateway(client)` is the house style, not a new
 * pattern."
 *
 * **Two rules from §10.1, both free now and expensive later.** Never store a
 * URL — store the identifier and mint on demand, because a signed URL in a row
 * bakes the provider's domain and its TTL into the data. And signed-URL expiry
 * must not reach components; one accessor takes a file id and re-mints. PR-14b
 * builds that accessor, and nothing here may make it harder.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { GatewayResult } from './family';

/** The bucket, from `docs/16` §3.2. Created by migration, never by config.toml. */
export const FILE_BUCKET = 'family-files';

/**
 * 10MB, mirroring `storage.buckets.file_size_limit`.
 *
 * Deliberately duplicated rather than read from the server. The bucket is the
 * real limit — a cap enforced only in an app bundle lasts until somebody points
 * curl at the endpoint — but a client that only finds out by being refused
 * makes the user wait for a whole upload to learn the answer.
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Mirrors the bucket's `allowed_mime_types`. Phase 4 adds audio and video. */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'application/pdf',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/**
 * The subset that is a picture.
 *
 * Not a second allow-list — a narrowing of the one above, so a type the bucket
 * would refuse cannot appear here. Memories accept these and nothing else in
 * PR-18 (see `MEMORY_FILES`).
 */
export const IMAGE_MIME_TYPES = ALLOWED_MIME_TYPES.filter(
  (mimeType) => mimeType !== 'application/pdf',
);

/**
 * The extension the stored object gets.
 *
 * Derived from the MIME type, **never from the user's filename**. The path
 * contract (`docs/15` §9.1 as amended) puts a generated uuid in the final
 * segment precisely so no user input reaches the path; taking the extension
 * from `report.pdf.exe` would put it back.
 */
const EXTENSIONS: Record<AllowedMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export function isAllowedMimeType(value: unknown): value is AllowedMimeType {
  return typeof value === 'string' && (ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

export function extensionFor(mimeType: string): string | null {
  return isAllowedMimeType(mimeType) ? EXTENSIONS[mimeType] : null;
}

/**
 * Whether this app can show the file itself, or has to hand it to something
 * that can.
 *
 * Images yes; PDFs no, and the reason is a platform fact rather than a
 * preference: **Android's WebView cannot render a PDF.** iOS can, but building
 * a preview that works on one platform and silently fails on the other — the
 * one the project demos on — is worse than being straightforward about it.
 *
 * The tempting escape is Google's document viewer, which takes a URL and
 * returns a rendered page. It is not a trade-off to weigh: it would send a
 * family's private documents to Google, which for this product is
 * disqualifying.
 *
 * So a PDF opens in whatever reader the user already trusts. Phase 10's dev
 * build, or a bundled `pdf.js`, could revisit this.
 */
export function isPreviewable(mimeType: string): boolean {
  return isAllowedMimeType(mimeType) && mimeType !== 'application/pdf';
}

/**
 * A stored object, whatever kind of record it hangs off.
 *
 * Named `RecordFile` rather than `DocumentFile` since PR-18, because the second
 * caller arrived and the logic turned out to be identical — see `RecordFileKind`.
 *
 * `recordId` is the parent's id. Which *table* that id lives in is the kind's
 * business, not this type's, and no consumer needs to know.
 */
export interface RecordFile {
  id: string;
  recordId: string;
  /**
   * The provider's own identifier for the object.
   *
   * **Opaque. Do not parse it, do not build one, do not display it.** It happens
   * to be a storage path today, and `docs/17` §10 named it `provider_file_id`
   * precisely so nothing outside the database's allocator would depend on that.
   * `docs/18` §13.6 makes it load-bearing for a second reason: if the open
   * content-ownership question ever re-associates a record with another family,
   * an identifier nothing parses can be re-pointed without moving bytes.
   */
  providerFileId: string;
  kind: 'original' | 'thumbnail';
  mimeType: string;
  sizeBytes: number;
  /** Null for a photograph. Reserved for PR-19's recordings. */
  durationSeconds: number | null;
  originalFilename: string | null;
  createdAt: string;
}

/**
 * What differs between one record domain's files and another's — which is only
 * ever names.
 *
 * `docs/18` §3.1 settled this: per-domain tables in SQL, shared upload *code* in
 * TypeScript. The SQL stays four small honest functions per domain, because a
 * polymorphic `record_files` table cannot express the composite foreign key that
 * makes a cross-tenant attachment impossible to represent, and would put a type
 * discriminator inside an RLS policy. The upload *path* has no such excuse: it
 * is allocate → read bytes → XHR with progress → attach, and only two RPC names
 * change.
 *
 * Written when the second caller arrived, not before it — `docs/16`'s closing
 * habit. PR-20's albums are the third; if a fourth field appears here, that is
 * the signal the abstraction is drifting from what actually varies.
 */
export interface RecordFileKind {
  /** RPC that returns a path. The only thing anywhere that builds one. */
  allocateRpc: string;
  /** RPC that writes the row, after verifying the object exists. */
  attachRpc: string;
  /** The RPC argument naming the parent record. */
  parentParam: string;
  /** The table holding the rows. */
  filesTable: string;
  /** The column in that table pointing at the parent. */
  parentColumn: string;
  /** What a file of this kind is called when it lands on somebody's phone. */
  downloadNoun: string;
  /**
   * What this domain accepts, which may be narrower than the bucket.
   *
   * The bucket is the real limit and permits PDFs; a *memory* takes
   * photographs, so a narrower list here keeps the grid honest — everything in
   * it renders — without touching the bucket that documents also use.
   */
  acceptedMimeTypes: readonly string[];
}

export const DOCUMENT_FILES: RecordFileKind = {
  allocateRpc: 'allocate_document_file_path',
  attachRpc: 'attach_document_file',
  parentParam: 'target_document',
  filesTable: 'document_files',
  parentColumn: 'document_id',
  downloadNoun: 'document',
  acceptedMimeTypes: ALLOWED_MIME_TYPES,
};

export const MEMORY_FILES: RecordFileKind = {
  allocateRpc: 'allocate_memory_file_path',
  attachRpc: 'attach_memory_file',
  parentParam: 'target_memory',
  filesTable: 'memory_files',
  parentColumn: 'memory_id',
  downloadNoun: 'photo',
  // Images only in PR-18. PR-19 adds audio here and to the bucket together.
  acceptedMimeTypes: IMAGE_MIME_TYPES,
};

export interface UploadCandidate {
  uri: string;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string | null;
}

/**
 * Refuse a file before uploading it rather than after.
 *
 * The size check matters most on a phone: a 40MB photo over mobile data that
 * fails at the end has cost the user their patience and their allowance to
 * learn something knowable up front.
 */
export function validateFile(
  file: {
    mimeType: string;
    sizeBytes: number;
  },
  accepted: readonly string[] = ALLOWED_MIME_TYPES,
): { message: string } | null {
  if (!isAllowedMimeType(file.mimeType) || !accepted.includes(file.mimeType)) {
    // The sentence names what this record takes, not what the bucket permits.
    // Telling somebody attaching a photo to a memory that they may use a PDF
    // would be true of the bucket and false of the thing in front of them.
    const wanted = accepted.includes('application/pdf') ? 'a photo or a PDF' : 'a photo';
    return { message: `That kind of file cannot be added yet. Use ${wanted}.` };
  }
  if (file.sizeBytes <= 0) {
    return { message: 'That file is empty.' };
  }
  if (file.sizeBytes > MAX_FILE_BYTES) {
    return {
      message: `Files must be under ${formatBytes(MAX_FILE_BYTES)}. That one is ${formatBytes(
        file.sizeBytes,
      )}.`,
    };
  }
  return null;
}

/** "2.4 MB". Sizes a person reads, not bytes a machine counts. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Postgres and the storage API speak to developers. This speaks to whoever is
 * holding the phone.
 *
 * The two a user will actually hit are the size cap and the type allow-list,
 * and both arrive as codes rather than sentences.
 */
export function describeStorageError(message: string): string {
  const normalised = message.toLowerCase();

  if (normalised.includes('payload too large') || normalised.includes('413')) {
    return `That file is too large. Files must be under ${formatBytes(MAX_FILE_BYTES)}.`;
  }
  if (normalised.includes('mime type') || normalised.includes('invalid_mime_type')) {
    return 'That kind of file cannot be filed yet. Use a photo or a PDF.';
  }
  // Raised by both allocator and attach functions in each domain, and
  // deliberately the same message whether the record is missing or somebody
  // else's — "not yours" and "does not exist" are the same fact to a caller who
  // should not learn which.
  if (normalised.includes('document not found')) {
    return 'That document is no longer available.';
  }
  if (normalised.includes('memory not found')) {
    return 'That memory is no longer available.';
  }
  if (normalised.includes('no file was uploaded')) {
    return 'The upload did not finish. Try again.';
  }
  if (normalised.includes('does not belong to this document')) {
    return 'That file does not belong to this document.';
  }
  if (normalised.includes('does not belong to this memory')) {
    return 'That file does not belong to this memory.';
  }
  if (normalised.includes('row-level security') || normalised.includes('permission denied')) {
    return 'You do not have permission to do that.';
  }
  if (normalised.includes('duplicate key')) {
    return 'That file is already attached.';
  }
  if (normalised.includes('network') || normalised.includes('fetch') || normalised.includes('timeout')) {
    return 'Cannot reach the server. Check your connection and try again.';
  }
  return message;
}

/**
 * How long a minted URL lasts.
 *
 * Long enough to open a file and read it; short enough that a URL which escapes
 * — copied from a log, left in a screenshot of a debugger — stops working
 * before it can be passed around. Nothing stores one, so nothing needs it to
 * outlive the screen that asked.
 */
export const SIGNED_URL_TTL_SECONDS = 300;

export type UploadProgress = (fraction: number) => void;

/**
 * One gateway shape for every record domain.
 *
 * The kind it was built with decides which RPCs and which table it talks to, so
 * nothing above this line mentions documents or memories.
 */
export interface StorageGateway {
  /** What this gateway was built for — callers read it, never mutate it. */
  readonly kind: RecordFileKind;
  allocatePath(recordId: string, extension: string): Promise<GatewayResult<string>>;
  uploadObject(input: {
    path: string;
    bytes: Uint8Array;
    mimeType: string;
    onProgress?: UploadProgress;
  }): Promise<{ error: { message: string } | null }>;
  attachFile(input: {
    recordId: string;
    path: string;
    mimeType: string;
    sizeBytes: number;
    originalFilename: string | null;
  }): Promise<GatewayResult<RecordFile>>;
  listFiles(recordId: string): Promise<GatewayResult<RecordFile[]>>;
  removeObject(path: string): Promise<{ error: { message: string } | null }>;
  detachFile(fileId: string): Promise<{ error: { message: string } | null }>;
  createSignedUrl(path: string, expiresInSeconds: number): Promise<GatewayResult<string>>;
}

export type AttachOutcome = { ok: true; file: RecordFile } | { ok: false; message: string };

/**
 * The whole upload, as one operation the screen can await.
 *
 * Three steps that must happen in this order, and the order is the design:
 *
 * 1. **Allocate.** The database returns a path. No client builds one
 *    (`docs/16` §9.1), so a bug in this file cannot produce a path in another
 *    family's prefix.
 * 2. **Upload.** The bytes go to that path. Storage policies check the caller
 *    authored the document, so a stolen path is not enough.
 * 3. **Attach.** The row is written *after* the object exists, and
 *    `attach_document_file` verifies that rather than trusting it.
 *
 * If step 3 fails the object is orphaned: quota spent, nothing readable, and
 * Phase 12's Storage Management is where that is swept. Reversing the order
 * would trade that for a row describing bytes that are not there, which is the
 * worse failure — the catalogue would be lying rather than merely wasteful.
 */
export async function uploadRecordFile(
  gateway: StorageGateway,
  recordId: string,
  candidate: UploadCandidate,
  readBytes: (uri: string) => Promise<Uint8Array>,
  onProgress?: UploadProgress,
): Promise<AttachOutcome> {
  const invalid = validateFile(candidate, gateway.kind.acceptedMimeTypes);
  if (invalid) return { ok: false, message: invalid.message };

  const extension = extensionFor(candidate.mimeType);
  if (!extension) {
    return { ok: false, message: 'That kind of file cannot be added yet.' };
  }

  const allocated = await gateway.allocatePath(recordId, extension);
  if (allocated.error || !allocated.data) {
    return {
      ok: false,
      message: describeStorageError(allocated.error?.message ?? 'Could not prepare the upload.'),
    };
  }
  const path = allocated.data;

  let bytes: Uint8Array;
  try {
    bytes = await readBytes(candidate.uri);
  } catch {
    return { ok: false, message: 'That file could not be read from your device.' };
  }

  const uploaded = await gateway.uploadObject({
    path,
    bytes,
    mimeType: candidate.mimeType,
    onProgress,
  });
  if (uploaded.error) {
    return { ok: false, message: describeStorageError(uploaded.error.message) };
  }

  const attached = await gateway.attachFile({
    recordId,
    path,
    mimeType: candidate.mimeType,
    sizeBytes: candidate.sizeBytes,
    originalFilename: candidate.originalFilename,
  });
  if (attached.error || !attached.data) {
    return {
      ok: false,
      message: describeStorageError(attached.error?.message ?? 'The file was not attached.'),
    };
  }

  return { ok: true, file: attached.data };
}

export async function listRecordFiles(
  gateway: StorageGateway,
  recordId: string,
): Promise<{ ok: true; files: RecordFile[] } | { ok: false; message: string }> {
  const { data, error } = await gateway.listFiles(recordId);
  if (error) return { ok: false, message: describeStorageError(error.message) };
  return { ok: true, files: data ?? [] };
}

/**
 * Remove a file: the bytes, then the row that describes them.
 *
 * **Both halves, and the first version did only one.** Removing the object left
 * the `document_files` row behind, so the file reappeared on the next read —
 * the remove button looked broken because it *was* half-done.
 *
 * The order matches upload's, reversed, and for the same reason. The bytes go
 * first through the storage API, which is what actually reclaims space; the row
 * follows. If the second step fails the object is gone and a row points at
 * nothing, which reads as a missing file rather than a phantom one — the same
 * direction of failure the upload path chose.
 *
 * A trigger backstops what this never sees: a whole family being deleted. That
 * removes rows only, so those bytes wait for Phase 12. Quota, not privacy — an
 * object whose document is gone is unreachable by anyone.
 */
export async function removeRecordFile(
  gateway: StorageGateway,
  file: RecordFile,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const removed = await gateway.removeObject(file.providerFileId);
  if (removed.error) return { ok: false, message: describeStorageError(removed.error.message) };

  const detached = await gateway.detachFile(file.id);
  if (detached.error) return { ok: false, message: describeStorageError(detached.error.message) };

  return { ok: true };
}

/**
 * A URL for a file, minted now and not kept.
 *
 * This is the accessor `docs/17` §10.1 asked for and every PR since has
 * deferred: *"never store a URL — store the identifier and mint on demand"*,
 * and *"signed-URL expiry must not reach the components."*
 *
 * Both rules are about the same leak. A URL in a row bakes the provider's
 * domain and its TTL into the data; a URL held in component state spreads a
 * Supabase concept — that links go stale — into screens that should only know
 * about files. Taking the row rather than a path is the other half: no caller
 * can hand this a path it constructed, because building paths is the database's
 * job (`allocate_document_file_path`).
 *
 * Authorisation is inherited, not re-implemented. `createSignedUrl` goes through
 * the storage SELECT policy, so only the document's author gets a URL at all.
 */
export async function fileUrl(
  gateway: StorageGateway,
  file: RecordFile,
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const { data, error } = await gateway.createSignedUrl(
    file.providerFileId,
    SIGNED_URL_TTL_SECONDS,
  );

  if (error) return { ok: false, message: describeStorageError(error.message) };
  if (!data) return { ok: false, message: 'That file is no longer available.' };

  return { ok: true, url: data };
}

/**
 * Get a file out of the vault and into the user's hands.
 *
 * FR-014 calls this "Download", which is a desktop-shaped word. On a phone
 * there is no folder the user thinks of as theirs — the honest equivalent is
 * the share sheet, which covers every reason somebody wants a document out:
 * saving to Files, sending it to a doctor, printing it, or opening it in a
 * reader that can display it.
 *
 * That last one is why PDFs use this path as their *primary* action rather than
 * a fallback. There is no in-app preview for them (see `isPreviewable`), so the
 * share sheet is how a PDF gets read at all.
 *
 * The download and the share are injected rather than imported so this stays
 * testable without a device — the same reason `uploadDocumentFile` takes
 * `readBytes`.
 */
export async function shareRecordFile(
  gateway: StorageGateway,
  file: RecordFile,
  download: (url: string, filename: string) => Promise<string>,
  share: (localUri: string, mimeType: string) => Promise<void>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const minted = await fileUrl(gateway, file);
  if (!minted.ok) return minted;

  let localUri: string;
  try {
    localUri = await download(minted.url, downloadFilenameFor(file));
  } catch {
    return { ok: false, message: 'That file could not be downloaded. Try again.' };
  }

  try {
    await share(localUri, file.mimeType);
  } catch {
    // The sheet failing is different from the download failing, and saying so
    // saves the user re-downloading something already on their device.
    return { ok: false, message: 'That file could not be opened. Try again.' };
  }

  return { ok: true };
}

/**
 * What the file is called once it leaves.
 *
 * The stored name is a uuid — deliberately, so no user input reaches a storage
 * path (`docs/15` §9.1). But a uuid in somebody's Downloads folder is useless,
 * so the *original* name comes back at the point it stops being a path and
 * starts being a filename again.
 *
 * Falls back to the document's kind plus the right extension, because "file"
 * with no extension is a file the receiving app will not know how to open.
 */
export function downloadFilenameFor(file: RecordFile, noun = 'document'): string {
  if (file.originalFilename) return file.originalFilename;
  const extension = extensionFor(file.mimeType) ?? 'bin';
  return `${noun}.${extension}`;
}

interface RecordFileRow {
  id: string;
  provider_file_id: string;
  kind: 'original' | 'thumbnail';
  mime_type: string;
  size_bytes: number;
  duration_seconds: number | null;
  original_filename: string | null;
  created_at: string;
  /** Whichever of `document_id` / `memory_id` this kind uses. */
  [parentColumn: string]: unknown;
}

function toRecordFile(row: RecordFileRow, parentColumn: string): RecordFile {
  return {
    id: row.id,
    recordId: String(row[parentColumn] ?? ''),
    providerFileId: row.provider_file_id,
    kind: row.kind,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    originalFilename: row.original_filename,
    createdAt: row.created_at,
  };
}

/** Built per kind, because the parent column is the only part that varies. */
function fileColumns(kind: RecordFileKind): string {
  return `id, ${kind.parentColumn}, provider_file_id, kind, mime_type, size_bytes, duration_seconds, original_filename, created_at`;
}

/**
 * Uploads through `XMLHttpRequest` rather than `supabase-js`.
 *
 * NFR-007 requires visible progress, and `supabase-js` exposes no progress
 * events on React Native — its `upload()` goes through `fetch`, which has no
 * upload-progress notion. `xhr.upload.onprogress` is the only real source of a
 * percentage, and a progress bar that moved on a timer would be a lie of
 * exactly the kind the landing page's honesty standard forbids.
 *
 * The cost is that this is the one place that knows the storage URL shape.
 * Contained deliberately: nothing outside this function builds a storage URL.
 */
export function createSupabaseStorageGateway(
  client: SupabaseClient,
  config: { url: string },
  kind: RecordFileKind = DOCUMENT_FILES,
): StorageGateway {
  return {
    kind,

    async allocatePath(recordId, extension) {
      const { data, error } = await client.rpc(kind.allocateRpc, {
        [kind.parentParam]: recordId,
        extension,
      });
      return { data: (data ?? null) as string | null, error };
    },

    async uploadObject({ path, bytes, mimeType, onProgress }) {
      const { data: session } = await client.auth.getSession();
      const token = session.session?.access_token;
      if (!token) return { error: { message: 'Not authenticated' } };

      return new Promise((resolve) => {
        const request = new XMLHttpRequest();
        request.open('POST', `${config.url}/storage/v1/object/${FILE_BUCKET}/${path}`);
        request.setRequestHeader('Authorization', `Bearer ${token}`);
        request.setRequestHeader('Content-Type', mimeType);
        // The bucket refuses an overwrite anyway; being explicit means a
        // colliding uuid fails loudly rather than silently replacing bytes.
        request.setRequestHeader('x-upsert', 'false');

        request.upload.onprogress = (event) => {
          if (event.lengthComputable && onProgress) {
            onProgress(event.loaded / event.total);
          }
        };

        request.onload = () => {
          if (request.status >= 200 && request.status < 300) {
            resolve({ error: null });
            return;
          }
          resolve({ error: { message: request.responseText || `Upload failed (${request.status})` } });
        };

        request.onerror = () => resolve({ error: { message: 'network error during upload' } });
        request.ontimeout = () => resolve({ error: { message: 'timeout during upload' } });

        // `bytes` is a Uint8Array from expo-file-system's File.bytes(). Sending
        // the underlying buffer avoids a copy on a device that may be handling
        // ten megabytes.
        request.send(bytes as unknown as XMLHttpRequestBodyInit);
      });
    },

    async attachFile({ recordId, path, mimeType, sizeBytes, originalFilename }) {
      const { data, error } = await client.rpc(kind.attachRpc, {
        [kind.parentParam]: recordId,
        object_path: path,
        file_mime_type: mimeType,
        file_size_bytes: sizeBytes,
        file_original_name: originalFilename,
      });

      const row = (data ?? null) as RecordFileRow | null;
      return { data: row ? toRecordFile(row, kind.parentColumn) : null, error };
    },

    async listFiles(recordId) {
      const { data, error } = await client
        .from(kind.filesTable)
        .select(fileColumns(kind))
        .eq(kind.parentColumn, recordId)
        .order('created_at', { ascending: true })
        .returns<RecordFileRow[]>();

      return { data: data ? data.map((row) => toRecordFile(row, kind.parentColumn)) : null, error };
    },

    async removeObject(path) {
      const { error } = await client.storage.from(FILE_BUCKET).remove([path]);
      return { error };
    },

    // A plain delete, unlike attach. There is no precondition beyond the policy
    // — see the migration's §5b on why DELETE is granted where INSERT is not.
    async createSignedUrl(path, expiresInSeconds) {
      const { data, error } = await client.storage
        .from(FILE_BUCKET)
        .createSignedUrl(path, expiresInSeconds);

      return { data: data?.signedUrl ?? null, error };
    },

    async detachFile(fileId) {
      const { error } = await client.from(kind.filesTable).delete().eq('id', fileId);
      return { error };
    },
  };
}
