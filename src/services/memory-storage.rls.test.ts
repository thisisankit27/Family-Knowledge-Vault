/**
 * The memory storage policies — run with `npm run test:rls`, excluded from CI.
 *
 * The second domain to take bytes, and the first where **the bytes of a record
 * somebody else wrote are legitimately readable**. Memories default to `family`,
 * so what documents only reached in PR-15a is the normal case here from the
 * first row.
 *
 * That inverts which half of the contract is load-bearing. `docs/15` §9.1 warns
 * that *"an invisible row does not make its file unreachable"*; PR-15a then hit
 * the mirror image, a **visible** row whose file was unreachable, and had to
 * split one predicate into two. This migration writes both on day one, so the
 * tests below have to prove both directions rather than one:
 *
 *   - a family memory's photograph **is** reachable by another member
 *   - a private memory's photograph is reachable by nobody but its author
 *   - and flipping `visibility` moves the bytes with the row, in both directions
 *
 * **Every test is named after the condition it depends on.** PR-15a's four
 * storage tests said *"another member cannot reach these bytes"* when the
 * requirement was *"only somebody who can read the row can reach its bytes"*.
 * Those sentences agreed exactly while every document was author-only, and a
 * suite cannot tell which one it is defending while they agree. Here they
 * disagree from the first row, which is why this file says `private` and
 * `family` out loud in almost every name.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const BUCKET = 'family-files';
const PASSWORD = 'rls-test-password';
const AUTHOR = { email: 'rls-mstore-author@example.com', password: PASSWORD };
const OTHER = { email: 'rls-mstore-other@example.com', password: PASSWORD };
const GUEST = { email: 'rls-mstore-guest@example.com', password: PASSWORD };

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

/** A one-pixel JPEG. Small enough to upload dozens of times without noticing. */
const PIXEL = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x03, 0x02, 0x02, 0x02, 0x02, 0x02, 0x03,
  0xff, 0xd9,
]);

describeRls('memory storage', () => {
  let author: SupabaseClient;
  let other: SupabaseClient;
  let guest: SupabaseClient;
  let authorId: string;
  let familyId: string;
  let memoryId: string;

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
        // Omitted unless a test asks: the column defaults to 'family', and a
        // helper that always set it would hide the divergence from documents
        // that this whole file exists to check.
        ...(visibility ? { visibility } : {}),
      })
      .select('id')
      .single();
    if (error) throw error;
    return (data as { id: string }).id;
  }

  async function allocate(client: SupabaseClient, id: string, extension = 'jpg') {
    return client.rpc('allocate_memory_file_path', {
      target_memory: id,
      extension,
    });
  }

  async function upload(
    client: SupabaseClient,
    path: string,
    contentType = 'image/jpeg',
  ) {
    return client.storage.from(BUCKET).upload(path, PIXEL, { contentType });
  }

  /**
   * The audio half of the happy path.
   *
   * The bytes are the same pixel — the bucket's allow-list checks the declared
   * Content-Type, not the file's contents, so this exercises exactly the thing
   * `20260819090000` changed without needing a real recording in the repository.
   */
  async function attachARecording(id = memoryId, seconds: number | null = 12): Promise<string> {
    const { data: path, error } = await allocate(author, id, 'm4a');
    if (error) throw error;
    const uploaded = await upload(author, path as string, 'audio/mp4');
    if (uploaded.error) throw uploaded.error;
    const attached = await author.rpc('attach_memory_file', {
      target_memory: id,
      object_path: path as string,
      file_mime_type: 'audio/mp4',
      file_size_bytes: PIXEL.byteLength,
      file_original_name: null,
      file_duration_seconds: seconds,
    });
    if (attached.error) throw attached.error;
    return path as string;
  }

  async function attach(client: SupabaseClient, id: string, path: string) {
    return client.rpc('attach_memory_file', {
      target_memory: id,
      object_path: path,
      file_mime_type: 'image/jpeg',
      file_size_bytes: PIXEL.byteLength,
      file_original_name: 'pixel.jpg',
    });
  }

  /** Everything the happy path does, for tests that need a photo already there. */
  async function attachAPhoto(id = memoryId): Promise<string> {
    const { data: path, error } = await allocate(author, id);
    if (error) throw error;
    const uploaded = await upload(author, path as string);
    if (uploaded.error) throw uploaded.error;
    const attached = await attach(author, id, path as string);
    if (attached.error) throw attached.error;
    return path as string;
  }

  /** Written as a plain UPDATE: the policy is the subject, not the service. */
  async function setVisibility(id: string, visibility: string): Promise<void> {
    const { error } = await author.from('memories').update({ visibility }).eq('id', id);
    if (error) throw error;
  }

  async function inviteAndJoin(client: SupabaseClient, role: string): Promise<void> {
    const { data: invitation, error } = await author.rpc('create_invitation', {
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
    author = freshClient();
    other = freshClient();
    guest = freshClient();
    authorId = await signInOrSignUp(author, AUTHOR);
    await signInOrSignUp(other, OTHER);
    await signInOrSignUp(guest, GUEST);
  });

  beforeEach(async () => {
    for (const client of [author, other, guest]) {
      await leaveEverything(client);
    }

    const { data: family, error } = await author.rpc('create_family', {
      family_name: 'The Album',
    });
    if (error) throw error;
    familyId = (family as { id: string }).id;

    await inviteAndJoin(other, 'member');
    await inviteAndJoin(guest, 'guest');

    memoryId = await keepMemory(author, authorId, 'Diwali');
  });

  afterAll(async () => {
    for (const client of [author, other, guest]) {
      await leaveEverything(client);
    }
  });

  // -------------------------------------------------------------------------
  // The happy path
  // -------------------------------------------------------------------------

  it('lets the author allocate, upload and attach a photo to their own memory', async () => {
    const path = await attachAPhoto();
    expect(path).toContain(`${familyId}/${memoryId}/`);

    const { data } = await author.from('memory_files').select('id').eq('memory_id', memoryId);
    expect(data ?? []).toHaveLength(1);
  });

  it('holds several photos for one memory', async () => {
    // A holiday is one memory with thirty photographs, which is why the unique
    // constraint is on the object rather than on (kind, version).
    await attachAPhoto();
    await attachAPhoto();

    const { data } = await author.from('memory_files').select('id').eq('memory_id', memoryId);
    expect(data ?? []).toHaveLength(2);
  });

  it('puts the tenant in the first path segment and the memory in the second', async () => {
    const path = await attachAPhoto();
    const [family, memory] = path.split('/');
    expect(family).toBe(familyId);
    expect(memory).toBe(memoryId);
  });

  // -------------------------------------------------------------------------
  // Reading bytes follows the row, in both directions
  // -------------------------------------------------------------------------

  it('lets another member fetch the bytes of a FAMILY memory they can read', async () => {
    // The case documents could not reach until PR-15a, and the default here.
    const path = await attachAPhoto();

    const { data, error } = await other.storage.from(BUCKET).download(path);
    expect(error).toBeNull();
    expect(data).not.toBeNull();
  });

  it('refuses another member the bytes of a PRIVATE memory they cannot read', async () => {
    const path = await attachAPhoto();
    await setVisibility(memoryId, 'private');

    const { data, error } = await other.storage.from(BUCKET).download(path);
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it('still lets the author fetch the bytes of their own private memory', async () => {
    const path = await attachAPhoto();
    await setVisibility(memoryId, 'private');

    const { error } = await author.storage.from(BUCKET).download(path);
    expect(error).toBeNull();
  });

  it('withdraws bytes when a family memory becomes private, and returns them when it is shared again', async () => {
    // The reversibility claim, asserted in both directions rather than as two
    // tests that happen to agree today. All four predicates — memories,
    // memory_files, memory_members and storage.objects — resolve through the
    // same can_see_record call, so this is what proves they have not drifted.
    const path = await attachAPhoto();

    expect((await other.storage.from(BUCKET).download(path)).error).toBeNull();

    await setVisibility(memoryId, 'private');
    expect((await other.storage.from(BUCKET).download(path)).error).not.toBeNull();

    await setVisibility(memoryId, 'family');
    expect((await other.storage.from(BUCKET).download(path)).error).toBeNull();
  });

  it('refuses a guest the bytes of a family memory', async () => {
    // No policy names a guest. can_see_record delegates 'family' to
    // can_read_records, which is an allow-list of owner, admin and member.
    const path = await attachAPhoto();

    const { error } = await guest.storage.from(BUCKET).download(path);
    expect(error).not.toBeNull();
  });

  it('refuses a removed member the bytes of a memory they could read yesterday', async () => {
    const path = await attachAPhoto();
    expect((await other.storage.from(BUCKET).download(path)).error).toBeNull();

    const otherId = (await other.auth.getUser()).data.user!.id;
    const { error } = await author.rpc('remove_family_access', {
      target_family: familyId,
      target_user: otherId,
    });
    if (error) throw error;

    expect((await other.storage.from(BUCKET).download(path)).error).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Writing never widens, even where reading did
  // -------------------------------------------------------------------------

  it('refuses another member an allocated path for a family memory they can read', async () => {
    // The sharpest case in this file. `other` can read the row and fetch its
    // bytes; they still may not write to it. A single predicate governing both
    // would pass every read test above and fail here.
    const { error } = await allocate(other, memoryId);
    expect(error).not.toBeNull();
  });

  it('refuses another member uploading into a family memory they can read', async () => {
    const { data: path } = await allocate(author, memoryId);

    const { error } = await upload(other, path as string);
    expect(error).not.toBeNull();
  });

  it('refuses another member deleting the object of a family memory they can read', async () => {
    const path = await attachAPhoto();

    await other.storage.from(BUCKET).remove([path]);

    // Storage remove reports success having removed nothing, so the assertion
    // that matters is whether the bytes are still there from the author's side.
    const { error } = await author.storage.from(BUCKET).download(path);
    expect(error).toBeNull();
  });

  it('refuses another member detaching the file row of a family memory they can read', async () => {
    await attachAPhoto();
    const { data: rows } = await author.from('memory_files').select('id').eq('memory_id', memoryId);
    const fileId = (rows as { id: string }[])[0].id;

    const { data, error } = await other.from('memory_files').delete().eq('id', fileId).select('id');

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: still } = await author.from('memory_files').select('id').eq('id', fileId);
    expect(still ?? []).toHaveLength(1);
  });

  it('lets the author detach their own file row', async () => {
    await attachAPhoto();
    const { data: rows } = await author.from('memory_files').select('id').eq('memory_id', memoryId);
    const fileId = (rows as { id: string }[])[0].id;

    const { data } = await author.from('memory_files').delete().eq('id', fileId).select('id');
    expect(data).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // memory_files cannot be written directly
  // -------------------------------------------------------------------------

  it('refuses a direct insert into memory_files, because attach_memory_file is the only writer', async () => {
    // No INSERT policy and no INSERT grant. A client that can write a row before
    // the object exists can describe bytes nobody can fetch.
    const { error } = await author
      .from('memory_files')
      .insert({
        family_id: familyId,
        memory_id: memoryId,
        provider_file_id: `${familyId}/${memoryId}/forged.jpg`,
        mime_type: 'image/jpeg',
        size_bytes: 10,
      })
      .select('id');

    expect(error).not.toBeNull();
  });

  it('refuses attaching a path with no object behind it', async () => {
    const { data: path } = await allocate(author, memoryId);

    // Skipping the upload entirely: the function checks storage.objects rather
    // than trusting the caller, which is the reason it is an RPC at all.
    const { error } = await attach(author, memoryId, path as string);
    expect(error).not.toBeNull();
  });

  it('refuses attaching an object that belongs to a different memory of your own', async () => {
    const otherMemory = await keepMemory(author, authorId, 'Goa');
    const { data: path } = await allocate(author, otherMemory);
    await upload(author, path as string);

    const { error } = await attach(author, memoryId, path as string);
    expect(error).not.toBeNull();
  });

  it('refuses an allocated path for a memory that does not exist', async () => {
    const { error } = await allocate(author, '00000000-0000-0000-0000-000000000000');
    expect(error).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // File rows follow their memory
  // -------------------------------------------------------------------------

  it('hides the file rows of a private memory from another member', async () => {
    await attachAPhoto();
    await setVisibility(memoryId, 'private');

    const { data } = await other.from('memory_files').select('id').eq('memory_id', memoryId);
    expect(data ?? []).toEqual([]);
  });

  it('shows the file rows of a family memory to another member', async () => {
    await attachAPhoto();

    const { data } = await other.from('memory_files').select('id').eq('memory_id', memoryId);
    expect(data ?? []).toHaveLength(1);
  });

  it('removes the file rows when the memory is deleted', async () => {
    await attachAPhoto();

    const { error } = await author.from('memories').delete().eq('id', memoryId);
    expect(error).toBeNull();

    const { data } = await author.from('memory_files').select('id').eq('memory_id', memoryId);
    expect(data ?? []).toEqual([]);
  });

  it('removes the storage rows when the memory is deleted', async () => {
    // The after-delete trigger, and the reason it needs set_config: without it
    // storage.objects' own guard rolls the whole delete back.
    const path = await attachAPhoto();

    const { error } = await author.from('memories').delete().eq('id', memoryId);
    expect(error).toBeNull();

    const { error: gone } = await author.storage.from(BUCKET).download(path);
    expect(gone).not.toBeNull();
  });

  it('still allows a family to be deleted once its memories hold objects', async () => {
    // PR-14a made families quietly undeletable this exact way, and the symptom
    // was a rolled-back transaction rather than an error anybody saw.
    await attachAPhoto();

    const { error } = await author.from('families').delete().eq('id', familyId);
    expect(error).toBeNull();

    const { data } = await author.from('families').select('id').eq('id', familyId);
    expect(data ?? []).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Signed URLs are an expression of the policy, not a way around it
  // -------------------------------------------------------------------------

  it('mints a signed URL for another member of a family memory', async () => {
    const path = await attachAPhoto();

    const { data, error } = await other.storage.from(BUCKET).createSignedUrl(path, 60);
    expect(error).toBeNull();
    expect(data?.signedUrl).toBeTruthy();
  });

  it('refuses to mint a signed URL for another member once the memory is private', async () => {
    const path = await attachAPhoto();
    await setVisibility(memoryId, 'private');

    const { data, error } = await other.storage.from(BUCKET).createSignedUrl(path, 60);
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it('serves a minted URL without a session, which is what makes it worth protecting', async () => {
    const path = await attachAPhoto();
    const { data } = await author.storage.from(BUCKET).createSignedUrl(path, 60);

    const response = await fetch(data!.signedUrl);
    expect(response.ok).toBe(true);
  });

  // -------------------------------------------------------------------------
  // The two domains share a bucket and do not reach each other
  // -------------------------------------------------------------------------

  it('refuses a memory path to the document allocator and vice versa', async () => {
    // Documents and memories both write <family_id>/<record_id>/<uuid>.<ext>.
    // Each predicate joins to its own table, so neither can address the other's
    // objects even though the shape is identical.
    const documentAllocate = await author.rpc('allocate_document_file_path', {
      target_document: memoryId,
      extension: 'jpg',
    });
    expect(documentAllocate.error).not.toBeNull();

    const { data: doc } = await author
      .from('documents')
      .insert({ family_id: familyId, title: 'Passport', category: 'identity', created_by: authorId })
      .select('id')
      .single();

    const memoryAllocate = await allocate(author, (doc as { id: string }).id);
    expect(memoryAllocate.error).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Audio — the bucket and the client list are two halves of one decision
  // -------------------------------------------------------------------------

  it('accepts an audio/mp4 upload, which is the bucket half of the change', () => {
    // If 20260819090000 were reverted or never applied, this is what fails —
    // and it fails here rather than on a stream at the last step of a recording.
    return expect(attachARecording()).resolves.toContain(`${familyId}/${memoryId}/`);
  });

  it('refuses a video upload, because video is deferred to Phase 12', async () => {
    // The other half of the same decision: the allow-list gained audio and
    // nothing else. docs/18 §3.3 — at a 10MB cap a video is fifteen seconds.
    const { data: path } = await allocate(author, memoryId, 'mp4');
    const { error } = await upload(author, path as string, 'video/mp4');
    expect(error).not.toBeNull();
  });

  it('refuses an audio upload whose type the bucket does not list', async () => {
    const { data: path } = await allocate(author, memoryId, 'mp3');
    const { error } = await upload(author, path as string, 'audio/mpeg');
    expect(error).not.toBeNull();
  });

  it('records the duration the recorder measured', async () => {
    await attachARecording(memoryId, 42);

    const { data } = await author
      .from('memory_files')
      .select('duration_seconds, mime_type')
      .eq('memory_id', memoryId);

    const row = (data as { duration_seconds: number; mime_type: string }[])[0];
    expect(row.duration_seconds).toBe(42);
    expect(row.mime_type).toBe('audio/mp4');
  });

  it('accepts a recording whose length was never measured', async () => {
    // Null is honest: nothing in this stack decodes audio, and an invented
    // duration would be worse than none.
    await attachARecording(memoryId, null);

    const { data } = await author
      .from('memory_files')
      .select('duration_seconds')
      .eq('memory_id', memoryId);

    expect((data as { duration_seconds: number | null }[])[0].duration_seconds).toBeNull();
  });

  it('lets another member hear a recording on a FAMILY memory', async () => {
    // A recording obeys the same read predicate as a photograph, because
    // can_read_memory_object never looks at mime_type.
    const path = await attachARecording();

    const { error } = await other.storage.from(BUCKET).download(path);
    expect(error).toBeNull();
  });

  it('refuses another member a recording on a PRIVATE memory', async () => {
    // The case that matters most for a voice note: a private recording is
    // audible to nobody but its author.
    const path = await attachARecording();
    await setVisibility(memoryId, 'private');

    const { error } = await other.storage.from(BUCKET).download(path);
    expect(error).not.toBeNull();
  });

  it('refuses another member uploading a recording into a memory they can read', async () => {
    // Writing never widens, whatever the media type.
    const { error } = await allocate(other, memoryId, 'm4a');
    expect(error).not.toBeNull();
  });

  it('keeps photographs and recordings on one memory, governed identically', async () => {
    await attachAPhoto();
    await attachARecording();

    const { data } = await other
      .from('memory_files')
      .select('mime_type')
      .eq('memory_id', memoryId);

    const types = (data as { mime_type: string }[]).map((row) => row.mime_type).sort();
    expect(types).toEqual(['audio/mp4', 'image/jpeg']);

    await setVisibility(memoryId, 'private');
    const { data: hidden } = await other
      .from('memory_files')
      .select('mime_type')
      .eq('memory_id', memoryId);
    expect(hidden ?? []).toEqual([]);
  });
});
