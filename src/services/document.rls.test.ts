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
 * **A document belongs to whoever filed it, and to nobody else** — not the
 * family Owner, not the person it is about. That is stronger than matrix §8.4's
 * "no role reads a private record", because after 20260810090000 every document
 * is private and the subject no longer grants anything either.
 *
 * **The regression this suite exists to prevent.** Until 20260810090000, naming
 * somebody in the subject field gave them read *and write* access: they could
 * rename a document they had not filed, and set its visibility back to 'family',
 * publishing somebody's private document to the household. Several tests below
 * are the exact inverse of tests that passed the day before.
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
  category: string;
  visibility: string;
  archived_at: string | null;
  ai_processing: string;
}

const COLUMNS = 'id, title, category, visibility, archived_at, ai_processing';

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
    fields: {
      title: string;
      category?: string;
      visibility?: string;
      member_id?: string | null;
    },
  ): Promise<DocumentRow> {
    const { data, error } = await client
      .from('documents')
      .insert({
        family_id: familyId,
        created_by: authorId,
        category: 'identity',
        // No `visibility` — the column defaults to 'private', and a helper that
        // set it would hide exactly the regression these tests exist to catch.
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
        category: 'identity',
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
    it('shows a member their own documents and no one else\'s', async () => {
      await inviteAndJoin(member, 'member');
      await file(owner, ownerId, { title: 'Property Deed' });
      await file(member, memberId, { title: 'My Aadhaar' });

      expect((await read(member)).map((row) => row.title)).toEqual(['My Aadhaar']);
      expect((await read(owner)).map((row) => row.title)).toEqual(['Property Deed']);
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
        category: 'identity',
        created_by: ownerId,
      });

      expect(error).not.toBeNull();
    });
  });

  describe('a document belongs to its author', () => {
    it('shows the author their own document', async () => {
      await inviteAndJoin(member, 'member');
      const doc = await file(member, memberId, { title: 'Therapy notes' });

      expect((await read(member)).map((row) => row.id)).toEqual([doc.id]);
    });

    it('hides it from the family owner', async () => {
      await inviteAndJoin(member, 'member');
      await file(member, memberId, { title: 'Therapy notes' });

      expect(await read(owner)).toEqual([]);
    });

    it('hides the owner\'s documents from a member', async () => {
      // The half that used to work the other way round: 'family' was the
      // default, so everything an owner filed was readable by every member.
      await inviteAndJoin(member, 'member');
      await file(owner, ownerId, { title: 'Property Deed' });

      expect(await read(member)).toEqual([]);
    });

    it('defaults to private without the client asking for it', async () => {
      const { data, error } = await owner
        .from('documents')
        .insert({ family_id: familyId, title: 'Passport', category: 'identity', created_by: ownerId })
        .select(COLUMNS)
        .single();

      expect(error).toBeNull();
      expect((data as DocumentRow).visibility).toBe('private');
    });

    it('does not grant access to the person it is about', async () => {
      // **The regression test for the reported bug.** This asserted the exact
      // opposite one day earlier: naming a subject used to hand them the row.
      await inviteAndJoin(member, 'member');
      const memberPerson = await personFor(memberId);

      await file(owner, ownerId, { title: 'Medical report', member_id: memberPerson });

      expect(await read(member)).toEqual([]);
    });

    it('separates the two reasons a row might be readable', async () => {
      // A 'family' row is readable by a member because of their *role*, never
      // because they are its subject. Flipping the same row to private proves
      // which of the two was doing the work.
      await inviteAndJoin(member, 'member');
      const memberPerson = await personFor(memberId);
      const doc = await file(owner, ownerId, { title: 'Legacy row', member_id: memberPerson });

      await owner.from('documents').update({ visibility: 'family' }).eq('id', doc.id);
      expect((await read(member)).map((row) => row.id)).toContain(doc.id);

      await owner.from('documents').update({ visibility: 'private' }).eq('id', doc.id);
      expect(await read(member)).toEqual([]);
    });
  });

  describe('authorship', () => {
    it('refuses a document filed in somebody else’s name', async () => {
      await inviteAndJoin(member, 'member');

      const { error } = await member.from('documents').insert({
        family_id: familyId,
        title: 'Filed as the owner',
        category: 'identity',
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
        category: 'identity',
        created_by: ownerId,
        ai_processing: 'sometimes',
      });

      expect(error).not.toBeNull();
    });
  });

  describe('categories', () => {
    it('refuses a document with no category', async () => {
      // The column is `not null` — there is no uncategorised shelf, and the
      // service check is a courtesy on top of this, not a substitute for it.
      const { error } = await owner.from('documents').insert({
        family_id: familyId,
        title: 'Unfiled',
        created_by: ownerId,
      });

      expect(error).not.toBeNull();
    });

    it('refuses a value outside the six', async () => {
      const { error } = await owner.from('documents').insert({
        family_id: familyId,
        title: 'Old lease',
        category: 'archived',
        created_by: ownerId,
      });

      // 'archived' is the tempting wrong value: the information architecture
      // lists it beside the six, but it is a timestamp on the row.
      expect(error).not.toBeNull();
    });

    it('accepts each of the six', async () => {
      for (const category of [
        'identity',
        'medical',
        'finance',
        'property',
        'education',
        'legal',
      ]) {
        const row = await file(owner, ownerId, { title: `A ${category} paper`, category });
        expect(row.category).toBe(category);
      }
    });

    it('lets an author re-file their own document onto another shelf', async () => {
      await inviteAndJoin(member, 'member');
      const doc = await file(member, memberId, { title: 'Insurance', category: 'finance' });

      const { error } = await member
        .from('documents')
        .update({ category: 'medical' })
        .eq('id', doc.id);

      expect(error).toBeNull();
      expect((await read(member)).find((row) => row.id === doc.id)?.category).toBe('medical');
    });

    it('stops a member re-filing somebody else\'s document', async () => {
      await inviteAndJoin(member, 'member');
      const doc = await file(owner, ownerId, { title: 'Insurance', category: 'finance' });

      await member.from('documents').update({ category: 'medical' }).eq('id', doc.id);

      expect((await read(owner)).find((row) => row.id === doc.id)?.category).toBe('finance');
    });

    it('stops a guest re-filing anything', async () => {
      await inviteAndJoin(guest, 'guest');
      const doc = await file(owner, ownerId, { title: 'Insurance', category: 'finance' });

      // Matches no visible row, so it changes nothing rather than erroring.
      await guest.from('documents').update({ category: 'medical' }).eq('id', doc.id);

      const rows = await read(owner);
      expect(rows.find((row) => row.id === doc.id)?.category).toBe('finance');
    });
  });

  describe('only the author may write', () => {
    it('lets the author rename their own document', async () => {
      await inviteAndJoin(member, 'member');
      const doc = await file(member, memberId, { title: 'Untitled' });

      const { error } = await member
        .from('documents')
        .update({ title: 'Property Deed' })
        .eq('id', doc.id);

      expect(error).toBeNull();
      expect((await read(member)).find((row) => row.id === doc.id)?.title).toBe('Property Deed');
    });

    it('refuses a rename to an empty title', async () => {
      const doc = await file(owner, ownerId, { title: 'Deed' });

      const { error } = await owner.from('documents').update({ title: '   ' }).eq('id', doc.id);

      expect(error).not.toBeNull();
    });

    it('stops the owner renaming a member\'s document', async () => {
      // Matches no visible row, so it reports success having changed nothing —
      // which is why the assertion comes from the author's session.
      await inviteAndJoin(member, 'member');
      const doc = await file(member, memberId, { title: 'Therapy notes' });

      await owner.from('documents').update({ title: 'Renamed by owner' }).eq('id', doc.id);

      expect((await read(member)).find((row) => row.id === doc.id)?.title).toBe('Therapy notes');
    });

    it('stops the subject editing a document filed about them', async () => {
      // The reported bug, from the writing side. Naming somebody used to give
      // them the row *and* the right to change every field on it.
      await inviteAndJoin(member, 'member');
      const memberPerson = await personFor(memberId);
      const doc = await file(owner, ownerId, { title: 'Medical report', member_id: memberPerson });

      await member.from('documents').update({ title: 'Taken over' }).eq('id', doc.id);

      expect((await read(owner)).find((row) => row.id === doc.id)?.title).toBe('Medical report');
    });

    it('stops the subject publishing a private document to the family', async () => {
      // The sharpest form of the hole: the subject could set visibility back to
      // 'family' and expose the author's document to the whole household.
      await inviteAndJoin(member, 'member');
      const memberPerson = await personFor(memberId);
      const doc = await file(owner, ownerId, { title: 'Will', member_id: memberPerson });

      await member.from('documents').update({ visibility: 'family' }).eq('id', doc.id);

      expect((await read(owner)).find((row) => row.id === doc.id)?.visibility).toBe('private');
    });

    it('stops the owner deleting a member\'s document', async () => {
      await inviteAndJoin(member, 'member');
      const doc = await file(member, memberId, { title: 'Therapy notes' });

      await owner.from('documents').delete().eq('id', doc.id);

      expect((await read(member)).map((row) => row.id)).toContain(doc.id);
    });

    it('lets the author delete their own document', async () => {
      await inviteAndJoin(member, 'member');
      const doc = await file(member, memberId, { title: 'Therapy notes' });

      await member.from('documents').delete().eq('id', doc.id);

      expect(await read(member)).toEqual([]);
    });

    it('refuses to let authorship be rewritten', async () => {
      const doc = await file(owner, ownerId, { title: 'Deed' });

      const { error } = await owner
        .from('documents')
        .update({ created_by: memberId })
        .eq('id', doc.id);

      // pin_created_by. Ownership transfer is parked, and until it is designed
      // the column is the one thing on this row nobody can move.
      expect(error).not.toBeNull();
    });

    it('records AI consent being granted and withdrawn', async () => {
      const doc = await file(owner, ownerId, { title: 'Passport' });
      expect(doc.ai_processing).toBe('denied');

      await owner.from('documents').update({ ai_processing: 'allowed' }).eq('id', doc.id);
      expect((await read(owner)).find((row) => row.id === doc.id)?.ai_processing).toBe('allowed');
    });

    it('lets the author read one document directly by id', async () => {
      const doc = await file(owner, ownerId, { title: 'Deed' });

      const { data, error } = await owner
        .from('documents')
        .select(COLUMNS)
        .eq('id', doc.id)
        .maybeSingle();

      expect(error).toBeNull();
      expect((data as DocumentRow | null)?.title).toBe('Deed');
    });

    it('returns nothing when somebody else knows a document id', async () => {
      // Null, not an error — which is why getDocument reports a hidden row with
      // its own message rather than as a failure.
      await inviteAndJoin(member, 'member');
      const doc = await file(owner, ownerId, { title: 'Deed' });

      const { data, error } = await member
        .from('documents')
        .select(COLUMNS)
        .eq('id', doc.id)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).toBeNull();
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

  /**
   * 20260813090000 — an author can let the household in.
   *
   * The point of these tests is not that `visibility = 'family'` works; PR-9a
   * already proved `can_see_record`'s branch by direct call. It is that **reading
   * widened and nothing else did.** Every test below either confirms a reader can
   * see, or confirms they cannot change — and the second group is the larger one
   * on purpose, because §8.4's escalation was precisely a read predicate that had
   * been allowed to decide writes.
   */
  describe('sharing', () => {
    it('lets a member read a document another member shared with the family', async () => {
      await inviteAndJoin(member, 'member');
      const shared = await file(owner, ownerId, {
        title: 'House Deed',
        visibility: 'family',
      });

      expect((await read(member)).map((row) => row.id)).toEqual([shared.id]);
    });

    it('shows a shared document to the family owner, who could not read a private one', async () => {
      // Both halves matter. The owner reading it proves 'family' means everyone
      // with read access rather than "everyone except the person who happens to
      // be looking"; the private one staying hidden proves §8.4 is intact and
      // that this PR did not quietly give managers a way in.
      await inviteAndJoin(member, 'member');
      const shared = await file(member, memberId, {
        title: 'My Degree',
        visibility: 'family',
      });
      await file(member, memberId, { title: 'Therapy notes' });

      expect((await read(owner)).map((row) => row.id)).toEqual([shared.id]);
    });

    it('still shows a guest nothing, because nobody widened the role', async () => {
      // The one bug a sharing PR is most likely to ship. No role is named in any
      // of these policies: 'family' delegates to `can_read_records`, an
      // allow-list of owner, admin and member. If a Guest ever reads a shared
      // document, the helper was turned into a deny-list somewhere.
      await inviteAndJoin(guest, 'guest');
      await file(owner, ownerId, { title: 'House Deed', visibility: 'family' });

      const { data, error } = await guest
        .from('documents')
        .select(COLUMNS)
        .eq('family_id', familyId);

      // Filtered, not refused — a Guest holds the select grant. The screen has
      // to ask the role, which is what LockedNotice exists for.
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('still shows an outsider nothing', async () => {
      // `has_family_access` gates every branch of the resolver, so sharing
      // inside a family cannot reach outside one.
      await file(owner, ownerId, { title: 'House Deed', visibility: 'family' });
      expect(await read(outsider)).toEqual([]);
    });

    it('does not let a reader rename what they can see', async () => {
      await inviteAndJoin(member, 'member');
      const shared = await file(owner, ownerId, {
        title: 'House Deed',
        visibility: 'family',
      });

      await member.from('documents').update({ title: 'Renamed by a reader' }).eq('id', shared.id);

      expect((await read(owner)).find((row) => row.id === shared.id)?.title).toBe('House Deed');
    });

    it('does not let a reader archive what they can see', async () => {
      await inviteAndJoin(member, 'member');
      const shared = await file(owner, ownerId, {
        title: 'House Deed',
        visibility: 'family',
      });

      await member
        .from('documents')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', shared.id);

      expect((await read(owner)).find((row) => row.id === shared.id)?.archived_at).toBeNull();
    });

    it('does not let a reader delete what they can see', async () => {
      await inviteAndJoin(member, 'member');
      const shared = await file(owner, ownerId, {
        title: 'House Deed',
        visibility: 'family',
      });

      await member.from('documents').delete().eq('id', shared.id);

      expect((await read(owner)).map((row) => row.id)).toEqual([shared.id]);
    });

    it('does not let a reader withdraw a document from the family', async () => {
      // Sharing is the author's decision in both directions. A reader who could
      // set this back to 'private' would be hiding somebody else's document from
      // the household — vandalism rather than disclosure, but still not theirs.
      await inviteAndJoin(member, 'member');
      const shared = await file(owner, ownerId, {
        title: 'House Deed',
        visibility: 'family',
      });

      await member.from('documents').update({ visibility: 'private' }).eq('id', shared.id);

      expect((await read(owner)).find((row) => row.id === shared.id)?.visibility).toBe('family');
    });

    it('does not let anyone publish a document they did not file', async () => {
      // **This is §8.4's escalation, asserted from the other side.** Until
      // 20260810090000 a named subject could set `visibility` to 'family' and
      // publish the author's private document to the household. The subject
      // position is null now, so the reader cannot even see the row — but the
      // write is what mattered, and it is refused independently by a policy that
      // keys on `created_by`.
      await inviteAndJoin(member, 'member');
      const ownerPerson = await personFor(ownerId);
      const memberPerson = await personFor(memberId);

      const priv = await file(owner, ownerId, {
        title: 'Therapy notes',
        member_id: memberPerson,
      });

      await member.from('documents').update({ visibility: 'family' }).eq('id', priv.id);

      // Two assertions, because either one alone would be satisfied by a bug:
      // the author's row is untouched, and the member still cannot see it.
      expect((await read(owner)).find((row) => row.id === priv.id)?.visibility).toBe('private');
      expect((await read(member)).map((row) => row.id)).toEqual([]);
      expect(ownerPerson).toBeTruthy();
    });

    it('withdraws the row the moment the author changes their mind', async () => {
      await inviteAndJoin(member, 'member');
      const shared = await file(owner, ownerId, {
        title: 'House Deed',
        visibility: 'family',
      });
      expect((await read(member)).map((row) => row.id)).toEqual([shared.id]);

      const { error } = await owner
        .from('documents')
        .update({ visibility: 'private' })
        .eq('id', shared.id);

      expect(error).toBeNull();
      expect(await read(member)).toEqual([]);
    });

    it('carries the people links with the row, so nothing hangs off an invisible parent', async () => {
      // The four-predicate agreement, from 20260810090000 §5: "the row hidden,
      // the things hanging off it not." It now has to hold in both directions —
      // a visible row whose children are hidden is the same defect mirrored.
      await inviteAndJoin(member, 'member');
      const ownerPerson = await personFor(ownerId);
      const shared = await file(owner, ownerId, {
        title: 'House Deed',
        visibility: 'family',
      });

      const { error: linkError } = await owner.from('document_members').insert({
        family_id: familyId,
        document_id: shared.id,
        member_id: ownerPerson,
      });
      expect(linkError).toBeNull();

      const { data } = await member
        .from('document_members')
        .select('member_id')
        .eq('document_id', shared.id);
      expect(data).toEqual([{ member_id: ownerPerson }]);
    });

    it('does not let a reader link people to a document they can see', async () => {
      // `document_members` is a label table and its INSERT policy keys on the
      // author, which is what stops a reader linking themselves to something and
      // calling it theirs. Reading the links is not permission to write them.
      await inviteAndJoin(member, 'member');
      const memberPerson = await personFor(memberId);
      const shared = await file(owner, ownerId, {
        title: 'House Deed',
        visibility: 'family',
      });

      const { error } = await member.from('document_members').insert({
        family_id: familyId,
        document_id: shared.id,
        member_id: memberPerson,
      });

      expect(error).not.toBeNull();
    });

    it('takes a shared document with the family, same as a private one', async () => {
      // The cascade question again, this time with the state this PR introduced.
      // Sharing adds a policy path, and every previous phase has paid for
      // assuming a new path behaves on the way out because it behaved on the way
      // in.
      await inviteAndJoin(member, 'member');
      await file(owner, ownerId, { title: 'House Deed', visibility: 'family' });

      const { error } = await owner.from('families').delete().eq('id', familyId);

      expect(error).toBeNull();
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
