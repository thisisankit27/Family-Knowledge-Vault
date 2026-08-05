import {
  canRemoveAccess,
  createSupabaseAccessGateway,
  describeAccessError,
  leaveFamily,
  removeAccess,
  transferOwnership,
  type AccessGateway,
} from './access';
import { FAMILY_ROLES, type FamilyRole } from './role';

type Call =
  | { method: 'removeAccess'; familyId: string; userId: string }
  | { method: 'leaveFamily'; familyId: string }
  | { method: 'setRole'; familyId: string; userId: string; role: FamilyRole };

function fakeGateway(overrides: Partial<AccessGateway> = {}) {
  const calls: Call[] = [];
  const gateway: AccessGateway = {
    async removeAccess(input) {
      calls.push({ method: 'removeAccess', ...input });
      return { error: null };
    },
    async leaveFamily(input) {
      calls.push({ method: 'leaveFamily', ...input });
      return { error: null };
    },
    async setRole(input) {
      calls.push({ method: 'setRole', ...input });
      return { error: null };
    },
    ...overrides,
  };
  return { gateway, calls };
}

describe('canRemoveAccess', () => {
  it('lets an owner remove anyone, including another owner', () => {
    // The case a single rank comparison gets wrong. `rank(actor) > rank(target)`
    // would block this, and removing a co-owner who has gone rogue is exactly
    // what removal is for. The last-owner guarantee is what protects the
    // family, not a hierarchy.
    for (const target of FAMILY_ROLES) {
      expect(canRemoveAccess('owner', target, false)).toBe(true);
    }
  });

  it('stops an admin removing an owner or another admin', () => {
    // And `rank(actor) >= rank(target)` would allow admin-on-admin, which the
    // matrix forbids. Neither comparison alone is the rule.
    expect(canRemoveAccess('admin', 'owner', false)).toBe(false);
    expect(canRemoveAccess('admin', 'admin', false)).toBe(false);
  });

  it('lets an admin remove a member or a guest', () => {
    expect(canRemoveAccess('admin', 'member', false)).toBe(true);
    expect(canRemoveAccess('admin', 'guest', false)).toBe(true);
  });

  it('gives a member and a guest nobody to remove', () => {
    for (const target of FAMILY_ROLES) {
      expect(canRemoveAccess('member', target, false)).toBe(false);
      expect(canRemoveAccess('guest', target, false)).toBe(false);
    }
  });

  it('refuses when the actor has no role at all', () => {
    // FamilyProvider returns null both for "no access" and for a failed read.
    expect(canRemoveAccess(null, 'member', false)).toBe(false);
  });

  it('never offers to remove yourself', () => {
    // Leaving has its own rules — a guest may leave but may not remove anyone —
    // and its own copy. Collapsing the two would put self-removal behind a
    // manager-gated door.
    for (const actor of FAMILY_ROLES) {
      expect(canRemoveAccess(actor, actor, true)).toBe(false);
    }
  });

  it('refuses somebody who has no account to remove', () => {
    // Most people in a family never sign in. There is no access to revoke.
    expect(canRemoveAccess('owner', null, false)).toBe(false);
  });
});

describe('describeAccessError', () => {
  it.each([
    [
      'You are the only owner. Make someone else an owner first, or delete the family',
      'You are the only owner. Make someone else an owner first, or delete the family.',
    ],
    [
      'A family must always have an owner',
      'A family must always have an owner. Make someone else an owner first.',
    ],
    ['Use leave family to remove yourself', 'To remove yourself, use Leave family.'],
    [
      'That person does not have access to this family',
      'That person does not have an account in this family.',
    ],
    ['Not allowed to remove this person', 'You do not have permission to remove this person.'],
    ['You are not in this family', 'You are not in this family.'],
    ['permission denied for table family_users', 'You do not have permission to do that.'],
  ])('rewrites %p', (raw, expected) => {
    expect(describeAccessError(raw)).toBe(expected);
  });

  it('passes an unrecognised message through rather than swallowing it', () => {
    expect(describeAccessError('deadlock detected')).toBe('deadlock detected');
  });
});

describe('removeAccess', () => {
  it('sends the family and the account', async () => {
    const { gateway, calls } = fakeGateway();
    await removeAccess(gateway, { familyId: 'fam-1', userId: 'user-2' });

    expect(calls).toEqual([{ method: 'removeAccess', familyId: 'fam-1', userId: 'user-2' }]);
  });

  it('translates the last-owner refusal', async () => {
    const { gateway } = fakeGateway({
      removeAccess: async () => ({ error: { message: 'A family must always have an owner' } }),
    });

    expect(await removeAccess(gateway, { familyId: 'f', userId: 'u' })).toEqual({
      ok: false,
      message: 'A family must always have an owner. Make someone else an owner first.',
    });
  });
});

describe('leaveFamily', () => {
  it('sends only the family — the account comes from the session', async () => {
    // If a user id ever appears in this call, leaving has become something one
    // account can do to another, which is removal and has different rules.
    const { gateway, calls } = fakeGateway();
    await leaveFamily(gateway, { familyId: 'fam-1' });

    expect(calls).toEqual([{ method: 'leaveFamily', familyId: 'fam-1' }]);
  });

  it('translates the sole-owner refusal into both ways out', async () => {
    const { gateway } = fakeGateway({
      leaveFamily: async () => ({
        error: {
          message:
            'You are the only owner. Make someone else an owner first, or delete the family',
        },
      }),
    });

    expect(await leaveFamily(gateway, { familyId: 'f' })).toEqual({
      ok: false,
      message: 'You are the only owner. Make someone else an owner first, or delete the family.',
    });
  });
});

describe('transferOwnership', () => {
  it('promotes them before stepping down, in that order', async () => {
    // The order is the entire reason this function exists. Demoting yourself
    // first is refused by the last-owner guarantee, so anybody doing this by
    // hand has to already know the trick.
    const { gateway, calls } = fakeGateway();
    await transferOwnership(gateway, {
      familyId: 'fam-1',
      fromUserId: 'me',
      toUserId: 'them',
    });

    expect(calls).toEqual([
      { method: 'setRole', familyId: 'fam-1', userId: 'them', role: 'owner' },
      { method: 'setRole', familyId: 'fam-1', userId: 'me', role: 'admin' },
    ]);
  });

  it('reports success', async () => {
    const { gateway } = fakeGateway();
    expect(
      await transferOwnership(gateway, { familyId: 'f', fromUserId: 'me', toUserId: 'them' }),
    ).toEqual({ ok: true });
  });

  it('does not step down when the promotion failed', async () => {
    // Otherwise a failed promotion is followed by a self-demotion, and the
    // family loses its owner because of an error.
    let attempts = 0;
    const { gateway } = fakeGateway({
      setRole: async () => {
        attempts += 1;
        return { error: { message: 'Not allowed to change roles here' } };
      },
    });
    const outcome = await transferOwnership(gateway, {
      familyId: 'f',
      fromUserId: 'me',
      toUserId: 'them',
    });

    expect(outcome.ok).toBe(false);
    expect(attempts).toBe(1);
  });

  it('says plainly that they are already an owner when only the step-down failed', async () => {
    // "It failed" would be a lie — the other person really is an owner now.
    // Two owners is a state the product supports, so the honest report is what
    // actually happened plus what to do about it.
    let attempt = 0;
    const { gateway } = fakeGateway({
      setRole: async () => {
        attempt += 1;
        return attempt === 1
          ? { error: null }
          : { error: { message: 'Network request failed' } };
      },
    });

    const outcome = await transferOwnership(gateway, {
      familyId: 'f',
      fromUserId: 'me',
      toUserId: 'them',
    });

    expect(outcome).toEqual({
      ok: false,
      message:
        'They are now an owner, but you could not be stepped down. You are both owners — try changing your own role.',
    });
  });

  it('refuses to transfer to yourself without calling the database', async () => {
    const { gateway, calls } = fakeGateway();
    const outcome = await transferOwnership(gateway, {
      familyId: 'f',
      fromUserId: 'me',
      toUserId: 'me',
    });

    expect(outcome).toEqual({ ok: false, message: 'You are already the owner.' });
    expect(calls).toEqual([]);
  });
});

describe('createSupabaseAccessGateway', () => {
  it('writes through RPCs, never through the table', () => {
    // family_users is write-closed: UPDATE and DELETE are revoked from
    // `authenticated`, so a `.from('family_users').delete()` here would fail at
    // the privilege layer. This test exists so that stays true by intent
    // rather than by accident.
    const rpcCalls: { name: string; args: unknown }[] = [];
    const client = {
      rpc: async (name: string, args: unknown) => {
        rpcCalls.push({ name, args });
        return { error: null };
      },
      from: () => {
        throw new Error('access must not touch family_users directly');
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const gateway = createSupabaseAccessGateway(client);

    return Promise.all([
      gateway.removeAccess({ familyId: 'f', userId: 'u' }),
      gateway.leaveFamily({ familyId: 'f' }),
      gateway.setRole({ familyId: 'f', userId: 'u', role: 'admin' }),
    ]).then(() => {
      expect(rpcCalls.map((call) => call.name)).toEqual([
        'remove_family_access',
        'leave_family',
        'set_family_role',
      ]);
    });
  });
});
