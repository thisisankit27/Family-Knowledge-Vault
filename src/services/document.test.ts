import {
  AI_PROCESSING_MODES,
  DOCUMENT_VISIBILITIES,
  MAX_DOCUMENT_TITLE_LENGTH,
  createDocument,
  deleteDocument,
  describeDocumentError,
  describeDocumentSubject,
  listDocuments,
  partitionDocuments,
  setDocumentArchived,
  validateDocumentTitle,
  type CreateDocumentInput,
  type DocumentGateway,
  type FamilyDocument,
} from './document';

function document(overrides: Partial<FamilyDocument> = {}): FamilyDocument {
  return {
    id: 'doc-1',
    title: "Dad's Passport",
    memberId: 'p-dad',
    visibility: 'family',
    archivedAt: null,
    aiProcessing: 'denied',
    createdBy: 'u-ankit',
    createdAt: '2026-08-08T10:00:00.000Z',
    updatedAt: '2026-08-08T10:00:00.000Z',
    ...overrides,
  };
}

/** A gateway that records what it was asked and answers however the test says. */
function fakeGateway(overrides: Partial<DocumentGateway> = {}): DocumentGateway {
  return {
    async listDocuments() {
      return { data: [], error: null };
    },
    async createDocument(input) {
      return { data: document({ title: input.title }), error: null };
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

describe('validateDocumentTitle', () => {
  it('rejects an empty or whitespace-only title', () => {
    for (const raw of ['', '   ', '\n\t']) {
      expect(validateDocumentTitle(raw)).toEqual({ message: 'Give this document a name.' });
    }
  });

  it('accepts a title at exactly the limit and rejects one past it', () => {
    // The boundary is asserted rather than assumed: the check constraint uses
    // `between 1 and 120`, so an off-by-one here would surface as a Postgres
    // error the user cannot act on instead of a sentence they can.
    expect(validateDocumentTitle('a'.repeat(MAX_DOCUMENT_TITLE_LENGTH))).toBeNull();
    expect(validateDocumentTitle('a'.repeat(MAX_DOCUMENT_TITLE_LENGTH + 1))).not.toBeNull();
  });

  it('measures the trimmed title, matching what the database will store', () => {
    const padded = `  ${'a'.repeat(MAX_DOCUMENT_TITLE_LENGTH)}  `;
    expect(validateDocumentTitle(padded)).toBeNull();
  });
});

describe('describeDocumentError', () => {
  it.each([
    ['new row violates row-level security policy', 'You do not have permission to do that.'],
    ['permission denied for table documents', 'You do not have permission to do that.'],
    ['not authenticated', 'Your session has expired. Sign in again.'],
    ['violates check constraint "documents_title_check"', `Use between 1 and ${MAX_DOCUMENT_TITLE_LENGTH} characters.`],
    ['violates check constraint "documents_ai_processing_check"', 'That privacy setting is not recognised.'],
    ['violates check constraint "documents_visibility_check"', 'That visibility setting is not recognised.'],
    ['violates foreign key constraint "documents_member_id_family_id_fkey"', 'That person is no longer in this family.'],
    ['network request failed', 'Cannot reach the server. Check your connection and try again.'],
  ])('translates %s', (raw, expected) => {
    expect(describeDocumentError(raw)).toBe(expected);
  });

  it('never tells a Guest the shelf is empty when it is locked', () => {
    // A Guest passes has_family_access and fails can_read_records, so the
    // documents tab is reachable and returns nothing. Softening this into
    // "nothing filed yet" would be a false statement about the family's data.
    const message = describeDocumentError('new row violates row-level security policy');
    expect(message).toBe('You do not have permission to do that.');
    expect(message.toLowerCase()).not.toContain('empty');
    expect(message.toLowerCase()).not.toContain('nothing');
  });

  it('passes an unrecognised message through rather than inventing one', () => {
    expect(describeDocumentError('something nobody predicted')).toBe('something nobody predicted');
  });
});

describe('listDocuments', () => {
  it('reports a refused read as a failure, not as an empty shelf', async () => {
    const gateway = fakeGateway({
      async listDocuments() {
        return { data: null, error: { message: 'permission denied for table documents' } };
      },
    });

    const result = await listDocuments(gateway, 'fam-1');

    expect(result).toEqual({ ok: false, message: 'You do not have permission to do that.' });
  });

  it('treats a genuinely empty family as success', async () => {
    const result = await listDocuments(fakeGateway(), 'fam-1');
    expect(result).toEqual({ ok: true, documents: [] });
  });

  it('keeps archived documents in the list', async () => {
    // Filtering them here would make archive indistinguishable from delete for
    // every caller, and the two are deliberately different columns.
    const archived = document({ id: 'doc-2', archivedAt: '2026-08-08T11:00:00.000Z' });
    const gateway = fakeGateway({
      async listDocuments() {
        return { data: [document(), archived], error: null };
      },
    });

    const result = await listDocuments(gateway, 'fam-1');

    expect(result).toEqual({ ok: true, documents: [document(), archived] });
  });
});

describe('createDocument', () => {
  it('refuses an invalid title without calling the gateway', async () => {
    const createDocumentSpy = jest.fn();
    const gateway = fakeGateway({ createDocument: createDocumentSpy });

    const result = await createDocument(gateway, { familyId: 'fam-1', title: '   ' });

    expect(result).toEqual({ ok: false, message: 'Give this document a name.' });
    expect(createDocumentSpy).not.toHaveBeenCalled();
  });

  it('trims the title before storing it', async () => {
    let received: CreateDocumentInput | null = null;
    const gateway = fakeGateway({
      async createDocument(input) {
        received = input;
        return { data: document({ title: input.title }), error: null };
      },
    });

    await createDocument(gateway, { familyId: 'fam-1', title: "  Nani's Aadhaar  " });

    expect(received!.title).toBe("Nani's Aadhaar");
  });

  it('fails when the insert succeeds but the row cannot be read back', async () => {
    // The SELECT policy declined to return it. Reporting success would leave
    // the list empty and the user filing the same document a second time.
    const gateway = fakeGateway({
      async createDocument() {
        return { data: null, error: null };
      },
    });

    const result = await createDocument(gateway, { familyId: 'fam-1', title: 'Deed' });

    expect(result).toEqual({ ok: false, message: 'The document was not filed. Please try again.' });
  });

  it('defaults are decided by the database, not invented here', async () => {
    // The service passes undefined through; `documents` defaults visibility to
    // 'family' and ai_processing to 'denied'. Duplicating those defaults in
    // TypeScript is how the two drift apart.
    let received: CreateDocumentInput | null = null;
    const gateway = fakeGateway({
      async createDocument(input) {
        received = input;
        return { data: document(), error: null };
      },
    });

    await createDocument(gateway, { familyId: 'fam-1', title: 'Deed' });

    expect(received!.visibility).toBeUndefined();
    expect(received!.aiProcessing).toBeUndefined();
  });
});

describe('setDocumentArchived', () => {
  it.each([
    [true, 'archives'],
    [false, 'restores'],
  ])('%s in both directions', async (archived) => {
    let received: boolean | null = null;
    const gateway = fakeGateway({
      async archiveDocument(_id, value) {
        received = value;
        return { error: null };
      },
    });

    const result = await setDocumentArchived(gateway, 'doc-1', archived);

    expect(result).toEqual({ ok: true });
    expect(received).toBe(archived);
  });

  it('translates a refusal', async () => {
    const gateway = fakeGateway({
      async archiveDocument() {
        return { error: { message: 'new row violates row-level security policy' } };
      },
    });

    const result = await setDocumentArchived(gateway, 'doc-1', true);

    expect(result).toEqual({ ok: false, message: 'You do not have permission to do that.' });
  });
});

describe('deleteDocument', () => {
  it('translates a refusal rather than reporting success', async () => {
    // RLS makes a delete that matches no visible row succeed with zero rows
    // affected, so "no error" is not proof. What this asserts is narrower: an
    // error that *is* raised must reach the user in their own language.
    const gateway = fakeGateway({
      async deleteDocument() {
        return { error: { message: 'permission denied for table documents' } };
      },
    });

    const result = await deleteDocument(gateway, 'doc-1');

    expect(result).toEqual({ ok: false, message: 'You do not have permission to do that.' });
  });
});

describe('partitionDocuments', () => {
  it('splits on archived_at and preserves order within each group', () => {
    const first = document({ id: 'a' });
    const old = document({ id: 'b', archivedAt: '2026-08-01T00:00:00.000Z' });
    const second = document({ id: 'c' });

    expect(partitionDocuments([first, old, second])).toEqual({
      active: [first, second],
      archived: [old],
    });
  });

  it('handles an empty list', () => {
    expect(partitionDocuments([])).toEqual({ active: [], archived: [] });
  });
});

describe('describeDocumentSubject', () => {
  const people = new Map([['p-dad', 'Dad']]);

  it('names the person a document is about', () => {
    expect(describeDocumentSubject(document(), people)).toBe('Dad');
  });

  it('says the household when there is no subject', () => {
    expect(describeDocumentSubject(document({ memberId: null }), people)).toBe('The whole family');
  });

  it('degrades gracefully when the subject is not in the supplied list', () => {
    // A Guest reads documents but may not be handed the full member list, and
    // a person can be removed between two reads. Neither is an error worth
    // showing, and neither may render as "undefined".
    const described = describeDocumentSubject(document({ memberId: 'p-ghost' }), people);
    expect(described).toBe('Someone in this family');
  });
});

describe('the vocabularies mirror the database', () => {
  it.each([...AI_PROCESSING_MODES])('ai_processing accepts %s', (mode) => {
    expect(['allowed', 'denied']).toContain(mode);
  });

  it.each([...DOCUMENT_VISIBILITIES])('visibility accepts %s', (value) => {
    expect(['family', 'private']).toContain(value);
  });

  it('defaults AI processing to denied, because consent never given is not consent', () => {
    expect(AI_PROCESSING_MODES[1]).toBe('denied');
  });
});
