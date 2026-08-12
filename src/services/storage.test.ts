import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_BYTES,
  describeStorageError,
  extensionFor,
  formatBytes,
  isAllowedMimeType,
  listDocumentFiles,
  removeDocumentFile,
  uploadDocumentFile,
  validateFile,
  type DocumentFile,
  type StorageGateway,
  type UploadCandidate,
} from './storage';

function documentFile(overrides: Partial<DocumentFile> = {}): DocumentFile {
  return {
    id: 'file-1',
    documentId: 'doc-1',
    providerFileId: 'fam-1/doc-1/abc.jpg',
    kind: 'original',
    mimeType: 'image/jpeg',
    sizeBytes: 2_400_000,
    originalFilename: 'passport.jpg',
    createdAt: '2026-08-11T10:00:00.000Z',
    ...overrides,
  };
}

function candidate(overrides: Partial<UploadCandidate> = {}): UploadCandidate {
  return {
    uri: 'file:///tmp/passport.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 2_400_000,
    originalFilename: 'passport.jpg',
    ...overrides,
  };
}

function fakeGateway(overrides: Partial<StorageGateway> = {}): StorageGateway {
  return {
    async allocatePath() {
      return { data: 'fam-1/doc-1/abc.jpg', error: null };
    },
    async uploadObject() {
      return { error: null };
    },
    async attachFile() {
      return { data: documentFile(), error: null };
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
    ...overrides,
  };
}

const readBytes = async () => new Uint8Array([1, 2, 3]);

describe('the allow-list mirrors the bucket', () => {
  it('is the five types the migration configured', () => {
    expect(ALLOWED_MIME_TYPES).toEqual([
      'image/jpeg',
      'image/png',
      'image/heic',
      'image/webp',
      'application/pdf',
    ]);
  });

  it('has an extension for every allowed type', () => {
    for (const mime of ALLOWED_MIME_TYPES) {
      expect(extensionFor(mime)).toBeTruthy();
    }
  });

  it('refuses anything else', () => {
    // The interesting ones are plausible rather than absurd: a phone will offer
    // all three, and Phase 4 is where audio and video become allowed.
    for (const mime of ['image/gif', 'video/mp4', 'audio/m4a', 'text/plain', 'application/zip']) {
      expect(isAllowedMimeType(mime)).toBe(false);
      expect(extensionFor(mime)).toBeNull();
    }
  });

  it('never takes the extension from a filename', () => {
    // The path contract puts a uuid in the final segment so no user input
    // reaches the path. Deriving the extension from `report.pdf.exe` would put
    // it straight back.
    expect(extensionFor('application/pdf')).toBe('pdf');
    expect(extensionFor('application/x-msdownload')).toBeNull();
  });
});

describe('validateFile', () => {
  it('accepts a file at exactly the cap and refuses one byte more', () => {
    expect(validateFile({ mimeType: 'image/jpeg', sizeBytes: MAX_FILE_BYTES })).toBeNull();
    expect(validateFile({ mimeType: 'image/jpeg', sizeBytes: MAX_FILE_BYTES + 1 })).not.toBeNull();
  });

  it('tells the user both numbers when a file is too large', () => {
    // "Too large" without saying how large, or what the limit is, sends someone
    // back to guess.
    const result = validateFile({ mimeType: 'image/jpeg', sizeBytes: 40 * 1024 * 1024 });
    expect(result!.message).toContain('10.0 MB');
    expect(result!.message).toContain('40.0 MB');
  });

  it('refuses an empty file', () => {
    expect(validateFile({ mimeType: 'image/jpeg', sizeBytes: 0 })).toEqual({
      message: 'That file is empty.',
    });
  });

  it('refuses a disallowed type before it looks at size', () => {
    const result = validateFile({ mimeType: 'video/mp4', sizeBytes: 1 });
    expect(result!.message).toContain('photo or a PDF');
  });
});

describe('formatBytes', () => {
  it.each([
    [512, '512 B'],
    [2048, '2 KB'],
    [2_400_000, '2.3 MB'],
    [10 * 1024 * 1024, '10.0 MB'],
  ])('renders %i as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('describeStorageError', () => {
  it.each([
    ['Payload too large', 'too large'],
    ['413 Request Entity Too Large', 'too large'],
    ['mime type video/mp4 is not supported', 'photo or a PDF'],
    ['Document not found', 'no longer available'],
    ['No file was uploaded', 'did not finish'],
    ['That file does not belong to this document', 'does not belong'],
    ['new row violates row-level security policy', 'permission'],
    ['duplicate key value violates unique constraint', 'already attached'],
    ['network request failed', 'Cannot reach the server'],
  ])('translates %s', (raw, expected) => {
    expect(describeStorageError(raw)).toContain(expected);
  });

  it('passes an unrecognised message through rather than inventing one', () => {
    expect(describeStorageError('something nobody predicted')).toBe('something nobody predicted');
  });
});

describe('uploadDocumentFile', () => {
  it('refuses an invalid file without touching the gateway', async () => {
    const allocatePath = jest.fn();
    const gateway = fakeGateway({ allocatePath });

    const result = await uploadDocumentFile(
      gateway,
      'doc-1',
      candidate({ mimeType: 'video/mp4' }),
      readBytes,
    );

    expect(result.ok).toBe(false);
    expect(allocatePath).not.toHaveBeenCalled();
  });

  it('allocates, uploads, then attaches — in that order', async () => {
    // The order is the design: the row is written after the object exists, so
    // the catalogue cannot describe bytes that are not there.
    const calls: string[] = [];
    const gateway = fakeGateway({
      async allocatePath() {
        calls.push('allocate');
        return { data: 'fam-1/doc-1/abc.jpg', error: null };
      },
      async uploadObject() {
        calls.push('upload');
        return { error: null };
      },
      async attachFile() {
        calls.push('attach');
        return { data: documentFile(), error: null };
      },
    });

    const result = await uploadDocumentFile(gateway, 'doc-1', candidate(), readBytes);

    expect(result).toEqual({ ok: true, file: documentFile() });
    expect(calls).toEqual(['allocate', 'upload', 'attach']);
  });

  it('never builds a path itself — it uploads to whatever the database returned', async () => {
    let uploadedTo: string | null = null;
    const gateway = fakeGateway({
      async allocatePath() {
        return { data: 'fam-9/doc-9/server-chose-this.pdf', error: null };
      },
      async uploadObject({ path }) {
        uploadedTo = path;
        return { error: null };
      },
    });

    await uploadDocumentFile(gateway, 'doc-1', candidate({ mimeType: 'application/pdf' }), readBytes);

    expect(uploadedTo).toBe('fam-9/doc-9/server-chose-this.pdf');
  });

  it('stops before uploading when allocation is refused', async () => {
    const uploadObject = jest.fn();
    const gateway = fakeGateway({
      async allocatePath() {
        return { data: null, error: { message: 'Document not found' } };
      },
      uploadObject,
    });

    const result = await uploadDocumentFile(gateway, 'doc-1', candidate(), readBytes);

    expect(result).toEqual({ ok: false, message: 'That document is no longer available.' });
    expect(uploadObject).not.toHaveBeenCalled();
  });

  it('reports a readable message when the device cannot read the file', async () => {
    const failing = async () => {
      throw new Error('ENOENT');
    };

    const result = await uploadDocumentFile(fakeGateway(), 'doc-1', candidate(), failing);

    expect(result).toEqual({ ok: false, message: 'That file could not be read from your device.' });
  });

  it('does not attach when the upload failed', async () => {
    const attachFile = jest.fn();
    const gateway = fakeGateway({
      async uploadObject() {
        return { error: { message: 'Payload too large' } };
      },
      attachFile,
    });

    const result = await uploadDocumentFile(gateway, 'doc-1', candidate(), readBytes);

    expect(result.ok).toBe(false);
    expect(attachFile).not.toHaveBeenCalled();
  });

  it('reports a failed attach, leaving an orphaned object', async () => {
    // The acknowledged failure mode: quota spent, nothing readable. Preferred
    // to the reverse, where a row would describe bytes that do not exist.
    const gateway = fakeGateway({
      async attachFile() {
        return { data: null, error: { message: 'No file was uploaded' } };
      },
    });

    const result = await uploadDocumentFile(gateway, 'doc-1', candidate(), readBytes);

    expect(result).toEqual({ ok: false, message: 'The upload did not finish. Try again.' });
  });

  it('passes progress through untouched', async () => {
    const seen: number[] = [];
    const gateway = fakeGateway({
      async uploadObject({ onProgress }) {
        onProgress?.(0.25);
        onProgress?.(1);
        return { error: null };
      },
    });

    await uploadDocumentFile(gateway, 'doc-1', candidate(), readBytes, (f) => seen.push(f));

    expect(seen).toEqual([0.25, 1]);
  });
});

describe('listDocumentFiles', () => {
  it('reports a refusal rather than an empty list', async () => {
    const gateway = fakeGateway({
      async listFiles() {
        return { data: null, error: { message: 'permission denied for table document_files' } };
      },
    });

    expect(await listDocumentFiles(gateway, 'doc-1')).toEqual({
      ok: false,
      message: 'You do not have permission to do that.',
    });
  });

  it('treats a document with no files as success', async () => {
    expect(await listDocumentFiles(fakeGateway(), 'doc-1')).toEqual({ ok: true, files: [] });
  });
});

describe('removeDocumentFile', () => {
  it('removes by the stored identifier, never by a reconstructed path', async () => {
    let removed: string | null = null;
    const gateway = fakeGateway({
      async removeObject(path) {
        removed = path;
        return { error: null };
      },
    });

    await removeDocumentFile(gateway, documentFile());

    expect(removed).toBe('fam-1/doc-1/abc.jpg');
  });

  it('removes the bytes AND the row', async () => {
    // The bug this test exists for: the first version removed the object and
    // left the row, so the file reappeared on the next read and the button
    // looked broken. Found on a device — the 21 storage tests asserted the
    // object was gone and never re-listed the rows.
    const calls: string[] = [];
    const gateway = fakeGateway({
      async removeObject() {
        calls.push('object');
        return { error: null };
      },
      async detachFile() {
        calls.push('row');
        return { error: null };
      },
    });

    expect(await removeDocumentFile(gateway, documentFile())).toEqual({ ok: true });
    expect(calls).toEqual(['object', 'row']);
  });

  it('detaches by row id, not by path', async () => {
    let detached: string | null = null;
    const gateway = fakeGateway({
      async detachFile(fileId) {
        detached = fileId;
        return { error: null };
      },
    });

    await removeDocumentFile(gateway, documentFile());

    expect(detached).toBe('file-1');
  });

  it('does not detach the row when the object could not be removed', async () => {
    // Leaving a row that points at bytes still present is recoverable; deleting
    // the row first would strand the object with nothing naming it.
    const detachFile = jest.fn();
    const gateway = fakeGateway({
      async removeObject() {
        return { error: { message: 'network request failed' } };
      },
      detachFile,
    });

    const result = await removeDocumentFile(gateway, documentFile());

    expect(result.ok).toBe(false);
    expect(detachFile).not.toHaveBeenCalled();
  });

  it('translates a refusal', async () => {
    const gateway = fakeGateway({
      async removeObject() {
        return { error: { message: 'new row violates row-level security policy' } };
      },
    });

    expect(await removeDocumentFile(gateway, documentFile())).toEqual({
      ok: false,
      message: 'You do not have permission to do that.',
    });
  });
});
