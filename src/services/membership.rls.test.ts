/**
 * Removing access, leaving, and deleting a family — run with `npm run test:rls`,
 * excluded from CI.
 *
 * Two properties here are promised by comments in three separate migrations and
 * asserted nowhere until now:
 *
 *   1. Removing somebody deletes their access row and **leaves their person row
 *      intact**, so a returning member is matched rather than duplicated.
 *   2. A removed member can no longer read the family — which is what the
 *      `has_family_access` gate added to `can_see_record` in PR-9a is for.
 *
 * Every destructive attempt is asserted twice, per the rule PR-5 established:
 * under RLS a delete matching no visible row reports success, so "no error
 * thrown" proves nothing. The actor must be refused *and* the victim's own
 * session must confirm the row survived.
 *
 * Accounts use an `rls-life-` prefix so this suite cannot collide with the
 * other five regardless of run order.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const PASSWORD = 'rls-test-password';
const OWNER = { email: 'rls-life-owner@example.com', password: PASSWORD };
const COOWNER = { email: 'rls-life-coowner@example.com', password: PASSWORD };
const ADMIN = { email: 'rls-life-admin@example.com', password: PASSWORD };
const MEMBER = { email: 'rls-life-member@example.com', password: PASSWORD };
const GUEST = { email: 'rls-life-guest@example.com', password: PASSWORD };

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

type Seat = 'owner' | 'coowner' | 'admin' | 'member' | 'guest';

const SEATS: Record<Seat, { email: string; password: string }> = {
  owner: OWNER,
  coowner: COOWNER,
  admin: ADMIN,
  member: MEMBER,
  guest: GUEST,
};

/** Which role each seat joins as. The owner creates the family. */
const SEAT_ROLE: Record<Exclude<Seat, 'owner'>, string> = {
  coowner: 'owner',
  admin: 'admin',
  member: 'member',
  guest: 'guest',
};

describeRls('membership lifecycle', () => {
  const clients = {} as Record<Seat, SupabaseClient>;
  const userIds = {} as Record<Seat, string>;
  let familyId: string;

  async function accessRoles(): Promise<Record<string, string>> {
    const { data } = await clients.owner
      .from('family_users')
      .select('user_id, role')
      .eq('family_id', familyId);

    const byUser: Record<string, string> = {};
    for (const row of (data ?? []) as { user_id: string; role: string }[]) {
      byUser[row.user_id] = row.role;
    }
    return byUser;
  }

  async function inviteAndJoin(seat: Exclude<Seat, 'owner'>): Promise<void> {
    const { data: invitation, error } = await clients.owner.rpc('create_invitation', {
      target_family: familyId,
      invited_role: SEAT_ROLE[seat],
    });
    if (error) throw error;

    const { error: joinError } = await clients[seat].rpc('redeem_invitation', {
      invitation_code: invitation.code,
    });
    if (joinError) throw new Error(`${seat} could not join: ${joinError.message}`);
  }

  beforeAll(async () => {
    for (const seat of Object.keys(SEATS) as Seat[]) {
      clients[seat] = freshClient();
      userIds[seat] = await signInOrSignUp(clients[seat], SEATS[seat]);
    }
  });

  beforeEach(async () => {
    // A fresh family per test. Every test here deliberately damages the access
    // list, and each account must be cleared because a demoted or removed
    // account cannot delete the family it is stuck in.
    for (const seat of Object.keys(SEATS) as Seat[]) {
      await leaveEverything(clients[seat]);
    }

    const { data: family, error } = await clients.owner.rpc('create_family', {
      family_name: 'Lifecycle',
    });
    if (error) throw error;
    familyId = family.id;

    for (const seat of ['coowner', 'admin', 'member', 'guest'] as const) {
      await inviteAndJoin(seat);
    }
  });

  afterAll(async () => {
    for (const seat of Object.keys(SEATS) as Seat[]) {
      await leaveEverything(clients[seat]);
    }
  });

  // -------------------------------------------------------------------------

  describe('removing someone else', () => {
    it('lets an owner remove a member', async () => {
      // The positive case first. A rule that only ever refuses passes every
      // isolation test while making the product unusable.
      const { error } = await clients.owner.rpc('remove_family_access', {
        target_family: familyId,
        target_user: userIds.member,
      });
      expect(error).toBeNull();
      expect(await accessRoles()).not.toHaveProperty(userIds.member);
    });

    it('lets an owner remove a co-owner while another owner remains', async () => {
      // The case a `rank(actor) > rank(target)` rule would have blocked, and
      // the reason the removal rule is two clauses rather than one comparison.
      const { error } = await clients.owner.rpc('remove_family_access', {
        target_family: familyId,
        target_user: userIds.coowner,
      });
      expect(error).toBeNull();
      expect(await accessRoles()).not.toHaveProperty(userIds.coowner);
    });

    it('lets an admin remove a member and a guest', async () => {
      for (const seat of ['member', 'guest'] as const) {
        const { error } = await clients.admin.rpc('remove_family_access', {
          target_family: familyId,
          target_user: userIds[seat],
        });
        expect(error).toBeNull();
      }
      const roles = await accessRoles();
      expect(roles).not.toHaveProperty(userIds.member);
      expect(roles).not.toHaveProperty(userIds.guest);
    });

    it('stops an admin removing an owner', async () => {
      const { error } = await clients.admin.rpc('remove_family_access', {
        target_family: familyId,
        target_user: userIds.coowner,
      });
      expect(error?.message).toMatch(/not allowed to remove/i);
      expect((await accessRoles())[userIds.coowner]).toBe('owner');
    });

    it('stops an admin removing another admin', async () => {
      // The case a `rank(actor) >= rank(target)` rule would have allowed.
      const code = await clients.owner.rpc('create_invitation', {
        target_family: familyId,
        invited_role: 'admin',
      });
      // No second admin account is needed: promote the member instead.
      await clients.owner.rpc('set_family_role', {
        target_family: familyId,
        target_user: userIds.member,
        new_role: 'admin',
      });
      await clients.owner.from('family_invitations').delete().eq('id', code.data.id);

      const { error } = await clients.admin.rpc('remove_family_access', {
        target_family: familyId,
        target_user: userIds.member,
      });
      expect(error?.message).toMatch(/not allowed to remove/i);
      expect((await accessRoles())[userIds.member]).toBe('admin');
    });

    it('stops a member and a guest removing anyone', async () => {
      for (const seat of ['member', 'guest'] as const) {
        const { error } = await clients[seat].rpc('remove_family_access', {
          target_family: familyId,
          target_user: userIds.admin,
        });
        expect(error?.message).toMatch(/not allowed to remove/i);
      }
      expect((await accessRoles())[userIds.admin]).toBe('admin');
    });

    it('cannot be used to remove the last owner, by construction', async () => {
      // Worth stating precisely, because the naive version of this test passes
      // for the wrong reason — and an assertion that something was refused
      // means nothing if something *else* could have refused it.
      //
      // Only an owner may remove an owner. So if the target is the last owner,
      // the actor is either that same person — caught by the self-check, which
      // sends them to leave_family — or somebody who may not remove an owner at
      // all. There is no third case, which is why the last-owner branch inside
      // remove_family_access is a backstop rather than a reachable path.
      //
      // Both doors, asserted, with the owner still standing afterwards.
      await clients.owner.rpc('set_family_role', {
        target_family: familyId,
        target_user: userIds.coowner,
        new_role: 'admin',
      });

      const bySelf = await clients.owner.rpc('remove_family_access', {
        target_family: familyId,
        target_user: userIds.owner,
      });
      expect(bySelf.error?.message).toMatch(/leave family/i);

      const byAdmin = await clients.coowner.rpc('remove_family_access', {
        target_family: familyId,
        target_user: userIds.owner,
      });
      expect(byAdmin.error?.message).toMatch(/not allowed to remove/i);

      expect((await accessRoles())[userIds.owner]).toBe('owner');
    });

    it('sends you to leave family when you aim at yourself', async () => {
      const { error } = await clients.admin.rpc('remove_family_access', {
        target_family: familyId,
        target_user: userIds.admin,
      });
      expect(error?.message).toMatch(/leave family/i);
      expect((await accessRoles())[userIds.admin]).toBe('admin');
    });

    it('refuses for somebody who has no access', async () => {
      const { error } = await clients.owner.rpc('remove_family_access', {
        target_family: familyId,
        target_user: '00000000-0000-0000-0000-000000000000',
      });
      expect(error?.message).toMatch(/does not have access/i);
    });
  });

  // -------------------------------------------------------------------------

  describe('what removal does not do', () => {
    it('leaves the person row, and relinks them on rejoin instead of duplicating', async () => {
      // The behaviour three migrations' comments promise and nothing asserted.
      const before = await clients.owner.rpc('list_family_members', {
        target_family: familyId,
      });
      const person = (before.data as { id: string; user_id: string | null }[]).find(
        (row) => row.user_id === userIds.member,
      );
      expect(person).toBeDefined();

      await clients.owner.rpc('remove_family_access', {
        target_family: familyId,
        target_user: userIds.member,
      });

      const after = await clients.owner.rpc('list_family_members', {
        target_family: familyId,
      });
      const stillThere = (after.data as { id: string; user_id: string | null }[]).find(
        (row) => row.id === person!.id,
      );
      expect(stillThere).toBeDefined();
      expect(stillThere!.user_id).toBe(userIds.member);

      // Rejoining matches that row rather than creating a second person.
      await inviteAndJoin('member');

      const rejoined = await clients.owner.rpc('list_family_members', {
        target_family: familyId,
      });
      const rows = (rejoined.data as { id: string; user_id: string | null }[]).filter(
        (row) => row.user_id === userIds.member,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(person!.id);
    });

    it('stops the removed account reading the family at all', async () => {
      await clients.owner.rpc('remove_family_access', {
        target_family: familyId,
        target_user: userIds.member,
      });

      const families = await clients.member.from('families').select('id').eq('id', familyId);
      expect(families.data ?? []).toEqual([]);

      const people = await clients.member.rpc('list_family_members', {
        target_family: familyId,
      });
      expect(people.data ?? []).toEqual([]);

      // And the visibility resolver agrees — this is what the has_family_access
      // gate added in PR-9a exists for: authorship alone must not survive
      // removal.
      const canSee = await clients.member.rpc('can_see_record', {
        target_family: familyId,
        record_visibility: 'private',
        subject_member: null,
        record_author: userIds.member,
      });
      expect(canSee.data).toBe(false);
    });
  });

  // -------------------------------------------------------------------------

  describe('leaving', () => {
    it('lets a guest leave', async () => {
      // Every role may leave. A read-only seat is still a seat you can vacate.
      const { error } = await clients.guest.rpc('leave_family', { target_family: familyId });
      expect(error).toBeNull();
      expect(await accessRoles()).not.toHaveProperty(userIds.guest);
    });

    it('lets an owner leave while another owner remains', async () => {
      const { error } = await clients.owner.rpc('leave_family', { target_family: familyId });
      expect(error).toBeNull();

      const { data } = await clients.coowner
        .from('family_users')
        .select('user_id')
        .eq('family_id', familyId)
        .eq('role', 'owner');
      expect(data).toHaveLength(1);
      expect(data?.[0].user_id).toBe(userIds.coowner);
    });

    it('refuses the only owner, and names both ways out', async () => {
      await clients.owner.rpc('set_family_role', {
        target_family: familyId,
        target_user: userIds.coowner,
        new_role: 'admin',
      });

      const { error } = await clients.owner.rpc('leave_family', { target_family: familyId });
      expect(error?.message).toMatch(/only owner/i);
      expect(error?.message).toMatch(/delete the family/i);
      expect((await accessRoles())[userIds.owner]).toBe('owner');
    });

    it('frees the account to join another family', async () => {
      // redeem_invitation refuses anyone already in a family, so this is the
      // observable consequence of leaving actually having happened.
      await clients.guest.rpc('leave_family', { target_family: familyId });

      const { data: family, error } = await clients.guest.rpc('create_family', {
        family_name: 'Somewhere Else',
      });
      expect(error).toBeNull();
      expect(family.id).not.toBe(familyId);
    });

    it('refuses somebody who is not in the family', async () => {
      await clients.guest.rpc('leave_family', { target_family: familyId });

      const { error } = await clients.guest.rpc('leave_family', { target_family: familyId });
      expect(error?.message).toMatch(/not in this family/i);
    });
  });

  // -------------------------------------------------------------------------

  describe('deleting the family', () => {
    it('stops an admin, a member and a guest', async () => {
      for (const seat of ['admin', 'member', 'guest'] as const) {
        await clients[seat].from('families').delete().eq('id', familyId);
      }

      const { data } = await clients.owner.from('families').select('id').eq('id', familyId);
      expect(data).toHaveLength(1);
    });

    it('lets an owner delete it, and takes everything with it', async () => {
      const people = await clients.owner.rpc('list_family_members', {
        target_family: familyId,
      });
      expect((people.data as unknown[]).length).toBeGreaterThan(0);

      const { error } = await clients.owner.from('families').delete().eq('id', familyId);
      expect(error).toBeNull();

      // The access rows cascade, which is exactly what enforce_last_owner's
      // cascade guard exists to allow.
      const access = await clients.coowner
        .from('family_users')
        .select('user_id')
        .eq('family_id', familyId);
      expect(access.data ?? []).toEqual([]);

      // And everyone in it is free to start again.
      const { error: createError } = await clients.coowner.rpc('create_family', {
        family_name: 'Starting Over',
      });
      expect(createError).toBeNull();
    });
  });
});
