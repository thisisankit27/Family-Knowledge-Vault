/**
 * The memories policies — run with `npm run test:rls`, excluded from CI.
 *
 * The second record table, and the first test of whether `docs/15` §8.2
 * generalised or merely fitted documents. Nothing new was designed for it: no
 * helper, no edit to `can_see_record`, no role named in any policy.
 *
 * Four things earn the round trip, and the first two are the ones that differ
 * from `document.rls.test.ts` rather than repeating it:
 *
 * **A memory defaults to `family`, and documents default to `private`.** So the
 * common case here is a row its author did *not* write being legitimately
 * readable — the state that took documents until PR-15a to reach. Every
 * write-refusal test below therefore runs against a memory the attacker **can
 * read**, which is the harder case and the one that catches a policy that
 * confused reading with writing.
 *
 * **The subject grants nothing.** `can_see_record` has a branch that would give
 * a private record to the person it is about, and `20260810090000` left it live
 * for exactly this table to use. `docs/18` §3.4 declined it. The test named
 * *"names a member as the subject of a private memory"* is what would fail if
 * somebody later 'restored' `member_id` to the subject position — which the
 * documents migration header once speculated PR-15 would do.
 *
 * **Refused writes must change nothing.** Under RLS an UPDATE or DELETE matching
 * no visible row is not an error: Postgres reports success having done nothing.
 * So every attack is checked twice — what the attacker got back, and what the
 * victim still sees.
 *
 * **Test names say the condition they depend on**, not the outcome they happen
 * to produce. PR-15a's four storage tests said "another member cannot reach
 * these bytes" when the requirement was "only somebody who can read the row
 * can"; the two agreed exactly until sharing shipped, and a suite cannot tell
 * which one it is defending while they agree.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const PASSWORD = 'rls-test-password';
const OWNER = { email: 'rls-mem-owner@example.com', password: PASSWORD };
const AUTHOR = { email: 'rls-mem-author@example.com', password: PASSWORD };
const OTHER = { email: 'rls-mem-other@example.com', password: PASSWORD };
const GUEST = { email: 'rls-mem-guest@example.com', password: PASSWORD };
const OUTSIDER = { email: 'rls-mem-outsider@example.com', password: PASSWORD };

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

interface MemoryRow {
  id: string;
  title: string;
  visibility: string;
  member_id: string | null;
  occurred_on: string | null;
  occurred_precision: string;
  archived_at: string | null;
}

const COLUMNS = 'id, title, visibility, member_id, occurred_on, occurred_precision, archived_at';

describeRls('memories', () => {
  let owner: SupabaseClient;
  let author: SupabaseClient;
  let other: SupabaseClient;
  let guest: SupabaseClient;
  let outsider: SupabaseClient;
  let ownerId: string;
  let authorId: string;
  let otherId: string;
  let familyId: string;

  async function read(client: SupabaseClient): Promise<MemoryRow[]> {
    const { data, error } = await client.from('memories').select(COLUMNS).eq('family_id', familyId);
    if (error) throw error;
    return (data ?? []) as MemoryRow[];
  }

  async function keep(
    client: SupabaseClient,
    creatorId: string,
    fields: {
      title: string;
      visibility?: string;
      member_id?: string | null;
      occurred_on?: string | null;
      occurred_precision?: string;
    },
  ): Promise<MemoryRow> {
    const { data, error } = await client
      .from('memories')
      .insert({
        family_id: familyId,
        created_by: creatorId,
        // No `visibility` — the column defaults to 'family', and a helper that
        // set it would hide exactly the divergence these tests exist to check.
        ...fields,
      })
      .select(COLUMNS)
      .single();
    if (error) throw error;
    return data as MemoryRow;
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
    author = freshClient();
    other = freshClient();
    guest = freshClient();
    outsider = freshClient();

    ownerId = await signInOrSignUp(owner, OWNER);
    authorId = await signInOrSignUp(author, AUTHOR);
    otherId = await signInOrSignUp(other, OTHER);
    await signInOrSignUp(guest, GUEST);
    await signInOrSignUp(outsider, OUTSIDER);
  });

  beforeEach(async () => {
    // Owner first: deleting the family cascades its access rows and frees
    // everyone else, and `redeem_invitation` refuses anyone already in a family.
    for (const client of [owner, author, other, guest, outsider]) {
      await leaveEverything(client);
    }

    const { data: family, error } = await owner.rpc('create_family', {
      family_name: 'The Album',
    });
    if (error) throw error;
    familyId = (family as { id: string }).id;

    await inviteAndJoin(author, 'member');
    await inviteAndJoin(other, 'member');
    await inviteAndJoin(guest, 'guest');
  });

  afterAll(async () => {
    for (const client of [owner, author, other, guest, outsider]) {
      await leaveEverything(client);
    }
  });

  // -------------------------------------------------------------------------
  // The default, which is the thing that differs from documents
  // -------------------------------------------------------------------------

  it('gives a new memory family visibility when the caller names none', async () => {
    const kept = await keep(author, authorId, { title: 'Diwali' });
    expect(kept.visibility).toBe('family');
  });

  it('lets another member read a memory whose visibility is family', async () => {
    // The case documents could not reach until PR-15a, and the normal one here.
    await keep(author, authorId, { title: 'Diwali' });

    const seen = await read(other);
    expect(seen.map((row) => row.title)).toContain('Diwali');
  });

  it('lets the owner read a memory whose visibility is family', async () => {
    await keep(author, authorId, { title: 'Diwali' });

    const seen = await read(owner);
    expect(seen.map((row) => row.title)).toContain('Diwali');
  });

  // -------------------------------------------------------------------------
  // Reading a private memory
  // -------------------------------------------------------------------------

  it('hides a private memory from another member of the same family', async () => {
    await keep(author, authorId, { title: 'Therapy notes', visibility: 'private' });

    const seen = await read(other);
    expect(seen.map((row) => row.title)).not.toContain('Therapy notes');
  });

  it('hides a private memory from the family owner', async () => {
    // docs/15 §8.4: no role reads a private record. Not Owner, not Admin.
    await keep(author, authorId, { title: 'Therapy notes', visibility: 'private' });

    const seen = await read(owner);
    expect(seen.map((row) => row.title)).not.toContain('Therapy notes');
  });

  it('shows a private memory to the author who wrote it', async () => {
    // The positive case beside the two above: a policy denying everything would
    // pass both of them while making the feature useless.
    await keep(author, authorId, { title: 'Therapy notes', visibility: 'private' });

    const seen = await read(author);
    expect(seen.map((row) => row.title)).toContain('Therapy notes');
  });

  it('hides a private memory from the member it names as its subject', async () => {
    // **The test this suite exists for.** `can_see_record`'s private branch
    // grants to the author OR the subject, and that branch is still live in the
    // function. The memories policies pass `null`, so naming somebody here is a
    // label and nothing more (docs/18 §3.4).
    //
    // If a later migration "restores" member_id to the subject position, this is
    // what fails — and it is the only thing that would.
    const subject = await personFor(otherId);
    await keep(author, authorId, {
      title: 'A letter I have not sent',
      visibility: 'private',
      member_id: subject,
    });

    const seen = await read(other);
    expect(seen.map((row) => row.title)).not.toContain('A letter I have not sent');
  });

  // -------------------------------------------------------------------------
  // A Guest reads nothing, and no policy says the word "guest"
  // -------------------------------------------------------------------------

  it('returns nothing to a guest even when the memory is family-visible', async () => {
    await keep(author, authorId, { title: 'Diwali' });

    const seen = await read(guest);
    expect(seen).toEqual([]);
  });

  it('refuses a guest keeping a memory', async () => {
    const { error } = await guest
      .from('memories')
      .insert({ family_id: familyId, created_by: (await guest.auth.getUser()).data.user!.id, title: 'Mine' })
      .select('id');

    expect(error).not.toBeNull();

    const seen = await read(author);
    expect(seen.map((row) => row.title)).not.toContain('Mine');
  });

  // -------------------------------------------------------------------------
  // The tenant boundary
  // -------------------------------------------------------------------------

  it('returns nothing to somebody with no access to the family', async () => {
    await keep(author, authorId, { title: 'Diwali' });

    const seen = await read(outsider);
    expect(seen).toEqual([]);
  });

  it('refuses an outsider keeping a memory in a family they are not in', async () => {
    const { error } = await outsider
      .from('memories')
      .insert({
        family_id: familyId,
        created_by: (await outsider.auth.getUser()).data.user!.id,
        title: 'Trespass',
      })
      .select('id');

    expect(error).not.toBeNull();

    const seen = await read(author);
    expect(seen.map((row) => row.title)).not.toContain('Trespass');
  });

  it('refuses a memory whose subject belongs to another family', async () => {
    // Structural rather than policy-refused: the composite foreign key means the
    // row cannot be represented, so nothing has to check for it.
    const subject = await personFor(authorId);

    await leaveEverything(outsider);
    const { data: theirs, error: familyError } = await outsider.rpc('create_family', {
      family_name: 'Another Album',
    });
    if (familyError) throw familyError;

    const { error } = await outsider
      .from('memories')
      .insert({
        family_id: (theirs as { id: string }).id,
        created_by: (await outsider.auth.getUser()).data.user!.id,
        title: 'Not mine to name',
        member_id: subject,
      })
      .select('id');

    expect(error).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Writing never widens, even when reading did
  // -------------------------------------------------------------------------

  it('stops another member renaming a family memory they can read', async () => {
    const kept = await keep(author, authorId, { title: 'Diwali' });

    const { data, error } = await other
      .from('memories')
      .update({ title: 'Renamed' })
      .eq('id', kept.id)
      .select('id');

    // Not a rejection — the row is readable, and the UPDATE policy simply
    // matches nothing. "No error" is why the second assertion exists.
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const [still] = await read(author);
    expect(still.title).toBe('Diwali');
  });

  it('stops the owner renaming a member’s family memory', async () => {
    const kept = await keep(author, authorId, { title: 'Diwali' });

    const { data, error } = await owner
      .from('memories')
      .update({ title: 'Renamed by the owner' })
      .eq('id', kept.id)
      .select('id');

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const [still] = await read(author);
    expect(still.title).toBe('Diwali');
  });

  it('stops another member making a family memory private', async () => {
    // Withdrawing somebody else's memory from the family is as much a change as
    // publishing one, and neither is a reader's to make.
    const kept = await keep(author, authorId, { title: 'Diwali' });

    const { data, error } = await other
      .from('memories')
      .update({ visibility: 'private' })
      .eq('id', kept.id)
      .select('id');

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const [still] = await read(author);
    expect(still.visibility).toBe('family');
  });

  it('stops another member deleting a family memory they can read', async () => {
    const kept = await keep(author, authorId, { title: 'Diwali' });

    const { data, error } = await other.from('memories').delete().eq('id', kept.id).select('id');

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const seen = await read(author);
    expect(seen.map((row) => row.title)).toContain('Diwali');
  });

  it('stops the owner deleting a member’s memory', async () => {
    const kept = await keep(author, authorId, { title: 'Diwali' });

    const { data, error } = await owner.from('memories').delete().eq('id', kept.id).select('id');

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const seen = await read(author);
    expect(seen.map((row) => row.title)).toContain('Diwali');
  });

  it('lets the author rename, share, archive and delete their own memory', async () => {
    // The positive case for all four refusals above.
    const kept = await keep(author, authorId, { title: 'Diwali' });

    const renamed = await author
      .from('memories')
      .update({ title: 'Diwali 2019' })
      .eq('id', kept.id)
      .select('id');
    expect(renamed.data).toHaveLength(1);

    const hidden = await author
      .from('memories')
      .update({ visibility: 'private' })
      .eq('id', kept.id)
      .select('id');
    expect(hidden.data).toHaveLength(1);

    const archived = await author
      .from('memories')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', kept.id)
      .select('id');
    expect(archived.data).toHaveLength(1);

    const removed = await author.from('memories').delete().eq('id', kept.id).select('id');
    expect(removed.data).toHaveLength(1);

    expect(await read(author)).toEqual([]);
  });

  it('refuses to move authorship of a memory to somebody else', async () => {
    // `memories_pin_created_by`. Authorship is what every policy keys on, so it
    // must not be rewritable by the row's own UPDATE policy.
    const kept = await keep(author, authorId, { title: 'Diwali' });

    const { error } = await author
      .from('memories')
      .update({ created_by: otherId })
      .eq('id', kept.id)
      .select('id');

    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });

  // -------------------------------------------------------------------------
  // Access revoked
  // -------------------------------------------------------------------------

  it('stops a removed author reading the private memory they wrote', async () => {
    // `can_see_record`'s leading has_family_access gate. Without it,
    // `created_by = auth.uid()` would stay true forever.
    await keep(author, authorId, { title: 'Therapy notes', visibility: 'private' });

    const { error } = await owner.rpc('remove_family_access', {
      target_family: familyId,
      target_user: authorId,
    });
    if (error) throw error;

    const seen = await read(author);
    expect(seen).toEqual([]);
  });

  it('stops a removed author editing the memory they wrote', async () => {
    const kept = await keep(author, authorId, { title: 'Diwali' });

    const { error } = await owner.rpc('remove_family_access', {
      target_family: familyId,
      target_user: authorId,
    });
    if (error) throw error;

    const { data } = await author
      .from('memories')
      .update({ title: 'Still mine' })
      .eq('id', kept.id)
      .select('id');

    expect(data).toEqual([]);

    const [still] = await read(owner);
    expect(still.title).toBe('Diwali');
  });

  // -------------------------------------------------------------------------
  // memory_members — a link grants nothing
  // -------------------------------------------------------------------------

  it('lets the author link a person to their own memory', async () => {
    const kept = await keep(author, authorId, { title: 'Diwali' });
    const person = await personFor(otherId);

    const { error } = await author
      .from('memory_members')
      .insert({ memory_id: kept.id, member_id: person, family_id: familyId })
      .select('memory_id');

    expect(error).toBeNull();
  });

  it('stops another member linking a person to a memory they did not write', async () => {
    const kept = await keep(author, authorId, { title: 'Diwali' });
    const person = await personFor(otherId);

    const { error } = await other
      .from('memory_members')
      .insert({ memory_id: kept.id, member_id: person, family_id: familyId })
      .select('memory_id');

    expect(error).not.toBeNull();
  });

  it('does not let a link make a private memory readable', async () => {
    // The privilege escalation the table's header comment warns about. The
    // author links the other member deliberately; it must still grant nothing.
    const kept = await keep(author, authorId, {
      title: 'Therapy notes',
      visibility: 'private',
    });
    const person = await personFor(otherId);

    const { error } = await author
      .from('memory_members')
      .insert({ memory_id: kept.id, member_id: person, family_id: familyId })
      .select('memory_id');
    expect(error).toBeNull();

    const seen = await read(other);
    expect(seen.map((row) => row.title)).not.toContain('Therapy notes');
  });

  it('hides the links of a private memory from everybody but its author', async () => {
    // The row hidden and the things hanging off it not — 20260810090000 §5.
    const kept = await keep(author, authorId, {
      title: 'Therapy notes',
      visibility: 'private',
    });
    const person = await personFor(otherId);
    await author
      .from('memory_members')
      .insert({ memory_id: kept.id, member_id: person, family_id: familyId });

    const theirs = await other.from('memory_members').select('memory_id').eq('memory_id', kept.id);
    expect(theirs.data ?? []).toEqual([]);

    const mine = await author.from('memory_members').select('memory_id').eq('memory_id', kept.id);
    expect(mine.data ?? []).toHaveLength(1);
  });

  it('shows the links of a family memory to another member', async () => {
    // The positive case: reading a link follows the memory's own visibility.
    const kept = await keep(author, authorId, { title: 'Diwali' });
    const person = await personFor(otherId);
    await author
      .from('memory_members')
      .insert({ memory_id: kept.id, member_id: person, family_id: familyId });

    const theirs = await other.from('memory_members').select('memory_id').eq('memory_id', kept.id);
    expect(theirs.data ?? []).toHaveLength(1);
  });

  it('removes the links when the memory is deleted', async () => {
    const kept = await keep(author, authorId, { title: 'Diwali' });
    const person = await personFor(otherId);
    await author
      .from('memory_members')
      .insert({ memory_id: kept.id, member_id: person, family_id: familyId });

    await author.from('memories').delete().eq('id', kept.id);

    const left = await author.from('memory_members').select('memory_id').eq('memory_id', kept.id);
    expect(left.data ?? []).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // The columns behave as the screens assume
  // -------------------------------------------------------------------------

  it('keeps a memory whose date nobody remembers', async () => {
    const kept = await keep(author, authorId, { title: 'A photograph', occurred_on: null });
    expect(kept.occurred_on).toBeNull();
    expect(kept.occurred_precision).toBe('day');
  });

  it('refuses a precision the check constraint does not know', async () => {
    const { error } = await author
      .from('memories')
      .insert({
        family_id: familyId,
        created_by: authorId,
        title: 'Sometime',
        occurred_precision: 'decade',
      })
      .select('id');

    expect(error).not.toBeNull();
  });

  it('refuses a visibility the resolver would fail closed on', async () => {
    const { error } = await author
      .from('memories')
      .insert({
        family_id: familyId,
        created_by: authorId,
        title: 'Somewhere',
        visibility: 'shared',
      })
      .select('id');

    expect(error).not.toBeNull();
  });

  it('keeps an archived memory readable, because archive is not delete', async () => {
    const kept = await keep(author, authorId, { title: 'Diwali' });
    await author
      .from('memories')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', kept.id);

    const seen = await read(author);
    expect(seen.map((row) => row.title)).toContain('Diwali');
    expect(seen[0].archived_at).not.toBeNull();
  });

  it('removes a family’s memories when the family is deleted', async () => {
    await keep(author, authorId, { title: 'Diwali' });

    const { error } = await owner.from('families').delete().eq('id', familyId);
    expect(error).toBeNull();

    const seen = await read(author);
    expect(seen).toEqual([]);
  });
});
