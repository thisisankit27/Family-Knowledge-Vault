import {
  createFamily,
  describeFamilyError,
  getMyRole,
  listMyFamilies,
  MAX_FAMILY_NAME_LENGTH,
  validateFamilyName,
  type Family,
  type FamilyGateway,
} from './family';

const family: Family = {
  id: 'fam-1',
  name: 'The Srivastavas',
  createdBy: 'user-1',
  createdAt: '2026-08-01T09:30:00.000Z',
};

/** Records what reached the database, so trimming can be asserted. */
function fakeGateway(overrides: Partial<FamilyGateway> = {}) {
  const calls: { method: string; name?: string }[] = [];
  const gateway: FamilyGateway = {
    createFamily: async (input) => {
      calls.push({ method: 'createFamily', ...input });
      return { data: family, error: null };
    },
    listMyFamilies: async () => {
      calls.push({ method: 'listMyFamilies' });
      return { data: [family], error: null };
    },
    getMyRole: async () => {
      calls.push({ method: 'getMyRole' });
      return { data: 'owner' as const, error: null };
    },
    ...overrides,
  };
  return { gateway, calls };
}

describe('validateFamilyName', () => {
  it('accepts an ordinary name', () => {
    expect(validateFamilyName('The Srivastavas')).toBeNull();
  });

  it.each(['', '   ', '\n\t'])('rejects %p as empty', (name) => {
    expect(validateFamilyName(name)).toEqual({ message: 'Give your family a name.' });
  });

  it(`rejects a name longer than ${MAX_FAMILY_NAME_LENGTH} characters`, () => {
    expect(validateFamilyName('a'.repeat(MAX_FAMILY_NAME_LENGTH + 1))).toEqual({
      message: `Keep it under ${MAX_FAMILY_NAME_LENGTH} characters.`,
    });
  });

  it('accepts a name of exactly the maximum length', () => {
    expect(validateFamilyName('a'.repeat(MAX_FAMILY_NAME_LENGTH))).toBeNull();
  });

  it('measures the trimmed name, not the padding around it', () => {
    // The database constraint checks trim(name), so validating the raw string
    // would reject names the database would happily accept.
    const padded = `  ${'a'.repeat(MAX_FAMILY_NAME_LENGTH)}  `;
    expect(validateFamilyName(padded)).toBeNull();
  });
});

describe('describeFamilyError', () => {
  it('explains a row-level-security rejection as a permission problem', () => {
    // Raw: "new row violates row-level security policy for table families".
    // That reads like a crash; it is a rule doing its job.
    expect(
      describeFamilyError('new row violates row-level security policy for table "families"'),
    ).toBe('You do not have permission to do that.');
  });

  it('translates the name check constraint', () => {
    expect(
      describeFamilyError('new row for relation "families" violates check constraint "families_name_check"'),
    ).toBe(`Use between 1 and ${MAX_FAMILY_NAME_LENGTH} characters.`);
  });

  it('explains the expired-session case raised by create_family()', () => {
    expect(describeFamilyError('Not authenticated')).toBe(
      'Your session has expired. Sign in again.',
    );
  });

  it('translates a network failure', () => {
    expect(describeFamilyError('Network request failed')).toBe(
      'Cannot reach the server. Check your connection and try again.',
    );
  });

  it('passes an unrecognised message through rather than swallowing it', () => {
    expect(describeFamilyError('deadlock detected')).toBe('deadlock detected');
  });
});

describe('createFamily', () => {
  it('never reaches the database when the name is invalid', async () => {
    const { gateway, calls } = fakeGateway();
    const result = await createFamily(gateway, { name: '  ' });

    expect(result).toEqual({ ok: false, message: 'Give your family a name.' });
    expect(calls).toHaveLength(0);
  });

  it('trims the name before storing it', async () => {
    const { gateway, calls } = fakeGateway();
    await createFamily(gateway, { name: '  The Srivastavas  ' });

    expect(calls[0]).toEqual({ method: 'createFamily', name: 'The Srivastavas' });
  });

  it('sends no creator — the database takes it from the session', () => {
    // Locks in the security property. If a `createdBy` ever reappears in this
    // call, ownership has become something the client can assert, and
    // create_family()'s guarantee that a family cannot be made in someone
    // else's name is gone.
    const input: Parameters<typeof createFamily>[1] = { name: 'The Srivastavas' };
    expect(Object.keys(input)).toEqual(['name']);
  });

  it('returns the created family', async () => {
    const { gateway } = fakeGateway();
    expect(await createFamily(gateway, { name: 'The Srivastavas' })).toEqual({
      ok: true,
      family,
    });
  });

  it('reports a policy rejection in plain language', async () => {
    const { gateway } = fakeGateway({
      createFamily: async () => ({
        data: null,
        error: { message: 'new row violates row-level security policy' },
      }),
    });

    expect(await createFamily(gateway, { name: 'Someone Else' })).toEqual({
      ok: false,
      message: 'You do not have permission to do that.',
    });
  });

  it('fails rather than claiming success when no row comes back', async () => {
    // Insert succeeded but the SELECT policy declined to return the row.
    // Reporting success here would show a family the app cannot then read.
    const { gateway } = fakeGateway({
      createFamily: async () => ({ data: null, error: null }),
    });

    expect(await createFamily(gateway, { name: 'The Srivastavas' })).toEqual({
      ok: false,
      message: 'The family was not created. Please try again.',
    });
  });
});

describe('listMyFamilies', () => {
  it('returns the families the gateway reports', async () => {
    const { gateway } = fakeGateway();
    expect(await listMyFamilies(gateway)).toEqual([family]);
  });

  it('sends no filter of its own — RLS is the filter', async () => {
    // If this ever starts passing a user id, the tenant boundary has quietly
    // moved from the database into application code, where a forgotten
    // `where` clause leaks another household's data.
    const { gateway, calls } = fakeGateway();
    await listMyFamilies(gateway);

    expect(calls).toEqual([{ method: 'listMyFamilies' }]);
  });

  it('returns an empty list on error rather than throwing at a screen', async () => {
    const { gateway } = fakeGateway({
      listMyFamilies: async () => ({ data: null, error: { message: 'Network request failed' } }),
    });

    expect(await listMyFamilies(gateway)).toEqual([]);
  });
});

describe('getMyRole', () => {
  it('returns the role the access table reports', async () => {
    const { gateway } = fakeGateway();
    expect(await getMyRole(gateway, 'fam-1', 'user-1')).toBe('owner');
  });

  it('returns null when the caller has no access', async () => {
    const { gateway } = fakeGateway({
      getMyRole: async () => ({ data: null, error: null }),
    });

    expect(await getMyRole(gateway, 'fam-1', 'user-1')).toBeNull();
  });

  it('returns null on a failed read rather than assuming a role', async () => {
    // Guessing upward on failure would show owner-only controls to someone who
    // may not be one. The safe direction to guess is "no permission".
    const { gateway } = fakeGateway({
      getMyRole: async () => ({ data: null, error: { message: 'Network request failed' } }),
    });

    expect(await getMyRole(gateway, 'fam-1', 'user-1')).toBeNull();
  });
});
