import {
  FAMILY_ROLES,
  ROLES_BY_RANK,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  canChangeRoles,
  canEditPeople,
  canManageFamily,
  canManageMembers,
  describeRoleError,
  invitableRoles,
  isFamilyRole,
  roleRank,
  setRole,
  type RoleGateway,
  type SetRoleInput,
} from './role';

function fakeGateway(
  overrides: Partial<RoleGateway> = {},
): { gateway: RoleGateway; calls: SetRoleInput[] } {
  const calls: SetRoleInput[] = [];
  const gateway: RoleGateway = {
    async setRole(input) {
      calls.push(input);
      return { error: null };
    },
    ...overrides,
  };
  return { gateway, calls };
}

describe('the role vocabulary', () => {
  it('is the four roles the check constraint allows, and no fifth', () => {
    // A fifth role is not a small change: Emergency Contact and Digital Legacy
    // were both considered and both rejected as roles, because a role that
    // exists inherits has_family_access and therefore the whole family.
    expect(FAMILY_ROLES).toEqual(['owner', 'admin', 'member', 'guest']);
  });

  it('has a label and a description for every role', () => {
    for (const role of FAMILY_ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
      expect(ROLE_DESCRIPTIONS[role]).toBeTruthy();
    }
  });
});

describe('roleRank', () => {
  it('ranks the four roles', () => {
    expect(roleRank('owner')).toBe(3);
    expect(roleRank('admin')).toBe(2);
    expect(roleRank('member')).toBe(1);
    expect(roleRank('guest')).toBe(0);
  });

  it('ranks anything it does not recognise below all of them', () => {
    // Mirrors the −1 in public.role_rank. A role from a future migration that
    // this build has never heard of must rank last, not first.
    expect(roleRank('sovereign')).toBe(-1);
    expect(roleRank(null)).toBe(-1);
  });

  it('orders the roles strongest first', () => {
    expect(ROLES_BY_RANK).toEqual(['owner', 'admin', 'member', 'guest']);
  });
});

describe('the permission predicates', () => {
  it.each([
    ['owner', true, true, true, true],
    ['admin', false, true, true, false],
    ['member', false, false, true, false],
    ['guest', false, false, false, false],
  ] as const)('%s', (role, manageFamily, manageMembers, editPeople, changeRoles) => {
    expect(canManageFamily(role)).toBe(manageFamily);
    expect(canManageMembers(role)).toBe(manageMembers);
    expect(canEditPeople(role)).toBe(editPeople);
    expect(canChangeRoles(role)).toBe(changeRoles);
  });

  it('refuses everything when the role is unknown', () => {
    // FamilyProvider returns null both for "no access" and for a failed read.
    // Guessing a role on a failed read is the dangerous direction to guess in —
    // PR-7 shipped a defect of exactly that shape.
    expect(canManageFamily(null)).toBe(false);
    expect(canManageMembers(null)).toBe(false);
    expect(canEditPeople(null)).toBe(false);
    expect(canChangeRoles(null)).toBe(false);
  });
});

describe('invitableRoles', () => {
  it('lets an owner invite any role, owner included', () => {
    // The case a strictly-below cap would have broken. A second owner can only
    // ever arrive through an owner's invitation.
    expect(invitableRoles('owner')).toEqual(['owner', 'admin', 'member', 'guest']);
  });

  it('stops an admin offering ownership', () => {
    // The escalation this closes: mint an owner code, redeem it on a second
    // account you control.
    expect(invitableRoles('admin')).toEqual(['admin', 'member', 'guest']);
  });

  it('gives a member and a guest nothing to offer', () => {
    expect(invitableRoles('member')).toEqual([]);
    expect(invitableRoles('guest')).toEqual([]);
    expect(invitableRoles(null)).toEqual([]);
  });

  it('never offers a role above the caller', () => {
    for (const caller of FAMILY_ROLES) {
      for (const offered of invitableRoles(caller)) {
        expect(roleRank(offered)).toBeLessThanOrEqual(roleRank(caller));
      }
    }
  });
});

describe('describeRoleError', () => {
  it.each([
    [
      'A family must always have an owner',
      'A family must always have an owner. Make someone else an owner first.',
    ],
    ['Not allowed to change roles here', 'Only an owner can change roles.'],
    [
      'That person does not have access to this family',
      'That person does not have an account in this family yet.',
    ],
    ['Unknown role', 'That is not a role.'],
    ['Not authenticated', 'Your session has expired. Sign in again.'],
    ['permission denied for table family_users', 'You do not have permission to do that.'],
  ])('rewrites %p', (raw, expected) => {
    expect(describeRoleError(raw)).toBe(expected);
  });

  it('passes an unrecognised message through rather than swallowing it', () => {
    expect(describeRoleError('deadlock detected')).toBe('deadlock detected');
  });
});

describe('setRole', () => {
  it('sends the family, the account and the new role', () => {
    const { gateway, calls } = fakeGateway();
    return setRole(gateway, { familyId: 'fam-1', userId: 'user-1', role: 'admin' }).then(() => {
      expect(calls).toEqual([{ familyId: 'fam-1', userId: 'user-1', role: 'admin' }]);
    });
  });

  it('reports success', async () => {
    const { gateway } = fakeGateway();
    expect(await setRole(gateway, { familyId: 'f', userId: 'u', role: 'guest' })).toEqual({
      ok: true,
    });
  });

  it('refuses a role that does not exist without calling the database', async () => {
    const { gateway, calls } = fakeGateway();
    const outcome = await setRole(gateway, {
      familyId: 'f',
      userId: 'u',
      role: 'sovereign' as never,
    });

    expect(outcome).toEqual({ ok: false, message: 'That is not a role.' });
    expect(calls).toEqual([]);
  });

  it('translates the last-owner refusal', async () => {
    const { gateway } = fakeGateway({
      setRole: async () => ({ error: { message: 'A family must always have an owner' } }),
    });

    expect(await setRole(gateway, { familyId: 'f', userId: 'u', role: 'member' })).toEqual({
      ok: false,
      message: 'A family must always have an owner. Make someone else an owner first.',
    });
  });
});

describe('isFamilyRole', () => {
  it('accepts the four roles and rejects everything else', () => {
    for (const role of FAMILY_ROLES) expect(isFamilyRole(role)).toBe(true);
    expect(isFamilyRole('sovereign')).toBe(false);
    expect(isFamilyRole(null)).toBe(false);
    expect(isFamilyRole(3)).toBe(false);
  });
});
