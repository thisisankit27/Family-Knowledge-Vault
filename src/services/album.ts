/**
 * Albums: collections of memories.
 *
 * Same shape as every other service — rules here, UI-free, gateway injected.
 * This service does **no permission work**: `can_see_record` decides what comes
 * back and the album's author decides what goes in, both in Postgres.
 *
 * **An album is a way of looking at memories, not a thing that owns them.**
 * Deleting one takes its links and leaves every memory where it was. Nothing
 * here has a collection-level permission of any kind — no co-curators, no
 * shared ownership — because an album is the first thing in this product that
 * groups content across authors, and `docs/18` §13.6 is explicit that the
 * question of who owns grouped content belongs to the §13.5 review rather than
 * to this PR.
 *
 * **The cover is derived, never stored.** `docs/18` §4.4 originally specified a
 * `cover_memory_id` and it was removed before this file existed: a column
 * holding the id of a `private` memory would disclose that memory's existence to
 * everyone who could read the album. The cover is instead the first photograph
 * of the first memory *this viewer* can see — which cannot leak, cannot dangle
 * when a memory is deleted, and corrects itself when one becomes private.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { GatewayResult } from './family';
import type { MemoryPrecision, MemoryVisibility } from './memory';
import type { RecordFile } from './storage';

export const MAX_ALBUM_TITLE_LENGTH = 120;

/**
 * Mirrors `albums.visibility`, and is the same two values memories use.
 *
 * `family` leads and is the default, for the reason memories give: an album
 * exists to be looked at together, and one nobody else can open is a folder.
 */
export const ALBUM_VISIBILITIES = ['family', 'private'] as const;
export type AlbumVisibility = (typeof ALBUM_VISIBILITIES)[number];

export const ALBUM_VISIBILITY_LABELS: Record<AlbumVisibility, string> = {
  family: 'Everyone in the family',
  private: 'Only me',
};

export const ALBUM_VISIBILITY_HINTS: Record<AlbumVisibility, string> = {
  family: 'Anyone with access to this family can open it. Guests cannot.',
  private: 'Nobody else can open this — not even an owner.',
};

export function isAlbumVisibility(value: unknown): value is AlbumVisibility {
  return typeof value === 'string' && (ALBUM_VISIBILITIES as readonly string[]).includes(value);
}

export interface Album {
  id: string;
  title: string;
  visibility: AlbumVisibility;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One memory's membership of one album, as the reader is allowed to see it.
 *
 * Every field here has already been through RLS — the link is returned only
 * when the viewer can see **both** the album and the memory, and `cover` is
 * present only when that memory has a photograph the viewer can also reach. So
 * anything in this list is safe to render, and anything filtered out is
 * invisible rather than redacted.
 */
export interface AlbumEntry {
  albumId: string;
  memoryId: string;
  memoryTitle: string;
  occurredOn: string | null;
  occurredPrecision: MemoryPrecision;
  memoryVisibility: MemoryVisibility;
  /**
   * The first photograph of that memory, if it has one this viewer can see.
   *
   * A whole `RecordFile` rather than just an id and a path, so `fileUrl` can be
   * handed the row exactly as everywhere else. That accessor takes a row on
   * purpose — no caller may construct the thing it addresses — and passing it a
   * synthetic object assembled here would defeat the rule while appearing to
   * follow it.
   */
  cover: RecordFile | null;
}

export interface CreateAlbumInput {
  familyId: string;
  title: string;
  visibility?: AlbumVisibility;
}

export interface AlbumGateway {
  listAlbums(familyId: string): Promise<GatewayResult<Album[]>>;
  listEntries(familyId: string): Promise<GatewayResult<AlbumEntry[]>>;
  createAlbum(input: CreateAlbumInput): Promise<GatewayResult<Album>>;
  getAlbum(albumId: string): Promise<GatewayResult<Album>>;
  setTitle(albumId: string, title: string): Promise<{ error: { message: string } | null }>;
  setVisibility(
    albumId: string,
    visibility: AlbumVisibility,
  ): Promise<{ error: { message: string } | null }>;
  deleteAlbum(albumId: string): Promise<{ error: { message: string } | null }>;
  addMemory(input: {
    albumId: string;
    memoryId: string;
    familyId: string;
  }): Promise<{ error: { message: string } | null }>;
  removeMemory(albumId: string, memoryId: string): Promise<{ error: { message: string } | null }>;
}

export type AlbumOutcome = { ok: true; album: Album } | { ok: false; message: string };

export function validateAlbumTitle(raw: string): { message: string } | null {
  const title = raw.trim();
  if (title.length === 0) return { message: 'Give this album a name.' };
  if (title.length > MAX_ALBUM_TITLE_LENGTH) {
    return { message: `Keep it under ${MAX_ALBUM_TITLE_LENGTH} characters.` };
  }
  return null;
}

export function describeAlbumError(message: string): string {
  const normalised = message.toLowerCase();

  if (normalised.includes('row-level security') || normalised.includes('permission denied')) {
    return 'You do not have permission to do that.';
  }
  if (normalised.includes('not authenticated')) {
    return 'Your session has expired. Sign in again.';
  }
  if (normalised.includes('albums_title_check')) {
    return `Use between 1 and ${MAX_ALBUM_TITLE_LENGTH} characters.`;
  }
  if (normalised.includes('albums_visibility_check')) {
    return 'That visibility setting is not recognised.';
  }
  if (normalised.includes('album_memories_pkey') || normalised.includes('duplicate key')) {
    return 'That memory is already in this album.';
  }
  if (normalised.includes('album_memories_memory_id_family_id_fkey')) {
    return 'That memory is no longer available.';
  }
  if (normalised.includes('network') || normalised.includes('fetch')) {
    return 'Cannot reach the server. Check your connection and try again.';
  }
  return message;
}

export async function listAlbums(
  gateway: AlbumGateway,
  familyId: string,
): Promise<{ ok: true; albums: Album[] } | { ok: false; message: string }> {
  const { data, error } = await gateway.listAlbums(familyId);
  if (error) return { ok: false, message: describeAlbumError(error.message) };
  return { ok: true, albums: data ?? [] };
}

/**
 * Every album membership this viewer can see, across the family.
 *
 * One query rather than one per album: the screens need counts and covers for a
 * whole list at once, and filtering an already-fetched set is the same trade
 * `filterByCategory` made for documents. When a family has enough albums for
 * that to be wrong, this moves into the query and takes an index with it.
 */
export async function listAlbumEntries(
  gateway: AlbumGateway,
  familyId: string,
): Promise<{ ok: true; entries: AlbumEntry[] } | { ok: false; message: string }> {
  const { data, error } = await gateway.listEntries(familyId);
  if (error) return { ok: false, message: describeAlbumError(error.message) };
  return { ok: true, entries: data ?? [] };
}

export async function createAlbum(
  gateway: AlbumGateway,
  input: CreateAlbumInput,
): Promise<AlbumOutcome> {
  const invalid = validateAlbumTitle(input.title);
  if (invalid) return { ok: false, message: invalid.message };

  if (input.visibility !== undefined && !isAlbumVisibility(input.visibility)) {
    return { ok: false, message: 'That visibility setting is not recognised.' };
  }

  const { data, error } = await gateway.createAlbum({ ...input, title: input.title.trim() });
  if (error) return { ok: false, message: describeAlbumError(error.message) };
  if (!data) return { ok: false, message: 'The album was not created. Please try again.' };
  return { ok: true, album: data };
}

export async function getAlbum(
  gateway: AlbumGateway,
  albumId: string,
): Promise<AlbumOutcome> {
  const { data, error } = await gateway.getAlbum(albumId);
  if (error) return { ok: false, message: describeAlbumError(error.message) };
  if (!data) return { ok: false, message: 'That album is no longer available.' };
  return { ok: true, album: data };
}

export async function renameAlbum(
  gateway: AlbumGateway,
  albumId: string,
  title: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const invalid = validateAlbumTitle(title);
  if (invalid) return { ok: false, message: invalid.message };

  const { error } = await gateway.setTitle(albumId, title.trim());
  if (error) return { ok: false, message: describeAlbumError(error.message) };
  return { ok: true };
}

export async function setAlbumVisibility(
  gateway: AlbumGateway,
  albumId: string,
  visibility: AlbumVisibility,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isAlbumVisibility(visibility)) {
    return { ok: false, message: 'That visibility setting is not recognised.' };
  }

  const { error } = await gateway.setVisibility(albumId, visibility);
  if (error) return { ok: false, message: describeAlbumError(error.message) };
  return { ok: true };
}

/**
 * Delete an album. **The memories in it are untouched.**
 *
 * Worth stating in the function that does it, because it is the one thing a
 * person is most likely to fear when they tap the button — and the copy on the
 * confirmation says the same thing.
 */
export async function deleteAlbum(
  gateway: AlbumGateway,
  albumId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await gateway.deleteAlbum(albumId);
  if (error) return { ok: false, message: describeAlbumError(error.message) };
  return { ok: true };
}

export async function addMemoryToAlbum(
  gateway: AlbumGateway,
  input: { albumId: string; memoryId: string; familyId: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await gateway.addMemory(input);
  if (error) return { ok: false, message: describeAlbumError(error.message) };
  return { ok: true };
}

export async function removeMemoryFromAlbum(
  gateway: AlbumGateway,
  albumId: string,
  memoryId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await gateway.removeMemory(albumId, memoryId);
  if (error) return { ok: false, message: describeAlbumError(error.message) };
  return { ok: true };
}

/**
 * How many memories an album holds **for this viewer**.
 *
 * Counted from the visible links, never stored. A stored counter is a second
 * copy of a permission-filtered fact: an album that said "8 memories" and then
 * listed five would disclose the other three by arithmetic, which is the same
 * leak `docs/18` §6.1 closes on the link table itself, arriving by subtraction.
 */
export function countByAlbum(entries: AlbumEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.albumId, (counts.get(entry.albumId) ?? 0) + 1);
  }
  return counts;
}

/** The memories of one album, most recent first, undated last. */
export function memoriesInAlbum(entries: AlbumEntry[], albumId: string): AlbumEntry[] {
  return entries
    .filter((entry) => entry.albumId === albumId)
    .sort((a, b) => {
      if (a.occurredOn === b.occurredOn) return 0;
      if (!a.occurredOn) return 1;
      if (!b.occurredOn) return -1;
      return b.occurredOn.localeCompare(a.occurredOn);
    });
}

/**
 * The album's cover, derived per viewer.
 *
 * The first photograph of the most recent memory in the album that this viewer
 * can see and that actually has one. `null` when the album is empty, when every
 * memory in it is hidden from this reader, or when none of the visible ones has
 * a photograph — three different situations that all mean the same thing to a
 * card, and none of which discloses anything.
 *
 * Two readers of the same album can legitimately see different covers. That is
 * the design working rather than a bug: the alternative is one stored id, which
 * is either everybody's or nobody's and leaks when it is a private memory's.
 */
export function coverForAlbum(
  entries: AlbumEntry[],
  albumId: string,
): AlbumEntry['cover'] | null {
  for (const entry of memoriesInAlbum(entries, albumId)) {
    if (entry.cover) return entry.cover;
  }
  return null;
}

/** Which albums already hold this memory, for the "Add to album" control. */
export function albumsContaining(entries: AlbumEntry[], memoryId: string): Set<string> {
  return new Set(
    entries.filter((entry) => entry.memoryId === memoryId).map((entry) => entry.albumId),
  );
}

/** "3 memories", and the empty case reads as an invitation rather than a count. */
export function describeAlbumSize(count: number): string {
  if (count === 0) return 'Nothing in it yet';
  return count === 1 ? '1 memory' : `${count} memories`;
}

interface AlbumRow {
  id: string;
  title: string;
  visibility: AlbumVisibility;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

function toAlbum(row: AlbumRow): Album {
  return {
    id: row.id,
    title: row.title,
    visibility: row.visibility,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ALBUM_COLUMNS = 'id, title, visibility, created_by, created_at, updated_at';

/**
 * The embedded shape PostgREST returns for a link and the memory behind it.
 *
 * `!inner` matters: without it a link whose memory is invisible comes back with
 * a null memory rather than being dropped, which would put an empty row in the
 * list and tell the reader that *something* is there. The database already
 * refuses the link itself — the both-ends policy — so this is belt and braces
 * on the shape rather than on the permission.
 */
interface EntryRow {
  album_id: string;
  memory_id: string;
  memories: {
    title: string;
    occurred_on: string | null;
    occurred_precision: MemoryPrecision;
    visibility: MemoryVisibility;
    memory_files:
      | {
          id: string;
          provider_file_id: string;
          mime_type: string;
          size_bytes: number;
          duration_seconds: number | null;
          original_filename: string | null;
          created_at: string;
        }[]
      | null;
  };
}

/** The only place that knows how albums are stored. */
export function createSupabaseAlbumGateway(client: SupabaseClient): AlbumGateway {
  return {
    async listAlbums(familyId) {
      const { data, error } = await client
        .from('albums')
        .select(ALBUM_COLUMNS)
        .eq('family_id', familyId)
        .order('created_at', { ascending: false })
        .returns<AlbumRow[]>();

      return { data: data ? data.map(toAlbum) : null, error };
    },

    async listEntries(familyId) {
      // One round trip for every album's contents. Both the link policy and the
      // memories policy apply to this, and the embedded `memory_files` carries
      // its own — so nothing comes back that the caller may not see.
      const { data, error } = await client
        .from('album_memories')
        .select(
          'album_id, memory_id, memories!inner(title, occurred_on, occurred_precision, visibility, memory_files(id, provider_file_id, mime_type, size_bytes, duration_seconds, original_filename, created_at))',
        )
        .eq('family_id', familyId)
        .returns<EntryRow[]>();

      if (error || !data) return { data: null, error };

      return {
        data: data.map((row) => {
          // The first *image* — a voice note is not a cover, and `memory_files`
          // holds both since PR-19.
          const photo =
            (row.memories.memory_files ?? []).find((file) =>
              file.mime_type.startsWith('image/'),
            ) ?? null;

          return {
            albumId: row.album_id,
            memoryId: row.memory_id,
            memoryTitle: row.memories.title,
            occurredOn: row.memories.occurred_on,
            occurredPrecision: row.memories.occurred_precision,
            memoryVisibility: row.memories.visibility,
            cover: photo
              ? {
                  id: photo.id,
                  recordId: row.memory_id,
                  providerFileId: photo.provider_file_id,
                  kind: 'original' as const,
                  mimeType: photo.mime_type,
                  sizeBytes: Number(photo.size_bytes),
                  durationSeconds:
                    photo.duration_seconds === null ? null : Number(photo.duration_seconds),
                  originalFilename: photo.original_filename,
                  createdAt: photo.created_at,
                }
              : null,
          };
        }),
        error: null,
      };
    },

    async createAlbum({ familyId, title, visibility }) {
      const { data: session } = await client.auth.getUser();

      const { data, error } = await client
        .from('albums')
        .insert({
          family_id: familyId,
          title,
          // Omitted when the caller says nothing, so the column's `family`
          // default applies rather than a second copy of it here.
          ...(visibility ? { visibility } : {}),
          created_by: session.user?.id ?? null,
        })
        .select(ALBUM_COLUMNS)
        .maybeSingle<AlbumRow>();

      return { data: data ? toAlbum(data) : null, error };
    },

    async getAlbum(albumId) {
      const { data, error } = await client
        .from('albums')
        .select(ALBUM_COLUMNS)
        .eq('id', albumId)
        .maybeSingle<AlbumRow>();

      return { data: data ? toAlbum(data) : null, error };
    },

    async setTitle(albumId, title) {
      const { error } = await client.from('albums').update({ title }).eq('id', albumId);
      return { error };
    },

    async setVisibility(albumId, visibility) {
      const { error } = await client.from('albums').update({ visibility }).eq('id', albumId);
      return { error };
    },

    async deleteAlbum(albumId) {
      // The cascade is on `album_memories`. Memories are referenced, not owned.
      const { error } = await client.from('albums').delete().eq('id', albumId);
      return { error };
    },

    async addMemory({ albumId, memoryId, familyId }) {
      const { error } = await client
        .from('album_memories')
        .insert({ album_id: albumId, memory_id: memoryId, family_id: familyId });

      return { error };
    },

    async removeMemory(albumId, memoryId) {
      const { error } = await client
        .from('album_memories')
        .delete()
        .eq('album_id', albumId)
        .eq('memory_id', memoryId);

      return { error };
    },
  };
}
