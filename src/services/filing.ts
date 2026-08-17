/**
 * Filing a document and its files as one act.
 *
 * This is the only orchestration module in the project, and it exists because
 * one user-facing operation genuinely spans two services. `document.ts` owns the
 * record and `storage.ts` owns the bytes; neither should learn about the other,
 * and a screen sequencing them by hand would put the failure semantics below
 * inside a component where no test can reach them.
 *
 * ---
 *
 * **It cannot be one transaction, and pretending otherwise would be the mistake.**
 *
 * The storage path is `<family_id>/<document_id>/<uuid>.<ext>`, and both
 * `allocate_document_file_path` and `attach_document_file` resolve that document
 * id before doing anything. So the row must exist before a single byte can move.
 * That is PR-14a's deliberate two-phase write — the reason `attach_document_file`
 * can *verify* the object exists rather than trust that it does — and it reaches
 * the UI here.
 *
 * What the product asks for is one coherent *operation*, which is a weaker and
 * achievable thing: one form, one button, one report at the end.
 *
 * ---
 *
 * **No rollback, and this is a decision rather than an omission.**
 *
 * If the document is created and the second of three uploads fails, the document
 * stays, with the files that succeeded, and the caller is told which one did not.
 * Deleting the document to "undo" would throw away the title, category, subject
 * and consent the person just typed — the half that took thought — in order to
 * tidy away the half that is one tap to retry. The detail screen is already the
 * place to retry, and it is where the caller is expected to land.
 *
 * The reverse order was also available: upload first, create the row after. It is
 * impossible here (the path needs the id) and would be wrong anyway — PR-14a
 * settled that a row describing bytes that are not there is worse than bytes with
 * no row, because a catalogue that lies is worse than one that wastes.
 */

import {
  createDocument,
  type CreateDocumentInput,
  type DocumentGateway,
  type FamilyDocument,
} from './document';
import {
  uploadRecordFile,
  type StorageGateway,
  type UploadCandidate,
} from './storage';

/** One attachment that did not make it, named so the message can say which. */
export interface FailedAttachment {
  originalFilename: string | null;
  message: string;
}

export type FilingOutcome =
  /** The document was not created. Nothing was uploaded; the form should stay put. */
  | { ok: false; message: string }
  /**
   * The document exists. `failed` may still be non-empty — that is the partial
   * case, and it is deliberately not an error: the record is real, and so are the
   * attachments that succeeded.
   */
  | { ok: true; document: FamilyDocument; attached: number; failed: FailedAttachment[] };

/**
 * How far along a multi-file upload is.
 *
 * `index` is 1-based and `total` is the number of candidates, so a caller can say
 * "2 of 3" without counting for itself. `fraction` is the real byte progress of
 * the current file, from `XMLHttpRequest` events — never a timer, because
 * `ProgressBar`'s own comment forbids the alternative: a bar animated on a timer
 * would look identical and mean nothing.
 */
export interface FilingProgress {
  index: number;
  total: number;
  fraction: number;
}

export async function fileDocument(
  gateways: { documents: DocumentGateway; storage: StorageGateway },
  input: CreateDocumentInput,
  candidates: UploadCandidate[],
  readBytes: (uri: string) => Promise<Uint8Array>,
  onProgress?: (progress: FilingProgress) => void,
): Promise<FilingOutcome> {
  // The record first, always. Everything below needs its id.
  const created = await createDocument(gateways.documents, input);
  if (!created.ok) return { ok: false, message: created.message };

  const document = created.document;
  const failed: FailedAttachment[] = [];
  let attached = 0;

  // Sequential rather than parallel, and not for simplicity. Progress for a
  // parallel batch is either a lie or a sum nobody can act on, and the free tier
  // this project is built against does not reward hammering storage with
  // concurrent uploads from a phone.
  for (const [position, candidate] of candidates.entries()) {
    const result = await uploadRecordFile(
      gateways.storage,
      document.id,
      candidate,
      readBytes,
      (fraction) =>
        onProgress?.({ index: position + 1, total: candidates.length, fraction }),
    );

    if (result.ok) {
      attached += 1;
    } else {
      // Collected rather than thrown. One unreadable photo out of three should
      // not discard the two that worked, and it certainly should not discard the
      // document.
      failed.push({ originalFilename: candidate.originalFilename, message: result.message });
    }
  }

  return { ok: true, document, attached, failed };
}

/**
 * What to tell somebody when part of a filing did not land.
 *
 * Returns `null` when there is nothing to say, so a caller can use it directly as
 * the condition for showing anything at all.
 *
 * Names the file when it can. "One file could not be attached" is true and
 * useless when three were chosen; the person needs to know which one to try
 * again, and a filename is the only handle they have on it.
 */
export function describeAttachmentFailures(outcome: {
  attached: number;
  failed: FailedAttachment[];
}): string | null {
  if (outcome.failed.length === 0) return null;

  const named = outcome.failed
    .map((failure) => failure.originalFilename)
    .filter((name): name is string => Boolean(name));

  const subject =
    outcome.failed.length === 1
      ? (named[0] ?? 'One file')
      : named.length === outcome.failed.length
        ? named.join(', ')
        : `${outcome.failed.length} files`;

  const verb = outcome.failed.length === 1 ? 'was not attached' : 'were not attached';

  const kept =
    outcome.attached > 0
      ? `${outcome.attached} of ${outcome.attached + outcome.failed.length} went up.`
      : null;

  return [`${subject} ${verb}.`, kept].filter(Boolean).join(' ');
}

/**
 * The same sentence, for somebody who is about to leave the filing form.
 *
 * Adds the two things that only matter at that moment: that the *document* was
 * filed even though a file was not, and where to go to try again. Both are noise
 * on the document screen, where the answer to each is already on the display.
 */
export function describeFilingResult(outcome: {
  attached: number;
  failed: FailedAttachment[];
}): string | null {
  const failures = describeAttachmentFailures(outcome);
  if (!failures) return null;

  // The document is always mentioned, because the person just pressed a button
  // labelled "File it" and needs to know that part worked before they decide
  // what to do about the rest.
  return `${failures} The document was filed. You can add them from the document.`;
}
