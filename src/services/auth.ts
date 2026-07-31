/**
 * Authentication business logic.
 *
 * Deliberately UI-free and framework-free: every function takes its gateway as
 * a parameter, so the rules here (what counts as a valid email, how long a
 * password must be, what a Supabase error means in plain English) are unit
 * tested without a network, a device, or a running Supabase project.
 *
 * The screens under `app/(auth)` call these; they never touch the Supabase
 * client directly. That keeps the sign-in *policy* in one place when it grows
 * — MFA (FR-004) and password reset (PR-3b) land here, not in a component.
 */

import type { Session } from '@supabase/supabase-js';

export interface Credentials {
  email: string;
  password: string;
}

/** The slice of `supabase.auth` this module depends on. */
export interface AuthGateway {
  signUp(credentials: Credentials): Promise<{
    data: { session: Session | null };
    error: { message: string } | null;
  }>;
  signInWithPassword(credentials: Credentials): Promise<{
    data: { session: Session | null };
    error: { message: string } | null;
  }>;
  signOut(): Promise<{ error: { message: string } | null }>;
  getSession(): Promise<{
    data: { session: Session | null };
    error: { message: string } | null;
  }>;
}

export type AuthOutcome =
  | { ok: true; session: Session | null; message?: string }
  | { ok: false; message: string; field?: 'email' | 'password' };

/**
 * Our own minimum, stricter than Supabase's default of 6. Chosen here rather
 * than only in the dashboard so the rule is visible, reviewable, and tested —
 * a policy that exists only in a hosted console is a policy nobody can audit.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Intentionally permissive. Real address validity is only ever proven by
 * delivering mail to it; anything stricter here just rejects legitimate
 * addresses (plus-tags, new TLDs, unicode domains) for no gain.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCredentials(raw: Credentials): AuthOutcome | null {
  const email = raw.email.trim();

  if (email.length === 0) {
    return { ok: false, message: 'Enter your email address.', field: 'email' };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { ok: false, message: 'That email address looks incomplete.', field: 'email' };
  }
  if (raw.password.length === 0) {
    return { ok: false, message: 'Enter your password.', field: 'password' };
  }
  if (raw.password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
      field: 'password',
    };
  }
  return null;
}

/**
 * Supabase's messages are written for developers. These are written for a
 * grandparent setting up the family vault — the audience in
 * docs/04-user-personas.md.
 */
export function describeAuthError(message: string): string {
  const normalised = message.toLowerCase();

  if (normalised.includes('invalid login credentials')) {
    return "That email and password don't match an account.";
  }
  if (normalised.includes('already registered')) {
    return 'An account with that email already exists. Try signing in instead.';
  }
  if (normalised.includes('email not confirmed')) {
    return 'Confirm your email address before signing in — check your inbox.';
  }
  if (normalised.includes('password should be')) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (normalised.includes('network') || normalised.includes('fetch')) {
    return 'Cannot reach the server. Check your connection and try again.';
  }
  return message;
}

/** Normalises what we send upstream: emails are case- and space-insensitive. */
function normalise(raw: Credentials): Credentials {
  return { email: raw.email.trim().toLowerCase(), password: raw.password };
}

export async function signUp(
  gateway: AuthGateway,
  raw: Credentials,
): Promise<AuthOutcome> {
  const invalid = validateCredentials(raw);
  if (invalid) return invalid;

  const { data, error } = await gateway.signUp(normalise(raw));
  if (error) return { ok: false, message: describeAuthError(error.message) };

  // With email confirmation enabled, Supabase returns success and no session.
  // Confirmation is currently off (see .claude/current-session.md), but the app
  // must not silently appear to do nothing if it is ever switched back on.
  if (!data.session) {
    return {
      ok: true,
      session: null,
      message: 'Account created. Check your inbox to confirm your email.',
    };
  }
  return { ok: true, session: data.session };
}

export async function signIn(
  gateway: AuthGateway,
  raw: Credentials,
): Promise<AuthOutcome> {
  const invalid = validateCredentials(raw);
  if (invalid) return invalid;

  const { data, error } = await gateway.signInWithPassword(normalise(raw));
  if (error) return { ok: false, message: describeAuthError(error.message) };

  return { ok: true, session: data.session };
}

export async function signOut(gateway: AuthGateway): Promise<AuthOutcome> {
  const { error } = await gateway.signOut();
  if (error) return { ok: false, message: describeAuthError(error.message) };
  return { ok: true, session: null };
}

export async function getSession(gateway: AuthGateway): Promise<Session | null> {
  const { data, error } = await gateway.getSession();
  // A failed read is indistinguishable from "not signed in" as far as the UI
  // is concerned — either way the person needs to sign in.
  if (error) return null;
  return data.session;
}
