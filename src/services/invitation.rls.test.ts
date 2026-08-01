/**
 * Invitation and membership RLS — run with `npm run test:rls`, excluded from CI.
 *
 * PR-5 established that neither `families` nor `family_members` has an INSERT
 * policy: membership can only come into existence through a SECURITY DEFINER
 * function. This suite checks that adding invitations did not quietly weaken
 * that — the new function has its own rules, and they have to hold against a
 * real database rather than on inspection.
 *
 * Four accounts, distinct from the ones family.rls.test.ts uses, so the two
 * suites cannot interfere with each other regardless of run order.
 *
 * Note the roles they play. An assertion that a redemption was refused only
 * means something if nothing *else* could have refused it — so "a spent code
 * cannot be reused" is checked by an account with no family, for whom the
 * already-in-a-family rule cannot fire first.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const PASSWORD = 'rls-test-password';
const OWNER = { email: 'rls-owner@example.com', password: PASSWORD };
const JOINER = { email: 'rls-joiner@example.com', password: PASSWORD };
const OUTSIDER = { email: 'rls-outsider@example.com', password: PASSWORD };
/** Kept family-less so "a spent code cannot be reused" is tested by someone
 *  who would otherwise be allowed to join. */
const LATECOMER = { email: 'rls-latecomer@example.com', password: PASSWORD };

jest.setTimeout(60_000);

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

/**
 * Leaves an account with no family.
 *
 * Necessary because redeem_invitation refuses anyone who already belongs to a
 * family: without this, a run that died before its cleanup would poison every
 * later run. Deleting a family cascades its memberships and invitations, so
 * clearing the owner clears everyone in it.
 */
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

describeRls('invitations RLS', () => {
  let owner: SupabaseClient;
  let joiner: SupabaseClient;
  let outsider: SupabaseClient;
  let latecomer: SupabaseClient;
  let ownerId: string;
  let joinerId: string;
  let familyId: string;
  let outsiderFamilyId: string;
  /** The code the joiner actually redeems, reused by the replay test. */
  let spentCode: string;

  async function freshCode(role: 'owner' | 'member' = 'member'): Promise<string> {
    const { data, error } = await owner.rpc('create_invitation', {
      target_family: familyId,
      invited_role: role,
    });
    if (error) throw error;
    return data.code;
  }

  beforeAll(async () => {
    owner = freshClient();
    joiner = freshClient();
    outsider = freshClient();
    latecomer = freshClient();

    ownerId = await signInOrSignUp(owner, OWNER);
    joinerId = await signInOrSignUp(joiner, JOINER);
    await signInOrSignUp(outsider, OUTSIDER);
    await signInOrSignUp(latecomer, LATECOMER);

    // Owner first: cascading their family also frees the joiner.
    await leaveEverything(owner);
    await leaveEverything(outsider);
    await leaveEverything(joiner);
    await leaveEverything(latecomer);

    const created = await owner.rpc('create_family', { family_name: 'Invite Household' });
    if (created.error) throw created.error;
    familyId = created.data.id;

    const other = await outsider.rpc('create_family', { family_name: 'Outsider Household' });
    if (other.error) throw other.error;
    outsiderFamilyId = other.data.id;
  });

  afterAll(async () => {
    await leaveEverything(owner);
    await leaveEverything(outsider);
    await Promise.all([
      owner.auth.signOut(),
      joiner.auth.signOut(),
      outsider.auth.signOut(),
      latecomer.auth.signOut(),
    ]);
  });

  describe('creating an invitation', () => {
    it('lets the owner create one', async () => {
      const { data, error } = await owner.rpc('create_invitation', {
        target_family: familyId,
        invited_role: 'member',
      });

      expect(error).toBeNull();
      expect(data.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      expect(data.role).toBe('member');
      expect(data.redeemed_at).toBeNull();
    });

    it('refuses someone who is not in the family', async () => {
      const { error } = await outsider.rpc('create_invitation', {
        target_family: familyId,
        invited_role: 'member',
      });

      expect(error).not.toBeNull();
      expect(error?.message).toContain('Only an owner can invite');
    });

    it('gives the same answer for a family that does not exist', async () => {
      // Distinguishing "not yours" from "no such family" would confirm the
      // existence of families the caller cannot see.
      const { error } = await outsider.rpc('create_invitation', {
        target_family: '00000000-0000-0000-0000-000000000000',
        invited_role: 'member',
      });

      expect(error?.message).toContain('Only an owner can invite');
    });

    it('refuses an unknown role', async () => {
      const { error } = await owner.rpc('create_invitation', {
        target_family: familyId,
        invited_role: 'superuser',
      });

      expect(error).not.toBeNull();
      expect(error?.message).toContain('Unknown role');
    });

    it('hides the family’s invitations from an outsider', async () => {
      await freshCode();
      const { data, error } = await outsider
        .from('family_invitations')
        .select('code')
        .eq('family_id', familyId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('refuses a hand-written invitation row', async () => {
      // family_invitations has no INSERT policy or privilege, so an attacker
      // cannot mint a code for a family they do not own.
      const { error } = await outsider.from('family_invitations').insert({
        family_id: familyId,
        code: 'AAAA2345',
        role: 'owner',
        created_by: ownerId,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      });

      expect(error).not.toBeNull();
    });
  });

  describe('redeeming', () => {
    it('rejects a code that does not exist', async () => {
      const { error } = await joiner.rpc('redeem_invitation', { invitation_code: 'ZZZZ9999' });
      expect(error?.message).toContain('Invalid code');
    });

    it('adds the joiner to the family', async () => {
      spentCode = await freshCode();
      const { data, error } = await joiner.rpc('redeem_invitation', { invitation_code: spentCode });

      expect(error).toBeNull();
      expect(data.id).toBe(familyId);

      const members = await joiner.rpc('list_family_members', { target_family: familyId });
      expect(members.data.map((row: { user_id: string }) => row.user_id).sort()).toEqual(
        [ownerId, joinerId].sort(),
      );
    });

    it('records who spent the code, and when', async () => {
      const invite = await owner
        .from('family_invitations')
        .select('redeemed_at, redeemed_by')
        .eq('code', spentCode)
        .single();

      expect(invite.data?.redeemed_at).not.toBeNull();
      expect(invite.data?.redeemed_by).toBe(joinerId);
    });

    it('refuses a code that has already been spent', async () => {
      // The latecomer belongs to no family, so nothing else can be refusing
      // this — a pass here means single-use is genuinely enforced, not that
      // some earlier check fired first.
      const { error } = await latecomer.rpc('redeem_invitation', {
        invitation_code: spentCode,
      });

      expect(error?.message).toContain('Code already used');
    });

    it('refuses someone who already belongs to a family', async () => {
      const code = await freshCode();
      const { error } = await joiner.rpc('redeem_invitation', { invitation_code: code });

      expect(error?.message).toContain('Already in a family');
    });

    it('leaves a code unspent when redemption is refused', async () => {
      // A rejected attempt must not burn the invitation — otherwise anyone who
      // learns a code can destroy it by trying to use it.
      const code = await freshCode();
      const refused = await outsider.rpc('redeem_invitation', { invitation_code: code });
      expect(refused.error?.message).toContain('Already in a family');

      const invite = await owner
        .from('family_invitations')
        .select('redeemed_at')
        .eq('code', code)
        .single();
      expect(invite.data?.redeemed_at).toBeNull();
    });
  });

  describe('member list', () => {
    it('shows email addresses to a member of that family', async () => {
      const { data, error } = await owner.rpc('list_family_members', {
        target_family: familyId,
      });

      expect(error).toBeNull();
      expect(data.map((row: { email: string }) => row.email).sort()).toEqual(
        [OWNER.email, JOINER.email].sort(),
      );
    });

    it('shows an outsider nothing, rather than leaking addresses', async () => {
      // The guard inside list_family_members is the whole security of that
      // function: it is SECURITY DEFINER, so without the check any signed-in
      // user could dump the email of every member of any family id they guess.
      const { data, error } = await outsider.rpc('list_family_members', {
        target_family: familyId,
      });

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  describe('membership after joining', () => {
    it('does not let a plain member invite anyone', async () => {
      // The joiner is a member, not an owner. Inviting is owner-only until
      // PR-9 defines the real permission matrix.
      const { error } = await joiner.rpc('create_invitation', {
        target_family: familyId,
        invited_role: 'member',
      });

      expect(error?.message).toContain('Only an owner can invite');
    });

    it('does not let a plain member revoke an invitation', async () => {
      const code = await freshCode();
      const { data, error } = await joiner
        .from('family_invitations')
        .delete()
        .eq('code', code)
        .select('id');

      // Zero rows rather than a rejection — the delete policy simply matches
      // nothing for a non-owner.
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const check = await owner.from('family_invitations').select('id').eq('code', code);
      expect(check.data).toHaveLength(1);
    });

    it('lets the owner revoke an invitation', async () => {
      const code = await freshCode();
      const { data, error } = await owner
        .from('family_invitations')
        .delete()
        .eq('code', code)
        .select('id');

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it('lets the joiner read the family they joined, and only that one', async () => {
      const { data } = await joiner.from('families').select('id');
      expect(data?.map((row) => row.id)).toEqual([familyId]);
      expect(data?.map((row) => row.id)).not.toContain(outsiderFamilyId);
    });
  });
});
