/**
 * Roles: what they are called, how they rank, and how one gets changed.
 *
 * Same shape as the other services — rules here, UI-free, gateway injected.
 *
 * **Everything in this file is presentation and convenience. None of it is a
 * security boundary.** The predicates below decide whether to draw a button;
 * the database decides whether the button works. Every one of them has a
 * counterpart in `supabase/migrations/20260805090000_roles_and_permission_matrix.sql`
 * that runs inside Postgres where a client cannot reach it, and the RLS suite
 * asserts the two agree. If they ever drift, the database is right.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { FAMILY_ROLES, type FamilyRole } from './family';

export { FAMILY_ROLES };
export type { FamilyRole };

export const ROLE_LABELS: Record<FamilyRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  guest: 'Guest',
};

/**
 * Shown next to each choice on the change-role screen. Written for whoever is
 * holding the phone, not for whoever wrote the matrix — "can_manage_members"
 * is not a sentence anybody wants to read about their mother-in-law.
 */
export const ROLE_DESCRIPTIONS: Record<FamilyRole, string> = {
  owner: 'Everything, including renaming or deleting the family and changing roles.',
  admin: 'Invite and remove people, and manage everything the family has saved.',
  member: 'Add and edit people, records and memories.',
  guest: 'Can see who is in the family, and nothing else.',
};

/** Mirrors `public.role_rank`, including the −1 that makes an unknown role
 *  rank below every real one. */
export function roleRank(role: FamilyRole | string | null): number {
  switch (role) {
    case 'owner':
      return 3;
    case 'admin':
      return 2;
    case 'member':
      return 1;
    case 'guest':
      return 0;
    default:
      return -1;
  }
}

/** Roles ordered strongest first, which is the order they are offered in. */
export const ROLES_BY_RANK: FamilyRole[] = [...FAMILY_ROLES].sort(
  (left, right) => roleRank(right) - roleRank(left),
);

/**
 * Nobody hands out more access than they hold.
 *
 * `<=`, not `<`. Strictly-below would stop an Owner inviting an Owner, which
 * is the only way a family acquires a second one and is behaviour PR-6 already
 * shipped. An Admin inviting an Admin is lateral, not an escalation — the
 * escalation this closes is an Admin minting an *Owner* code and redeeming it
 * on a second account. `create_invitation` enforces the same rule server-side.
 */
export function invitableRoles(callerRole: FamilyRole | null): FamilyRole[] {
  if (!canManageMembers(callerRole)) return [];
  return ROLES_BY_RANK.filter((role) => roleRank(role) <= roleRank(callerRole));
}

/**
 * Allow-lists, never deny-lists — `role === 'guest'` inverted would mean every
 * role added in a later phase silently inherits permissions written before it
 * existed. Same rule as the SQL helpers, for the same reason.
 */
export function canManageFamily(role: FamilyRole | null): boolean {
  return role === 'owner';
}

export function canManageMembers(role: FamilyRole | null): boolean {
  return role === 'owner' || role === 'admin';
}

export function canEditPeople(role: FamilyRole | null): boolean {
  return role === 'owner' || role === 'admin' || role === 'member';
}

export function canChangeRoles(role: FamilyRole | null): boolean {
  return canManageFamily(role);
}

export interface SetRoleInput {
  familyId: string;
  userId: string;
  role: FamilyRole;
}

export interface RoleGateway {
  setRole(input: SetRoleInput): Promise<{ error: { message: string } | null }>;
}

export type RoleOutcome = { ok: true } | { ok: false; message: string };

export function describeRoleError(message: string): string {
  const normalised = message.toLowerCase();

  if (normalised.includes('must always have an owner')) {
    // The one message here that has to teach rather than apologise: the way
    // out is to make somebody else an owner first, and nothing else on screen
    // says so.
    return 'A family must always have an owner. Make someone else an owner first.';
  }
  if (normalised.includes('not allowed to change roles')) {
    return 'Only an owner can change roles.';
  }
  if (normalised.includes('does not have access')) {
    return 'That person does not have an account in this family yet.';
  }
  if (normalised.includes('unknown role')) {
    return 'That is not a role.';
  }
  if (normalised.includes('not authenticated')) {
    return 'Your session has expired. Sign in again.';
  }
  if (normalised.includes('row-level security') || normalised.includes('permission denied')) {
    return 'You do not have permission to do that.';
  }
  if (normalised.includes('network') || normalised.includes('fetch')) {
    return 'Cannot reach the server. Check your connection and try again.';
  }
  return message;
}

export async function setRole(
  gateway: RoleGateway,
  input: SetRoleInput,
): Promise<RoleOutcome> {
  if (roleRank(input.role) < 0) {
    return { ok: false, message: 'That is not a role.' };
  }

  const { error } = await gateway.setRole(input);
  if (error) return { ok: false, message: describeRoleError(error.message) };
  return { ok: true };
}

/** The only place that knows how a role is written. */
export function createSupabaseRoleGateway(client: SupabaseClient): RoleGateway {
  return {
    // An RPC, not an update. `family_users` is write-closed — UPDATE and DELETE
    // are revoked from `authenticated` — because a policy can gate *who* writes
    // but cannot pin *which row* or *what value*, and cannot hold the row lock
    // the last-owner guarantee needs.
    async setRole({ familyId, userId, role }) {
      const { error } = await client.rpc('set_family_role', {
        target_family: familyId,
        target_user: userId,
        new_role: role,
      });
      return { error };
    },
  };
}

/** Narrows the `role` column, which arrives from PostgREST as a plain string. */
export function isFamilyRole(value: unknown): value is FamilyRole {
  return typeof value === 'string' && (FAMILY_ROLES as readonly string[]).includes(value);
}
