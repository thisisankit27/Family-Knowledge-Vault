import {
  addRelationship,
  describeRelationshipError,
  listRelationships,
  relationshipLabel,
  relationshipsFor,
  removeRelationship,
  RELATIONSHIP_CHOICES,
  RELATIONSHIP_TYPES,
  resolveRelationshipArguments,
  validateRelationship,
  type Relationship,
  type RelationshipGateway,
} from './relationship';

const NANI = 'member-nani';
const SUNITA = 'member-sunita';
const ANKIT = 'member-ankit';

const naniIsParentOfSunita: Relationship = {
  id: 'rel-1',
  familyId: 'fam-1',
  fromMemberId: NANI,
  toMemberId: SUNITA,
  type: 'parent_of',
};

const sunitaAndAnkitAreSpouses: Relationship = {
  id: 'rel-2',
  familyId: 'fam-1',
  fromMemberId: ANKIT,
  toMemberId: SUNITA,
  type: 'spouse_of',
};

function fakeGateway(overrides: Partial<RelationshipGateway> = {}) {
  const calls: { method: string; [key: string]: unknown }[] = [];
  const gateway: RelationshipGateway = {
    listRelationships: async (familyId) => {
      calls.push({ method: 'listRelationships', familyId });
      return { data: [naniIsParentOfSunita], error: null };
    },
    addRelationship: async (input) => {
      calls.push({ method: 'addRelationship', ...input });
      return { data: naniIsParentOfSunita, error: null };
    },
    removeRelationship: async (id) => {
      calls.push({ method: 'removeRelationship', id });
      return { error: null };
    },
    ...overrides,
  };
  return { gateway, calls };
}

describe('relationshipLabel', () => {
  it('calls the other person a child when the viewer is the parent', () => {
    // parent_of is stored as "from is the parent of to". Getting this backwards
    // is the single most likely bug in this file, and it would be invisible
    // until somebody noticed their grandmother listed as their daughter.
    expect(relationshipLabel('parent_of', true)).toBe('Child');
  });

  it('calls the other person a parent when the viewer is the child', () => {
    expect(relationshipLabel('parent_of', false)).toBe('Parent');
  });

  it.each([
    ['spouse_of', 'Spouse'],
    ['sibling_of', 'Sibling'],
  ] as const)('reads %p the same in both directions', (type, expected) => {
    expect(relationshipLabel(type, true)).toBe(expected);
    expect(relationshipLabel(type, false)).toBe(expected);
  });
});

describe('relationshipsFor', () => {
  const all = [naniIsParentOfSunita, sunitaAndAnkitAreSpouses];

  it('shows Sunita as Nani’s child', () => {
    expect(relationshipsFor(NANI, all)).toEqual([
      { id: 'rel-1', otherMemberId: SUNITA, label: 'Child' },
    ]);
  });

  it('shows Nani as Sunita’s parent — the same row, read from the other end', () => {
    expect(relationshipsFor(SUNITA, all)).toEqual([
      { id: 'rel-1', otherMemberId: NANI, label: 'Parent' },
      { id: 'rel-2', otherMemberId: ANKIT, label: 'Spouse' },
    ]);
  });

  it('ignores relationships the person is not part of', () => {
    expect(relationshipsFor('member-stranger', all)).toEqual([]);
  });

  it('returns nothing when the family has no relationships', () => {
    expect(relationshipsFor(NANI, [])).toEqual([]);
  });
});

describe('resolveRelationshipArguments', () => {
  const choice = (key: string) => RELATIONSHIP_CHOICES.find((entry) => entry.key === key)!;

  it('puts the subject first for "parent of"', () => {
    expect(resolveRelationshipArguments(choice('parent'), NANI, SUNITA)).toEqual({
      firstMemberId: NANI,
      secondMemberId: SUNITA,
      type: 'parent_of',
    });
  });

  it('swaps the pair for "child of" — the same row, stated from the other side', () => {
    // Standing on Sunita's page and saying "Sunita is the child of Nani" must
    // produce the identical row as standing on Nani's and saying "parent of".
    // If it did not, the two phrasings would create two contradictory records.
    expect(resolveRelationshipArguments(choice('child'), SUNITA, NANI)).toEqual({
      firstMemberId: NANI,
      secondMemberId: SUNITA,
      type: 'parent_of',
    });
  });

  it('produces the same row from either page', () => {
    expect(resolveRelationshipArguments(choice('parent'), NANI, SUNITA)).toEqual(
      resolveRelationshipArguments(choice('child'), SUNITA, NANI),
    );
  });

  it.each(['spouse', 'sibling'])('leaves the order alone for %p', (key) => {
    expect(resolveRelationshipArguments(choice(key), NANI, SUNITA)).toEqual({
      firstMemberId: NANI,
      secondMemberId: SUNITA,
      type: choice(key).type,
    });
  });

  it('offers four choices over three stored types', () => {
    expect(RELATIONSHIP_CHOICES).toHaveLength(4);
    expect(new Set(RELATIONSHIP_CHOICES.map((entry) => entry.type)).size).toBe(3);
  });
});

describe('validateRelationship', () => {
  it('accepts two different people and a known type', () => {
    expect(
      validateRelationship({ firstMemberId: NANI, secondMemberId: SUNITA, type: 'parent_of' }),
    ).toBeNull();
  });

  it('rejects a person related to themselves', () => {
    expect(
      validateRelationship({ firstMemberId: NANI, secondMemberId: NANI, type: 'sibling_of' }),
    ).toEqual({ message: 'A person cannot be related to themselves.' });
  });

  it.each([
    ['', SUNITA],
    [NANI, ''],
  ])('rejects a missing person (%p, %p)', (firstMemberId, secondMemberId) => {
    expect(validateRelationship({ firstMemberId, secondMemberId, type: 'parent_of' })).toEqual({
      message: 'Choose both people.',
    });
  });

  it('rejects a type the database would not accept', () => {
    expect(
      validateRelationship({
        firstMemberId: NANI,
        secondMemberId: SUNITA,
        type: 'cousin_of' as never,
      }),
    ).toEqual({ message: 'Choose a relationship.' });
  });

  it.each(RELATIONSHIP_TYPES)('accepts the %s type', (type) => {
    expect(
      validateRelationship({ firstMemberId: NANI, secondMemberId: SUNITA, type }),
    ).toBeNull();
  });
});

describe('describeRelationshipError', () => {
  it.each([
    ['That relationship already exists', 'That relationship is already recorded.'],
    [
      'Circular parent relationship',
      'They are already recorded as this person’s parent, so it cannot go both ways.',
    ],
    ['Those people are not in the same family', 'Those two people are not in the same family.'],
    ['Not allowed to edit this family', 'You do not have permission to do that.'],
    ['permission denied for table family_relationships', 'You do not have permission to do that.'],
  ])('rewrites %p', (raw, expected) => {
    expect(describeRelationshipError(raw)).toBe(expected);
  });

  it('passes an unrecognised message through rather than swallowing it', () => {
    expect(describeRelationshipError('deadlock detected')).toBe('deadlock detected');
  });
});

describe('addRelationship', () => {
  it('never reaches the database when the input cannot be valid', async () => {
    const { gateway, calls } = fakeGateway();
    const result = await addRelationship(gateway, {
      firstMemberId: NANI,
      secondMemberId: NANI,
      type: 'sibling_of',
    });

    expect(result).toEqual({
      ok: false,
      message: 'A person cannot be related to themselves.',
    });
    expect(calls).toHaveLength(0);
  });

  it('sends the pair in the order the caller gave — ordering is the database’s job', async () => {
    // Canonical ordering for symmetric types happens inside
    // add_family_relationship. If this service ever starts sorting, the two
    // implementations can disagree and duplicates become possible.
    const { gateway, calls } = fakeGateway();
    await addRelationship(gateway, {
      firstMemberId: SUNITA,
      secondMemberId: ANKIT,
      type: 'spouse_of',
    });

    expect(calls[0]).toEqual({
      method: 'addRelationship',
      firstMemberId: SUNITA,
      secondMemberId: ANKIT,
      type: 'spouse_of',
    });
  });

  it('sends no family id — it is derived from the people involved', async () => {
    const { gateway, calls } = fakeGateway();
    await addRelationship(gateway, {
      firstMemberId: NANI,
      secondMemberId: SUNITA,
      type: 'parent_of',
    });

    expect(Object.keys(calls[0]).sort()).toEqual(
      ['firstMemberId', 'method', 'secondMemberId', 'type'].sort(),
    );
  });

  it('returns the recorded relationship', async () => {
    const { gateway } = fakeGateway();
    expect(
      await addRelationship(gateway, {
        firstMemberId: NANI,
        secondMemberId: SUNITA,
        type: 'parent_of',
      }),
    ).toEqual({ ok: true, relationship: naniIsParentOfSunita });
  });

  it('explains a duplicate rather than reporting a constraint name', async () => {
    const { gateway } = fakeGateway({
      addRelationship: async () => ({
        data: null,
        error: { message: 'That relationship already exists' },
      }),
    });

    expect(
      await addRelationship(gateway, {
        firstMemberId: NANI,
        secondMemberId: SUNITA,
        type: 'parent_of',
      }),
    ).toEqual({ ok: false, message: 'That relationship is already recorded.' });
  });

  it('fails rather than claiming success when no row comes back', async () => {
    const { gateway } = fakeGateway({
      addRelationship: async () => ({ data: null, error: null }),
    });

    expect(
      await addRelationship(gateway, {
        firstMemberId: NANI,
        secondMemberId: SUNITA,
        type: 'parent_of',
      }),
    ).toEqual({ ok: false, message: 'That relationship was not recorded. Please try again.' });
  });
});

describe('listRelationships', () => {
  it('returns what the gateway reports', async () => {
    const { gateway } = fakeGateway();
    expect(await listRelationships(gateway, 'fam-1')).toEqual([naniIsParentOfSunita]);
  });

  it('returns an empty list on error rather than throwing at a screen', async () => {
    const { gateway } = fakeGateway({
      listRelationships: async () => ({
        data: null,
        error: { message: 'Network request failed' },
      }),
    });

    expect(await listRelationships(gateway, 'fam-1')).toEqual([]);
  });
});

describe('removeRelationship', () => {
  it('deletes the relationship', async () => {
    const { gateway, calls } = fakeGateway();
    expect(await removeRelationship(gateway, 'rel-1')).toEqual({ ok: true });
    expect(calls).toEqual([{ method: 'removeRelationship', id: 'rel-1' }]);
  });

  it('reports a refusal rather than pretending it worked', async () => {
    const { gateway } = fakeGateway({
      removeRelationship: async () => ({ error: { message: 'permission denied' } }),
    });

    expect(await removeRelationship(gateway, 'rel-1')).toEqual({
      ok: false,
      message: 'You do not have permission to do that.',
    });
  });
});
