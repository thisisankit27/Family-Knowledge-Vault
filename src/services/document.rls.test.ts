/**
 * The documents policies — run with `npm run test:rls`, excluded from CI.
 *
 * This is the first record table, so it is the first time the §8.2 contract is
 * exercised end to end rather than by direct calls to `can_see_record`. Four
 * things are worth the round trip:
 *
 * **The tenant boundary.** An outsider must see nothing and write nothing, and
 * — the part a policy alone does not give you — a write that is refused must
 * change no rows. Under RLS an UPDATE or DELETE matching no visible row is not
 * an error: Postgres reports success having done nothing. So every attack below
 * is checked twice, once for what the attacker got back and once from the
 * victim's own session.
 *
 * **A Guest reads nothing.** Nobody wrote a role into these policies;
 * `can_see_record` delegates 'family' to `can_read_records`, which excludes
 * Guest. Matrix §4.5 is enforced by an expression that names no role.
 *
 * **No role reads a private record** — not even the Owner (matrix §8.4). This
 * is the first table where that can be shown with real rows rather than
 * asserted about a function, and it is the decision most likely to be
 * "corrected" later by someone who thinks an Owner should see everything.
 *
 * **document_members grants nothing.** Linking yourself to a document must not
 * make it visible. If it did, any member could read any private document by
 * inserting one row, and no interface would be needed to do it.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const PASSWORD = 'rls-test-password';
const OWNER = { email: 'rls-doc-owner@example.com', password: PASSWORD };
const MEMBER = { email: 'rls-doc-member@example.com', password: PASSWORD };
const GUEST = { email: 'rls-doc-guest@example.com', password: PASSWORD };
const OUTSIDER = { email: 'rls-doc-outsider@example.com', password: PASSWORD };

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

interface DocumentRow {
  id: string;
  title: string;
  visibility: string;
  archived_at: string | null;
  ai_processing: string;
}

const COLUMNS = 'id, title, visibility, archived_at, ai_processing';

describeRls('documents', () => {
  let owner: SupabaseClient;
  let member: SupabaseClient;
  let guest: SupabaseClient;
  let outsider: SupabaseClient;
  let ownerId: string;
  let memberId: string;
  let familyId: string;

  async function read(client: SupabaseClient): Promise<DocumentRow[]> {
    const { data, error } = await client
      .from('documents')
      .select(COLUMNS)
      .eq('family_id', familyId);
    if (error) throw error;
    return (data ?? []) as DocumentRow[];
  }

  async function file(
    client: SupabaseClient,
    authorId: string,
    fields: { title: string; visibility?: string; member_id?: string | null },
  ): Promise<DocumentRow> {
    const { data, error } = await client
      .from('documents')
      .insert({
        family_id: familyId,
        created_by: authorId,
        visibility: 'family',
        ...fields,
      })
      .select(COLUMNS)
      .single();
    if (error) throw error;
    return data as DocumentRow;
  }

  async function inviteAndJoin(client: SupabaseClient, role: string): Promise<void> {
    const { data: invitation, error } = await owner.rpc('create_invitation', {
      target_family: familyId,
      invited_role: role,
    });
    if (error) throw error;
    const { error: joinError } = await client.rpc('redeem_invitation', {
      invitation_code: invitation.code,
    });
    if (joinError) throw joinError;
  }

  /** The person row auto-created for an account when it gained access. */
  async function personFor(userId: string): Promise<string> {
    const { data, error } = await owner
      .from('family_members')
      .select('id')
      .eq('family_id', familyId)
      .eq('user_id', userId)
      .single();
    if (error) throw error;
    return (data as { id: string }).id;
  }

  beforeAll(async () => {
    owner = freshClient();
    member = freshClient();
    guest = freshClient();
    outsider = freshClient();

    ownerId = await signInOrSignUp(owner, OWNER);
    memberId = await signInOrSignUp(member, MEMBER);
    await signInOrSignUp(guest, GUEST);
    await signInOrSignUp(outsider, OUTSIDER);
  });

  beforeEach(async () => {
    for (const client of [owner, member, guest, outsider]) {
      await leaveEverything(client);
    }

    const { data: family, error } = await owner.rpc('create_family', {
      family_name: 'The Filing Cabinet',
    });
    if (error) throw error;
    familyId = (family as { id: string }).id;
  });

  afterAll(async () => {
    for (const client of [owner, member, guest, outsider]) {
      await leaveEverything(client);
    }
  });

  // -------------------------------------------------------------------------

  describe('the tenant boundary', () => {
    it('shows an outsider nothing', async () => {
      await file(owner, ownerId, { title: 'Property Deed' });
      expect(await read(outsider)).toEqual([]);
    });

    it('refuses an outsider a write, and changes nothing', async () => {
      const { error } = await outsider.from('documents').insert({
        family_id: familyId,
        title: 'Injected',
        created_by: ownerId,
      });

      expect(error).not.toBeNull();
      expect(await read(owner)).toEqual([]);
    });

    it('lets an outsider delete nothing, and the row survives', async () => {
      // The delete matches no visible row, so it "succeeds" affecting nothing.
      // Asserting on the absence of an error would prove the opposite of what
      // this test is for; the victim's own read is the assertion.
      const doc = await file(owner, ownerId, { title: 'Insurance Policy' });

      await outsider.from('documents').delete().eq('id', doc.id);

      const survivors = await read(owner);
      expect(survivors.map((row) => row.id)).toEqual([doc.id]);
    });
  });

  describe('who may read', () => {
    it('shows a member the family documents', async () => {
      await inviteAndJoin(member, 'member');
      await file(owner, ownerId, { title: 'Property Deed' });

      const rows = await read(member);
      expect(rows.map((row) => row.title)).toEqual(['Property Deed']);
    });

    it('shows a guest nothing, without any policy naming a role', async () => {
      await inviteAndJoin(guest, 'guest');
      await file(owner, ownerId, { title: 'Property Deed' });

      expect(await read(guest)).toEqual([]);
    });

    it('filters rather than errors, which is why the UI cannot ask the query', async () => {
      // The fact that caused a real defect on stream. A Guest holds the `select`
      // grant, so the read *succeeds* and returns zero rows — byte-identical to
      // what a family with no documents returns. `read()` throws on error, so
      // this passing at all is the assertion.
      //
      // The consequence: no screen can distinguish "empty" from "forbidden" by
      // looking at the result. It has to ask `canReadRecords(role)` instead,
      // which is what `LockedNotice` exists for. A missing *grant* would error;
      // a policy that filters never does.
      await inviteAndJoin(guest, 'guest');
      await file(owner, ownerId, { title: 'Property Deed' });

      const { data, error } = await guest
        .from('documents')
        .select(COLUMNS)
        .eq('family_id', familyId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('refuses a guest a write', async () => {
      await inviteAndJoin(guest, 'guest');

      const { error } = await guest.from('documents').insert({
        family_id: familyId,
        title: 'Guest note',
        created_by: ownerId,
      });

      expect(error).not.toBeNull();
    });
  });

  describe('private documents', () => {
    it('hides a member’s private document from the owner', async () => {
      // Matrix §8.4, and the decision most likely to be "fixed" by somebody who
      // assumes an Owner outranks privacy. The failure mode this project chose
      // is data being unreachable, never data leaking.
      await inviteAndJoin(member, 'member');
      await file(member, memberId, { title: 'Therapy notes', visibility: 'private' });

      expect(await read(owner)).toEqual([]);
    });

    it('shows the author their own private document', async () => {
      await inviteAndJoin(member, 'member');
      await file(member, memberId, { title: 'Therapy notes', visibility: 'private' });

      const rows = await read(member);
      expect(rows.map((row) => row.title)).toEqual(['Therapy notes']);
    });

    it('shows the subject a private document filed about them by someone else', async () => {
      // The other half of can_see_record's private branch: a document *about*
      // you is yours to read even when you did not file it.
      await inviteAndJoin(member, 'member');
      const memberPerson = await personFor(memberId);

      await file(owner, ownerId, {
        title: 'Medical report',
        visibility: 'private',
        member_id: memberPerson,
      });

      const rows = await read(member);
      expect(rows.map((row) => row.title)).toEqual(['Medical report']);
    });

    it('stops the owner deleting a private document they cannot read', async () => {
      // The DELETE policy gates on `can_see_record` *before* considering the
      // role, so managerial delete does not reach a record privacy already
      // hid. An owner-only delete would have been defensible — deleting is not
      // reading — but this is the stricter reading and it costs nothing: the
      // owner still holds the real escape hatch, which is deleting the family
      // and cascading everything, and that is auditable in a way a silent
      // single-row delete is not.
      await inviteAndJoin(member, 'member');
      const doc = await file(member, memberId, {
        title: 'Therapy notes',
        visibility: 'private',
      });

      // Matches no visible row, so it reports success having done nothing.
      await owner.from('documents').delete().eq('id', doc.id);

      // The author is the only one who can confirm either way.
      const rows = await read(member);
      expect(rows.map((row) => row.id)).toContain(doc.id);
    });

    it('lets the author delete their own private document', async () => {
      await inviteAndJoin(member, 'member');
      const doc = await file(member, memberId, {
        title: 'Therapy notes',
        visibility: 'private',
      });

      await member.from('documents').delete().eq('id', doc.id);

      expect(await read(member)).toEqual([]);
    });
  });

  describe('authorship', () => {
    it('refuses a document filed in somebody else’s name', async () => {
      await inviteAndJoin(member, 'member');

      const { error } = await member.from('documents').insert({
        family_id: familyId,
        title: 'Filed as the owner',
        created_by: ownerId,
      });

      expect(error).not.toBeNull();
    });

    it('refuses to let authorship be rewritten after the fact', async () => {
      // pin_created_by. Authorship is what both the delete policy and
      // can_see_record key on, so a rewritable column would be an escalation.
      await inviteAndJoin(member, 'member');
      const doc = await file(member, memberId, { title: 'Warranty' });

      const { error } = await member
        .from('documents')
        .update({ created_by: ownerId })
        .eq('id', doc.id);

      expect(error).not.toBeNull();
    });
  });

  describe('archive is not delete', () => {
    it('keeps an archived document readable', async () => {
      const doc = await file(owner, ownerId, { title: 'Old lease' });

      await owner
        .from('documents')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', doc.id);

      const rows = await read(owner);
      expect(rows).toHaveLength(1);
      expect(rows[0].archived_at).not.toBeNull();
    });

    it('restores an archived document', async () => {
      const doc = await file(owner, ownerId, { title: 'Old lease' });
      await owner.from('documents').update({ archived_at: new Date().toISOString() }).eq('id', doc.id);

      await owner.from('documents').update({ archived_at: null }).eq('id', doc.id);

      const rows = await read(owner);
      expect(rows[0].archived_at).toBeNull();
    });
  });

  describe('AI consent', () => {
    it('defaults to denied when nobody was asked', async () => {
      // Consent that was never given is not consent. Phase 9 must not be able
      // to read a document filed before anybody was asked the question.
      const doc = await file(owner, ownerId, { title: 'Passport' });
      expect(doc.ai_processing).toBe('denied');
    });

    it('refuses a value outside the vocabulary', async () => {
      const { error } = await owner.from('documents').insert({
        family_id: familyId,
        title: 'Passport',
        created_by: ownerId,
        ai_processing: 'sometimes',
      });

      expect(error).not.toBeNull();
    });
  });

  describe('document_members grants nothing', () => {
    it('does not make a private document visible to the person linked to it', async () => {
      // The escalation this table would be if a link were permission-bearing.
      // The owner links themselves as an additional subject of a document they
      // cannot read; can_see_record consults `documents.member_id` only, so the
      // link changes nothing.
      await inviteAndJoin(member, 'member');
      const doc = await file(member, memberId, {
        title: 'Therapy notes',
        visibility: 'private',
      });
      const ownerPerson = await personFor(ownerId);

      await owner.from('document_members').insert({
        document_id: doc.id,
        member_id: ownerPerson,
        family_id: familyId,
      });

      expect(await read(owner)).toEqual([]);
    });

    it('refuses an outsider a link', async () => {
      const doc = await file(owner, ownerId, { title: 'Deed' });
      const ownerPerson = await personFor(ownerId);

      const { error } = await outsider.from('document_members').insert({
        document_id: doc.id,
        member_id: ownerPerson,
        family_id: familyId,
      });

      expect(error).not.toBeNull();
    });
  });

  describe('document_files', () => {
    it('is not writable by any client', async () => {
      // No INSERT policy and no INSERT grant until PR-14, which adds them with
      // the upload flow. A client that could describe bytes before they exist
      // would leave the catalog claiming files nobody can fetch.
      const doc = await file(owner, ownerId, { title: 'Deed' });

      const { error } = await owner.from('document_files').insert({
        family_id: familyId,
        document_id: doc.id,
        provider_file_id: 'made-up',
        mime_type: 'application/pdf',
        size_bytes: 1,
      });

      expect(error).not.toBeNull();
    });
  });

  describe('deleting the family', () => {
    it('takes its documents with it and does not trip a trigger', async () => {
      // The cascade guard question, asked for a fourth time: what does this
      // mean for rows on their way out? PR-7, PR-9a and PR-10 each paid for
      // forgetting it.
      await file(owner, ownerId, { title: 'Deed' });

      const { error } = await owner.from('families').delete().eq('id', familyId);

      expect(error).toBeNull();
    });
  });
});
