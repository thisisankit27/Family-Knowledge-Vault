/**
 * Chunked Expo SecureStore adapter for Supabase's auth storage.
 *
 * Why this exists: SecureStore is backed by the iOS keychain and Android
 * EncryptedSharedPreferences, and warns above ~2048 bytes per value. A Supabase
 * session is a JSON blob holding an access JWT, a refresh token, and the user
 * record — routinely larger than that once user metadata is populated. Writing
 * it as one value works today and silently starts failing as the payload grows,
 * which is the worst possible failure mode for auth: the user is signed out at
 * random with no error to trace.
 *
 * So values are split across `key.0`, `key.1`, … and the chunk *count* is
 * stored at `key` itself. Reads reassemble; writes clean up chunks left behind
 * by a longer previous value.
 *
 * Everything here takes its storage backend as a parameter so the logic is
 * unit-testable without a device — see secureStore.test.ts.
 */

/** The slice of expo-secure-store this adapter depends on. */
export interface SecureStoreBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/** The storage contract Supabase's auth client expects. */
export interface SupabaseAuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Deliberately well under SecureStore's ~2048-byte warning threshold. Session
 * payloads are almost entirely ASCII (base64url JWTs), so one character is
 * one byte in practice; the headroom covers the multi-byte case.
 */
export const CHUNK_SIZE = 1024;

/**
 * Splits without ever cutting a surrogate pair in half.
 *
 * Sessions carry user metadata — a display name with an emoji or a non-BMP
 * script is enough to put a surrogate pair on a chunk boundary, and splitting
 * one produces two lone surrogates that no longer round-trip.
 */
export function splitIntoChunks(value: string, size = CHUNK_SIZE): string[] {
  if (value.length === 0) return [''];

  const chunks: string[] = [];
  let start = 0;

  while (start < value.length) {
    let end = Math.min(start + size, value.length);
    const last = value.charCodeAt(end - 1);
    // A high surrogate at the boundary owns the next code unit — take it too.
    const isHighSurrogate = last >= 0xd800 && last <= 0xdbff;
    if (isHighSurrogate && end < value.length) end += 1;
    chunks.push(value.slice(start, end));
    start = end;
  }

  return chunks;
}

function chunkKey(key: string, index: number): string {
  return `${key}.${index}`;
}

async function readChunkCount(
  backend: SecureStoreBackend,
  key: string,
): Promise<number> {
  const raw = await backend.getItemAsync(key);
  if (raw === null) return 0;
  const count = Number.parseInt(raw, 10);
  return Number.isNaN(count) || count < 0 ? 0 : count;
}

/**
 * Wraps a SecureStore backend in the interface Supabase's auth client wants.
 */
export function createChunkedSecureStore(
  backend: SecureStoreBackend,
): SupabaseAuthStorage {
  return {
    async getItem(key) {
      const count = await readChunkCount(backend, key);
      if (count === 0) return null;

      const parts: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const part = await backend.getItemAsync(chunkKey(key, i));
        // A missing chunk means a partial write or partial wipe. Returning a
        // truncated session would hand Supabase a corrupt token, so report
        // "nothing stored" and let it re-authenticate.
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join('');
    },

    async setItem(key, value) {
      const previousCount = await readChunkCount(backend, key);
      const chunks = splitIntoChunks(value);

      for (let i = 0; i < chunks.length; i += 1) {
        await backend.setItemAsync(chunkKey(key, i), chunks[i]);
      }
      await backend.setItemAsync(key, String(chunks.length));

      // A shorter value than last time leaves orphans that would corrupt a
      // future read if the count ever grew back.
      for (let i = chunks.length; i < previousCount; i += 1) {
        await backend.deleteItemAsync(chunkKey(key, i));
      }
    },

    async removeItem(key) {
      const count = await readChunkCount(backend, key);
      for (let i = 0; i < count; i += 1) {
        await backend.deleteItemAsync(chunkKey(key, i));
      }
      await backend.deleteItemAsync(key);
    },
  };
}
