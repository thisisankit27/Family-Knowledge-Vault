import {
  MAX_ALBUM_TITLE_LENGTH,
  addMemoryToAlbum,
  albumsContaining,
  countByAlbum,
  coverForAlbum,
  createAlbum,
  deleteAlbum,
  describeAlbumError,
  describeAlbumSize,
  getAlbum,
  isAlbumVisibility,
  listAlbumEntries,
  listAlbums,
  memoriesInAlbum,
  removeMemoryFromAlbum,
  renameAlbum,
  setAlbumVisibility,
  validateAlbumTitle,
  type Album,
  type AlbumEntry,
  type AlbumGateway,
  type CreateAlbumInput,
} from './album';
import type { RecordFile } from './storage';

function album(overrides: Partial<Album> = {}): Album {
  return {
    id: 'album-1',
    title: 'Summer at the lake',
    visibility: 'family',
    createdBy: 'user-1',
    createdAt: '2026-08-20T09:00:00.000Z',
    updatedAt: '2026-08-20T09:00:00.000Z',
    ...overrides,
  };
}

function photo(overrides: Partial<RecordFile> = {}): RecordFile {
  return {
    id: 'file-1',
    recordId: 'memory-1',
    providerFileId: 'fam-1/memory-1/abc.jpg',
    kind: 'original',
    mimeType: 'image/jpeg',
    sizeBytes: 1000,
    durationSeconds: null,
    originalFilename: null,
    createdAt: '2026-08-20T09:00:00.000Z',
    ...overrides,
  };
}

function entry(overrides: Partial<AlbumEntry> = {}): AlbumEntry {
  return {
    albumId: 'album-1',
    memoryId: 'memory-1',
    memoryTitle: 'Diwali',
    occurredOn: '2019-11-05',
    occurredPrecision: 'day',
    memoryVisibility: 'family',
    cover: null,
    ...overrides,
  };
}

function fakeGateway(overrides: Partial<AlbumGateway> = {}): AlbumGateway {
  return {
    async listAlbums() {
      return { data: [], error: null };
    },
    async listEntries() {
      return { data: [], error: null };
    },
    async createAlbum() {
      return { data: album(), error: null };
    },
    async getAlbum() {
      return { data: album(), error: null };
    },
    async setTitle() {
      return { error: null };
    },
    async setVisibility() {
      return { error: null };
    },
    async deleteAlbum() {
      return { error: null };
    },
    async addMemory() {
      return { error: null };
    },
    async removeMemory() {
      return { error: null };
    },
    ...overrides,
  };
}

describe('validateAlbumTitle', () => {
  it('asks for a name rather than reporting a constraint', () => {
    expect(validateAlbumTitle('   ')?.message).toBe('Give this album a name.');
  });

  it('refuses a title past the column length and accepts one at it', () => {
    expect(validateAlbumTitle('a'.repeat(MAX_ALBUM_TITLE_LENGTH + 1))).not.toBeNull();
    expect(validateAlbumTitle('a'.repeat(MAX_ALBUM_TITLE_LENGTH))).toBeNull();
  });
});

describe('isAlbumVisibility', () => {
  it('accepts only the two values the check constraint allows', () => {
    expect(isAlbumVisibility('family')).toBe(true);
    expect(isAlbumVisibility('private')).toBe(true);
    expect(isAlbumVisibility('shared')).toBe(false);
  });
});

describe('describeAlbumError', () => {
  it('names the duplicate rather than showing a constraint', () => {
    expect(describeAlbumError('duplicate key value violates unique constraint')).toBe(
      'That memory is already in this album.',
    );
  });

  it('does not soften a refusal into an empty album', () => {
    expect(describeAlbumError('new row violates row-level security policy')).toBe(
      'You do not have permission to do that.',
    );
  });

  it('passes an unrecognised message through rather than inventing one', () => {
    expect(describeAlbumError('something new')).toBe('something new');
  });
});

describe('countByAlbum', () => {
  it('counts only what the viewer was given', () => {
    // The list has already been through the both-ends policy, so a memory the
    // reader cannot see is absent rather than counted — which is what stops the
    // count disclosing it by arithmetic.
    const counts = countByAlbum([
      entry({ albumId: 'a', memoryId: '1' }),
      entry({ albumId: 'a', memoryId: '2' }),
      entry({ albumId: 'b', memoryId: '3' }),
    ]);

    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
    expect(counts.get('c')).toBeUndefined();
  });

  it('agrees with the list it was counted from', () => {
    // The invariant that matters: an album that says "2 memories" and then shows
    // one would leak the other by subtraction.
    const entries = [
      entry({ albumId: 'a', memoryId: '1' }),
      entry({ albumId: 'a', memoryId: '2' }),
    ];
    expect(countByAlbum(entries).get('a')).toBe(memoriesInAlbum(entries, 'a').length);
  });
});

describe('memoriesInAlbum', () => {
  it('returns only that album, most recent first', () => {
    const contents = memoriesInAlbum(
      [
        entry({ albumId: 'a', memoryId: 'old', occurredOn: '2015-01-01' }),
        entry({ albumId: 'b', memoryId: 'other', occurredOn: '2020-01-01' }),
        entry({ albumId: 'a', memoryId: 'new', occurredOn: '2021-06-01' }),
      ],
      'a',
    );

    expect(contents.map((item) => item.memoryId)).toEqual(['new', 'old']);
  });

  it('puts undated memories last', () => {
    const contents = memoriesInAlbum(
      [
        entry({ memoryId: 'undated', occurredOn: null }),
        entry({ memoryId: 'dated', occurredOn: '2005-01-01' }),
      ],
      'album-1',
    );

    expect(contents.map((item) => item.memoryId)).toEqual(['dated', 'undated']);
  });
});

describe('coverForAlbum', () => {
  it('is the first photograph of the most recent visible memory that has one', () => {
    const cover = coverForAlbum(
      [
        entry({ memoryId: 'old', occurredOn: '2010-01-01', cover: photo({ id: 'old-photo' }) }),
        entry({ memoryId: 'new', occurredOn: '2021-01-01', cover: photo({ id: 'new-photo' }) }),
      ],
      'album-1',
    );

    expect(cover?.id).toBe('new-photo');
  });

  it('skips memories with no photograph rather than showing nothing', () => {
    const cover = coverForAlbum(
      [
        entry({ memoryId: 'newest', occurredOn: '2021-01-01', cover: null }),
        entry({ memoryId: 'older', occurredOn: '2019-01-01', cover: photo({ id: 'has-one' }) }),
      ],
      'album-1',
    );

    expect(cover?.id).toBe('has-one');
  });

  it('is null for an empty album, and for one whose visible memories have no photos', () => {
    // Three different situations — empty, all hidden, none with photographs —
    // and the same answer to all three on purpose. Telling them apart on screen
    // is the disclosure the derived cover exists to avoid.
    expect(coverForAlbum([], 'album-1')).toBeNull();
    expect(coverForAlbum([entry({ cover: null })], 'album-1')).toBeNull();
    expect(coverForAlbum([entry({ albumId: 'other', cover: photo() })], 'album-1')).toBeNull();
  });

  it('is a whole file row, so fileUrl is never handed a constructed path', () => {
    const cover = coverForAlbum([entry({ cover: photo() })], 'album-1');
    expect(cover).toMatchObject({ id: expect.any(String), providerFileId: expect.any(String) });
  });
});

describe('albumsContaining', () => {
  it('reports which albums already hold a memory', () => {
    const albums = albumsContaining(
      [
        entry({ albumId: 'a', memoryId: 'm1' }),
        entry({ albumId: 'b', memoryId: 'm2' }),
        entry({ albumId: 'c', memoryId: 'm1' }),
      ],
      'm1',
    );

    expect([...albums].sort()).toEqual(['a', 'c']);
  });

  it('lets one memory sit in several albums', () => {
    expect(
      albumsContaining([entry({ albumId: 'a' }), entry({ albumId: 'b' })], 'memory-1').size,
    ).toBe(2);
  });
});

describe('describeAlbumSize', () => {
  it('invites rather than reporting zero', () => {
    expect(describeAlbumSize(0)).toBe('Nothing in it yet');
  });

  it('gets the singular right', () => {
    expect(describeAlbumSize(1)).toBe('1 memory');
    expect(describeAlbumSize(4)).toBe('4 memories');
  });
});

describe('listAlbums and listAlbumEntries', () => {
  it('distinguishes an empty family from a refused read', async () => {
    expect(await listAlbums(fakeGateway(), 'family-1')).toEqual({ ok: true, albums: [] });

    const refused = await listAlbums(
      fakeGateway({
        async listAlbums() {
          return { data: null, error: { message: 'permission denied for table albums' } };
        },
      }),
      'family-1',
    );
    expect(refused).toEqual({ ok: false, message: 'You do not have permission to do that.' });
  });

  it('returns entries the policy allowed and nothing else', async () => {
    const result = await listAlbumEntries(
      fakeGateway({
        async listEntries() {
          return { data: [entry()], error: null };
        },
      }),
      'family-1',
    );

    expect(result).toEqual({ ok: true, entries: [entry()] });
  });
});

describe('createAlbum', () => {
  it('refuses an unnamed album before any round trip', async () => {
    let called = false;
    const outcome = await createAlbum(
      fakeGateway({
        async createAlbum() {
          called = true;
          return { data: album(), error: null };
        },
      }),
      { familyId: 'family-1', title: '  ' },
    );

    expect(outcome).toEqual({ ok: false, message: 'Give this album a name.' });
    expect(called).toBe(false);
  });

  it('trims the title before storing it', async () => {
    let received: CreateAlbumInput | null = null;
    await createAlbum(
      fakeGateway({
        async createAlbum(input) {
          received = input;
          return { data: album(), error: null };
        },
      }),
      { familyId: 'family-1', title: '  Summer  ' },
    );

    expect(received!.title).toBe('Summer');
  });

  it('never sends a visibility the caller did not choose', async () => {
    // The column defaults to `family`; a default repeated here could disagree.
    let received: CreateAlbumInput | null = null;
    await createAlbum(
      fakeGateway({
        async createAlbum(input) {
          received = input;
          return { data: album(), error: null };
        },
      }),
      { familyId: 'family-1', title: 'Summer' },
    );

    expect(received!.visibility).toBeUndefined();
  });

  it('does not report success when the row comes back invisible', async () => {
    const outcome = await createAlbum(
      fakeGateway({
        async createAlbum() {
          return { data: null, error: null };
        },
      }),
      { familyId: 'family-1', title: 'Summer' },
    );

    expect(outcome).toEqual({ ok: false, message: 'The album was not created. Please try again.' });
  });
});

describe('getAlbum', () => {
  it('reports a hidden album as unavailable rather than as a failure', async () => {
    const outcome = await getAlbum(
      fakeGateway({
        async getAlbum() {
          return { data: null, error: null };
        },
      }),
      'album-1',
    );

    expect(outcome).toEqual({ ok: false, message: 'That album is no longer available.' });
  });
});

describe('the writers validate with the same rules that guard creation', () => {
  it('will not rename an album to something it could not have been called', async () => {
    expect(await renameAlbum(fakeGateway(), 'album-1', '   ')).toEqual({
      ok: false,
      message: 'Give this album a name.',
    });
  });

  it('refuses an unrecognised visibility before the round trip', async () => {
    let called = false;
    const outcome = await setAlbumVisibility(
      fakeGateway({
        async setVisibility() {
          called = true;
          return { error: null };
        },
      }),
      'album-1',
      'everyone' as never,
    );

    expect(outcome).toEqual({ ok: false, message: 'That visibility setting is not recognised.' });
    expect(called).toBe(false);
  });
});

describe('adding and removing memories', () => {
  it('sends the family with the link, because the row carries the tenant', async () => {
    let received: { albumId: string; memoryId: string; familyId: string } | null = null;
    await addMemoryToAlbum(
      fakeGateway({
        async addMemory(input) {
          received = input;
          return { error: null };
        },
      }),
      { albumId: 'album-1', memoryId: 'memory-1', familyId: 'family-1' },
    );

    expect(received).toEqual({ albumId: 'album-1', memoryId: 'memory-1', familyId: 'family-1' });
  });

  it('names the duplicate when a memory is added twice', async () => {
    const outcome = await addMemoryToAlbum(
      fakeGateway({
        async addMemory() {
          return { error: { message: 'duplicate key value violates unique constraint' } };
        },
      }),
      { albumId: 'album-1', memoryId: 'memory-1', familyId: 'family-1' },
    );

    expect(outcome).toEqual({ ok: false, message: 'That memory is already in this album.' });
  });

  it('removes a link without touching the memory', async () => {
    // There is no gateway method here that could delete a memory, and that is
    // the point: an album references memories, it does not own them.
    let deletedAlbum = false;
    await removeMemoryFromAlbum(
      fakeGateway({
        async deleteAlbum() {
          deletedAlbum = true;
          return { error: null };
        },
      }),
      'album-1',
      'memory-1',
    );

    expect(deletedAlbum).toBe(false);
  });

  it('reaches album deletion only through its own function', async () => {
    let deleted = false;
    await deleteAlbum(
      fakeGateway({
        async deleteAlbum() {
          deleted = true;
          return { error: null };
        },
      }),
      'album-1',
    );

    expect(deleted).toBe(true);
  });
});
