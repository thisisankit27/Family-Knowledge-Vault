/**
 * The storage policies — run with `npm run test:rls`, excluded from CI.
 *
 * **This suite exists because `docs/15` §9.1 froze a predicate that is no longer
 * safe.** It specified `has_family_access((storage.foldername(name))[1]::uuid)`
 * — tenant-level and role-blind, written when documents were family-visible by
 * default. After 20260810090000 a document belongs to its author alone, so that
 * predicate would have let any family member fetch the bytes of a row they
 * cannot read. §9.1's own sentence is the indictment: *"an invisible row does
 * not make its file unreachable."*
 *
 * The tests that matter most are therefore the ones where a *second member of
 * the same family* is refused. Under the frozen predicate every one of them
 * would pass the check.
 *
 * Two more things are pinned here:
 *
 * **No client builds a path.** `allocate_document_file_path` is the only source,
 * and it refuses a document the caller did not file.
 *
 * **A row cannot describe bytes that are not there.** PR-11 asserted that as a
 * reason to withhold an INSERT policy; because `storage.objects` is an ordinary
 * table, `attach_document_file` can check it rather than trust it.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const PASSWORD = 'rls-test-password';
const AUTHOR = { email: 'rls-store-author@example.com', password: PASSWORD };
const OTHER = { email: 'rls-store-other@example.com', password: PASSWORD };

const BUCKET = 'family-files';

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
  if (created.error) throw new Error(`Could not prepare ${credentials.email}: ${created.error.message}`);
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

describeRls('document storage', () => {
  let author: SupabaseClient;
  let other: SupabaseClient;
  let authorId: string;
  let familyId: string;
  let documentId: string;

  async function fileDocument(client: SupabaseClient, createdBy: string, title: string): Promise<string> {
    const { data, error } = await client
      .from('documents')
      .insert({ family_id: familyId, title, category: 'identity', created_by: createdBy })
      .select('id')
      .single();
    if (error) throw error;
    return (data as { id: string }).id;
  }

  async function allocate(client: SupabaseClient, docId: string, extension = 'jpg') {
    return client.rpc('allocate_document_file_path', {
      target_document: docId,
      extension,
    });
  }

  async function upload(client: SupabaseClient, path: string) {
    return client.storage.from(BUCKET).upload(path, PIXEL, { contentType: 'image/jpeg' });
  }

  async function attach(client: SupabaseClient, docId: string, path: string) {
    return client.rpc('attach_document_file', {
      target_document: docId,
      object_path: path,
      file_mime_type: 'image/jpeg',
      file_size_bytes: PIXEL.byteLength,
      file_original_name: 'pixel.jpg',
    });
  }

  /** Everything the happy path does, for tests that need a file already there. */
  async function attachAFile(docId = documentId): Promise<string> {
    const { data: path, error } = await allocate(author, docId);
    if (error) throw error;
    const uploaded = await upload(author, path as string);
    if (uploaded.error) throw uploaded.error;
    const attached = await attach(author, docId, path as string);
    if (attached.error) throw attached.error;
    return path as string;
  }

  beforeAll(async () => {
    author = freshClient();
    other = freshClient();
    authorId = await signInOrSignUp(author, AUTHOR);
    await signInOrSignUp(other, OTHER);
  });

  beforeEach(async () => {
    for (const client of [author, other]) await leaveEverything(client);

    const { data: family, error } = await author.rpc('create_family', { family_name: 'The Vault' });
    if (error) throw error;
    familyId = (family as { id: string }).id;

    const { data: invitation, error: inviteError } = await author.rpc('create_invitation', {
      target_family: familyId,
      invited_role: 'member',
    });
    if (inviteError) throw inviteError;
    const joined = await other.rpc('redeem_invitation', {
      invitation_code: (invitation as { code: string }).code,
    });
    if (joined.error) throw joined.error;

    documentId = await fileDocument(author, authorId, 'Passport');
  });

  afterAll(async () => {
    for (const client of [author, other]) await leaveEverything(client);
  });

  // -------------------------------------------------------------------------

  describe('the bucket', () => {
    // Asserted by behaviour rather than by reading `storage.buckets`, which an
    // ordinary session cannot see — and behaviour is the better test anyway. A
    // bucket configured correctly but not *enforcing* would pass an
    // introspection test and fail a user.

    it('refuses a type outside the allow-list', async () => {
      const { data: path } = await allocate(author, documentId);

      const { error } = await author.storage
        .from(BUCKET)
        .upload(path as string, PIXEL, { contentType: 'text/plain' });

      expect(error).not.toBeNull();
    });

    it('refuses a file over the 10MB cap', async () => {
      // The cap that matters is this one, not the client's. `validateFile`
      // spares the user a doomed upload; this is what makes the limit true when
      // somebody points curl at the endpoint instead.
      const { data: path } = await allocate(author, documentId);
      const oversize = new Uint8Array(10 * 1024 * 1024 + 1);

      const { error } = await author.storage
        .from(BUCKET)
        .upload(path as string, oversize, { contentType: 'image/jpeg' });

      expect(error).not.toBeNull();
    });

    it('is not readable without a session', async () => {
      // Private, proven the way it matters: the bucket is not public, so an
      // unauthenticated client gets nothing even holding an exact path.
      const path = await attachAFile();
      const anonymous = freshClient();

      const { error } = await anonymous.storage.from(BUCKET).download(path);

      expect(error).not.toBeNull();
    });
  });

  describe('allocating a path', () => {
    it('returns a path under the family and the document', async () => {
      const { data, error } = await allocate(author, documentId);

      expect(error).toBeNull();
      expect(data).toMatch(new RegExp(`^${familyId}/${documentId}/[0-9a-f-]{36}\\.jpg$`));
    });

    it('never reuses a path', async () => {
      const first = await allocate(author, documentId);
      const second = await allocate(author, documentId);

      expect(first.data).not.toBe(second.data);
    });

    it('refuses a document the caller did not file', async () => {
      // The other account is a full member of the same family, which is exactly
      // the case the frozen has_family_access predicate would have allowed.
      const { error } = await allocate(other, documentId);
      expect(error).not.toBeNull();
    });

    it('refuses a file type it has no extension for', async () => {
      const { error } = await allocate(author, documentId, '');
      expect(error).not.toBeNull();
    });
  });

  describe('uploading', () => {
    it('lets the author upload to their own allocated path', async () => {
      const { data: path } = await allocate(author, documentId);
      const { error } = await upload(author, path as string);

      expect(error).toBeNull();
    });

    it('stops another member uploading to that path', async () => {
      // **The regression guard.** Under `has_family_access(segment1)` this would
      // succeed: the other account is in the family, and segment 1 is the family.
      const { data: path } = await allocate(author, documentId);

      const { error } = await upload(other, path as string);

      expect(error).not.toBeNull();
    });

    it('stops another member reading the object', async () => {
      const path = await attachAFile();

      const { error } = await other.storage.from(BUCKET).download(path);

      expect(error).not.toBeNull();
    });

    it('stops another member listing the family prefix', async () => {
      await attachAFile();

      const { data } = await other.storage.from(BUCKET).list(`${familyId}/${documentId}`);

      expect(data ?? []).toEqual([]);
    });

    it('stops another member removing the object', async () => {
      const path = await attachAFile();

      await other.storage.from(BUCKET).remove([path]);

      // Asserted from the author's session: a remove that matches no visible
      // object does not necessarily error, so absence of an error proves nothing.
      const { error } = await author.storage.from(BUCKET).download(path);
      expect(error).toBeNull();
    });
  });

  describe('attaching', () => {
    it('records the file after the bytes exist', async () => {
      const path = await attachAFile();

      const { data, error } = await author
        .from('document_files')
        .select('provider_file_id, mime_type, size_bytes, original_filename, kind, version')
        .eq('document_id', documentId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0]).toMatchObject({
        provider_file_id: path,
        mime_type: 'image/jpeg',
        original_filename: 'pixel.jpg',
        kind: 'original',
        version: 1,
      });
    });

    it('refuses when no object was uploaded', async () => {
      // The check PR-11 said it wanted and could not have: a row must not
      // describe bytes that are not there.
      const { data: path } = await allocate(author, documentId);

      const { error } = await attach(author, documentId, path as string);

      expect(error).not.toBeNull();
    });

    it('refuses a path belonging to a different document', async () => {
      const otherDocument = await fileDocument(author, authorId, 'Deed');
      const { data: path } = await allocate(author, otherDocument);
      await upload(author, path as string);

      const { error } = await attach(author, documentId, path as string);

      expect(error).not.toBeNull();
    });

    it('refuses a document the caller did not file', async () => {
      const { error } = await attach(other, documentId, `${familyId}/${documentId}/made-up.jpg`);
      expect(error).not.toBeNull();
    });

    it('holds several files for one document', async () => {
      // A passport is one document with two pages. PR-11's
      // `unique (document_id, kind, version)` made the second page claim to
      // supersede the first; 20260811090000 replaced it.
      await attachAFile();
      await attachAFile();

      const { data } = await author
        .from('document_files')
        .select('id')
        .eq('document_id', documentId);

      expect(data).toHaveLength(2);
    });
  });

  describe('document_files stays unwritable by clients', () => {
    it('refuses a direct insert even from the author', async () => {
      // The RPC is the only writer. A grant here would reopen exactly what
      // attach_document_file exists to close.
      const { error } = await author.from('document_files').insert({
        family_id: familyId,
        document_id: documentId,
        provider_file_id: `${familyId}/${documentId}/forged.jpg`,
        mime_type: 'image/jpeg',
        size_bytes: 1,
      });

      expect(error).not.toBeNull();
    });

    it('hides another member\'s file rows', async () => {
      await attachAFile();

      const { data } = await other.from('document_files').select('id').eq('document_id', documentId);

      expect(data ?? []).toEqual([]);
    });

    it('lets the author detach a file, removing the row', async () => {
      // DELETE is granted where INSERT is not. The hazard INSERT carries — a row
      // describing bytes that are not there — has no delete equivalent.
      //
      // **This is the regression test for a bug found on a device.** Removing
      // the object left the row behind, so the file reappeared on the next read
      // and the remove button looked broken. The suite missed it because every
      // test asserted the object was gone and none re-listed the rows.
      await attachAFile();
      const { data: before } = await author
        .from('document_files')
        .select('id')
        .eq('document_id', documentId);
      expect(before).toHaveLength(1);

      const { error } = await author
        .from('document_files')
        .delete()
        .eq('id', (before as { id: string }[])[0].id);

      expect(error).toBeNull();

      const { data: after } = await author
        .from('document_files')
        .select('id')
        .eq('document_id', documentId);
      expect(after ?? []).toEqual([]);
    });

    it('stops another member detaching a file', async () => {
      await attachAFile();
      const { data: rows } = await author
        .from('document_files')
        .select('id')
        .eq('document_id', documentId);

      // Matches no visible row, so it changes nothing rather than erroring —
      // asserted from the author's session for that reason.
      await other.from('document_files').delete().eq('id', (rows as { id: string }[])[0].id);

      const { data: after } = await author
        .from('document_files')
        .select('id')
        .eq('document_id', documentId);
      expect(after).toHaveLength(1);
    });
  });

  describe('signed URLs', () => {
    it('lets the author mint one, and it fetches', async () => {
      const path = await attachAFile();

      const { data, error } = await author.storage.from(BUCKET).createSignedUrl(path, 300);

      expect(error).toBeNull();
      expect(data!.signedUrl).toContain(path);

      const response = await fetch(data!.signedUrl);
      expect(response.status).toBe(200);
    });

    it('stops another member minting one', async () => {
      // **The guard this feature introduces.** createSignedUrl goes through the
      // storage SELECT policy, so a member who cannot read the object cannot
      // mint a link to it either — otherwise the URL would be a way around the
      // policy rather than an expression of it.
      const path = await attachAFile();

      const { data, error } = await other.storage.from(BUCKET).createSignedUrl(path, 300);

      expect(error ?? data === null).toBeTruthy();
      expect(data?.signedUrl).toBeUndefined();
    });

    it('fetches without a session, which is what signing means', async () => {
      // Stated as a test because it is the reason the TTL is short and the
      // reason nothing stores one: a minted URL is a bearer token for that
      // object until it expires.
      const path = await attachAFile();
      const { data } = await author.storage.from(BUCKET).createSignedUrl(path, 300);

      // No Authorization header — the signature is the whole credential.
      const response = await fetch(data!.signedUrl);

      expect(response.status).toBe(200);
    });

    it('refuses a path the caller made up', async () => {
      const { data, error } = await author.storage
        .from(BUCKET)
        .createSignedUrl(`${familyId}/${documentId}/never-uploaded.jpg`, 300);

      expect(error ?? data === null).toBeTruthy();
    });
  });

  describe('cleanup', () => {
    it('removes the objects when the document goes', async () => {
      const path = await attachAFile();

      await author.from('documents').delete().eq('id', documentId);

      const { error } = await author.storage.from(BUCKET).download(path);
      expect(error).not.toBeNull();
    });

    it('removes the objects when the whole family goes', async () => {
      // The case the client never sees, and the reason the trigger exists: no
      // screen knows which files went with a cascaded document.
      const path = await attachAFile();

      await author.from('families').delete().eq('id', familyId);

      const { error } = await author.storage.from(BUCKET).download(path);
      expect(error).not.toBeNull();
    });
  });
});
