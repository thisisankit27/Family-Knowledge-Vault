import {
  describeAttachmentFailures,
  describeFilingResult,
  fileDocument,
  type FilingProgress,
} from './filing';
import type { CreateDocumentInput, DocumentGateway, FamilyDocument } from './document';
import type { StorageGateway, UploadCandidate } from './storage';

function document(overrides: Partial<FamilyDocument> = {}): FamilyDocument {
  return {
    id: 'doc-1',
    title: "Dad's Passport",
    category: 'identity',
    memberId: null,
    visibility: 'private',
    archivedAt: null,
    aiProcessing: 'denied',
    createdBy: 'u-ankit',
    createdAt: '2026-08-13T10:00:00.000Z',
    updatedAt: '2026-08-13T10:00:00.000Z',
    ...overrides,
  };
}

function candidate(overrides: Partial<UploadCandidate> = {}): UploadCandidate {
  return {
    uri: 'file:///tmp/front.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 1024,
    originalFilename: 'front.jpg',
    ...overrides,
  };
}

function documents(overrides: Partial<DocumentGateway> = {}): DocumentGateway {
  return {
    async listDocuments() {
      return { data: [], error: null };
    },
    async createDocument(input: CreateDocumentInput) {
      return {
        data: document({ title: input.title, category: input.category }),
        error: null,
      };
    },
    async getDocument() {
      return { data: document(), error: null };
    },
    async setCategory() {
      return { error: null };
    },
    async setTitle() {
      return { error: null };
    },
    async setMember() {
      return { error: null };
    },
    async setAiProcessing() {
      return { error: null };
    },
    async setVisibility() {
      return { error: null };
    },
    async archiveDocument() {
      return { error: null };
    },
    async deleteDocument() {
      return { error: null };
    },
    ...overrides,
  };
}

/** Enough of a storage gateway for the happy path; tests override what they break. */
function storage(overrides: Partial<StorageGateway> = {}): StorageGateway {
  let allocated = 0;
  return {
    async allocatePath(documentId) {
      allocated += 1;
      return { data: `fam-1/${documentId}/object-${allocated}.jpg`, error: null };
    },
    async uploadObject({ onProgress }) {
      onProgress?.(0.5);
      onProgress?.(1);
      return { error: null };
    },
    async attachFile() {
      return {
        data: {
          id: `file-${allocated}`,
          documentId: 'doc-1',
          providerFileId: `fam-1/doc-1/object-${allocated}.jpg`,
          kind: 'original' as const,
          mimeType: 'image/jpeg',
          sizeBytes: 1024,
          originalFilename: 'front.jpg',
          createdAt: '2026-08-13T10:00:00.000Z',
        },
        error: null,
      };
    },
    async listFiles() {
      return { data: [], error: null };
    },
    async removeObject() {
      return { error: null };
    },
    async detachFile() {
      return { error: null };
    },
    async createSignedUrl() {
      return { data: 'https://example.test/signed', error: null };
    },
    ...overrides,
  };
}

const readBytes = async () => Uint8Array.from([1, 2, 3]);

const INPUT: CreateDocumentInput = {
  familyId: 'fam-1',
  title: "Dad's Passport",
  category: 'identity',
};

describe('fileDocument', () => {
  it('files a document with no attachments at all', async () => {
    // A record can exist before its scan does — a passport you know the number
    // of but have not photographed is still worth recording.
    const outcome = await fileDocument({ documents: documents(), storage: storage() }, INPUT, [], readBytes);

    expect(outcome).toEqual({ ok: true, document: document(), attached: 0, failed: [] });
  });

  it('creates the record before touching storage, because the path needs its id', async () => {
    const order: string[] = [];
    const outcome = await fileDocument(
      {
        documents: documents({
          async createDocument() {
            order.push('create');
            return { data: document(), error: null };
          },
        }),
        storage: storage({
          async allocatePath(documentId) {
            order.push(`allocate:${documentId}`);
            return { data: `fam-1/${documentId}/o.jpg`, error: null };
          },
        }),
      },
      INPUT,
      [candidate()],
      readBytes,
    );

    expect(outcome.ok).toBe(true);
    expect(order).toEqual(['create', 'allocate:doc-1']);
  });

  it('uploads nothing when the record could not be created', async () => {
    // Not merely "returns an error": the whole point of creating first is that a
    // failure there costs no bytes and no quota.
    const allocatePath = jest.fn(async () => ({ data: null, error: null }));
    const outcome = await fileDocument(
      {
        documents: documents({
          async createDocument() {
            return { data: null, error: { message: 'new row violates row-level security policy' } };
          },
        }),
        storage: storage({ allocatePath }),
      },
      INPUT,
      [candidate(), candidate()],
      readBytes,
    );

    expect(outcome).toEqual({ ok: false, message: 'You do not have permission to do that.' });
    expect(allocatePath).not.toHaveBeenCalled();
  });

  it('attaches several files to one document', async () => {
    // A passport is one document with two pages. PR-14a replaced
    // `unique (document_id, kind, version)` precisely so the second page does
    // not have to claim it superseded the first.
    const outcome = await fileDocument(
      { documents: documents(), storage: storage() },
      INPUT,
      [candidate({ originalFilename: 'front.jpg' }), candidate({ originalFilename: 'back.jpg' })],
      readBytes,
    );

    expect(outcome.ok && outcome.attached).toBe(2);
    expect(outcome.ok && outcome.failed).toEqual([]);
  });

  it('keeps the document and the files that worked when one upload fails', async () => {
    // **The decision this function exists to encode.** No rollback: deleting the
    // document would discard the title, category, subject and consent somebody
    // just typed in order to tidy away the half that is one tap to retry.
    let call = 0;
    const deleteDocument = jest.fn(async () => ({ error: null }));
    const outcome = await fileDocument(
      {
        documents: documents({ deleteDocument }),
        storage: storage({
          async uploadObject() {
            call += 1;
            return call === 2 ? { error: { message: 'network request failed' } } : { error: null };
          },
        }),
      },
      INPUT,
      [
        candidate({ originalFilename: 'front.jpg' }),
        candidate({ originalFilename: 'back.jpg' }),
        candidate({ originalFilename: 'stamp.jpg' }),
      ],
      readBytes,
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.attached).toBe(2);
    expect(outcome.ok && outcome.failed).toEqual([
      {
        originalFilename: 'back.jpg',
        message: 'Cannot reach the server. Check your connection and try again.',
      },
    ]);
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it('keeps going after a failure rather than abandoning the rest', async () => {
    // One unreadable photo out of three should not cost the other two.
    let call = 0;
    const outcome = await fileDocument(
      {
        documents: documents(),
        storage: storage({
          async uploadObject() {
            call += 1;
            return call === 1 ? { error: { message: 'network' } } : { error: null };
          },
        }),
      },
      INPUT,
      [candidate(), candidate(), candidate()],
      readBytes,
    );

    expect(outcome.ok && outcome.attached).toBe(2);
    expect(outcome.ok && outcome.failed).toHaveLength(1);
  });

  it('reports which file is uploading, not just how far along it is', async () => {
    // A single bar restarting three times reads as a failure loop. The index and
    // the total are what make it read as three uploads.
    const seen: FilingProgress[] = [];
    await fileDocument(
      { documents: documents(), storage: storage() },
      INPUT,
      [candidate(), candidate()],
      readBytes,
      (progress) => seen.push(progress),
    );

    expect(seen).toEqual([
      { index: 1, total: 2, fraction: 0.5 },
      { index: 1, total: 2, fraction: 1 },
      { index: 2, total: 2, fraction: 0.5 },
      { index: 2, total: 2, fraction: 1 },
    ]);
  });

  it('passes every setting through, so filing configures the document', async () => {
    // The whole point of PR-15b: these are not create-only or edit-only
    // settings, and none of them may be silently dropped on the way in.
    let received: CreateDocumentInput | null = null;
    await fileDocument(
      {
        documents: documents({
          async createDocument(input) {
            received = input;
            return { data: document(), error: null };
          },
        }),
        storage: storage(),
      },
      {
        familyId: 'fam-1',
        title: 'Therapy notes',
        category: 'medical',
        memberId: 'p-teen',
        visibility: 'private',
        aiProcessing: 'denied',
      },
      [],
      readBytes,
    );

    expect(received).toEqual({
      familyId: 'fam-1',
      title: 'Therapy notes',
      category: 'medical',
      memberId: 'p-teen',
      visibility: 'private',
      aiProcessing: 'denied',
    });
  });

  it('refuses a visibility the resolver would not recognise, before writing anything', async () => {
    // `can_see_record` fails closed on an unknown value, so this would file a
    // document and hide it from its own author.
    const createDocument = jest.fn(async () => ({ data: document(), error: null }));
    const outcome = await fileDocument(
      { documents: documents({ createDocument }), storage: storage() },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...INPUT, visibility: 'everyone' as any },
      [candidate()],
      readBytes,
    );

    expect(outcome).toEqual({
      ok: false,
      message: 'That visibility setting is not recognised.',
    });
    expect(createDocument).not.toHaveBeenCalled();
  });
});

describe('describeAttachmentFailures', () => {
  it('says nothing when everything landed', () => {
    expect(describeAttachmentFailures({ attached: 2, failed: [] })).toBeNull();
  });

  it('names the file, because "one file failed" is useless when three were chosen', () => {
    const message = describeAttachmentFailures({
      attached: 2,
      failed: [{ originalFilename: 'back.jpg', message: 'network' }],
    });

    expect(message).toContain('back.jpg');
    expect(message).toContain('2 of 3');
  });

  it('names every file when it can', () => {
    const message = describeAttachmentFailures({
      attached: 1,
      failed: [
        { originalFilename: 'back.jpg', message: 'network' },
        { originalFilename: 'stamp.jpg', message: 'network' },
      ],
    });

    expect(message).toContain('back.jpg, stamp.jpg');
  });

  it('falls back to a count rather than a partial list', () => {
    // A list naming one of two files reads as though only one failed.
    const message = describeAttachmentFailures({
      attached: 0,
      failed: [
        { originalFilename: 'back.jpg', message: 'network' },
        { originalFilename: null, message: 'network' },
      ],
    });

    expect(message).toContain('2 files');
    expect(message).not.toContain('back.jpg');
  });

  it('does not mention the document, because the reader is already on it', () => {
    // This is the half both screens share. The filing form adds the rest.
    const message = describeAttachmentFailures({
      attached: 0,
      failed: [{ originalFilename: null, message: 'network' }],
    });

    expect(message).not.toMatch(/from the document/i);
  });
});

describe('describeFilingResult', () => {
  it('says nothing when everything landed', () => {
    expect(describeFilingResult({ attached: 2, failed: [] })).toBeNull();
  });

  it('confirms the document was filed, since that is the button they pressed', () => {
    const message = describeFilingResult({
      attached: 0,
      failed: [{ originalFilename: 'back.jpg', message: 'network' }],
    });

    expect(message).toContain('The document was filed');
  });

  it('points at where the retry is, unlike the shared half', () => {
    const outcome = { attached: 0, failed: [{ originalFilename: null, message: 'network' }] };

    expect(describeFilingResult(outcome)).toContain('add them from the document');
    expect(describeAttachmentFailures(outcome)).not.toContain('add them from the document');
  });

  it('builds on the shared sentence rather than restating it', () => {
    // If these two ever describe the same failure differently, the two screens
    // have drifted again — which is the thing this PR exists to stop.
    const outcome = {
      attached: 1,
      failed: [{ originalFilename: 'back.jpg', message: 'network' }],
    };

    expect(describeFilingResult(outcome)).toContain(describeAttachmentFailures(outcome)!);
  });
});
