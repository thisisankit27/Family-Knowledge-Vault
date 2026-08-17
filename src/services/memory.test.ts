import {
  MAX_LOCATION_LENGTH,
  MAX_MEMORY_TITLE_LENGTH,
  MAX_STORY_LENGTH,
  UNKNOWN_DATE_TEXT,
  createMemory,
  deleteMemory,
  describeMemoryAuthor,
  describeMemoryDate,
  describeMemoryError,
  describeMemoryMoment,
  describeMemorySubject,
  formatOccurredOnInput,
  getMemory,
  groupByYear,
  isMemoryPrecision,
  isMemoryVisibility,
  listMemories,
  parseOccurredOn,
  partitionMemories,
  renameMemory,
  setMemoryAiProcessing,
  setMemoryArchived,
  setMemoryDate,
  setMemoryLocation,
  setMemoryStory,
  setMemoryVisibility,
  validateLocation,
  validateMemoryTitle,
  validateStory,
  type CreateMemoryInput,
  type FamilyMemory,
  type MemoryGateway,
} from './memory';

function memory(overrides: Partial<FamilyMemory> = {}): FamilyMemory {
  return {
    id: 'memory-1',
    title: 'Diwali at Nani’s house',
    story: null,
    occurredOn: '2019-11-05',
    occurredPrecision: 'day',
    location: null,
    memberId: null,
    visibility: 'family',
    archivedAt: null,
    aiProcessing: 'denied',
    createdBy: 'user-1',
    createdAt: '2026-08-17T09:00:00.000Z',
    updatedAt: '2026-08-17T09:00:00.000Z',
    ...overrides,
  };
}

/** A gateway that records what it was asked and answers however the test says. */
function fakeGateway(overrides: Partial<MemoryGateway> = {}): MemoryGateway {
  return {
    async listMemories() {
      return { data: [], error: null };
    },
    async createMemory() {
      return { data: memory(), error: null };
    },
    async getMemory() {
      return { data: memory(), error: null };
    },
    async setTitle() {
      return { error: null };
    },
    async setStory() {
      return { error: null };
    },
    async setOccurredOn() {
      return { error: null };
    },
    async setLocation() {
      return { error: null };
    },
    async setMember() {
      return { error: null };
    },
    async setVisibility() {
      return { error: null };
    },
    async setAiProcessing() {
      return { error: null };
    },
    async archiveMemory() {
      return { error: null };
    },
    async deleteMemory() {
      return { error: null };
    },
    ...overrides,
  };
}

describe('validateMemoryTitle', () => {
  it('asks for a name rather than reporting a constraint', () => {
    expect(validateMemoryTitle('  ')?.message).toBe('Give this memory a name.');
  });

  it('accepts a title with surrounding space, because it is trimmed before storing', () => {
    expect(validateMemoryTitle('  Diwali  ')).toBeNull();
  });

  it('refuses a title past the column length', () => {
    expect(validateMemoryTitle('a'.repeat(MAX_MEMORY_TITLE_LENGTH + 1))).not.toBeNull();
    expect(validateMemoryTitle('a'.repeat(MAX_MEMORY_TITLE_LENGTH))).toBeNull();
  });
});

describe('validateStory and validateLocation', () => {
  it('allows an empty story — a title alone is a memory', () => {
    expect(validateStory('')).toBeNull();
  });

  it('refuses a story past the column length', () => {
    expect(validateStory('a'.repeat(MAX_STORY_LENGTH + 1))).not.toBeNull();
    expect(validateStory('a'.repeat(MAX_STORY_LENGTH))).toBeNull();
  });

  it('measures a location after trimming, so trailing space cannot fail it', () => {
    expect(validateLocation(`${'a'.repeat(MAX_LOCATION_LENGTH)}   `)).toBeNull();
    expect(validateLocation('a'.repeat(MAX_LOCATION_LENGTH + 1))).not.toBeNull();
  });
});

describe('parseOccurredOn', () => {
  it('treats empty input as "nobody remembers" rather than as an error', () => {
    expect(parseOccurredOn('', 'day')).toEqual({ occurredOn: null });
    expect(parseOccurredOn('   ', 'year')).toEqual({ occurredOn: null });
  });

  it('normalises a year to the first of January, so the column always sorts', () => {
    expect(parseOccurredOn('1998', 'year')).toEqual({ occurredOn: '1998-01-01' });
  });

  it('normalises a month to the first of that month', () => {
    expect(parseOccurredOn('1998-07', 'month')).toEqual({ occurredOn: '1998-07-01' });
  });

  it('keeps a full date as given', () => {
    expect(parseOccurredOn('1998-07-12', 'day')).toEqual({ occurredOn: '1998-07-12' });
  });

  it('names the shape it wanted when the input does not match the precision', () => {
    expect(parseOccurredOn('1998', 'day')).toEqual({ message: 'Use YYYY-MM-DD.' });
    expect(parseOccurredOn('1998-07-12', 'year')).toEqual({ message: 'Use YYYY.' });
    expect(parseOccurredOn('1998-07-12', 'month')).toEqual({ message: 'Use YYYY-MM.' });
  });

  it('rejects a date that matches the shape and does not exist', () => {
    // The regex cannot catch this; round-tripping through Date can.
    expect(parseOccurredOn('1998-02-31', 'day')).toEqual({ message: 'That is not a real date.' });
    expect(parseOccurredOn('2019-02-29', 'day')).toEqual({ message: 'That is not a real date.' });
  });

  it('accepts a real leap day', () => {
    expect(parseOccurredOn('2020-02-29', 'day')).toEqual({ occurredOn: '2020-02-29' });
  });

  it('rejects a month outside 1-12', () => {
    expect(parseOccurredOn('1998-13', 'month')).toEqual({ message: 'That is not a month.' });
    expect(parseOccurredOn('1998-00', 'month')).toEqual({ message: 'That is not a month.' });
  });

  it('rejects a year before photographs existed, which is always a typo', () => {
    expect(parseOccurredOn('1799', 'year')).toEqual({ message: 'That year is too far back.' });
  });

  it('allows a future date — a planned trip is a memory waiting to happen', () => {
    expect(parseOccurredOn('2099-01-01', 'day')).toEqual({ occurredOn: '2099-01-01' });
  });
});

describe('describeMemoryDate', () => {
  it('renders only the precision that was claimed', () => {
    expect(describeMemoryDate({ occurredOn: '1998-01-01', occurredPrecision: 'year' })).toBe('1998');
    expect(describeMemoryDate({ occurredOn: '1998-07-01', occurredPrecision: 'month' })).toBe(
      'July 1998',
    );
    expect(describeMemoryDate({ occurredOn: '1998-07-12', occurredPrecision: 'day' })).toBe(
      '12 July 1998',
    );
  });

  it('never invents a day the family did not claim', () => {
    // The stored value is 1 January; saying so would be a fact nobody gave us.
    const rendered = describeMemoryDate({ occurredOn: '1998-01-01', occurredPrecision: 'year' });
    expect(rendered).not.toContain('January');
    expect(rendered).not.toContain('1 ');
  });

  it('says the date is unknown rather than showing nothing', () => {
    expect(describeMemoryDate({ occurredOn: null, occurredPrecision: 'day' })).toBe(
      UNKNOWN_DATE_TEXT,
    );
  });

  it('drops the leading zero from a day, because people do not write 05 July', () => {
    expect(describeMemoryDate({ occurredOn: '2019-07-05', occurredPrecision: 'day' })).toBe(
      '5 July 2019',
    );
  });
});

describe('formatOccurredOnInput', () => {
  it('returns the stored date in the shape its precision is typed in', () => {
    expect(formatOccurredOnInput({ occurredOn: '1998-01-01', occurredPrecision: 'year' })).toBe(
      '1998',
    );
    expect(formatOccurredOnInput({ occurredOn: '1998-07-01', occurredPrecision: 'month' })).toBe(
      '1998-07',
    );
    expect(formatOccurredOnInput({ occurredOn: '1998-07-12', occurredPrecision: 'day' })).toBe(
      '1998-07-12',
    );
  });

  it('round-trips through parseOccurredOn without drift', () => {
    const stored = { occurredOn: '1998-07-01', occurredPrecision: 'month' as const };
    const typed = formatOccurredOnInput(stored);
    expect(parseOccurredOn(typed, 'month')).toEqual({ occurredOn: stored.occurredOn });
  });

  it('gives an empty field when the date is unknown', () => {
    expect(formatOccurredOnInput({ occurredOn: null, occurredPrecision: 'day' })).toBe('');
  });
});

describe('the type guards mirror the check constraints', () => {
  it('accepts only the two visibility values', () => {
    expect(isMemoryVisibility('family')).toBe(true);
    expect(isMemoryVisibility('private')).toBe(true);
    expect(isMemoryVisibility('shared')).toBe(false);
    expect(isMemoryVisibility(null)).toBe(false);
  });

  it('accepts only the three precisions', () => {
    expect(isMemoryPrecision('day')).toBe(true);
    expect(isMemoryPrecision('decade')).toBe(false);
  });
});

describe('describeMemoryError', () => {
  it('does not soften a refusal into an empty shelf', () => {
    // A Guest's read is filtered, not failed — but a Guest's *write* is refused,
    // and telling them nothing is here would be a claim this project does not make.
    expect(describeMemoryError('new row violates row-level security policy')).toBe(
      'You do not have permission to do that.',
    );
  });

  it('translates each check constraint into the mistake rather than the column', () => {
    expect(describeMemoryError('violates check constraint "memories_title_check"')).toContain(
      String(MAX_MEMORY_TITLE_LENGTH),
    );
    expect(describeMemoryError('violates check constraint "memories_visibility_check"')).toBe(
      'That visibility setting is not recognised.',
    );
    expect(describeMemoryError('violates check constraint "memories_ai_processing_check"')).toBe(
      'That privacy setting is not recognised.',
    );
    expect(
      describeMemoryError('violates check constraint "memories_occurred_precision_check"'),
    ).toBe('That is not a date precision.');
  });

  it('names the cause when the subject left the family mid-form', () => {
    expect(
      describeMemoryError('violates foreign key constraint "memories_member_id_family_id_fkey"'),
    ).toBe('That person is no longer in this family.');
  });

  it('passes an unrecognised message through rather than inventing one', () => {
    expect(describeMemoryError('something new')).toBe('something new');
  });
});

describe('listMemories', () => {
  it('distinguishes an empty list from a refused read', async () => {
    const empty = await listMemories(fakeGateway(), 'family-1');
    expect(empty).toEqual({ ok: true, memories: [] });

    const refused = await listMemories(
      fakeGateway({
        async listMemories() {
          return { data: null, error: { message: 'permission denied for table memories' } };
        },
      }),
      'family-1',
    );
    expect(refused).toEqual({ ok: false, message: 'You do not have permission to do that.' });
  });
});

describe('createMemory', () => {
  it('refuses an untitled memory before any round trip', async () => {
    let called = false;
    const outcome = await createMemory(
      fakeGateway({
        async createMemory() {
          called = true;
          return { data: memory(), error: null };
        },
      }),
      { familyId: 'family-1', title: '   ' },
    );

    expect(outcome).toEqual({ ok: false, message: 'Give this memory a name.' });
    expect(called).toBe(false);
  });

  it('trims the title, story and place before storing them', async () => {
    let received: CreateMemoryInput | null = null;
    await createMemory(
      fakeGateway({
        async createMemory(input) {
          received = input;
          return { data: memory(), error: null };
        },
      }),
      {
        familyId: 'family-1',
        title: '  Diwali  ',
        story: '  It rained.  ',
        location: '  Nani’s house  ',
      },
    );

    expect(received).toMatchObject({
      title: 'Diwali',
      story: 'It rained.',
      location: 'Nani’s house',
    });
  });

  it('turns an empty story or place into null, so "nothing written" is one value', async () => {
    let received: CreateMemoryInput | null = null;
    await createMemory(
      fakeGateway({
        async createMemory(input) {
          received = input;
          return { data: memory(), error: null };
        },
      }),
      { familyId: 'family-1', title: 'Diwali', story: '   ', location: '' },
    );

    expect(received).toMatchObject({ story: null, location: null });
  });

  it('refuses a visibility the resolver would fail closed on', async () => {
    const outcome = await createMemory(fakeGateway(), {
      familyId: 'family-1',
      title: 'Diwali',
      // A value can_see_record does not know hides the row from its own author.
      visibility: 'shared' as never,
    });

    expect(outcome).toEqual({
      ok: false,
      message: 'That visibility setting is not recognised.',
    });
  });

  it('does not report success when the row comes back invisible', async () => {
    // The insert succeeded and the SELECT policy declined to return it. Saying
    // "kept" would leave the list empty and the person writing it again.
    const outcome = await createMemory(
      fakeGateway({
        async createMemory() {
          return { data: null, error: null };
        },
      }),
      { familyId: 'family-1', title: 'Diwali' },
    );

    expect(outcome).toEqual({
      ok: false,
      message: 'The memory was not saved. Please try again.',
    });
  });

  it('never sends a visibility the caller did not choose', async () => {
    // The column defaults to `family`; a default repeated here could disagree
    // with it, and the copy nobody was looking at would win.
    let received: CreateMemoryInput | null = null;
    await createMemory(
      fakeGateway({
        async createMemory(input) {
          received = input;
          return { data: memory(), error: null };
        },
      }),
      { familyId: 'family-1', title: 'Diwali' },
    );

    expect(received!.visibility).toBeUndefined();
  });
});

describe('getMemory', () => {
  it('reports a hidden row as unavailable rather than as a failure', async () => {
    const outcome = await getMemory(
      fakeGateway({
        async getMemory() {
          return { data: null, error: null };
        },
      }),
      'memory-1',
    );

    expect(outcome).toEqual({ ok: false, message: 'That memory is no longer available.' });
  });
});

describe('the setters validate with the same rules that guard creation', () => {
  it('will not rename a memory to something it could not have been called', async () => {
    expect(await renameMemory(fakeGateway(), 'memory-1', '  ')).toEqual({
      ok: false,
      message: 'Give this memory a name.',
    });
  });

  it('stores an emptied story as null', async () => {
    let received: string | null | undefined;
    await setMemoryStory(
      fakeGateway({
        async setStory(_id, story) {
          received = story;
          return { error: null };
        },
      }),
      'memory-1',
      '   ',
    );

    expect(received).toBeNull();
  });

  it('writes the date and its precision in one call, because they are one fact', async () => {
    let received: { date: string | null; precision: string } | null = null;
    await setMemoryDate(
      fakeGateway({
        async setOccurredOn(_id, occurredOn, precision) {
          received = { date: occurredOn, precision };
          return { error: null };
        },
      }),
      'memory-1',
      '1998',
      'year',
    );

    expect(received).toEqual({ date: '1998-01-01', precision: 'year' });
  });

  it('refuses a date that does not match its precision before the round trip', async () => {
    let called = false;
    const outcome = await setMemoryDate(
      fakeGateway({
        async setOccurredOn() {
          called = true;
          return { error: null };
        },
      }),
      'memory-1',
      'summer',
      'year',
    );

    expect(outcome).toEqual({ ok: false, message: 'Use YYYY.' });
    expect(called).toBe(false);
  });

  it('clears the date when the field is emptied', async () => {
    let received: string | null | undefined = 'unset';
    await setMemoryDate(
      fakeGateway({
        async setOccurredOn(_id, occurredOn) {
          received = occurredOn;
          return { error: null };
        },
      }),
      'memory-1',
      '',
      'day',
    );

    expect(received).toBeNull();
  });

  it('refuses an unrecognised visibility or consent value', async () => {
    expect(await setMemoryVisibility(fakeGateway(), 'memory-1', 'everyone' as never)).toEqual({
      ok: false,
      message: 'That visibility setting is not recognised.',
    });
    expect(await setMemoryAiProcessing(fakeGateway(), 'memory-1', 'maybe' as never)).toEqual({
      ok: false,
      message: 'That privacy setting is not recognised.',
    });
  });

  it('stores an emptied place as null', async () => {
    let received: string | null | undefined;
    await setMemoryLocation(
      fakeGateway({
        async setLocation(_id, location) {
          received = location;
          return { error: null };
        },
      }),
      'memory-1',
      '  ',
    );

    expect(received).toBeNull();
  });
});

describe('archive and delete are different acts', () => {
  it('archives by setting a timestamp and restores by clearing it', async () => {
    const received: (string | null)[] = [];
    const gateway = fakeGateway({
      async archiveMemory(_id, archived) {
        received.push(archived ? 'set' : null);
        return { error: null };
      },
    });

    await setMemoryArchived(gateway, 'memory-1', true);
    await setMemoryArchived(gateway, 'memory-1', false);

    expect(received).toEqual(['set', null]);
  });

  it('reaches delete only through its own function, never through a flag', async () => {
    let archived = false;
    let deleted = false;

    await deleteMemory(
      fakeGateway({
        async archiveMemory() {
          archived = true;
          return { error: null };
        },
        async deleteMemory() {
          deleted = true;
          return { error: null };
        },
      }),
      'memory-1',
    );

    expect(deleted).toBe(true);
    expect(archived).toBe(false);
  });
});

describe('partitionMemories', () => {
  it('splits archived from active in one pass, preserving order', () => {
    const a = memory({ id: 'a' });
    const b = memory({ id: 'b', archivedAt: '2026-08-17T00:00:00.000Z' });
    const c = memory({ id: 'c' });

    const { active, archived } = partitionMemories([a, b, c]);
    expect(active.map((m) => m.id)).toEqual(['a', 'c']);
    expect(archived.map((m) => m.id)).toEqual(['b']);
  });
});

describe('groupByYear', () => {
  it('groups by the year it happened, newest first', () => {
    const groups = groupByYear([
      memory({ id: 'a', occurredOn: '2019-11-05' }),
      memory({ id: 'b', occurredOn: '2021-01-02' }),
      memory({ id: 'c', occurredOn: '2019-03-01' }),
    ]);

    expect(groups.map((group) => group.year)).toEqual(['2021', '2019']);
    expect(groups[1].memories.map((m) => m.id)).toEqual(['a', 'c']);
  });

  it('puts undated memories last, under their own heading', () => {
    const groups = groupByYear([
      memory({ id: 'undated', occurredOn: null }),
      memory({ id: 'dated', occurredOn: '2005-06-01' }),
    ]);

    expect(groups.map((group) => group.year)).toEqual(['2005', UNKNOWN_DATE_TEXT]);
  });

  it('sorts undated last even when it is the only group with company', () => {
    // "Date unknown" sorted as a word would land between 1999 and 2005.
    const groups = groupByYear([
      memory({ id: 'x', occurredOn: null }),
      memory({ id: 'y', occurredOn: '1999-01-01' }),
      memory({ id: 'z', occurredOn: '2005-01-01' }),
    ]);

    expect(groups.map((group) => group.year)).toEqual(['2005', '1999', UNKNOWN_DATE_TEXT]);
  });

  it('returns nothing for an empty list rather than an empty group', () => {
    expect(groupByYear([])).toEqual([]);
  });
});

describe('the lines under a memory’s title', () => {
  it('joins the moment and the place, and omits the place when there is none', () => {
    expect(describeMemoryMoment(memory({ occurredOn: '2019-11-05', location: 'Nani’s house' }))).toBe(
      '5 November 2019 · Nani’s house',
    );
    expect(describeMemoryMoment(memory({ occurredOn: '2019-11-05', location: null }))).toBe(
      '5 November 2019',
    );
  });

  it('says nothing about files, in either branch', () => {
    // docs/10 §13: context beats an inventory. When PR-18 adds photographs the
    // answer still must not become "3 files, 6.1 MB".
    // Word-bounded on purpose — an unanchored /MB/ matches "November".
    const inventory = /\bfiles?\b|\bphotos?\b|\battachments?\b|\d+\s*[KM]B\b/i;

    expect(describeMemoryMoment(memory({ location: 'Goa' }))).not.toMatch(inventory);
    expect(describeMemoryMoment(memory({ location: null }))).not.toMatch(inventory);
  });

  it('falls back to the whole family when nobody is named', () => {
    expect(describeMemorySubject(memory({ memberId: null }), new Map())).toBe('The whole family');
  });

  it('names the subject when the person is known, and degrades without inventing', () => {
    const people = new Map([['person-1', 'Nani']]);
    expect(describeMemorySubject(memory({ memberId: 'person-1' }), people)).toBe('Nani');
    expect(describeMemorySubject(memory({ memberId: 'person-9' }), people)).toBe(
      'Someone in this family',
    );
  });

  it('says "You" to the person who kept it', () => {
    const people = [{ userId: 'user-1', displayName: 'Ankit' }];
    expect(describeMemoryAuthor(memory({ createdBy: 'user-1' }), people, 'user-1')).toBe('You');
    expect(describeMemoryAuthor(memory({ createdBy: 'user-1' }), people, 'user-2')).toBe('Ankit');
  });

  it('degrades to "Someone" when the account is gone, rather than showing an id', () => {
    expect(describeMemoryAuthor(memory({ createdBy: null }), [], 'user-2')).toBe('Someone');
    expect(describeMemoryAuthor(memory({ createdBy: 'ghost' }), [], 'user-2')).toBe('Someone');
  });
});
