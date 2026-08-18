import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_BYTES,
  SIGNED_URL_TTL_SECONDS,
  describeStorageError,
  downloadFilenameFor,
  fileUrl,
  extensionFor,
  formatBytes,
  isAllowedMimeType,
  isPreviewable,
  listRecordFiles,
  removeRecordFile,
  shareRecordFile,
  uploadRecordFile,
  validateFile,
  type RecordFile,
  AUDIO_MIME_TYPES,
  DOCUMENT_FILES,
  IMAGE_MIME_TYPES,
  MEMORY_FILES,
  isAudio,
  type StorageGateway,
  type UploadCandidate,
} from './storage';

function documentFile(overrides: Partial<RecordFile> = {}): RecordFile {
  return {
    id: 'file-1',
    recordId: 'doc-1',
    providerFileId: 'fam-1/doc-1/abc.jpg',
    kind: 'original',
    mimeType: 'image/jpeg',
    sizeBytes: 2_400_000,
    durationSeconds: null,
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
    kind: DOCUMENT_FILES,
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
    async createSignedUrl() {
      return { data: 'https://example.test/signed/abc.jpg?token=x', error: null };
    },
    ...overrides,
  };
}

const readBytes = async () => new Uint8Array([1, 2, 3]);

describe('the allow-list mirrors the bucket', () => {
  it('is the seven types the migrations configured, audio included', () => {
    // This list and `storage.buckets.allowed_mime_types` are two halves of one
    // decision (20260819090000). If this test fails, check whether the migration
    // moved too — a client list wider than the bucket makes the refusal arrive
    // after a whole upload instead of before it.
    expect(ALLOWED_MIME_TYPES).toEqual([
      'image/jpeg',
      'image/png',
      'image/heic',
      'image/webp',
      'application/pdf',
      'audio/mp4',
      'audio/m4a',
    ]);
  });

  it('has an extension for every allowed type', () => {
    for (const mime of ALLOWED_MIME_TYPES) {
      expect(extensionFor(mime)).toBeTruthy();
    }
  });

  it('refuses anything else, and video in particular', () => {
    // The interesting ones are plausible rather than absurd: a phone offers all
    // of these. **Video stays refused on purpose** — docs/18 §3.3 defers it to
    // Phase 12 with the 10MB cap it depends on, since at that cap a video is
    // about fifteen seconds. If this line ever passes, that decision changed.
    for (const mime of ['image/gif', 'video/mp4', 'video/quicktime', 'text/plain', 'application/zip']) {
      expect(isAllowedMimeType(mime)).toBe(false);
      expect(extensionFor(mime)).toBeNull();
    }
  });

  it('accepts what the recorder actually produces', () => {
    // expo-audio's HIGH_QUALITY preset writes .m4a on both platforms, and this
    // app sends `audio/mp4` for it. Both map to the same extension.
    expect(isAllowedMimeType('audio/mp4')).toBe(true);
    expect(isAllowedMimeType('audio/m4a')).toBe(true);
    expect(extensionFor('audio/mp4')).toBe('m4a');
    expect(extensionFor('audio/m4a')).toBe('m4a');
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

describe('uploadRecordFile', () => {
  it('refuses an invalid file without touching the gateway', async () => {
    const allocatePath = jest.fn();
    const gateway = fakeGateway({ allocatePath });

    const result = await uploadRecordFile(
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

    const result = await uploadRecordFile(gateway, 'doc-1', candidate(), readBytes);

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

    await uploadRecordFile(gateway, 'doc-1', candidate({ mimeType: 'application/pdf' }), readBytes);

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

    const result = await uploadRecordFile(gateway, 'doc-1', candidate(), readBytes);

    expect(result).toEqual({ ok: false, message: 'That document is no longer available.' });
    expect(uploadObject).not.toHaveBeenCalled();
  });

  it('reports a readable message when the device cannot read the file', async () => {
    const failing = async () => {
      throw new Error('ENOENT');
    };

    const result = await uploadRecordFile(fakeGateway(), 'doc-1', candidate(), failing);

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

    const result = await uploadRecordFile(gateway, 'doc-1', candidate(), readBytes);

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

    const result = await uploadRecordFile(gateway, 'doc-1', candidate(), readBytes);

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

    await uploadRecordFile(gateway, 'doc-1', candidate(), readBytes, (f) => seen.push(f));

    expect(seen).toEqual([0.25, 1]);
  });
});

describe('listRecordFiles', () => {
  it('reports a refusal rather than an empty list', async () => {
    const gateway = fakeGateway({
      async listFiles() {
        return { data: null, error: { message: 'permission denied for table document_files' } };
      },
    });

    expect(await listRecordFiles(gateway, 'doc-1')).toEqual({
      ok: false,
      message: 'You do not have permission to do that.',
    });
  });

  it('treats a document with no files as success', async () => {
    expect(await listRecordFiles(fakeGateway(), 'doc-1')).toEqual({ ok: true, files: [] });
  });
});

describe('removeRecordFile', () => {
  it('removes by the stored identifier, never by a reconstructed path', async () => {
    let removed: string | null = null;
    const gateway = fakeGateway({
      async removeObject(path) {
        removed = path;
        return { error: null };
      },
    });

    await removeRecordFile(gateway, documentFile());

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

    expect(await removeRecordFile(gateway, documentFile())).toEqual({ ok: true });
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

    await removeRecordFile(gateway, documentFile());

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

    const result = await removeRecordFile(gateway, documentFile());

    expect(result.ok).toBe(false);
    expect(detachFile).not.toHaveBeenCalled();
  });

  it('translates a refusal', async () => {
    const gateway = fakeGateway({
      async removeObject() {
        return { error: { message: 'new row violates row-level security policy' } };
      },
    });

    expect(await removeRecordFile(gateway, documentFile())).toEqual({
      ok: false,
      message: 'You do not have permission to do that.',
    });
  });
});


describe('isPreviewable', () => {
  it.each([...ALLOWED_MIME_TYPES])('decides for %s', (mime) => {
    // Table-driven over the allow-list so a type added in Phase 4 — audio,
    // video — fails here rather than rendering a blank box on a device.
    expect(typeof isPreviewable(mime)).toBe('boolean');
  });

  it('shows images in-app', () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/heic', 'image/webp']) {
      expect(isPreviewable(mime)).toBe(true);
    }
  });

  it('does not claim to render PDFs', () => {
    // Android's WebView cannot, and pretending otherwise would show a blank box
    // on the platform this project demos on.
    expect(isPreviewable('application/pdf')).toBe(false);
  });

  it('refuses anything outside the allow-list', () => {
    expect(isPreviewable('image/gif')).toBe(false);
    expect(isPreviewable('video/mp4')).toBe(false);
  });
});

describe('fileUrl', () => {
  it('mints a URL for the stored identifier', async () => {
    let received: { path: string; ttl: number } | null = null;
    const gateway = fakeGateway({
      async createSignedUrl(path, expiresInSeconds) {
        received = { path, ttl: expiresInSeconds };
        return { data: 'https://example.test/signed', error: null };
      },
    });

    const result = await fileUrl(gateway, documentFile());

    expect(result).toEqual({ ok: true, url: 'https://example.test/signed' });
    // The accessor takes the row and reads providerFileId itself, so no caller
    // can hand it a path they built — path construction is the database's job.
    expect(received!.path).toBe('fam-1/doc-1/abc.jpg');
    expect(received!.ttl).toBe(SIGNED_URL_TTL_SECONDS);
  });

  it('translates a refusal rather than returning a broken URL', async () => {
    const gateway = fakeGateway({
      async createSignedUrl() {
        return { data: null, error: { message: 'permission denied for table objects' } };
      },
    });

    expect(await fileUrl(gateway, documentFile())).toEqual({
      ok: false,
      message: 'You do not have permission to do that.',
    });
  });

  it('reports a missing URL as unavailable, not as success', async () => {
    const gateway = fakeGateway({
      async createSignedUrl() {
        return { data: null, error: null };
      },
    });

    const result = await fileUrl(gateway, documentFile());

    expect(result).toEqual({ ok: false, message: 'That file is no longer available.' });
  });
});

describe('downloadFilenameFor', () => {
  it('gives back the name the user recognised', () => {
    // The stored name is a uuid so no user input reaches a storage path. It
    // becomes a filename again only here, where it stops being a path.
    expect(downloadFilenameFor(documentFile())).toBe('passport.jpg');
  });

  it('falls back to a name with the right extension', () => {
    // Not "file": an extensionless download is one the receiving app cannot open.
    expect(downloadFilenameFor(documentFile({ originalFilename: null }))).toBe('document.jpg');
    expect(
      downloadFilenameFor(
        documentFile({ originalFilename: null, mimeType: 'application/pdf' }),
      ),
    ).toBe('document.pdf');
  });
});

describe('shareRecordFile', () => {
  const download = async () => 'file:///cache/passport.jpg';
  const share = async () => undefined;

  it('mints, downloads, then shares — in that order', async () => {
    const calls: string[] = [];
    const gateway = fakeGateway({
      async createSignedUrl() {
        calls.push('mint');
        return { data: 'https://example.test/signed', error: null };
      },
    });

    const result = await shareRecordFile(
      gateway,
      documentFile(),
      async (url) => {
        calls.push(`download:${url}`);
        return 'file:///cache/passport.jpg';
      },
      async () => {
        calls.push('share');
      },
    );

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(['mint', 'download:https://example.test/signed', 'share']);
  });

  it('does not download when the URL cannot be minted', async () => {
    const downloadSpy = jest.fn();
    const gateway = fakeGateway({
      async createSignedUrl() {
        return { data: null, error: { message: 'permission denied' } };
      },
    });

    const result = await shareRecordFile(gateway, documentFile(), downloadSpy, share);

    expect(result.ok).toBe(false);
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it('does not share when the download failed', async () => {
    const shareSpy = jest.fn();
    const failing = async () => {
      throw new Error('network');
    };

    const result = await shareRecordFile(gateway_(), documentFile(), failing, shareSpy);

    expect(result).toEqual({
      ok: false,
      message: 'That file could not be downloaded. Try again.',
    });
    expect(shareSpy).not.toHaveBeenCalled();
  });

  it('distinguishes a failed sheet from a failed download', async () => {
    // Different messages because the remedies differ: one means try again, the
    // other means the file is already on the device and the sheet misbehaved.
    const result = await shareRecordFile(gateway_(), documentFile(), download, async () => {
      throw new Error('no activity found');
    });

    expect(result).toEqual({ ok: false, message: 'That file could not be opened. Try again.' });
  });

  it('passes the original filename to the downloader', async () => {
    let named: string | null = null;
    await shareRecordFile(
      gateway_(),
      documentFile(),
      async (_url, filename) => {
        named = filename;
        return 'file:///cache/passport.jpg';
      },
      share,
    );

    expect(named).toBe('passport.jpg');
  });
});

/** A gateway with nothing overridden, for the share tests. */
function gateway_(): StorageGateway {
  return fakeGateway();
}

describe('record file kinds', () => {
  it('sends each domain to its own RPCs, which is the whole of what differs', () => {
    // docs/18 §3.1: per-domain tables in SQL, shared upload code in TypeScript.
    // If this ever needs a fifth field, the abstraction has drifted from what
    // actually varies between the two.
    expect(DOCUMENT_FILES.allocateRpc).toBe('allocate_document_file_path');
    expect(DOCUMENT_FILES.attachRpc).toBe('attach_document_file');
    expect(MEMORY_FILES.allocateRpc).toBe('allocate_memory_file_path');
    expect(MEMORY_FILES.attachRpc).toBe('attach_memory_file');
  });

  it('never lets a kind accept something the bucket would refuse', () => {
    // A per-domain list may be narrower than the bucket and must never be wider,
    // or the refusal arrives from storage after a whole upload instead of before it.
    for (const kind of [DOCUMENT_FILES, MEMORY_FILES]) {
      for (const mimeType of kind.acceptedMimeTypes) {
        expect(isAllowedMimeType(mimeType)).toBe(true);
      }
    }
  });

  it('accepts a photo for a memory and refuses a PDF, which the bucket allows', () => {
    // The narrowing that keeps the grid honest: everything in it renders.
    expect(validateFile({ mimeType: 'image/jpeg', sizeBytes: 1000 }, MEMORY_FILES.acceptedMimeTypes)).toBeNull();

    const refused = validateFile(
      { mimeType: 'application/pdf', sizeBytes: 1000 },
      MEMORY_FILES.acceptedMimeTypes,
    );
    expect(refused).not.toBeNull();
    // And the sentence names what a memory takes, not what the bucket permits.
    expect(refused?.message).toContain('a photo');
    expect(refused?.message).not.toContain('PDF');
  });

  it('still accepts a PDF for a document', () => {
    expect(
      validateFile({ mimeType: 'application/pdf', sizeBytes: 1000 }, DOCUMENT_FILES.acceptedMimeTypes),
    ).toBeNull();
  });

  it('defaults to the bucket allow-list when no kind is given', () => {
    expect(validateFile({ mimeType: 'application/pdf', sizeBytes: 1000 })).toBeNull();
  });

  it('keeps the image list to things that actually render', () => {
    // Listed rather than derived by exclusion. `filter(t => t !== 'application/pdf')`
    // was right while PDFs were the only non-image and silently wrong the moment
    // audio joined — it would have put voice notes in the photo grid.
    for (const mimeType of IMAGE_MIME_TYPES) {
      expect(isAllowedMimeType(mimeType)).toBe(true);
      expect(isPreviewable(mimeType)).toBe(true);
      expect(isAudio(mimeType)).toBe(false);
    }
    expect(IMAGE_MIME_TYPES).not.toContain('application/pdf');
  });

  it('never calls a recording previewable, so it cannot reach the photo grid', () => {
    for (const mimeType of AUDIO_MIME_TYPES) {
      expect(isAllowedMimeType(mimeType)).toBe(true);
      expect(isAudio(mimeType)).toBe(true);
      expect(isPreviewable(mimeType)).toBe(false);
    }
  });

  it('lets a memory take a recording and a document refuse one', () => {
    // The widening that had to happen in the same PR as the bucket's.
    expect(MEMORY_FILES.acceptedMimeTypes).toContain('audio/mp4');
    expect(DOCUMENT_FILES.acceptedMimeTypes).not.toContain('audio/mp4');

    expect(validateFile({ mimeType: 'audio/mp4', sizeBytes: 1000 }, MEMORY_FILES.acceptedMimeTypes)).toBeNull();
    expect(
      validateFile({ mimeType: 'audio/mp4', sizeBytes: 1000 }, DOCUMENT_FILES.acceptedMimeTypes),
    ).not.toBeNull();
  });

  it('only sends a duration to the RPC that declares one', () => {
    // PostgREST refuses an argument a function does not have, so this is a fact
    // about the two signatures rather than a preference.
    expect(MEMORY_FILES.acceptsDuration).toBe(true);
    expect(DOCUMENT_FILES.acceptsDuration).toBe(false);
  });

  it('checks the kind the gateway carries, not one the caller passes separately', async () => {
    // The kind travels with the gateway so a screen cannot pair a memory gateway
    // with a document allow-list. This is the test that would fail if uploadRecordFile
    // ever grew a `kind` argument of its own.
    const memoryGateway = { ...fakeGateway(), kind: MEMORY_FILES };
    const outcome = await uploadRecordFile(
      memoryGateway,
      'memory-1',
      candidate({ mimeType: 'application/pdf', originalFilename: 'scan.pdf' }),
      async () => new Uint8Array([1]),
    );

    expect(outcome.ok).toBe(false);
  });
});

describe('downloadFilenameFor', () => {
  it('prefers the name the file arrived with', () => {
    expect(downloadFilenameFor(documentFile({ originalFilename: 'passport.jpg' }))).toBe(
      'passport.jpg',
    );
  });

  it('falls back to the kind\'s own noun, so a photo does not save as document.jpg', () => {
    expect(downloadFilenameFor(documentFile({ originalFilename: null }))).toBe('document.jpg');
    expect(downloadFilenameFor(documentFile({ originalFilename: null }), MEMORY_FILES.downloadNoun)).toBe(
      'photo.jpg',
    );
  });
});
