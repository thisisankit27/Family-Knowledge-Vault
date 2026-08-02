/**
 * People RLS — run with `npm run test:rls`, excluded from CI.
 *
 * `family_members` now holds people rather than access grants, and most of
 * them will never have an account. That makes two things worth proving against
 * a real database: a person is still confined to one family, and a client
 * still cannot write the table directly — `user_id` links a person to an
 * account, and a policy cannot express "every column except that one".
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const PASSWORD = 'rls-test-password';
const OWNER = { email: 'rls-people-owner@example.com', password: PASSWORD };
const JOINER = { email: 'rls-people-joiner@example.com', password: PASSWORD };
const OUTSIDER = { email: 'rls-people-outsider@example.com', password: PASSWORD };

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

async function leaveEverything(client: SupabaseClient): Promise<void> {
  const { data } = await client.from('families').select('id');
  for (const row of data ?? []) {
    await client.from('families').delete().eq('id', row.id);
  }
}

const configured = Boolean(url && key);
const describeRls = configured ? describe : describe.skip;

describeRls('people RLS', () => {
  let owner: SupabaseClient;
  let joiner: SupabaseClient;
  let outsider: SupabaseClient;
  let ownerId: string;
  let joinerId: string;
  let familyId: string;
  let outsiderFamilyId: string;

  beforeAll(async () => {
    owner = freshClient();
    joiner = freshClient();
    outsider = freshClient();

    ownerId = await signInOrSignUp(owner, OWNER);
    joinerId = await signInOrSignUp(joiner, JOINER);
    await signInOrSignUp(outsider, OUTSIDER);

    await leaveEverything(owner);
    await leaveEverything(outsider);
    await leaveEverything(joiner);

    const created = await owner.rpc('create_family', { family_name: 'People Household' });
    if (created.error) throw created.error;
    familyId = created.data.id;

    const other = await outsider.rpc('create_family', { family_name: 'Outsider Household' });
    if (other.error) throw other.error;
    outsiderFamilyId = other.data.id;
  });

  afterAll(async () => {
    await leaveEverything(owner);
    await leaveEverything(outsider);
    await Promise.all([owner.auth.signOut(), joiner.auth.signOut(), outsider.auth.signOut()]);
  });

  describe('auto-provisioning', () => {
    it('creates exactly one person for whoever created the family', async () => {
      const { data, error } = await owner.rpc('list_family_members', {
        target_family: familyId,
      });

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data[0].user_id).toBe(ownerId);
      expect(data[0].email).toBe(OWNER.email);
      expect(data[0].role).toBe('owner');
      // Derived from the address until they edit it — a member list of raw
      // email addresses is what this whole change exists to avoid.
      expect(data[0].display_name).toBe(OWNER.email.split('@')[0]);
    });

    it('creates exactly one person for whoever redeems an invitation', async () => {
      const invite = await owner.rpc('create_invitation', {
        target_family: familyId,
        invited_role: 'member',
      });
      if (invite.error) throw invite.error;

      const joined = await joiner.rpc('redeem_invitation', { invitation_code: invite.data.code });
      expect(joined.error).toBeNull();

      const { data } = await owner.rpc('list_family_members', { target_family: familyId });
      const linked = data.filter((row: { user_id: string | null }) => row.user_id === joinerId);
      expect(linked).toHaveLength(1);
    });
  });

  describe('adding people', () => {
    it('lets a member add someone who has no account', async () => {
      const { data, error } = await owner.rpc('add_family_member', {
        target_family: familyId,
        member_name: 'Nani',
        member_dob: '1948-03-12',
        member_blood_group: 'O+',
      });

      expect(error).toBeNull();
      expect(data.display_name).toBe('Nani');
      // The whole point: a person with no login is still a member.
      expect(data.user_id).toBeNull();
    });

    it('refuses someone adding a person to a family they are not in', async () => {
      const { error } = await outsider.rpc('add_family_member', {
        target_family: familyId,
        member_name: 'Intruder',
      });

      expect(error).not.toBeNull();
      expect(error?.message).toContain('Not allowed to edit this family');
    });

    it('rejects a birthday in the future at the database, not only in the app', async () => {
      const { error } = await owner.rpc('add_family_member', {
        target_family: familyId,
        member_name: 'Time Traveller',
        member_dob: '2999-01-01',
      });

      expect(error?.message).toContain('Date of birth is in the future');
    });

    it('refuses a hand-written person row', async () => {
      // No INSERT policy and no INSERT privilege, so add_family_member is the
      // only way in — which is what keeps user_id server-controlled.
      const { error } = await outsider.from('family_members').insert({
        family_id: familyId,
        display_name: 'Forged',
      });

      expect(error).not.toBeNull();
    });
  });

  describe('reading people', () => {
    it('shows an outsider none of another family’s people', async () => {
      const { data, error } = await outsider
        .from('family_members')
        .select('id')
        .eq('family_id', familyId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('returns nothing from list_family_members for an outsider', async () => {
      const { data, error } = await outsider.rpc('list_family_members', {
        target_family: familyId,
      });

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('shows a joined member everyone in their family', async () => {
      const { data, error } = await joiner.rpc('list_family_members', {
        target_family: familyId,
      });

      expect(error).toBeNull();
      // The owner, the joiner, and Nani who has no account.
      expect(data.length).toBeGreaterThanOrEqual(3);
      expect(data.map((row: { display_name: string }) => row.display_name)).toContain('Nani');
    });
  });

  describe('editing people', () => {
    let naniId: string;

    beforeAll(async () => {
      const { data } = await owner.rpc('list_family_members', { target_family: familyId });
      naniId = data.find((row: { display_name: string }) => row.display_name === 'Nani').id;
    });

    it('lets a member of the family edit a person', async () => {
      const { data, error } = await owner.rpc('update_family_member', {
        member: naniId,
        member_name: 'Nani Ma',
        member_dob: '1948-03-12',
        member_blood_group: 'O+',
      });

      expect(error).toBeNull();
      expect(data.display_name).toBe('Nani Ma');
    });

    it('refuses an outsider, without confirming the person exists', async () => {
      const { error } = await outsider.rpc('update_family_member', {
        member: naniId,
        member_name: 'Renamed',
      });

      // Same message as for an id that does not exist at all — distinguishing
      // them would confirm the existence of records the caller cannot see.
      expect(error?.message).toContain('Not allowed to edit this person');

      const check = await owner.rpc('list_family_members', { target_family: familyId });
      expect(check.data.map((row: { display_name: string }) => row.display_name)).toContain(
        'Nani Ma',
      );
    });

    it('gives the same answer for a person who does not exist', async () => {
      const { error } = await outsider.rpc('update_family_member', {
        member: '00000000-0000-0000-0000-000000000000',
        member_name: 'Ghost',
      });

      expect(error?.message).toContain('Not allowed to edit this person');
    });

    it('refuses a direct update, which is how user_id stays server-controlled', async () => {
      const { data, error } = await joiner
        .from('family_members')
        .update({ user_id: joinerId })
        .eq('id', naniId)
        .select('id');

      // No UPDATE privilege at all, so this is refused outright rather than
      // matching zero rows.
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });
  });

  describe('family isolation', () => {
    it('never lets a person appear in two families', async () => {
      const mine = await owner.rpc('list_family_members', { target_family: familyId });
      const theirs = await owner.rpc('list_family_members', {
        target_family: outsiderFamilyId,
      });

      expect(mine.data.length).toBeGreaterThan(0);
      // Not a member there, so the guard inside the function returns nothing.
      expect(theirs.data).toEqual([]);
    });
  });
});
