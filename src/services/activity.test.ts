import {
  ACTIVITY_ACTIONS,
  createSupabaseActivityGateway,
  describeActivity,
  listActivity,
  type ActivityContext,
  type ActivityEvent,
  type ActivityGateway,
} from './activity';
import type { Member } from './member';

function person(overrides: Partial<Member> & Pick<Member, 'id' | 'displayName'>): Member {
  return {
    familyId: 'fam-1',
    userId: null,
    dateOfBirth: null,
    bloodGroup: null,
    email: null,
    role: null,
    joinedAt: null,
    ...overrides,
  };
}

const ANKIT = person({ id: 'p-ankit', displayName: 'Ankit', userId: 'u-ankit', role: 'owner' });
const PRIYA = person({ id: 'p-priya', displayName: 'Priya', userId: 'u-priya', role: 'admin' });
const NANI = person({ id: 'p-nani', displayName: 'Nani' });

const context: ActivityContext = {
  people: [ANKIT, PRIYA, NANI],
  viewerUserId: 'u-ankit',
};

function event(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: 'a-1',
    action: 'person_added',
    actorUserId: 'u-priya',
    subjectMemberId: 'p-nani',
    detail: null,
    createdAt: '2026-08-07T10:00:00.000Z',
    ...overrides,
  };
}

describe('describeActivity', () => {
  it('renders a sentence for every action the database can store', () => {
    // Table-driven against the same list the check constraint uses, so a ninth
    // action added to the migration without a case here fails rather than
    // silently vanishing from the feed.
    for (const action of ACTIVITY_ACTIONS) {
      const sentence = describeActivity(event({ action }), context);
      expect(sentence).toBeTruthy();
      expect(sentence).not.toMatch(/undefined|null|\[object/);
    }
  });

  it.each([
    ['family_created', 'Priya created the family'],
    ['person_added', 'Priya added Nani'],
    ['person_updated', "Priya updated Nani's details"],
    ['relationship_added', 'Priya added a relationship for Nani'],
    ['relationship_removed', 'Priya removed a relationship for Nani'],
  ])('renders %p', (action, expected) => {
    expect(describeActivity(event({ action }), context)).toBe(expected);
  });

  it('says "You" when the actor is the reader', () => {
    expect(describeActivity(event({ actorUserId: 'u-ankit' }), context)).toBe('You added Nani');
  });

  describe('when the reader is the person it happened to', () => {
    // Read as Priya. "Ankit made Priya an admin" is news about somebody else;
    // this is the half of the feed a person most wants to notice, so the
    // subject gets the same courtesy the actor already had.
    const asPriya: ActivityContext = { people: context.people, viewerUserId: 'u-priya' };

    it.each([
      ['person_added', 'Ankit added you'],
      ['person_updated', 'Ankit updated your details'],
      ['relationship_added', 'Ankit added a relationship for you'],
      ['relationship_removed', 'Ankit removed a relationship for you'],
      ['access_revoked', 'Ankit removed your access'],
    ])('renders %p in the second person', (action, expected) => {
      expect(
        describeActivity(
          event({ action, actorUserId: 'u-ankit', subjectMemberId: 'p-priya' }),
          asPriya,
        ),
      ).toBe(expected);
    });

    it('renders a role change in the second person', () => {
      expect(
        describeActivity(
          event({
            action: 'role_changed',
            actorUserId: 'u-ankit',
            subjectMemberId: 'p-priya',
            detail: { role: 'admin' },
          }),
          asPriya,
        ),
      ).toBe('Ankit made you an admin');
    });

    it('never writes "you\'s"', () => {
      // The possessive is the reason `subjectPossessive` exists at all:
      // `${subject}'s details` would render "you's details".
      for (const action of ACTIVITY_ACTIONS) {
        const sentence =
          describeActivity(
            event({ action, actorUserId: 'u-ankit', subjectMemberId: 'p-priya' }),
            asPriya,
          ) ?? '';
        expect(sentence).not.toMatch(/you's|your's/i);
      }
    });

    it('handles the reader being both the actor and the subject', () => {
      expect(
        describeActivity(
          event({ action: 'person_updated', actorUserId: 'u-priya', subjectMemberId: 'p-priya' }),
          asPriya,
        ),
      ).toBe('You updated your details');
    });

    it('still uses a name for a person who is not the reader', () => {
      expect(
        describeActivity(
          event({ action: 'person_updated', actorUserId: 'u-ankit', subjectMemberId: 'p-nani' }),
          asPriya,
        ),
      ).toBe("Ankit updated Nani's details");
    });

    it('does not mistake a person with no account for the reader', () => {
      // Nani has no `userId`. A null-to-null comparison must not make every
      // placeholder relative read as "you" for a signed-out viewer.
      const signedOut: ActivityContext = { people: context.people, viewerUserId: null };
      expect(
        describeActivity(
          event({ action: 'person_updated', actorUserId: 'u-ankit', subjectMemberId: 'p-nani' }),
          signedOut,
        ),
      ).toBe("Ankit updated Nani's details");
    });
  });

  it('names the role on the actions that carry one', () => {
    expect(
      describeActivity(event({ action: 'role_changed', detail: { role: 'admin' } }), context),
    ).toBe('Priya made Nani an admin');

    expect(
      describeActivity(
        event({ action: 'access_granted', subjectMemberId: 'p-priya', detail: { role: 'owner' } }),
        context,
      ),
    ).toBe('Priya joined as an owner');
  });

  it('falls back to "a member" for a role it does not recognise', () => {
    // A role from a later migration must not render as "a sovereign" on a build
    // that has never heard of it, and must not render as nothing either.
    expect(
      describeActivity(event({ action: 'role_changed', detail: { role: 'sovereign' } }), context),
    ).toBe('Priya made Nani a member');
  });

  it('tells leaving apart from being removed', () => {
    // The one place in the app that can. The people list deliberately refuses to
    // guess, because a person row records no reason — but the feed stored both
    // the actor and the subject, so it knows.
    const left = describeActivity(
      event({ action: 'access_revoked', actorUserId: 'u-priya', subjectMemberId: 'p-priya' }),
      context,
    );
    const removed = describeActivity(
      event({ action: 'access_revoked', actorUserId: 'u-ankit', subjectMemberId: 'p-priya' }),
      context,
    );

    expect(left).toBe('Priya left the family');
    expect(removed).toBe("You removed Priya's access");
  });

  it('degrades a missing subject rather than dropping the row', () => {
    // The event still happened. Refusing to render it would lose more than the
    // name it cannot resolve.
    expect(describeActivity(event({ subjectMemberId: 'p-gone' }), context)).toBe(
      'Priya added someone',
    );
    expect(describeActivity(event({ subjectMemberId: null }), context)).toBe(
      'Priya added someone',
    );
  });

  it('degrades a missing actor to "Someone"', () => {
    // `actor_user_id` is `on delete set null`, so a deleted account leaves rows
    // behind with no actor. That is not the same as nobody having done it.
    expect(describeActivity(event({ actorUserId: null }), context)).toBe('Someone added Nani');
    expect(describeActivity(event({ actorUserId: 'u-deleted' }), context)).toBe(
      'Someone added Nani',
    );
  });

  it('returns null for an action it has never heard of', () => {
    // A later phase adding an action must not make an older install render
    // "undefined". The screen skips whatever this returns null for.
    expect(describeActivity(event({ action: 'document_uploaded' }), context)).toBeNull();
    expect(describeActivity(event({ action: '' }), context)).toBeNull();
  });

  it('never renders a raw identifier, whatever it is handed', () => {
    // The §9.5 property, asserted directly. A feed row's whole safety argument
    // is that it holds references rather than prose — so nothing it renders may
    // contain an id, and the only text it can produce comes from the member
    // list or from this file.
    const empty: ActivityContext = { people: [], viewerUserId: null };

    for (const action of ACTIVITY_ACTIONS) {
      for (const ctx of [context, empty]) {
        const sentence = describeActivity(event({ action }), ctx) ?? '';
        expect(sentence).not.toContain('p-nani');
        expect(sentence).not.toContain('u-priya');
        expect(sentence).not.toContain('a-1');
      }
    }
  });
});

describe('listActivity', () => {
  function fakeGateway(overrides: Partial<ActivityGateway> = {}) {
    const calls: { familyId: string; limit: number }[] = [];
    const gateway: ActivityGateway = {
      async listActivity(familyId, limit) {
        calls.push({ familyId, limit });
        return { data: [event()], error: null };
      },
      ...overrides,
    };
    return { gateway, calls };
  }

  it('asks for the family and a page size', async () => {
    const { gateway, calls } = fakeGateway();
    await listActivity(gateway, 'fam-1', 5);

    expect(calls).toEqual([{ familyId: 'fam-1', limit: 5 }]);
  });

  it('goes quiet on failure rather than taking the screen with it', async () => {
    // The feed is the least important thing on the Dashboard. A greeting and a
    // family name are still worth showing when the log cannot be read.
    const { gateway } = fakeGateway({
      listActivity: async () => ({ data: null, error: { message: 'Network request failed' } }),
    });

    expect(await listActivity(gateway, 'fam-1')).toEqual([]);
  });
});

describe('createSupabaseActivityGateway', () => {
  it('reads the newest rows first and never writes', () => {
    // The table has no INSERT, UPDATE or DELETE policy and only a `select`
    // grant — the triggers are the only writers. This pins the client side of
    // that: a log an app can edit is not a log.
    const chain: string[] = [];
    const builder = {
      select: () => (chain.push('select'), builder),
      eq: () => (chain.push('eq'), builder),
      order: (_column: string, options: { ascending: boolean }) => (
        chain.push(`order:${options.ascending}`), builder
      ),
      limit: () => (chain.push('limit'), builder),
      returns: async () => ({ data: [], error: null }),
    };
    const client = {
      from: (table: string) => {
        chain.push(`from:${table}`);
        return builder;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    return createSupabaseActivityGateway(client)
      .listActivity('fam-1', 10)
      .then(() => {
        expect(chain).toEqual([
          'from:family_activity',
          'select',
          'eq',
          'order:false',
          'limit',
        ]);
      });
  });
});
