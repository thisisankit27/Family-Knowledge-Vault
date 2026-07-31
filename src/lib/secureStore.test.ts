import {
  CHUNK_SIZE,
  createChunkedSecureStore,
  splitIntoChunks,
  type SecureStoreBackend,
} from './secureStore';

/** In-memory stand-in for the native keychain. */
function fakeBackend(): SecureStoreBackend & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItemAsync: async (key) => store.get(key) ?? null,
    setItemAsync: async (key, value) => {
      store.set(key, value);
    },
    deleteItemAsync: async (key) => {
      store.delete(key);
    },
  };
}

describe('splitIntoChunks', () => {
  it('keeps a short value in a single chunk', () => {
    expect(splitIntoChunks('hello')).toEqual(['hello']);
  });

  it('splits a long value into pieces no larger than the chunk size', () => {
    const chunks = splitIntoChunks('x'.repeat(CHUNK_SIZE * 2 + 7));
    expect(chunks).toHaveLength(3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_SIZE + 1);
    }
    expect(chunks.join('')).toHaveLength(CHUNK_SIZE * 2 + 7);
  });

  it('never splits a surrogate pair across two chunks', () => {
    // Places an emoji so its high surrogate sits exactly on the boundary.
    const value = 'a'.repeat(CHUNK_SIZE - 1) + '👵' + 'b'.repeat(10);
    const chunks = splitIntoChunks(value);

    expect(chunks.join('')).toBe(value);
    for (const chunk of chunks) {
      // A lone surrogate survives neither JSON.parse nor a keychain round trip.
      expect(chunk).toBe(
        chunk.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '�'),
      );
      expect(chunk).toBe(
        chunk.replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�'),
      );
    }
  });

  it('represents the empty string as one empty chunk', () => {
    expect(splitIntoChunks('')).toEqual(['']);
  });
});

describe('createChunkedSecureStore', () => {
  it('returns null for a key that was never written', async () => {
    const storage = createChunkedSecureStore(fakeBackend());
    expect(await storage.getItem('sb-auth-token')).toBeNull();
  });

  it('round-trips a value small enough to fit one chunk', async () => {
    const storage = createChunkedSecureStore(fakeBackend());
    await storage.setItem('sb-auth-token', 'small');
    expect(await storage.getItem('sb-auth-token')).toBe('small');
  });

  it('round-trips a session larger than SecureStore accepts in one value', async () => {
    const backend = fakeBackend();
    const storage = createChunkedSecureStore(backend);
    // A realistic Supabase session shape, comfortably past the 2048-byte limit.
    const session = JSON.stringify({
      access_token: 'a'.repeat(2400),
      refresh_token: 'r'.repeat(600),
      user: { email: 'nanima@example.com', user_metadata: { name: 'Nani 👵' } },
    });

    await storage.setItem('sb-auth-token', session);

    expect(await storage.getItem('sb-auth-token')).toBe(session);
    // Guards the point of the exercise: nothing was written whole.
    for (const value of backend.store.values()) {
      expect(value.length).toBeLessThanOrEqual(CHUNK_SIZE + 1);
    }
  });

  it('deletes orphaned chunks when a value shrinks', async () => {
    const backend = fakeBackend();
    const storage = createChunkedSecureStore(backend);

    await storage.setItem('sb-auth-token', 'x'.repeat(CHUNK_SIZE * 3));
    await storage.setItem('sb-auth-token', 'short');

    expect(await storage.getItem('sb-auth-token')).toBe('short');
    expect(backend.store.has('sb-auth-token.1')).toBe(false);
    expect(backend.store.has('sb-auth-token.2')).toBe(false);
  });

  it('removes every chunk on removeItem, leaving nothing behind', async () => {
    const backend = fakeBackend();
    const storage = createChunkedSecureStore(backend);

    await storage.setItem('sb-auth-token', 'y'.repeat(CHUNK_SIZE * 2));
    await storage.removeItem('sb-auth-token');

    expect(backend.store.size).toBe(0);
    expect(await storage.getItem('sb-auth-token')).toBeNull();
  });

  it('reports nothing stored when a chunk has gone missing', async () => {
    const backend = fakeBackend();
    const storage = createChunkedSecureStore(backend);

    await storage.setItem('sb-auth-token', 'z'.repeat(CHUNK_SIZE * 2));
    backend.store.delete('sb-auth-token.1');

    // Handing Supabase half a token would be worse than asking for a re-login.
    expect(await storage.getItem('sb-auth-token')).toBeNull();
  });
});
