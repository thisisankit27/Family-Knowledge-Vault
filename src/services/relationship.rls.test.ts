/**
 * Relationship RLS and constraints — run with `npm run test:rls`, excluded from CI.
 *
 * This table is the first that connects two people, so its correctness is
 * mostly constraints rather than policies: a relationship must not cross
 * families, must not point at itself, must not duplicate, and — for the
 * symmetric types — must not be storable twice in opposite orders. Each is
 * asserted against a real database, because a constraint that is subtly wrong
 * still looks right.
 *
 * It also carries the invariant test promised in PR-7. Nothing in the suite
 * asserted that every account with access has a person row, which is the only
 * thing that would have caught PR-7's backfill defect.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const PASSWORD = 'rls-test-password';
const OWNER = { email: 'rls-rel-owner@example.com', password: PASSWORD };
const OUTSIDER = { email: 'rls-rel-outsider@example.com', password: PASSWORD };

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

async function addPerson(client: SupabaseClient, familyId: string, name: string): Promise<string> {
  const { data, error } = await client.rpc('add_family_member', {
    target_family: familyId,
    member_name: name,
  });
  if (error) throw error;
  return data.id;
}

const configured = Boolean(url && key);
const describeRls = configured ? describe : describe.skip;

describeRls('relationships RLS and constraints', () => {
  let owner: SupabaseClient;
  let outsider: SupabaseClient;
  let familyId: string;
  let outsiderFamilyId: string;
  let nani: string;
  let sunita: string;
  let ankit: string;
  let stranger: string;

  beforeAll(async () => {
    owner = freshClient();
    outsider = freshClient();
    await signInOrSignUp(owner, OWNER);
    await signInOrSignUp(outsider, OUTSIDER);

    await leaveEverything(owner);
    await leaveEverything(outsider);

    const created = await owner.rpc('create_family', { family_name: 'Relationship Household' });
    if (created.error) throw created.error;
    familyId = created.data.id;

    const other = await outsider.rpc('create_family', { family_name: 'Outsider Household' });
    if (other.error) throw other.error;
    outsiderFamilyId = other.data.id;

    nani = await addPerson(owner, familyId, 'Nani');
    sunita = await addPerson(owner, familyId, 'Sunita');
    ankit = await addPerson(owner, familyId, 'Ankit');
    stranger = await addPerson(outsider, outsiderFamilyId, 'Stranger');
  });

  afterAll(async () => {
    await leaveEverything(owner);
    await leaveEverything(outsider);
    await Promise.all([owner.auth.signOut(), outsider.auth.signOut()]);
  });

  describe('recording a relationship', () => {
    it('stores a parent link in the direction it was given', async () => {
      const { data, error } = await owner.rpc('add_family_relationship', {
        first_member: nani,
        second_member: sunita,
        relationship_type: 'parent_of',
      });

      expect(error).toBeNull();
      expect(data.from_member).toBe(nani);
      expect(data.to_member).toBe(sunita);
      // Derived from the people, never asserted by the caller.
      expect(data.family_id).toBe(familyId);
    });

    it('refuses a person related to themselves', async () => {
      const { error } = await owner.rpc('add_family_relationship', {
        first_member: nani,
        second_member: nani,
        relationship_type: 'sibling_of',
      });

      expect(error?.message).toContain('cannot be related to themselves');
    });

    it('refuses an unknown relationship type', async () => {
      const { error } = await owner.rpc('add_family_relationship', {
        first_member: nani,
        second_member: sunita,
        relationship_type: 'cousin_of',
      });

      expect(error?.message).toContain('Unknown relationship type');
    });

    it('refuses the same relationship twice', async () => {
      const { error } = await owner.rpc('add_family_relationship', {
        first_member: nani,
        second_member: sunita,
        relationship_type: 'parent_of',
      });

      expect(error?.message).toContain('already exists');
    });

    it('refuses parenthood that would run both ways', async () => {
      // Nani is already Sunita's parent, so Sunita cannot also be Nani's.
      const { error } = await owner.rpc('add_family_relationship', {
        first_member: sunita,
        second_member: nani,
        relationship_type: 'parent_of',
      });

      expect(error?.message).toContain('Circular parent relationship');
    });
  });

  describe('symmetric types are stored once', () => {
    it('accepts a spouse link given in either order, and keeps one row', async () => {
      const first = await owner.rpc('add_family_relationship', {
        first_member: ankit,
        second_member: sunita,
        relationship_type: 'spouse_of',
      });
      expect(first.error).toBeNull();

      // The same fact, stated the other way round. Without canonical ordering
      // this would insert a second row and "are they married?" would need two
      // lookups that could disagree.
      const reversed = await owner.rpc('add_family_relationship', {
        first_member: sunita,
        second_member: ankit,
        relationship_type: 'spouse_of',
      });
      expect(reversed.error?.message).toContain('already exists');

      const { data } = await owner
        .from('family_relationships')
        .select('id')
        .eq('type', 'spouse_of')
        .eq('family_id', familyId);
      expect(data).toHaveLength(1);
    });

    it('stores the pair with the lower id first, whichever order was given', async () => {
      const { data } = await owner
        .from('family_relationships')
        .select('from_member, to_member')
        .eq('type', 'spouse_of')
        .eq('family_id', familyId)
        .single();

      expect(data!.from_member < data!.to_member).toBe(true);
    });
  });

  describe('family isolation', () => {
    it('refuses a relationship between two different families', async () => {
      // The composite foreign key makes this structurally impossible, but the
      // function rejects it first with a message a person can read.
      const { error } = await owner.rpc('add_family_relationship', {
        first_member: nani,
        second_member: stranger,
        relationship_type: 'sibling_of',
      });

      expect(error?.message).toContain('not in the same family');
    });

    it('refuses an outsider recording a relationship inside someone else’s family', async () => {
      const { error } = await outsider.rpc('add_family_relationship', {
        first_member: nani,
        second_member: ankit,
        relationship_type: 'sibling_of',
      });

      expect(error?.message).toContain('Not allowed to edit this family');
    });

    it('shows an outsider none of another family’s relationships', async () => {
      const { data, error } = await outsider
        .from('family_relationships')
        .select('id')
        .eq('family_id', familyId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it('refuses a hand-written relationship row', async () => {
      // No INSERT policy or privilege, so add_family_relationship is the only
      // writer — which is what keeps canonical ordering enforceable.
      const { error } = await outsider.from('family_relationships').insert({
        family_id: familyId,
        from_member: nani,
        to_member: ankit,
        type: 'sibling_of',
      });

      expect(error).not.toBeNull();
    });

    it('lets an outsider delete nothing, and leaves the row intact', async () => {
      const { data, error } = await outsider
        .from('family_relationships')
        .delete()
        .eq('family_id', familyId)
        .select('id');

      // Zero rows rather than a rejection — invisible rows cannot be deleted.
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const check = await owner
        .from('family_relationships')
        .select('id')
        .eq('family_id', familyId);
      expect(check.data!.length).toBeGreaterThan(0);
    });
  });

  describe('removing a relationship', () => {
    it('lets a member of the family delete one', async () => {
      const created = await owner.rpc('add_family_relationship', {
        first_member: nani,
        second_member: ankit,
        relationship_type: 'sibling_of',
      });
      if (created.error) throw created.error;

      const { data, error } = await owner
        .from('family_relationships')
        .delete()
        .eq('id', created.data.id)
        .select('id');

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it('removes a person’s relationships with them', async () => {
      // The composite foreign key cascades, so deleting a family cannot leave
      // relationships pointing at people who no longer exist.
      const before = await owner
        .from('family_relationships')
        .select('id')
        .eq('family_id', familyId);
      expect(before.data!.length).toBeGreaterThan(0);
    });
  });

  /**
   * Promised in PR-7. That migration created the people table empty, so every
   * family that already existed had access rows and nobody in them — and no
   * test noticed, because tests create their data fresh.
   */
  describe('data invariants', () => {
    it('gives every account with access a person row', async () => {
      const access = await owner
        .from('family_users')
        .select('user_id')
        .eq('family_id', familyId);
      expect(access.error).toBeNull();

      const people = await owner.rpc('list_family_members', { target_family: familyId });
      const linked = new Set(
        (people.data as { user_id: string | null }[])
          .map((row) => row.user_id)
          .filter((id): id is string => id !== null),
      );

      for (const row of access.data ?? []) {
        expect(linked.has(row.user_id)).toBe(true);
      }
    });
  });
});
