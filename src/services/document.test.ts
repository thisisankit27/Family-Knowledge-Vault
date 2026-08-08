import {
  AI_PROCESSING_MODES,
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  DOCUMENT_CATEGORIES,
  DOCUMENT_VISIBILITIES,
  MAX_DOCUMENT_TITLE_LENGTH,
  countByCategory,
  createDocument,
  deleteDocument,
  describeDocumentError,
  describeDocumentSubject,
  filterByCategory,
  isDocumentCategory,
  listDocuments,
  partitionDocuments,
  setDocumentArchived,
  setDocumentCategory,
  validateDocumentTitle,
  type CreateDocumentInput,
  type DocumentCategory,
  type DocumentGateway,
  type FamilyDocument,
} from './document';

function document(overrides: Partial<FamilyDocument> = {}): FamilyDocument {
  return {
    id: 'doc-1',
    title: "Dad's Passport",
    category: 'identity',
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
      return { data: document({ title: input.title, category: input.category }), error: null };
    },
    async setCategory() {
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

    const result = await createDocument(gateway, { familyId: 'fam-1', title: '   ', category: 'identity' });

    expect(result).toEqual({ ok: false, message: 'Give this document a name.' });
    expect(createDocumentSpy).not.toHaveBeenCalled();
  });

  it('trims the title before storing it', async () => {
    let received: CreateDocumentInput | null = null;
    const gateway = fakeGateway({
      async createDocument(input) {
        received = input;
        return { data: document({ title: input.title, category: input.category }), error: null };
      },
    });

    await createDocument(gateway, { familyId: 'fam-1', title: "  Nani's Aadhaar  ", category: 'identity' });

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

    const result = await createDocument(gateway, { familyId: 'fam-1', title: 'Deed', category: 'property' });

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

    await createDocument(gateway, { familyId: 'fam-1', title: 'Deed', category: 'property' });

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

describe('categories', () => {
  it('is the six shelves the check constraint allows, in the IA order', () => {
    // Not alphabetical, and not arbitrary: this is the order the filter row
    // renders, taken from docs/06 §4. A seventh value is a migration, not a
    // convenience — which is the point of a check constraint over a table.
    expect(DOCUMENT_CATEGORIES).toEqual([
      'identity',
      'medical',
      'finance',
      'property',
      'education',
      'legal',
    ]);
  });

  it('never includes Archived, which is a different axis', () => {
    // IA §4 lists "Archived" beside the six. It is a timestamp on the row, and
    // making it a category would force a document to stop being Medical the
    // moment it was filed away.
    expect(DOCUMENT_CATEGORIES).not.toContain('archived');
  });

  it('has a label and a hint for every category', () => {
    for (const category of DOCUMENT_CATEGORIES) {
      expect(CATEGORY_LABELS[category]).toBeTruthy();
      expect(CATEGORY_HINTS[category]).toBeTruthy();
    }
  });

  it('accepts the six and rejects everything else', () => {
    for (const category of DOCUMENT_CATEGORIES) expect(isDocumentCategory(category)).toBe(true);
    expect(isDocumentCategory('archived')).toBe(false);
    expect(isDocumentCategory('Identity')).toBe(false);
    expect(isDocumentCategory(null)).toBe(false);
    expect(isDocumentCategory(3)).toBe(false);
  });
});

describe('createDocument and categories', () => {
  it('refuses a category outside the vocabulary without calling the gateway', async () => {
    const createDocumentSpy = jest.fn();
    const gateway = fakeGateway({ createDocument: createDocumentSpy });

    const result = await createDocument(gateway, {
      familyId: 'fam-1',
      title: 'Passport',
      category: 'archived' as DocumentCategory,
    });

    expect(result).toEqual({ ok: false, message: 'Choose where this belongs.' });
    expect(createDocumentSpy).not.toHaveBeenCalled();
  });

  it('passes the chosen category through', async () => {
    let received: DocumentCategory | null = null;
    const gateway = fakeGateway({
      async createDocument(input) {
        received = input.category;
        return { data: document({ category: input.category }), error: null };
      },
    });

    await createDocument(gateway, { familyId: 'fam-1', title: 'Deed', category: 'property' });

    expect(received).toBe('property');
  });

  it('checks the title before the category, so the first problem is the one reported', async () => {
    const result = await createDocument(fakeGateway(), {
      familyId: 'fam-1',
      title: '',
      category: 'nonsense' as DocumentCategory,
    });

    expect(result).toEqual({ ok: false, message: 'Give this document a name.' });
  });
});

describe('setDocumentCategory', () => {
  it('re-files a document', async () => {
    let received: DocumentCategory | null = null;
    const gateway = fakeGateway({
      async setCategory(_id, category) {
        received = category;
        return { error: null };
      },
    });

    expect(await setDocumentCategory(gateway, 'doc-1', 'legal')).toEqual({ ok: true });
    expect(received).toBe('legal');
  });

  it('refuses an unknown category without calling the gateway', async () => {
    const setCategorySpy = jest.fn();
    const gateway = fakeGateway({ setCategory: setCategorySpy });

    const result = await setDocumentCategory(gateway, 'doc-1', 'archived' as DocumentCategory);

    expect(result).toEqual({ ok: false, message: 'That is not a category.' });
    expect(setCategorySpy).not.toHaveBeenCalled();
  });

  it('translates a refusal', async () => {
    const gateway = fakeGateway({
      async setCategory() {
        return { error: { message: 'new row violates row-level security policy' } };
      },
    });

    expect(await setDocumentCategory(gateway, 'doc-1', 'legal')).toEqual({
      ok: false,
      message: 'You do not have permission to do that.',
    });
  });
});

describe('filterByCategory', () => {
  const passport = document({ id: 'a', category: 'identity' });
  const report = document({ id: 'b', category: 'medical' });
  const deed = document({ id: 'c', category: 'property' });

  it('returns everything when no category is chosen', () => {
    expect(filterByCategory([passport, report, deed], null)).toEqual([passport, report, deed]);
  });

  it('narrows to one shelf, preserving order', () => {
    expect(filterByCategory([passport, report, deed], 'medical')).toEqual([report]);
  });

  it('returns nothing for a shelf with nothing on it', () => {
    expect(filterByCategory([passport, report, deed], 'legal')).toEqual([]);
  });
});

describe('countByCategory', () => {
  it('counts every category, including the empty ones', () => {
    // Zero-filled so a filter row can render all six without the caller
    // guarding each lookup.
    const counts = countByCategory([document({ category: 'identity' })]);

    expect(counts.identity).toBe(1);
    expect(counts.legal).toBe(0);
    expect(Object.keys(counts).sort()).toEqual([...DOCUMENT_CATEGORIES].sort());
  });

  it('excludes archived documents', () => {
    // The count and the list it labels must be the same set. A row reading
    // "Medical 3" that filters to an empty list is a lie the user can see.
    const counts = countByCategory([
      document({ id: 'a', category: 'medical' }),
      document({ id: 'b', category: 'medical', archivedAt: '2026-08-01T00:00:00.000Z' }),
    ]);

    expect(counts.medical).toBe(1);
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
