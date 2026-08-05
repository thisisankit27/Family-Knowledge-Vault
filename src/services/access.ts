/**
 * Who has access to a family at all — granting is invitations, this is the
 * other end: taking it away, giving it up, and handing it over.
 *
 * Separate from `role.ts` on purpose. That file answers *what roles are and how
 * one is changed*; this one answers *who is inside the tenant boundary*.
 * Changing somebody's role and revoking it are different operations with
 * different rules — a Guest may leave but may not remove anyone.
 *
 * **The predicate here is presentation, not a security boundary.** It decides
 * whether to draw a button; `remove_family_access` decides whether the button
 * works, inside Postgres where a client cannot reach it, and
 * `membership.rls.test.ts` asserts the two agree.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { FamilyRole } from './family';
import { roleRank } from './role';

export interface AccessGateway {
  removeAccess(input: {
    familyId: string;
    userId: string;
  }): Promise<{ error: { message: string } | null }>;
  leaveFamily(input: { familyId: string }): Promise<{ error: { message: string } | null }>;
  setRole(input: {
    familyId: string;
    userId: string;
    role: FamilyRole;
  }): Promise<{ error: { message: string } | null }>;
}

export type AccessOutcome = { ok: true } | { ok: false; message: string };

/**
 * Two clauses, not a rank comparison — and the reason is worth keeping.
 *
 * `rank(actor) > rank(target)` blocks an Owner removing a co-owner, which is
 * the exact case removal exists for. `rank(actor) >= rank(target)` lets an
 * Admin remove another Admin, which the matrix forbids. Neither single
 * comparison is the rule.
 *
 * An Owner may remove anyone; an Admin may remove strictly below themselves.
 * What stops an Owner emptying the family is the last-owner guarantee, checked
 * in the database under a row lock, not anything here.
 */
export function canRemoveAccess(
  actorRole: FamilyRole | null,
  targetRole: FamilyRole | null,
  isSelf: boolean,
): boolean {
  // Removing yourself is leaving, which has its own rules and its own copy.
  if (isSelf) return false;
  // Somebody with no account has no access to remove.
  if (!targetRole) return false;

  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') return roleRank(targetRole) < roleRank('admin');
  return false;
}

export function describeAccessError(message: string): string {
  const normalised = message.toLowerCase();

  if (normalised.includes('only owner')) {
    // The one message that has to offer a way out rather than apologise: the
    // screen turns both halves of this into buttons.
    return 'You are the only owner. Make someone else an owner first, or delete the family.';
  }
  if (normalised.includes('must always have an owner')) {
    return 'A family must always have an owner. Make someone else an owner first.';
  }
  if (normalised.includes('leave family to remove yourself')) {
    return 'To remove yourself, use Leave family.';
  }
  if (normalised.includes('does not have access')) {
    return 'That person does not have an account in this family.';
  }
  if (normalised.includes('not allowed to remove')) {
    return 'You do not have permission to remove this person.';
  }
  if (normalised.includes('not in this family')) {
    return 'You are not in this family.';
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

export async function removeAccess(
  gateway: AccessGateway,
  input: { familyId: string; userId: string },
): Promise<AccessOutcome> {
  const { error } = await gateway.removeAccess(input);
  if (error) return { ok: false, message: describeAccessError(error.message) };
  return { ok: true };
}

export async function leaveFamily(
  gateway: AccessGateway,
  input: { familyId: string },
): Promise<AccessOutcome> {
  const { error } = await gateway.leaveFamily(input);
  if (error) return { ok: false, message: describeAccessError(error.message) };
  return { ok: true };
}

/**
 * Hand the family over: make them an owner, then step down.
 *
 * **This is the only place the order is written down, and the order is the
 * whole point.** Demoting yourself first fails — the last-owner guarantee
 * refuses it — so anyone doing this by hand has to already know the trick.
 *
 * Deliberately not a database function. Owners are plural, so the state between
 * the two calls is two owners, which the product already supports; a transfer
 * that stops halfway leaves nothing broken and needs no transaction. What it
 * does need is an honest report, because "it failed" would be wrong — the other
 * person really is an owner now.
 */
export async function transferOwnership(
  gateway: AccessGateway,
  input: { familyId: string; fromUserId: string; toUserId: string },
): Promise<AccessOutcome> {
  if (input.fromUserId === input.toUserId) {
    return { ok: false, message: 'You are already the owner.' };
  }

  const promoted = await gateway.setRole({
    familyId: input.familyId,
    userId: input.toUserId,
    role: 'owner',
  });
  if (promoted.error) {
    return { ok: false, message: describeAccessError(promoted.error.message) };
  }

  const steppedDown = await gateway.setRole({
    familyId: input.familyId,
    userId: input.fromUserId,
    role: 'admin',
  });
  if (steppedDown.error) {
    return {
      ok: false,
      message:
        'They are now an owner, but you could not be stepped down. You are both owners — try changing your own role.',
    };
  }

  return { ok: true };
}

/** The only place that knows how access is revoked. */
export function createSupabaseAccessGateway(client: SupabaseClient): AccessGateway {
  return {
    // RPCs, not table writes. `family_users` is write-closed: UPDATE and DELETE
    // are revoked from `authenticated`, because a policy cannot pin which row
    // is affected nor hold the lock the last-owner guarantee needs.
    async removeAccess({ familyId, userId }) {
      const { error } = await client.rpc('remove_family_access', {
        target_family: familyId,
        target_user: userId,
      });
      return { error };
    },

    async leaveFamily({ familyId }) {
      const { error } = await client.rpc('leave_family', { target_family: familyId });
      return { error };
    },

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
