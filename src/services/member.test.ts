import {
  addMember,
  BLOOD_GROUPS,
  describeMemberError,
  listMembers,
  MAX_NAME_LENGTH,
  updateMember,
  validateMemberInput,
  type Member,
  type MemberGateway,
  type Person,
} from './member';

const person: Person = {
  id: 'person-1',
  familyId: 'fam-1',
  displayName: 'Nani',
  dateOfBirth: '1948-03-12',
  bloodGroup: 'O+',
};

const member: Member = {
  ...person,
  userId: null,
  email: null,
  role: null,
  joinedAt: null,
};

function fakeGateway(overrides: Partial<MemberGateway> = {}) {
  const calls: { method: string; [key: string]: unknown }[] = [];
  const gateway: MemberGateway = {
    listMembers: async (familyId) => {
      calls.push({ method: 'listMembers', familyId });
      return { data: [member], error: null };
    },
    addMember: async (familyId, input) => {
      calls.push({ method: 'addMember', familyId, ...input });
      return { data: person, error: null };
    },
    updateMember: async (memberId, input) => {
      calls.push({ method: 'updateMember', memberId, ...input });
      return { data: person, error: null };
    },
    ...overrides,
  };
  return { gateway, calls };
}

const today = new Date('2026-08-03T10:00:00.000Z');

describe('validateMemberInput', () => {
  it('accepts a person with only a name — most relatives have nothing else recorded', () => {
    expect(validateMemberInput({ displayName: 'Nani' }, today)).toBeNull();
  });

  it('accepts a full record', () => {
    expect(
      validateMemberInput(
        { displayName: 'Nani', dateOfBirth: '1948-03-12', bloodGroup: 'O+' },
        today,
      ),
    ).toBeNull();
  });

  it.each(['', '   ', '\n'])('rejects %p as a name', (displayName) => {
    expect(validateMemberInput({ displayName }, today)).toEqual({
      message: 'Enter a name.',
      field: 'displayName',
    });
  });

  it(`rejects a name longer than ${MAX_NAME_LENGTH} characters`, () => {
    expect(validateMemberInput({ displayName: 'a'.repeat(MAX_NAME_LENGTH + 1) }, today)).toEqual({
      message: `Keep it under ${MAX_NAME_LENGTH} characters.`,
      field: 'displayName',
    });
  });

  it('measures the trimmed name, matching the database constraint', () => {
    const padded = `  ${'a'.repeat(MAX_NAME_LENGTH)}  `;
    expect(validateMemberInput({ displayName: padded }, today)).toBeNull();
  });

  it('rejects a malformed date', () => {
    expect(
      validateMemberInput({ displayName: 'Nani', dateOfBirth: '12/03/1948' }, today),
    ).toEqual({
      message: 'Use the format YYYY-MM-DD, e.g. 1948-03-12.',
      field: 'dateOfBirth',
    });
  });

  it('rejects a date that does not exist', () => {
    expect(
      validateMemberInput({ displayName: 'Nani', dateOfBirth: '2026-02-31' }, today),
    ).toEqual({ message: 'That is not a real date.', field: 'dateOfBirth' });
  });

  it('rejects a birthday in the future', () => {
    expect(
      validateMemberInput({ displayName: 'Nani', dateOfBirth: '2026-08-04' }, today),
    ).toEqual({ message: 'A birthday cannot be in the future.', field: 'dateOfBirth' });
  });

  it('accepts a birthday of today', () => {
    // A baby born this morning is a family member. Comparison is done in UTC
    // so a device ahead of UTC cannot reject today as future.
    expect(
      validateMemberInput({ displayName: 'Newborn', dateOfBirth: '2026-08-03' }, today),
    ).toBeNull();
  });

  it('accepts a long-dead ancestor', () => {
    expect(
      validateMemberInput({ displayName: 'Great-grandfather', dateOfBirth: '1899-01-04' }, today),
    ).toBeNull();
  });

  it.each(BLOOD_GROUPS)('accepts blood group %s', (bloodGroup) => {
    expect(validateMemberInput({ displayName: 'Nani', bloodGroup }, today)).toBeNull();
  });
});

describe('describeMemberError', () => {
  it.each([
    ['Not allowed to edit this person', 'You do not have permission to do that.'],
    ['Date of birth is in the future', 'A birthday cannot be in the future.'],
    [
      'violates check constraint "family_members_display_name_check"',
      `Use between 1 and ${MAX_NAME_LENGTH} characters.`,
    ],
    [
      'violates check constraint "family_members_blood_group_check"',
      'That is not a recognised blood group.',
    ],
    [
      'duplicate key value violates unique constraint "family_members_account_unique"',
      'That person is already linked to an account in this family.',
    ],
    ['permission denied for table family_members', 'You do not have permission to do that.'],
  ])('rewrites %p', (raw, expected) => {
    expect(describeMemberError(raw)).toBe(expected);
  });

  it('passes an unrecognised message through rather than swallowing it', () => {
    expect(describeMemberError('deadlock detected')).toBe('deadlock detected');
  });
});

describe('addMember', () => {
  it('never reaches the database when the input is invalid', async () => {
    const { gateway, calls } = fakeGateway();
    const result = await addMember(gateway, 'fam-1', { displayName: '  ' });

    expect(result).toEqual({ ok: false, message: 'Enter a name.', field: 'displayName' });
    expect(calls).toHaveLength(0);
  });

  it('trims the name and turns empty optional fields into null', async () => {
    // A text input yields '' when cleared, and '' is not a date. Sending it
    // would fail at the column rather than reading as "not recorded".
    const { gateway, calls } = fakeGateway();
    await addMember(gateway, 'fam-1', {
      displayName: '  Nani  ',
      dateOfBirth: '',
      bloodGroup: null,
    });

    expect(calls[0]).toEqual({
      method: 'addMember',
      familyId: 'fam-1',
      displayName: 'Nani',
      dateOfBirth: null,
      bloodGroup: null,
    });
  });

  it('returns the created person', async () => {
    const { gateway } = fakeGateway();
    expect(await addMember(gateway, 'fam-1', { displayName: 'Nani' })).toEqual({
      ok: true,
      person,
    });
  });

  it('reports a permission failure in plain language', async () => {
    const { gateway } = fakeGateway({
      addMember: async () => ({ data: null, error: { message: 'Not allowed to edit this family' } }),
    });

    expect(await addMember(gateway, 'fam-1', { displayName: 'Nani' })).toEqual({
      ok: false,
      message: 'You do not have permission to do that.',
    });
  });

  it('fails rather than claiming success when no row comes back', async () => {
    const { gateway } = fakeGateway({
      addMember: async () => ({ data: null, error: null }),
    });

    expect(await addMember(gateway, 'fam-1', { displayName: 'Nani' })).toEqual({
      ok: false,
      message: 'That person was not added. Please try again.',
    });
  });

  it('sends no user_id — linking a person to an account is the database’s job', async () => {
    // Locks in the reason writes go through a definer function. If a user id
    // ever appears in this call, a client can claim someone else's identity.
    const { gateway, calls } = fakeGateway();
    await addMember(gateway, 'fam-1', { displayName: 'Nani' });

    expect(Object.keys(calls[0]).sort()).toEqual(
      ['bloodGroup', 'dateOfBirth', 'displayName', 'familyId', 'method'].sort(),
    );
  });
});

describe('updateMember', () => {
  it('validates before sending', async () => {
    const { gateway, calls } = fakeGateway();
    await updateMember(gateway, 'person-1', { displayName: '' });
    expect(calls).toHaveLength(0);
  });

  it('sends the member id and the normalised fields', async () => {
    const { gateway, calls } = fakeGateway();
    await updateMember(gateway, 'person-1', {
      displayName: 'Nani ',
      dateOfBirth: '1948-03-12',
      bloodGroup: 'O+',
    });

    expect(calls[0]).toEqual({
      method: 'updateMember',
      memberId: 'person-1',
      displayName: 'Nani',
      dateOfBirth: '1948-03-12',
      bloodGroup: 'O+',
    });
  });

  it('explains a rejection from another family', async () => {
    const { gateway } = fakeGateway({
      updateMember: async () => ({
        data: null,
        error: { message: 'Not allowed to edit this person' },
      }),
    });

    expect(await updateMember(gateway, 'person-1', { displayName: 'Nani' })).toEqual({
      ok: false,
      message: 'You do not have permission to do that.',
    });
  });
});

describe('listMembers', () => {
  it('returns everyone the gateway reports', async () => {
    const { gateway } = fakeGateway();
    expect(await listMembers(gateway, 'fam-1')).toEqual([member]);
  });

  it('sends no filter of its own — the database checks the caller', async () => {
    const { gateway, calls } = fakeGateway();
    await listMembers(gateway, 'fam-1');
    expect(calls).toEqual([{ method: 'listMembers', familyId: 'fam-1' }]);
  });

  it('returns an empty list on error rather than throwing at a screen', async () => {
    const { gateway } = fakeGateway({
      listMembers: async () => ({ data: null, error: { message: 'permission denied' } }),
    });

    expect(await listMembers(gateway, 'fam-1')).toEqual([]);
  });
});
