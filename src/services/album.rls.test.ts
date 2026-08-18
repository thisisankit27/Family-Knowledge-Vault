/**
 * The albums policies — run with `npm run test:rls`, excluded from CI.
 *
 * **The one genuinely new security question Phase 4 raises**, and the reason
 * this file exists rather than being a fourth copy of the memories suite.
 *
 * An album groups memories that may not all be visible to the same people. If
 * `album_memories`' SELECT resolved through the album alone, a member reading a
 * `family` album would receive the `memory_id` of every `private` memory inside
 * it. They could not open those memories — the memories policy still refuses —
 * but they would learn that a private memory exists, and its id. `docs/18` §6.1
 * names that disclosure; `20260810090000` §5 named the shape: *the row hidden,
 * the things hanging off it not.*
 *
 * So the link is visible only to somebody who can see **both ends**, and the
 * test named *"does not disclose the id of a private memory inside a family
 * album"* is what fails if that ever becomes one condition instead of two.
 *
 * The same reasoning removed `albums.cover_memory_id` before this file was
 * written (§4.4 as amended): a column holding a private memory's id leaks it to
 * everyone who can read the album row, which is the same failure one table up.
 * There is nothing here to test for it, because there is no column — which is
 * the point.
 *
 * **Test names say the condition they depend on.** `family` and `private` appear
 * in almost every one, because on this table the two genuinely disagree.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const PASSWORD = 'rls-test-password';
const CURATOR = { email: 'rls-album-curator@example.com', password: PASSWORD };
const OTHER = { email: 'rls-album-other@example.com', password: PASSWORD };
const GUEST = { email: 'rls-album-guest@example.com', password: PASSWORD };
const OUTSIDER = { email: 'rls-album-outsider@example.com', password: PASSWORD };

jest.setTimeout(120_000);

function freshClient(): SupabaseClient {
  return createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function signInOrSignUp(
  client: SupabaseClient,
  credentials: { email: string; password: string },
): Promise<string> {
  const existing = await client.auth.signInWithPassword(credentials);
  if (existing.data.session) return existing.data.session.user.id;

  const created = await client.auth.signUp(credentials);
  if (created.error) {
    throw new Error(`Could not prepare ${credentials.email}: ${created.error.message}`);
  }
  if (!created.data.session) {
    throw new Error(
      `No session for ${credentials.email}. Email confirmation is probably switched on; ` +
        'these tests need it off (config.toml [auth.email] enable_confirmations).',
    );
  }
  return created.data.session.user.id;
}

async function leaveEverything(client: SupabaseClient): Promise<void> {
  const { data } = await client.from('families').select('id');
  for (const row of data ?? []) {
    await client.from('families').delete().eq('id', row.id);
  }
}

const configured = Boolean(url && key);
const describeRls = configured ? describe : describe.skip;

if (!configured) {
  // eslint-disable-next-line no-console
  console.warn('Skipping RLS tests: EXPO_PUBLIC_SUPABASE_URL / key not found in .env');
}

describeRls('albums', () => {
  let curator: SupabaseClient;
  let other: SupabaseClient;
  let guest: SupabaseClient;
  let outsider: SupabaseClient;
  let curatorId: string;
  let otherId: string;
  let familyId: string;
  let albumId: string;

  async function makeAlbum(
    client: SupabaseClient,
    createdBy: string,
    title: string,
    visibility?: string,
  ): Promise<string> {
    const { data, error } = await client
      .from('albums')
      .insert({
        family_id: familyId,
        title,
        created_by: createdBy,
        // Omitted unless asked: the column defaults to 'family'.
        ...(visibility ? { visibility } : {}),
      })
      .select('id')
      .single();
    if (error) throw error;
    return (data as { id: string }).id;
  }

  async function keepMemory(
    client: SupabaseClient,
    createdBy: string,
    title: string,
    visibility?: string,
  ): Promise<string> {
    const { data, error } = await client
      .from('memories')
      .insert({
        family_id: familyId,
        title,
        created_by: createdBy,
        ...(visibility ? { visibility } : {}),
      })
      .select('id')
      .single();
    if (error) throw error;
    return (data as { id: string }).id;
  }

  async function add(client: SupabaseClient, album: string, memory: string) {
    return client
      .from('album_memories')
      .insert({ album_id: album, memory_id: memory, family_id: familyId })
      .select('memory_id');
  }

  async function contents(client: SupabaseClient, album: string): Promise<string[]> {
    const { data, error } = await client
      .from('album_memories')
      .select('memory_id')
      .eq('album_id', album);
    if (error) throw error;
    return (data as { memory_id: string }[]).map((row) => row.memory_id);
  }

  async function inviteAndJoin(client: SupabaseClient, role: string): Promise<void> {
    const { data: invitation, error } = await curator.rpc('create_invitation', {
      target_family: familyId,
      invited_role: role,
    });
    if (error) throw error;
    const { error: joinError } = await client.rpc('redeem_invitation', {
      invitation_code: invitation.code,
    });
    if (joinError) throw joinError;
  }

  beforeAll(async () => {
    curator = freshClient();
    other = freshClient();
    guest = freshClient();
    outsider = freshClient();

    curatorId = await signInOrSignUp(curator, CURATOR);
    otherId = await signInOrSignUp(other, OTHER);
    await signInOrSignUp(guest, GUEST);
    await signInOrSignUp(outsider, OUTSIDER);
  });

  beforeEach(async () => {
    for (const client of [curator, other, guest, outsider]) {
      await leaveEverything(client);
    }

    const { data: family, error } = await curator.rpc('create_family', {
      family_name: 'The Album Shelf',
    });
    if (error) throw error;
    familyId = (family as { id: string }).id;

    await inviteAndJoin(other, 'member');
    await inviteAndJoin(guest, 'guest');

    albumId = await makeAlbum(curator, curatorId, 'Summer at the lake');
  });

  afterAll(async () => {
    for (const client of [curator, other, guest, outsider]) {
      await leaveEverything(client);
    }
  });

  // -------------------------------------------------------------------------
  // The headline: both ends, or nothing
  // -------------------------------------------------------------------------

  it('does not disclose the id of a PRIVATE memory inside a FAMILY album', async () => {
    // **The test this file exists for.** If the link policy is ever reduced to
    // one condition — resolving through the album alone — this is what fails,
    // and it is the only thing that would.
    const shared = await keepMemory(curator, curatorId, 'Boat trip');
    const secret = await keepMemory(curator, curatorId, 'A letter I have not sent', 'private');

    expect((await add(curator, albumId, shared)).error).toBeNull();
    expect((await add(curator, albumId, secret)).error).toBeNull();

    const seen = await contents(other, albumId);
    expect(seen).toEqual([shared]);
    expect(seen).not.toContain(secret);
  });

  it('shows the author every memory in their own album, including the private one', async () => {
    // The positive case beside it: a policy denying everything would pass the
    // test above while making albums useless.
    const shared = await keepMemory(curator, curatorId, 'Boat trip');
    const secret = await keepMemory(curator, curatorId, 'Quiet one', 'private');
    await add(curator, albumId, shared);
    await add(curator, albumId, secret);

    expect((await contents(curator, albumId)).sort()).toEqual([shared, secret].sort());
  });

  it('makes the count agree with the list, so nothing leaks by arithmetic', async () => {
    const shared = await keepMemory(curator, curatorId, 'Boat trip');
    const secret = await keepMemory(curator, curatorId, 'Quiet one', 'private');
    await add(curator, albumId, shared);
    await add(curator, albumId, secret);

    const { count } = await other
      .from('album_memories')
      .select('memory_id', { count: 'exact', head: true })
      .eq('album_id', albumId);

    expect(count).toBe(1);
    expect((await contents(other, albumId)).length).toBe(1);
  });

  it('withdraws a link when its memory becomes private, and returns it when shared again', async () => {
    const memory = await keepMemory(curator, curatorId, 'Boat trip');
    await add(curator, albumId, memory);

    expect(await contents(other, albumId)).toEqual([memory]);

    await curator.from('memories').update({ visibility: 'private' }).eq('id', memory);
    expect(await contents(other, albumId)).toEqual([]);

    await curator.from('memories').update({ visibility: 'family' }).eq('id', memory);
    expect(await contents(other, albumId)).toEqual([memory]);
  });

  it('hides the links of a PRIVATE album even when every memory in it is family-visible', async () => {
    // The other end of the same rule. Both conditions matter, in both directions.
    const memory = await keepMemory(curator, curatorId, 'Boat trip');
    const secretAlbum = await makeAlbum(curator, curatorId, 'Just for me', 'private');
    await add(curator, secretAlbum, memory);

    expect(await contents(other, secretAlbum)).toEqual([]);

    const { data } = await other.from('albums').select('id').eq('id', secretAlbum);
    expect(data ?? []).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Curating across authors, which is what makes a family album a family album
  // -------------------------------------------------------------------------

  it('lets an album author add a FAMILY memory somebody else wrote', async () => {
    // Adding is an act on the album, not on the memory: it changes nothing
    // about the memory and widens nobody's access to it.
    const theirs = await keepMemory(other, otherId, 'Their photograph');

    const { error } = await add(curator, albumId, theirs);
    expect(error).toBeNull();
    expect(await contents(curator, albumId)).toContain(theirs);
  });

  it('does not widen a memory by putting it in an album', async () => {
    // The guest still sees nothing, because the memory's own policy is what
    // decides — the album never enters that question.
    const memory = await keepMemory(curator, curatorId, 'Boat trip');
    await add(curator, albumId, memory);

    const { data } = await guest.from('memories').select('id').eq('id', memory);
    expect(data ?? []).toEqual([]);
    expect(await contents(guest, albumId)).toEqual([]);
  });

  it('refuses an album author adding a PRIVATE memory they did not write', async () => {
    // They cannot see it, so they cannot curate it — and the insert policy says
    // so independently of the fact that they could not have learnt its id.
    const theirSecret = await keepMemory(other, otherId, 'Their private one', 'private');

    const { error } = await add(curator, albumId, theirSecret);
    expect(error).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Writing never widens
  // -------------------------------------------------------------------------

  it('refuses another member adding to an album they can read', async () => {
    const memory = await keepMemory(other, otherId, 'Their photograph');

    const { error } = await add(other, albumId, memory);
    expect(error).not.toBeNull();
  });

  it('refuses another member removing from an album they can read', async () => {
    const memory = await keepMemory(curator, curatorId, 'Boat trip');
    await add(curator, albumId, memory);

    const { data, error } = await other
      .from('album_memories')
      .delete()
      .eq('album_id', albumId)
      .select('memory_id');

    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await contents(curator, albumId)).toEqual([memory]);
  });

  it('refuses another member renaming an album they can read', async () => {
    const { data, error } = await other
      .from('albums')
      .update({ title: 'Mine now' })
      .eq('id', albumId)
      .select('id');

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: still } = await curator.from('albums').select('title').eq('id', albumId).single();
    expect((still as { title: string }).title).toBe('Summer at the lake');
  });

  it('refuses another member deleting an album they can read', async () => {
    const { data, error } = await other.from('albums').delete().eq('id', albumId).select('id');

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: still } = await curator.from('albums').select('id').eq('id', albumId);
    expect(still ?? []).toHaveLength(1);
  });

  it('refuses to move authorship of an album', async () => {
    const { error } = await curator
      .from('albums')
      .update({ created_by: otherId })
      .eq('id', albumId)
      .select('id');

    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });

  it('lets the author remove a memory that has since become private', async () => {
    // The DELETE policy deliberately checks only the album. Requiring
    // visibility of the memory would strand exactly this link — added while it
    // was shared, unreachable once it was not.
    const memory = await keepMemory(curator, curatorId, 'Boat trip');
    await add(curator, albumId, memory);
    await curator.from('memories').update({ visibility: 'private' }).eq('id', memory);

    const { data } = await curator
      .from('album_memories')
      .delete()
      .eq('album_id', albumId)
      .eq('memory_id', memory)
      .select('memory_id');

    expect(data).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // An album references memories; it does not own them
  // -------------------------------------------------------------------------

  it('keeps every memory when its album is deleted', async () => {
    const memory = await keepMemory(curator, curatorId, 'Boat trip');
    await add(curator, albumId, memory);

    const { error } = await curator.from('albums').delete().eq('id', albumId);
    expect(error).toBeNull();

    const { data } = await curator.from('memories').select('id').eq('id', memory);
    expect(data ?? []).toHaveLength(1);
  });

  it('removes a memory from every album when the memory is deleted', async () => {
    const second = await makeAlbum(curator, curatorId, 'Another album');
    const memory = await keepMemory(curator, curatorId, 'Boat trip');
    await add(curator, albumId, memory);
    await add(curator, second, memory);

    await curator.from('memories').delete().eq('id', memory);

    expect(await contents(curator, albumId)).toEqual([]);
    expect(await contents(curator, second)).toEqual([]);
  });

  it('lets one memory sit in several albums and refuses it twice in one', async () => {
    const second = await makeAlbum(curator, curatorId, 'Another album');
    const memory = await keepMemory(curator, curatorId, 'Boat trip');

    expect((await add(curator, albumId, memory)).error).toBeNull();
    expect((await add(curator, second, memory)).error).toBeNull();
    expect((await add(curator, albumId, memory)).error).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // The tenant boundary and the roles
  // -------------------------------------------------------------------------

  it('returns nothing to a guest, album or link', async () => {
    const memory = await keepMemory(curator, curatorId, 'Boat trip');
    await add(curator, albumId, memory);

    const { data } = await guest.from('albums').select('id').eq('family_id', familyId);
    expect(data ?? []).toEqual([]);
    expect(await contents(guest, albumId)).toEqual([]);
  });

  it('refuses a guest making an album', async () => {
    const guestId = (await guest.auth.getUser()).data.user!.id;

    const { error } = await guest
      .from('albums')
      .insert({ family_id: familyId, title: 'Mine', created_by: guestId })
      .select('id');

    expect(error).not.toBeNull();
  });

  it('returns nothing to somebody with no access to the family', async () => {
    const { data } = await outsider.from('albums').select('id').eq('family_id', familyId);
    expect(data ?? []).toEqual([]);
  });

  it('refuses an album linking a memory from another family', async () => {
    // Structural: the composite foreign keys make the row unrepresentable, so
    // no policy has to check for it.
    const mine = await keepMemory(curator, curatorId, 'Boat trip');

    await leaveEverything(outsider);
    const { data: theirs } = await outsider.rpc('create_family', { family_name: 'Elsewhere' });
    const theirFamily = (theirs as { id: string }).id;
    const outsiderId = (await outsider.auth.getUser()).data.user!.id;

    const { data: theirAlbum } = await outsider
      .from('albums')
      .insert({ family_id: theirFamily, title: 'Theirs', created_by: outsiderId })
      .select('id')
      .single();

    const { error } = await outsider
      .from('album_memories')
      .insert({
        album_id: (theirAlbum as { id: string }).id,
        memory_id: mine,
        family_id: theirFamily,
      })
      .select('memory_id');

    expect(error).not.toBeNull();
  });

  it('stops a removed author reading the private album they made', async () => {
    // can_see_record's leading has_family_access gate, on a third table now.
    const secretAlbum = await makeAlbum(other, otherId, 'Theirs alone', 'private');

    const { data: before } = await other.from('albums').select('id').eq('id', secretAlbum);
    expect(before ?? []).toHaveLength(1);

    const { error } = await curator.rpc('remove_family_access', {
      target_family: familyId,
      target_user: otherId,
    });
    if (error) throw error;

    const { data: after } = await other.from('albums').select('id').eq('id', secretAlbum);
    expect(after ?? []).toEqual([]);
  });

  it('removes a family’s albums and links when the family is deleted', async () => {
    const memory = await keepMemory(curator, curatorId, 'Boat trip');
    await add(curator, albumId, memory);

    const { error } = await curator.from('families').delete().eq('id', familyId);
    expect(error).toBeNull();

    const { data } = await curator.from('albums').select('id').eq('id', albumId);
    expect(data ?? []).toEqual([]);
  });
});
