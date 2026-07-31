import type { Session } from '@supabase/supabase-js';

import {
  describeAuthError,
  getSession,
  MIN_PASSWORD_LENGTH,
  signIn,
  signOut,
  signUp,
  validateCredentials,
  type AuthGateway,
} from './auth';

const session = { access_token: 'token', user: { email: 'a@b.com' } } as Session;

/** Records what reached Supabase, so normalisation can be asserted. */
function fakeGateway(overrides: Partial<AuthGateway> = {}) {
  const calls: { method: string; email?: string; password?: string }[] = [];
  const gateway: AuthGateway = {
    signUp: async (c) => {
      calls.push({ method: 'signUp', ...c });
      return { data: { session }, error: null };
    },
    signInWithPassword: async (c) => {
      calls.push({ method: 'signInWithPassword', ...c });
      return { data: { session }, error: null };
    },
    signOut: async () => {
      calls.push({ method: 'signOut' });
      return { error: null };
    },
    getSession: async () => {
      calls.push({ method: 'getSession' });
      return { data: { session }, error: null };
    },
    ...overrides,
  };
  return { gateway, calls };
}

const valid = { email: 'nanima@example.com', password: 'correct-horse' };

describe('validateCredentials', () => {
  it('accepts a well-formed email and long-enough password', () => {
    expect(validateCredentials(valid)).toBeNull();
  });

  it.each([
    ['', 'Enter your email address.'],
    ['   ', 'Enter your email address.'],
    ['nanima', 'That email address looks incomplete.'],
    ['nanima@example', 'That email address looks incomplete.'],
  ])('rejects the email %p', (email, message) => {
    expect(validateCredentials({ ...valid, email })).toEqual({
      ok: false,
      message,
      field: 'email',
    });
  });

  it('rejects an empty password before complaining about its length', () => {
    expect(validateCredentials({ ...valid, password: '' })).toEqual({
      ok: false,
      message: 'Enter your password.',
      field: 'password',
    });
  });

  it(`rejects a password shorter than ${MIN_PASSWORD_LENGTH} characters`, () => {
    const result = validateCredentials({ ...valid, password: 'a'.repeat(MIN_PASSWORD_LENGTH - 1) });
    expect(result).toEqual({
      ok: false,
      message: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
      field: 'password',
    });
  });

  it('accepts a password of exactly the minimum length', () => {
    expect(
      validateCredentials({ ...valid, password: 'a'.repeat(MIN_PASSWORD_LENGTH) }),
    ).toBeNull();
  });

  it('accepts plus-tagged addresses rather than over-validating', () => {
    expect(validateCredentials({ ...valid, email: 'nani+vault@example.co.in' })).toBeNull();
  });
});

describe('describeAuthError', () => {
  it.each([
    ['Invalid login credentials', "That email and password don't match an account."],
    ['User already registered', 'An account with that email already exists. Try signing in instead.'],
    ['Email not confirmed', 'Confirm your email address before signing in — check your inbox.'],
    ['Network request failed', 'Cannot reach the server. Check your connection and try again.'],
  ])('rewrites %p for a non-technical reader', (raw, expected) => {
    expect(describeAuthError(raw)).toBe(expected);
  });

  it('passes an unrecognised message through rather than swallowing it', () => {
    expect(describeAuthError('Signups not allowed for this instance')).toBe(
      'Signups not allowed for this instance',
    );
  });
});

describe('signIn', () => {
  it('never calls Supabase when the input is invalid', async () => {
    const { gateway, calls } = fakeGateway();
    const result = await signIn(gateway, { email: 'nope', password: 'short' });

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('lowercases and trims the email before sending it', async () => {
    const { gateway, calls } = fakeGateway();
    await signIn(gateway, { email: '  NaniMa@Example.COM ', password: 'correct-horse' });

    expect(calls[0]).toEqual({
      method: 'signInWithPassword',
      email: 'nanima@example.com',
      password: 'correct-horse',
    });
  });

  it('leaves the password untouched — whitespace can be deliberate', async () => {
    const { gateway, calls } = fakeGateway();
    await signIn(gateway, { email: valid.email, password: '  spaced out  ' });

    expect(calls[0].password).toBe('  spaced out  ');
  });

  it('returns the session on success', async () => {
    const { gateway } = fakeGateway();
    expect(await signIn(gateway, valid)).toEqual({ ok: true, session });
  });

  it('translates a rejected sign-in into readable wording', async () => {
    const { gateway } = fakeGateway({
      signInWithPassword: async () => ({
        data: { session: null },
        error: { message: 'Invalid login credentials' },
      }),
    });

    expect(await signIn(gateway, valid)).toEqual({
      ok: false,
      message: "That email and password don't match an account.",
    });
  });
});

describe('signUp', () => {
  it('returns the session when confirmation is off', async () => {
    const { gateway } = fakeGateway();
    expect(await signUp(gateway, valid)).toEqual({ ok: true, session });
  });

  it('succeeds with an explanation when Supabase withholds the session', async () => {
    // What happens if email confirmation is switched back on in the dashboard:
    // no error, no session. Without this branch the screen would look frozen.
    const { gateway } = fakeGateway({
      signUp: async () => ({ data: { session: null }, error: null }),
    });

    expect(await signUp(gateway, valid)).toEqual({
      ok: true,
      session: null,
      message: 'Account created. Check your inbox to confirm your email.',
    });
  });

  it('reports an address that is already registered', async () => {
    const { gateway } = fakeGateway({
      signUp: async () => ({
        data: { session: null },
        error: { message: 'User already registered' },
      }),
    });

    const result = await signUp(gateway, valid);
    expect(result).toEqual({
      ok: false,
      message: 'An account with that email already exists. Try signing in instead.',
    });
  });

  it('enforces the password rule before Supabase is reached', async () => {
    const { gateway, calls } = fakeGateway();
    await signUp(gateway, { ...valid, password: 'short' });
    expect(calls).toHaveLength(0);
  });
});

describe('signOut', () => {
  it('clears the session', async () => {
    const { gateway, calls } = fakeGateway();
    expect(await signOut(gateway)).toEqual({ ok: true, session: null });
    expect(calls).toEqual([{ method: 'signOut' }]);
  });

  it('surfaces a failure rather than pretending it worked', async () => {
    const { gateway } = fakeGateway({
      signOut: async () => ({ error: { message: 'Network request failed' } }),
    });

    expect(await signOut(gateway)).toEqual({
      ok: false,
      message: 'Cannot reach the server. Check your connection and try again.',
    });
  });
});

describe('getSession', () => {
  it('returns the stored session', async () => {
    const { gateway } = fakeGateway();
    expect(await getSession(gateway)).toBe(session);
  });

  it('treats a read failure as signed out', async () => {
    const { gateway } = fakeGateway({
      getSession: async () => ({
        data: { session: null },
        error: { message: 'keychain unavailable' },
      }),
    });

    expect(await getSession(gateway)).toBeNull();
  });
});
