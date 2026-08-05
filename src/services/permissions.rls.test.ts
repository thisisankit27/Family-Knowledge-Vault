/**
 * The permission matrix, the two escalation fixes, and the last-owner
 * guarantee — run with `npm run test:rls`, excluded from CI.
 *
 * The matrix in `docs/15-permission-matrix.md` governs every phase from here
 * on. A matrix that lives only in Markdown is wrong within two phases, so the
 * table below is the same data as the document and is asserted role by role
 * against a real database: four roles, seven helpers, twenty-eight answers.
 *
 * The escalation tests are the reason this PR exists. Neither hole was a defect
 * in shipped behaviour — both open the moment `can_manage_members` includes
 * 'admin', which this PR does. Each is asserted twice, per the rule PR-5
 * established: under RLS an UPDATE or DELETE matching no visible row reports
 * success, so "no error thrown" proves nothing. The attacker must fail *and*
 * the victim's own session must confirm nothing moved.
 *
 * Accounts use an `rls-role-` prefix so this suite cannot collide with the
 * other four regardless of run order, and the last-owner tests use a separate
 * family of their own so that mutating roles cannot disturb the matrix.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

loadEnv();

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const PASSWORD = 'rls-test-password';
const OWNER = { email: 'rls-role-owner@example.com', password: PASSWORD };
const ADMIN = { email: 'rls-role-admin@example.com', password: PASSWORD };
const MEMBER = { email: 'rls-role-member@example.com', password: PASSWORD };
const GUEST = { email: 'rls-role-guest@example.com', password: PASSWORD };
const OUTSIDER = { email: 'rls-role-outsider@example.com', password: PASSWORD };
/** A family of two owners, kept apart from the matrix family. */
const RACE_A = { email: 'rls-role-race-a@example.com', password: PASSWORD };
const RACE_B = { email: 'rls-role-race-b@example.com', password: PASSWORD };

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

/**
 * Deleting a family cascades its access rows, so clearing the owner frees
 * everyone who joined it. Without this a run that died before cleanup would
 * poison every later run, because redeem_invitation refuses anyone who already
 * belongs to a family.
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

type Role = 'owner' | 'admin' | 'member' | 'guest';

const HELPERS = [
  'has_family_access',
  'can_manage_family',
  'can_manage_members',
  'can_edit_people',
  'can_read_records',
  'can_write_records',
  'can_delete_records',
] as const;

type Helper = (typeof HELPERS)[number];

/**
 * docs/15-permission-matrix.md §5, as data.
 *
 * If this table and the document ever disagree, one of them is a lie and this
 * one is the one that runs.
 */
const MATRIX: Record<Helper, Record<Role, boolean>> = {
  has_family_access:   { owner: true,  admin: true,  member: true,  guest: true  },
  can_manage_family:   { owner: true,  admin: false, member: false, guest: false },
  can_manage_members:  { owner: true,  admin: true,  member: false, guest: false },
  can_edit_people:     { owner: true,  admin: true,  member: true,  guest: false },
  can_read_records:    { owner: true,  admin: true,  member: true,  guest: false },
  can_write_records:   { owner: true,  admin: true,  member: true,  guest: false },
  can_delete_records:  { owner: true,  admin: true,  member: false, guest: false },
};

describeRls('roles, permissions and visibility', () => {
  const clients = {} as Record<Role | 'outsider', SupabaseClient>;
  const userIds = {} as Record<Role | 'outsider', string>;
  let familyId: string;
  /** `family_members.id` for each account — the person, not the access grant. */
  const personIds = {} as Record<Role, string>;

  async function invite(role: Role): Promise<string> {
    const { data, error } = await clients.owner.rpc('create_invitation', {
      target_family: familyId,
      invited_role: role,
    });
    if (error) throw error;
    return data.code;
  }

  beforeAll(async () => {
    for (const name of ['owner', 'admin', 'member', 'guest', 'outsider'] as const) {
      clients[name] = freshClient();
    }
    userIds.owner = await signInOrSignUp(clients.owner, OWNER);
    userIds.admin = await signInOrSignUp(clients.admin, ADMIN);
    userIds.member = await signInOrSignUp(clients.member, MEMBER);
    userIds.guest = await signInOrSignUp(clients.guest, GUEST);
    userIds.outsider = await signInOrSignUp(clients.outsider, OUTSIDER);

    // The owner first: cascading their family frees the other three.
    await leaveEverything(clients.owner);
    await leaveEverything(clients.outsider);

    const { data: family, error } = await clients.owner.rpc('create_family', {
      family_name: 'Permission Matrix',
    });
    if (error) throw error;
    familyId = family.id;

    for (const role of ['admin', 'member', 'guest'] as const) {
      const code = await invite(role);
      const { error: joinError } = await clients[role].rpc('redeem_invitation', {
        invitation_code: code,
      });
      if (joinError) throw joinError;
    }

    const { data: people, error: peopleError } = await clients.owner.rpc(
      'list_family_members',
      { target_family: familyId },
    );
    if (peopleError) throw peopleError;
    for (const role of ['owner', 'admin', 'member', 'guest'] as const) {
      const row = (people as { id: string; user_id: string | null }[]).find(
        (person) => person.user_id === userIds[role],
      );
      if (!row) throw new Error(`No person row for the ${role}`);
      personIds[role] = row.id;
    }
  });

  afterAll(async () => {
    if (familyId) await leaveEverything(clients.owner);
  });

  // -------------------------------------------------------------------------

  describe('the matrix, as data', () => {
    for (const helper of HELPERS) {
      for (const role of ['owner', 'admin', 'member', 'guest'] as const) {
        const expected = MATRIX[helper][role];

        it(`${helper} is ${expected} for ${role}`, async () => {
          const { data, error } = await clients[role].rpc(helper, {
            target_family: familyId,
          });
          expect(error).toBeNull();
          expect(data).toBe(expected);
        });
      }
    }

    it('answers false for every helper when the caller is outside the family', async () => {
      for (const helper of HELPERS) {
        const { data, error } = await clients.outsider.rpc(helper, {
          target_family: familyId,
        });
        expect(error).toBeNull();
        expect(data).toBe(false);
      }
    });

    it('ranks the four roles, and anything else below all of them', async () => {
      const ranked = await Promise.all(
        ['owner', 'admin', 'member', 'guest', 'sovereign'].map(async (role) => {
          const { data } = await clients.owner.rpc('role_rank', { role_name: role });
          return data;
        }),
      );
      expect(ranked).toEqual([3, 2, 1, 0, -1]);
    });
  });

  // -------------------------------------------------------------------------

  describe('can_see_record — the visibility resolver', () => {
    function see(
      as: Role | 'outsider',
      visibility: string,
      subject: string | null,
      author: string,
    ) {
      return clients[as].rpc('can_see_record', {
        target_family: familyId,
        record_visibility: visibility,
        subject_member: subject,
        record_author: author,
      });
    }

    it('shows a family-visibility record to a member', async () => {
      const { data, error } = await see('member', 'family', personIds.owner, userIds.owner);
      expect(error).toBeNull();
      expect(data).toBe(true);
    });

    it('hides a family-visibility record from a guest', async () => {
      // The reason the Guest role exists: read-only inside the family does not
      // mean read-everything.
      const { data } = await see('guest', 'family', personIds.owner, userIds.owner);
      expect(data).toBe(false);
    });

    it('hides a family-visibility record from an outsider', async () => {
      const { data } = await see('outsider', 'family', personIds.owner, userIds.owner);
      expect(data).toBe(false);
    });

    it('hides a private record from the owner and the admin', async () => {
      // The decision of 2026-08-04: private means private. No role reads it.
      // The failure mode is data being unreachable, never data leaking.
      const forOwner = await see('owner', 'private', personIds.member, userIds.member);
      const forAdmin = await see('admin', 'private', personIds.member, userIds.member);
      expect(forOwner.data).toBe(false);
      expect(forAdmin.data).toBe(false);
    });

    it('shows a private record to its author', async () => {
      const { data } = await see('member', 'private', personIds.owner, userIds.member);
      expect(data).toBe(true);
    });

    it('shows a private record to the person it is about', async () => {
      // Written by the owner, about the member: the subject reads it even
      // though they did not create it.
      const { data } = await see('member', 'private', personIds.member, userIds.owner);
      expect(data).toBe(true);
    });

    it('hides a private record from a member who is neither author nor subject', async () => {
      const { data } = await see('member', 'private', personIds.admin, userIds.owner);
      expect(data).toBe(false);
    });

    it('hides a private record from an outsider who authored it', async () => {
      // Access to the family is a precondition of every branch. Without it,
      // PR-9b's removal would leave a departed member reading everything they
      // ever wrote.
      const { data } = await see('outsider', 'private', personIds.owner, userIds.outsider);
      expect(data).toBe(false);
    });

    it('fails closed on a visibility value it does not recognise', async () => {
      // This is what makes adding 'shared' in Phase 10 safe: until the branch
      // exists, nobody sees the row.
      const { data } = await see('owner', 'shared', personIds.owner, userIds.owner);
      expect(data).toBe(false);
    });
  });

  // -------------------------------------------------------------------------

  describe('hole 1 — an admin cannot promote themselves', () => {
    it('refuses a direct write to family_users.role', async () => {
      await clients.admin
        .from('family_users')
        .update({ role: 'owner' })
        .eq('family_id', familyId)
        .eq('user_id', userIds.admin);

      // The load-bearing assertion. The attempt above may fail loudly or
      // quietly; what matters is what the table says afterwards, read by
      // somebody who can actually see it.
      const { data } = await clients.owner
        .from('family_users')
        .select('role')
        .eq('family_id', familyId)
        .eq('user_id', userIds.admin)
        .single();
      expect(data?.role).toBe('admin');
    });

    it('refuses a direct delete of the owner\'s access', async () => {
      await clients.admin
        .from('family_users')
        .delete()
        .eq('family_id', familyId)
        .eq('role', 'owner');

      const { data } = await clients.owner
        .from('family_users')
        .select('user_id')
        .eq('family_id', familyId)
        .eq('role', 'owner');
      expect(data).toHaveLength(1);
      expect(data?.[0].user_id).toBe(userIds.owner);
    });

    it('refuses set_family_role to an admin', async () => {
      const { error } = await clients.admin.rpc('set_family_role', {
        target_family: familyId,
        target_user: userIds.admin,
        new_role: 'owner',
      });
      expect(error?.message).toMatch(/not allowed to change roles/i);
    });

    it('refuses set_family_role to a member', async () => {
      const { error } = await clients.member.rpc('set_family_role', {
        target_family: familyId,
        target_user: userIds.member,
        new_role: 'admin',
      });
      expect(error?.message).toMatch(/not allowed to change roles/i);
    });

    it('lets the owner change a role, and refuses a role that does not exist', async () => {
      const { error } = await clients.owner.rpc('set_family_role', {
        target_family: familyId,
        target_user: userIds.guest,
        new_role: 'member',
      });
      expect(error).toBeNull();

      const unknown = await clients.owner.rpc('set_family_role', {
        target_family: familyId,
        target_user: userIds.guest,
        new_role: 'sovereign',
      });
      expect(unknown.error?.message).toMatch(/unknown role/i);

      // Put the guest back — the matrix tests above depend on it.
      await clients.owner.rpc('set_family_role', {
        target_family: familyId,
        target_user: userIds.guest,
        new_role: 'guest',
      });
    });

    it('refuses to change the role of somebody with no access', async () => {
      const { error } = await clients.owner.rpc('set_family_role', {
        target_family: familyId,
        target_user: userIds.outsider,
        new_role: 'member',
      });
      expect(error?.message).toMatch(/does not have access/i);
    });
  });

  // -------------------------------------------------------------------------

  describe('hole 2 — an invitation cannot outrank its inviter', () => {
    it('refuses an admin minting an owner invitation', async () => {
      const { error } = await clients.admin.rpc('create_invitation', {
        target_family: familyId,
        invited_role: 'owner',
      });
      expect(error?.message).toMatch(/higher role than your own/i);
    });

    it('lets an admin invite at or below their own rank', async () => {
      for (const role of ['admin', 'member', 'guest'] as const) {
        const { data, error } = await clients.admin.rpc('create_invitation', {
          target_family: familyId,
          invited_role: role,
        });
        expect(error).toBeNull();
        expect(data.role).toBe(role);
        await clients.admin.from('family_invitations').delete().eq('id', data.id);
      }
    });

    it('still lets an owner invite an owner', async () => {
      // The behaviour that a strictly-below cap would have broken, and the only
      // way a family acquires a second owner.
      const { data, error } = await clients.owner.rpc('create_invitation', {
        target_family: familyId,
        invited_role: 'owner',
      });
      expect(error).toBeNull();
      expect(data.role).toBe('owner');
      await clients.owner.from('family_invitations').delete().eq('id', data.id);
    });

    it('refuses a member inviting anyone at all', async () => {
      const { error } = await clients.member.rpc('create_invitation', {
        target_family: familyId,
        invited_role: 'guest',
      });
      expect(error?.message).toMatch(/not allowed to invite/i);
    });
  });

  // -------------------------------------------------------------------------

  describe('the widened helpers reach the policies that call them', () => {
    it('lets an admin revoke an invitation', async () => {
      const { data: invitation } = await clients.owner.rpc('create_invitation', {
        target_family: familyId,
        invited_role: 'member',
      });
      await clients.admin.from('family_invitations').delete().eq('id', invitation.id);

      const { data } = await clients.owner
        .from('family_invitations')
        .select('id')
        .eq('id', invitation.id);
      expect(data).toHaveLength(0);
    });

    it('refuses a guest adding a person', async () => {
      const { error } = await clients.guest.rpc('add_family_member', {
        target_family: familyId,
        member_name: 'Uninvited',
      });
      expect(error?.message).toMatch(/not allowed to edit/i);
    });

    it('lets a member add a person', async () => {
      // A permission model that only ever refuses passes every isolation test
      // while making the product unusable.
      const { data, error } = await clients.member.rpc('add_family_member', {
        target_family: familyId,
        member_name: 'Added by a member',
      });
      expect(error).toBeNull();
      expect(data.display_name).toBe('Added by a member');
    });
  });

  // -------------------------------------------------------------------------

  describe('families.created_by is pinned', () => {
    it('refuses an owner rewriting it', async () => {
      const { error } = await clients.owner
        .from('families')
        .update({ created_by: userIds.admin })
        .eq('id', familyId);
      expect(error?.message).toMatch(/created_by cannot be changed/i);

      const { data } = await clients.owner
        .from('families')
        .select('created_by')
        .eq('id', familyId)
        .single();
      expect(data?.created_by).toBe(userIds.owner);
    });

    it('still lets an owner rename the family', async () => {
      const { error } = await clients.owner
        .from('families')
        .update({ name: 'Permission Matrix' })
        .eq('id', familyId);
      expect(error).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------

describeRls('the last-owner guarantee', () => {
  let a: SupabaseClient;
  let b: SupabaseClient;
  let aId: string;
  let bId: string;
  let familyId: string;

  async function ownerCount(): Promise<number> {
    const { data } = await a
      .from('family_users')
      .select('user_id')
      .eq('family_id', familyId)
      .eq('role', 'owner');
    return data?.length ?? 0;
  }

  beforeAll(async () => {
    a = freshClient();
    b = freshClient();
    aId = await signInOrSignUp(a, RACE_A);
    bId = await signInOrSignUp(b, RACE_B);
    await leaveEverything(a);
  });

  beforeEach(async () => {
    // A fresh two-owner family per test: these tests deliberately damage the
    // thing they are testing, and a shared fixture would make the order matter.
    //
    // Both accounts, not just A. Every test here demotes an owner, and a
    // demoted A cannot delete the family it created — can_manage_family is
    // owner-only. Clearing only A leaves B inside a family that outlives the
    // test, and redeem_invitation refuses anyone already in one.
    await leaveEverything(a);
    await leaveEverything(b);

    const { data: family, error } = await a.rpc('create_family', {
      family_name: 'Two Owners',
    });
    if (error) throw error;
    familyId = family.id;

    const { data: invitation } = await a.rpc('create_invitation', {
      target_family: familyId,
      invited_role: 'owner',
    });
    const { error: joinError } = await b.rpc('redeem_invitation', {
      invitation_code: invitation.code,
    });
    if (joinError) throw joinError;
  });

  afterAll(async () => {
    await leaveEverything(a);
    await leaveEverything(b);
  });

  it('refuses the last owner demoting themselves', async () => {
    await a.rpc('set_family_role', {
      target_family: familyId,
      target_user: bId,
      new_role: 'member',
    });

    const { error } = await a.rpc('set_family_role', {
      target_family: familyId,
      target_user: aId,
      new_role: 'member',
    });
    expect(error?.message).toMatch(/must always have an owner/i);
    expect(await ownerCount()).toBe(1);
  });

  it('lets one owner demote another while a second owner remains', async () => {
    const { error } = await a.rpc('set_family_role', {
      target_family: familyId,
      target_user: bId,
      new_role: 'admin',
    });
    expect(error).toBeNull();
    expect(await ownerCount()).toBe(1);
  });

  it('lets exactly one of two concurrent self-demotions through', async () => {
    // The reason set_family_role takes `select ... for update` on the family
    // row as its first statement. Under READ COMMITTED both transactions read
    // count(*) = 2 — neither sees the other's uncommitted write — so without
    // the lock both pass their check, both commit, and the family is left with
    // no owner at all. A trigger cannot help: it runs in the same transaction
    // on the same snapshot and is equally blind.
    const results = await Promise.all([
      a.rpc('set_family_role', {
        target_family: familyId,
        target_user: aId,
        new_role: 'member',
      }),
      b.rpc('set_family_role', {
        target_family: familyId,
        target_user: bId,
        new_role: 'member',
      }),
    ]);

    const succeeded = results.filter((result) => result.error === null);
    const refused = results.filter((result) => result.error !== null);

    expect(succeeded).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].error?.message).toMatch(/must always have an owner/i);
    expect(await ownerCount()).toBe(1);
  });

  it('still allows the family itself to be deleted', async () => {
    // The cascade guard in enforce_last_owner. Deleting a family cascades to
    // its access rows; without the guard the trigger sees zero owners on the
    // way down and refuses, making a family undeletable.
    const { error } = await a.from('families').delete().eq('id', familyId);
    expect(error).toBeNull();

    const { data } = await a.from('families').select('id').eq('id', familyId);
    expect(data).toHaveLength(0);
  });
});
