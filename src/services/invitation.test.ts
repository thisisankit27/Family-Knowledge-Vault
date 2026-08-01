import type { Family } from './family';
import {
  createInvitation,
  describeInvitationError,
  INVITATION_CODE_LENGTH,
  listMembers,
  listUsableInvitations,
  normaliseCode,
  redeemInvitation,
  revokeInvitation,
  selectUsableInvitations,
  validateCode,
  type FamilyMember,
  type Invitation,
  type InvitationGateway,
} from './invitation';

const family: Family = {
  id: 'fam-1',
  name: 'The Srivastavas',
  createdBy: 'user-1',
  createdAt: '2026-08-01T09:30:00.000Z',
};

const invitation: Invitation = {
  id: 'inv-1',
  familyId: 'fam-1',
  code: 'ABCD2345',
  role: 'member',
  createdAt: '2026-08-01T09:30:00.000Z',
  expiresAt: '2026-08-08T09:30:00.000Z',
  redeemedAt: null,
};

const member: FamilyMember = {
  userId: 'user-1',
  email: 'nanima@example.com',
  role: 'owner',
  joinedAt: '2026-08-01T09:30:00.000Z',
};

function fakeGateway(overrides: Partial<InvitationGateway> = {}) {
  const calls: { method: string; [key: string]: unknown }[] = [];
  const gateway: InvitationGateway = {
    createInvitation: async (input) => {
      calls.push({ method: 'createInvitation', ...input });
      return { data: invitation, error: null };
    },
    redeemInvitation: async (code) => {
      calls.push({ method: 'redeemInvitation', code });
      return { data: family, error: null };
    },
    listMembers: async (familyId) => {
      calls.push({ method: 'listMembers', familyId });
      return { data: [member], error: null };
    },
    listInvitations: async (familyId) => {
      calls.push({ method: 'listInvitations', familyId });
      return { data: [invitation], error: null };
    },
    revokeInvitation: async (id) => {
      calls.push({ method: 'revokeInvitation', id });
      return { error: null };
    },
    ...overrides,
  };
  return { gateway, calls };
}

describe('normaliseCode', () => {
  it.each([
    ['abcd2345', 'ABCD2345'],
    ['ABCD-2345', 'ABCD2345'],
    ['abcd 2345', 'ABCD2345'],
    ['  ABCD2345  ', 'ABCD2345'],
    ['a b c d 2 3 4 5', 'ABCD2345'],
  ])('turns %p into %p', (raw, expected) => {
    // Codes get read aloud, forwarded, and typed from screenshots. Every one
    // of these is the same code, and rejecting any of them is a support ticket.
    expect(normaliseCode(raw)).toBe(expected);
  });
});

describe('validateCode', () => {
  it('accepts a well-formed code', () => {
    expect(validateCode('ABCD2345')).toBeNull();
  });

  it('accepts a code that only needs normalising', () => {
    expect(validateCode('abcd-2345')).toBeNull();
  });

  it('rejects an empty entry', () => {
    expect(validateCode('   ')).toEqual({ message: 'Enter the code you were given.' });
  });

  it.each(['ABCD234', 'ABCD23456'])('rejects %p for length', (code) => {
    expect(validateCode(code)).toEqual({
      message: `Codes are ${INVITATION_CODE_LENGTH} characters long.`,
    });
  });

  it.each(['ABCD234O', 'ABCD2340', 'ABCD234I', 'ABCD2341'])(
    'rejects %p, which contains an excluded character',
    (code) => {
      // O/0 and I/1 are excluded from the alphabet precisely because they are
      // misread, so seeing one means the person mistyped a real code.
      expect(validateCode(code)).toEqual({
        message: 'That code contains characters we never use — check for O/0 or I/1.',
      });
    },
  );
});

describe('describeInvitationError', () => {
  it.each([
    ['Already in a family', "You're already in a family. Joining a second one isn't supported yet."],
    ['Invalid code', "That code doesn't match an invitation."],
    ['Code already used', 'That code has already been used. Ask for a new one.'],
    ['Code expired', 'That code has expired. Ask for a new one.'],
    ['Only an owner can invite', 'Only the family owner can invite people.'],
    ['permission denied for table family_invitations', 'You do not have permission to do that.'],
  ])('rewrites %p', (raw, expected) => {
    expect(describeInvitationError(raw)).toBe(expected);
  });

  it('passes an unrecognised message through rather than swallowing it', () => {
    expect(describeInvitationError('deadlock detected')).toBe('deadlock detected');
  });
});

describe('createInvitation', () => {
  it('defaults the invited role to member', async () => {
    // Owner is the more dangerous default; an invite link that silently grants
    // ownership is the kind of thing nobody notices until it matters.
    const { gateway, calls } = fakeGateway();
    await createInvitation(gateway, { familyId: 'fam-1' });

    expect(calls[0]).toEqual({ method: 'createInvitation', familyId: 'fam-1', role: 'member' });
  });

  it('passes an explicit owner role through', async () => {
    const { gateway, calls } = fakeGateway();
    await createInvitation(gateway, { familyId: 'fam-1', role: 'owner' });

    expect(calls[0]).toEqual({ method: 'createInvitation', familyId: 'fam-1', role: 'owner' });
  });

  it('returns the invitation', async () => {
    const { gateway } = fakeGateway();
    expect(await createInvitation(gateway, { familyId: 'fam-1' })).toEqual({
      ok: true,
      invitation,
    });
  });

  it('reports a non-owner attempt in plain language', async () => {
    const { gateway } = fakeGateway({
      createInvitation: async () => ({
        data: null,
        error: { message: 'Only an owner can invite' },
      }),
    });

    expect(await createInvitation(gateway, { familyId: 'fam-1' })).toEqual({
      ok: false,
      message: 'Only the family owner can invite people.',
    });
  });
});

describe('redeemInvitation', () => {
  it('never reaches the database when the code cannot be valid', async () => {
    const { gateway, calls } = fakeGateway();
    const result = await redeemInvitation(gateway, 'nope');

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('sends the normalised code, not what was typed', async () => {
    const { gateway, calls } = fakeGateway();
    await redeemInvitation(gateway, ' abcd-2345 ');

    expect(calls[0]).toEqual({ method: 'redeemInvitation', code: 'ABCD2345' });
  });

  it('returns the family that was joined', async () => {
    const { gateway } = fakeGateway();
    expect(await redeemInvitation(gateway, 'ABCD2345')).toEqual({ ok: true, family });
  });

  it.each([
    ['Invalid code', "That code doesn't match an invitation."],
    ['Code already used', 'That code has already been used. Ask for a new one.'],
    ['Code expired', 'That code has expired. Ask for a new one.'],
    ['Already in a family', "You're already in a family. Joining a second one isn't supported yet."],
  ])('explains the %p rejection', async (raw, expected) => {
    const { gateway } = fakeGateway({
      redeemInvitation: async () => ({ data: null, error: { message: raw } }),
    });

    expect(await redeemInvitation(gateway, 'ABCD2345')).toEqual({ ok: false, message: expected });
  });
});

describe('selectUsableInvitations', () => {
  const now = new Date('2026-08-02T00:00:00.000Z');

  it('keeps an unredeemed, unexpired invitation', () => {
    expect(selectUsableInvitations([invitation], now)).toEqual([invitation]);
  });

  it('drops one that has been redeemed', () => {
    const spent = { ...invitation, redeemedAt: '2026-08-01T12:00:00.000Z' };
    expect(selectUsableInvitations([spent], now)).toEqual([]);
  });

  it('drops one that has expired', () => {
    const stale = { ...invitation, expiresAt: '2026-08-01T12:00:00.000Z' };
    expect(selectUsableInvitations([stale], now)).toEqual([]);
  });

  it('treats an invitation expiring exactly now as expired', () => {
    const boundary = { ...invitation, expiresAt: now.toISOString() };
    expect(selectUsableInvitations([boundary], now)).toEqual([]);
  });
});

describe('listUsableInvitations', () => {
  it('filters what the gateway returns', async () => {
    const spent = { ...invitation, id: 'inv-2', redeemedAt: '2026-08-01T12:00:00.000Z' };
    const { gateway } = fakeGateway({
      listInvitations: async () => ({ data: [invitation, spent], error: null }),
    });

    const usable = await listUsableInvitations(gateway, 'fam-1', new Date('2026-08-02T00:00:00.000Z'));
    expect(usable).toEqual([invitation]);
  });

  it('returns an empty list on error rather than throwing at a screen', async () => {
    const { gateway } = fakeGateway({
      listInvitations: async () => ({ data: null, error: { message: 'Network request failed' } }),
    });

    expect(await listUsableInvitations(gateway, 'fam-1')).toEqual([]);
  });
});

describe('revokeInvitation', () => {
  it('deletes the invitation', async () => {
    const { gateway, calls } = fakeGateway();
    expect(await revokeInvitation(gateway, 'inv-1')).toEqual({ ok: true });
    expect(calls).toEqual([{ method: 'revokeInvitation', id: 'inv-1' }]);
  });

  it('reports a non-owner attempt rather than pretending it worked', async () => {
    // The delete policy is owner-only. A member's attempt matches no rows, so
    // silence here would tell them the code was killed when it is still live.
    const { gateway } = fakeGateway({
      revokeInvitation: async () => ({ error: { message: 'permission denied' } }),
    });

    expect(await revokeInvitation(gateway, 'inv-1')).toEqual({
      ok: false,
      message: 'You do not have permission to do that.',
    });
  });
});

describe('listMembers', () => {
  it('returns the members the gateway reports', async () => {
    const { gateway } = fakeGateway();
    expect(await listMembers(gateway, 'fam-1')).toEqual([member]);
  });

  it('returns an empty list on error', async () => {
    const { gateway } = fakeGateway({
      listMembers: async () => ({ data: null, error: { message: 'permission denied' } }),
    });

    expect(await listMembers(gateway, 'fam-1')).toEqual([]);
  });
});
