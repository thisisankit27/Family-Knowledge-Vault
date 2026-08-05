/**
 * The activity feed's policy and its triggers — run with `npm run test:rls`,
 * excluded from CI.
 *
 * Two things are worth the round trip.
 *
 * **The policy is a single `can_see_record` call**, so the whole of matrix §4.5
 * lands or fails as one expression: an outsider sees nothing, a Guest sees
 * nothing because `'family'` visibility delegates to `can_read_records`, and a
 * Member sees the family's history. That a Guest is excluded by a policy nobody
 * wrote a role into is the payoff for PR-9a shipping the resolver early.
 *
 * **The triggers must not break family deletion.** Deleting a family cascades to
 * three tables that now carry logging triggers, each of which would try to
 * insert a row referencing a family that is already gone. PR-9a hit this exact
 * shape with `enforce_last_owner`, and the only reason we know that guard works
 * is the test PR-9b wrote for it. This suite has its own.
 *
 * The `private` branch of the policy is deliberately not tested here: the table
 * is write-closed, so no client can create a private row to test with. It is
 * covered where it belongs — `permissions.rls.test.ts` asserts `can_see_record`
 * directly, and this policy only delegates to it.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const PASSWORD = 'rls-test-password';
const OWNER = { email: 'rls-feed-owner@example.com', password: PASSWORD };
const MEMBER = { email: 'rls-feed-member@example.com', password: PASSWORD };
const GUEST = { email: 'rls-feed-guest@example.com', password: PASSWORD };
const OUTSIDER = { email: 'rls-feed-outsider@example.com', password: PASSWORD };

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

if (!configured) {
  // eslint-disable-next-line no-console
  console.warn('Skipping RLS tests: EXPO_PUBLIC_SUPABASE_URL / key not found in .env');
}

interface ActivityRow {
  action: string;
  actor_user_id: string | null;
  subject_member_id: string | null;
  detail: { role?: string } | null;
}

describeRls('the activity feed', () => {
  let owner: SupabaseClient;
  let member: SupabaseClient;
  let guest: SupabaseClient;
  let outsider: SupabaseClient;
  let ownerId: string;
  let memberId: string;
  let familyId: string;

  async function feed(client: SupabaseClient = owner): Promise<ActivityRow[]> {
    const { data, error } = await client
      .from('family_activity')
      .select('action, actor_user_id, subject_member_id, detail')
      .eq('family_id', familyId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as ActivityRow[];
  }

  async function actions(client: SupabaseClient = owner): Promise<string[]> {
    return (await feed(client)).map((row) => row.action);
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
      family_name: 'The Feed',
    });
    if (error) throw error;
    familyId = family.id;
  });

  afterAll(async () => {
    for (const client of [owner, member, guest, outsider]) {
      await leaveEverything(client);
    }
  });

  // -------------------------------------------------------------------------

  describe('who may read it', () => {
    it('shows a member the family history', async () => {
      await inviteAndJoin(member, 'member');
      const rows = await feed(member);
      expect(rows.length).toBeGreaterThan(0);
    });

    it('shows a guest nothing at all', async () => {
      // Not a rule anybody wrote into this table. `can_see_record` delegates
      // 'family' visibility to `can_read_records`, which excludes Guest — so
      // matrix §4.5's feed row is enforced by a policy that names no role.
      await inviteAndJoin(guest, 'guest');
      expect(await feed(guest)).toEqual([]);
    });

    it('shows an outsider nothing at all', async () => {
      expect(await feed(outsider)).toEqual([]);
    });

    it('refuses every write, including from an owner', async () => {
      // A log an app can edit is not a log. There is no INSERT, UPDATE or
      // DELETE policy and only a `select` grant.
      const inserted = await owner
        .from('family_activity')
        .insert({ family_id: familyId, action: 'person_added' });
      expect(inserted.error).not.toBeNull();

      const deleted = await owner.from('family_activity').delete().eq('family_id', familyId);
      expect(deleted.error).not.toBeNull();

      expect((await feed()).length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------

  describe('what gets recorded', () => {
    it('opens with the family being created', async () => {
      // Ordering within a transaction is why `created_at` defaults to
      // `clock_timestamp()` and not `now()`. `now()` is transaction time, so
      // this event and the creator's access_granted tied — and the feed could
      // show somebody joining a family that did not exist yet.
      const rows = await feed();
      expect(rows.map((row) => row.action)).toContain('family_created');
      expect(rows.at(-1)?.action).toBe('family_created');
    });

    it('records somebody joining exactly once', async () => {
      // The load-bearing condition in the person trigger. `ensure_person_for_
      // access` provisions a person row on every grant, so without the
      // `user_id is null` check a single join would write both "was added" and
      // "joined".
      await inviteAndJoin(member, 'member');

      const rows = await feed();
      // Two grants — the creator's and the joiner's — and no person_added at
      // all, because every person in this family arrived through an account.
      expect(rows.filter((row) => row.action === 'access_granted')).toHaveLength(2);
      expect(rows.filter((row) => row.action === 'person_added')).toHaveLength(0);
    });

    it('records the role somebody joined as', async () => {
      await inviteAndJoin(member, 'member');
      const granted = (await feed()).filter((row) => row.action === 'access_granted');
      expect(granted.map((row) => row.detail?.role).sort()).toEqual(['member', 'owner']);
    });

    it('records a person somebody typed in', async () => {
      const { data, error } = await owner.rpc('add_family_member', {
        target_family: familyId,
        member_name: 'Nani',
      });
      expect(error).toBeNull();

      const rows = await feed();
      const added = rows.find((row) => row.action === 'person_added');
      expect(added).toBeDefined();
      expect(added?.subject_member_id).toBe(data.id);
      expect(added?.actor_user_id).toBe(ownerId);
    });

    it('records an edit to a person, but not an edit that changed nothing', async () => {
      const { data } = await owner.rpc('add_family_member', {
        target_family: familyId,
        member_name: 'Nani',
      });

      await owner.rpc('update_family_member', { member: data.id, member_name: 'Nani' });
      expect((await feed()).filter((row) => row.action === 'person_updated')).toHaveLength(0);

      await owner.rpc('update_family_member', { member: data.id, member_name: 'Sunita' });
      expect((await feed()).filter((row) => row.action === 'person_updated')).toHaveLength(1);
    });

    it('records a role change, and what it changed to', async () => {
      await inviteAndJoin(member, 'member');
      await owner.rpc('set_family_role', {
        target_family: familyId,
        target_user: memberId,
        new_role: 'admin',
      });

      const changed = (await feed()).find((row) => row.action === 'role_changed');
      expect(changed?.detail?.role).toBe('admin');
      expect(changed?.actor_user_id).toBe(ownerId);
    });

    it('records access being revoked, and keeps the row afterwards', async () => {
      // The person row survives removal, so the history of it does too.
      await inviteAndJoin(member, 'member');
      await owner.rpc('remove_family_access', {
        target_family: familyId,
        target_user: memberId,
      });

      const revoked = (await feed()).find((row) => row.action === 'access_revoked');
      expect(revoked).toBeDefined();
      expect(revoked?.actor_user_id).toBe(ownerId);
      expect(revoked?.subject_member_id).not.toBeNull();
    });

    it('records leaving distinguishably from being removed', async () => {
      // The actor and the subject are the same person when somebody leaves, and
      // different when they are removed. That comparison is the only thing in
      // the product that can tell the two apart.
      await inviteAndJoin(member, 'member');
      await member.rpc('leave_family', { target_family: familyId });

      const revoked = (await feed()).find((row) => row.action === 'access_revoked');
      expect(revoked?.actor_user_id).toBe(memberId);

      const { data: people } = await owner.rpc('list_family_members', {
        target_family: familyId,
      });
      const subject = (people as { id: string; user_id: string | null }[]).find(
        (row) => row.id === revoked?.subject_member_id,
      );
      expect(subject?.user_id).toBe(memberId);
    });

    it('records relationships being added and removed', async () => {
      const nani = await owner.rpc('add_family_member', {
        target_family: familyId,
        member_name: 'Nani',
      });
      const sunita = await owner.rpc('add_family_member', {
        target_family: familyId,
        member_name: 'Sunita',
      });

      const { data: relationship, error } = await owner.rpc('add_family_relationship', {
        first_member: nani.data.id,
        second_member: sunita.data.id,
        relationship_type: 'parent_of',
      });
      expect(error).toBeNull();

      expect((await feed()).filter((row) => row.action === 'relationship_added')).toHaveLength(1);

      await owner.from('family_relationships').delete().eq('id', relationship.id);
      expect((await feed()).filter((row) => row.action === 'relationship_removed')).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------

  describe('the cascade guard', () => {
    it('still allows a family to be deleted', async () => {
      // The whole reason `log_family_event` checks the family still exists.
      // Deleting a family cascades to family_users, family_members and
      // family_relationships, each of which now fires a logging trigger — and
      // an insert referencing a family that is already gone is a foreign-key
      // violation, whose symptom is that families become undeletable.
      await inviteAndJoin(member, 'member');
      const nani = await owner.rpc('add_family_member', {
        target_family: familyId,
        member_name: 'Nani',
      });
      const sunita = await owner.rpc('add_family_member', {
        target_family: familyId,
        member_name: 'Sunita',
      });
      await owner.rpc('add_family_relationship', {
        first_member: nani.data.id,
        second_member: sunita.data.id,
        relationship_type: 'sibling_of',
      });

      const { error } = await owner.from('families').delete().eq('id', familyId);
      expect(error).toBeNull();

      const { data } = await owner.from('families').select('id').eq('id', familyId);
      expect(data).toHaveLength(0);
    });

    it('takes the history with the family', async () => {
      await owner.from('families').delete().eq('id', familyId);
      expect(await feed()).toEqual([]);
    });
  });
});
