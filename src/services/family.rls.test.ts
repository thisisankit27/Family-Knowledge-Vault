/**
 * Row-Level Security integration tests — the tenant boundary, exercised for real.
 *
 * These talk to the live Supabase project, so they are excluded from CI (which
 * has no credentials) via `testPathIgnorePatterns`. Run them deliberately:
 *
 *     npm run test:rls
 *
 * Why they exist rather than trusting the policies by inspection: a policy that
 * is subtly wrong still *looks* right. `docs/08-database-design.md` §22 makes
 * isolation the product's central promise, and every table added from PR-6
 * onward sits behind these same policies. If they are wrong, everything after
 * them is wrong too.
 *
 * A note on what is asserted. Under RLS, an UPDATE or DELETE that matches no
 * visible row is **not an error** — Postgres reports success having changed
 * nothing. So "no error was thrown" proves nothing at all here. Each write
 * attempt is checked twice: the attacker must receive zero affected rows, and
 * the victim's own session must confirm the data is untouched.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** Two throwaway accounts, reused across runs so the auth table stays tidy. */
const ALICE = { email: 'rls-a@example.com', password: 'rls-test-password' };
const BOB = { email: 'rls-b@example.com', password: 'rls-test-password' };

jest.setTimeout(60_000);

/**
 * Each user gets an isolated client. `persistSession: false` matters — sharing
 * storage would let the second sign-in overwrite the first, and the test would
 * then quietly check Bob against himself and pass while proving nothing.
 */
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
        'these tests need it off (Authentication → Sign In / Providers → Email).',
    );
  }
  return created.data.session.user.id;
}

const configured = Boolean(url && key);
const describeRls = configured ? describe : describe.skip;

if (!configured) {
  // eslint-disable-next-line no-console
  console.warn('Skipping RLS tests: EXPO_PUBLIC_SUPABASE_URL / key not found in .env');
}

describeRls('families RLS — one family cannot touch another', () => {
  let alice: SupabaseClient;
  let bob: SupabaseClient;
  let aliceId: string;
  let bobId: string;
  let aliceFamilyId: string;
  let bobFamilyId: string;

  const BOB_FAMILY_NAME = 'Bob Household';

  beforeAll(async () => {
    alice = freshClient();
    bob = freshClient();
    aliceId = await signInOrSignUp(alice, ALICE);
    bobId = await signInOrSignUp(bob, BOB);

    const aliceFamily = await alice.rpc('create_family', { family_name: 'Alice Household' });
    if (aliceFamily.error) throw aliceFamily.error;
    aliceFamilyId = aliceFamily.data.id;

    const bobFamily = await bob.rpc('create_family', { family_name: BOB_FAMILY_NAME });
    if (bobFamily.error) throw bobFamily.error;
    bobFamilyId = bobFamily.data.id;
  });

  afterAll(async () => {
    // Owners may delete their own family; membership rows cascade.
    if (aliceFamilyId) await alice.from('families').delete().eq('id', aliceFamilyId);
    if (bobFamilyId) await bob.from('families').delete().eq('id', bobFamilyId);
    await alice.auth.signOut();
    await bob.auth.signOut();
  });

  describe('creating a family', () => {
    it('makes the creator its owner', async () => {
      const { data, error } = await alice
        .from('family_members')
        .select('user_id, role')
        .eq('family_id', aliceFamilyId);

      expect(error).toBeNull();
      expect(data).toEqual([{ user_id: aliceId, role: 'owner' }]);
    });

    it('refuses a family inserted directly, bypassing create_family()', async () => {
      const { error } = await alice
        .from('families')
        .insert({ name: 'Impersonated', created_by: bobId })
        .select('id');

      expect(error).not.toBeNull();
      // Currently "permission denied": `authenticated` was never granted
      // INSERT, so this is refused at the privilege layer before RLS is even
      // consulted. Either refusal is acceptable — what must never change is
      // that create_family() is the only way a family comes into existence,
      // which is what makes created_by unforgeable.
      expect(error?.message.toLowerCase()).toMatch(/permission denied|row-level security/);

      const check = await alice.from('families').select('id').eq('name', 'Impersonated');
      expect(check.data).toEqual([]);
    });

    it('records the caller as creator, whatever the client wanted', async () => {
      // create_family takes only a name; ownership comes from auth.uid().
      const { data, error } = await alice.rpc('create_family', { family_name: 'Throwaway' });

      expect(error).toBeNull();
      expect(data.created_by).toBe(aliceId);

      await alice.from('families').delete().eq('id', data.id);
    });
  });

  describe('SELECT', () => {
    it('shows Alice her own family and never Bob’s', async () => {
      const { data, error } = await alice.from('families').select('id');
      const visible = (data ?? []).map((row) => row.id);

      expect(error).toBeNull();
      // Asserted as contains/excludes rather than an exact list: an earlier
      // run that died before its cleanup would otherwise fail this test for a
      // reason that has nothing to do with isolation.
      expect(visible).toContain(aliceFamilyId);
      expect(visible).not.toContain(bobFamilyId);
    });

    it('returns nothing when Alice asks for Bob’s family by id', async () => {
      const { data, error } = await alice.from('families').select('id').eq('id', bobFamilyId);

      // Not an error — simply invisible. That is what RLS does.
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('hides Bob’s membership rows from Alice', async () => {
      const { data, error } = await alice
        .from('family_members')
        .select('user_id')
        .eq('family_id', bobFamilyId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  describe('INSERT', () => {
    it('stops Alice adding herself to Bob’s family', async () => {
      // family_members has no INSERT policy at all, so this is denied by
      // default — create_family() is the only thing that grants membership,
      // and it grants it only to the caller.
      const { data, error } = await alice
        .from('family_members')
        .insert({ family_id: bobFamilyId, user_id: aliceId, role: 'owner' })
        .select('user_id');

      expect(error).not.toBeNull();
      expect(data).toBeNull();

      const check = await bob
        .from('family_members')
        .select('user_id')
        .eq('family_id', bobFamilyId);
      expect(check.data).toEqual([{ user_id: bobId }]);
    });
  });

  describe('UPDATE', () => {
    it('stops Alice renaming Bob’s family', async () => {
      const { data, error } = await alice
        .from('families')
        .update({ name: 'Taken Over' })
        .eq('id', bobFamilyId)
        .select('id');

      // Zero rows, not a rejection — the row is simply not visible to update.
      expect(error).toBeNull();
      expect(data).toEqual([]);

      // The half that actually matters: confirm from Bob's own session.
      const check = await bob.from('families').select('name').eq('id', bobFamilyId).single();
      expect(check.data?.name).toBe(BOB_FAMILY_NAME);
    });

    it('stops Alice promoting herself inside Bob’s family', async () => {
      const { data, error } = await alice
        .from('family_members')
        .update({ role: 'owner' })
        .eq('family_id', bobFamilyId)
        .select('user_id');

      expect(error).toBeNull();
      expect(data).toEqual([]);

      const check = await bob
        .from('family_members')
        .select('user_id, role')
        .eq('family_id', bobFamilyId);
      expect(check.data).toEqual([{ user_id: bobId, role: 'owner' }]);
    });

    it('lets Bob rename his own family', async () => {
      // The mirror image. Without this, a policy that denies everything would
      // pass every test above while making the product unusable.
      const { data, error } = await bob
        .from('families')
        .update({ name: BOB_FAMILY_NAME })
        .eq('id', bobFamilyId)
        .select('name');

      expect(error).toBeNull();
      expect(data).toEqual([{ name: BOB_FAMILY_NAME }]);
    });
  });

  describe('DELETE', () => {
    it('stops Alice deleting Bob’s family', async () => {
      const { data, error } = await alice
        .from('families')
        .delete()
        .eq('id', bobFamilyId)
        .select('id');

      expect(error).toBeNull();
      expect(data).toEqual([]);

      const check = await bob.from('families').select('id').eq('id', bobFamilyId);
      expect(check.data).toEqual([{ id: bobFamilyId }]);
    });

    it('stops Alice removing Bob from his own family', async () => {
      const { data, error } = await alice
        .from('family_members')
        .delete()
        .eq('family_id', bobFamilyId)
        .select('user_id');

      expect(error).toBeNull();
      expect(data).toEqual([]);

      const check = await bob
        .from('family_members')
        .select('user_id')
        .eq('family_id', bobFamilyId);
      expect(check.data).toEqual([{ user_id: bobId }]);
    });
  });

  describe('signed out', () => {
    it('shows an anonymous client nothing at all', async () => {
      const anonymous = freshClient();
      const { data } = await anonymous.from('families').select('id');

      // Every policy is scoped `to authenticated`, so anon matches none.
      expect(data ?? []).toEqual([]);
    });
  });
});
