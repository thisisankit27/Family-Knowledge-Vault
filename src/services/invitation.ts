/**
 * Invitations and membership.
 *
 * Same shape as `src/services/auth.ts` and `src/services/family.ts`: rules
 * here, UI-free, data access injected.
 *
 * The interesting logic is code normalisation. An invitation code is read
 * aloud, forwarded over WhatsApp, or typed from a screenshot, so it arrives
 * lowercase, spaced, hyphenated, or with a stray trailing space. Rejecting
 * those is a self-inflicted support problem — the code is the same code.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Family, FamilyRole, GatewayResult } from './family';

export interface Invitation {
  id: string;
  familyId: string;
  code: string;
  role: FamilyRole;
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
}

export interface InvitationGateway {
  createInvitation(input: {
    familyId: string;
    role: FamilyRole;
  }): Promise<GatewayResult<Invitation>>;
  redeemInvitation(code: string): Promise<GatewayResult<Family>>;
  listInvitations(familyId: string): Promise<GatewayResult<Invitation[]>>;
  revokeInvitation(id: string): Promise<{ error: { message: string } | null }>;
}

export type InvitationOutcome =
  | { ok: true; invitation: Invitation }
  | { ok: false; message: string };

export type RedeemOutcome =
  | { ok: true; family: Family }
  | { ok: false; message: string };

export const INVITATION_CODE_LENGTH = 8;

/**
 * No I, O, 0 or 1 — the pairs people mistype when copying by hand. Mirrors the
 * check constraint on `family_invitations.code`.
 */
const CODE_ALPHABET = /^[A-HJ-NP-Z2-9]+$/;

/**
 * Uppercases and strips anything that is obviously formatting rather than
 * content. Spaces and hyphens are how people write codes down; they carry no
 * meaning here.
 */
export function normaliseCode(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

export function validateCode(raw: string): { message: string } | null {
  const code = normaliseCode(raw);

  if (code.length === 0) {
    return { message: 'Enter the code you were given.' };
  }
  if (code.length !== INVITATION_CODE_LENGTH) {
    return { message: `Codes are ${INVITATION_CODE_LENGTH} characters long.` };
  }
  if (!CODE_ALPHABET.test(code)) {
    // Almost always a misread O-for-0 or I-for-1, so say which characters are
    // in play rather than "invalid".
    return { message: 'That code contains characters we never use — check for O/0 or I/1.' };
  }
  return null;
}

/**
 * The database raises these deliberately, one per reason, so the person gets
 * an answer rather than "something went wrong".
 */
export function describeInvitationError(message: string): string {
  const normalised = message.toLowerCase();

  if (normalised.includes('already in a family')) {
    return "You're already in a family. Joining a second one isn't supported yet.";
  }
  if (normalised.includes('invalid code')) {
    return "That code doesn't match an invitation.";
  }
  if (normalised.includes('already used')) {
    return 'That code has already been used. Ask for a new one.';
  }
  if (normalised.includes('expired')) {
    return 'That code has expired. Ask for a new one.';
  }
  if (normalised.includes('not allowed to invite')) {
    // Reworded in PR-9a: inviting is no longer owner-only, so "only the owner
    // can" became untrue the moment Admins arrived.
    return 'Only an owner or an admin can invite people.';
  }
  if (normalised.includes('higher role than your own')) {
    return 'You cannot invite someone at a higher role than your own.';
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

export async function createInvitation(
  gateway: InvitationGateway,
  input: { familyId: string; role?: FamilyRole },
): Promise<InvitationOutcome> {
  const { data, error } = await gateway.createInvitation({
    familyId: input.familyId,
    role: input.role ?? 'member',
  });

  if (error) return { ok: false, message: describeInvitationError(error.message) };
  if (!data) return { ok: false, message: 'The invitation was not created. Please try again.' };
  return { ok: true, invitation: data };
}

export async function redeemInvitation(
  gateway: InvitationGateway,
  rawCode: string,
): Promise<RedeemOutcome> {
  const invalid = validateCode(rawCode);
  if (invalid) return { ok: false, message: invalid.message };

  const { data, error } = await gateway.redeemInvitation(normaliseCode(rawCode));

  if (error) return { ok: false, message: describeInvitationError(error.message) };
  if (!data) return { ok: false, message: 'Could not join that family. Please try again.' };
  return { ok: true, family: data };
}

/**
 * A code dies in one of three ways: it gets used, it reaches its expiry, or
 * the owner kills it. The third exists because the first two are not enough —
 * a code shared with the wrong person is live for up to a week, and waiting it
 * out is not a remedy.
 *
 * Deleting rather than flagging: an unredeemed invitation carries no history
 * worth keeping, and a row that no longer exists cannot be redeemed by a bug.
 */
export async function revokeInvitation(
  gateway: InvitationGateway,
  id: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await gateway.revokeInvitation(id);
  if (error) return { ok: false, message: describeInvitationError(error.message) };
  return { ok: true };
}

/** Only invitations that can still be used — spent and expired ones are noise. */
export function selectUsableInvitations(
  invitations: Invitation[],
  now: Date = new Date(),
): Invitation[] {
  return invitations.filter(
    (invitation) =>
      invitation.redeemedAt === null && new Date(invitation.expiresAt) > now,
  );
}

export async function listUsableInvitations(
  gateway: InvitationGateway,
  familyId: string,
  now: Date = new Date(),
): Promise<Invitation[]> {
  const { data, error } = await gateway.listInvitations(familyId);
  if (error || !data) return [];
  return selectUsableInvitations(data, now);
}

interface InvitationRow {
  id: string;
  family_id: string;
  code: string;
  role: FamilyRole;
  created_at: string;
  expires_at: string;
  redeemed_at: string | null;
}

interface FamilyRow {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
}

function toInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    familyId: row.family_id,
    code: row.code,
    role: row.role,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    redeemedAt: row.redeemed_at,
  };
}

/** The only place that knows how invitations and membership are stored. */
export function createSupabaseInvitationGateway(
  client: SupabaseClient,
): InvitationGateway {
  return {
    async createInvitation({ familyId, role }) {
      const { data, error } = await client.rpc('create_invitation', {
        target_family: familyId,
        invited_role: role,
      });
      const row = (data ?? null) as InvitationRow | null;
      return { data: row ? toInvitation(row) : null, error };
    },

    async redeemInvitation(code) {
      const { data, error } = await client.rpc('redeem_invitation', {
        invitation_code: code,
      });
      const row = (data ?? null) as FamilyRow | null;
      return {
        data: row
          ? {
              id: row.id,
              name: row.name,
              createdBy: row.created_by,
              createdAt: row.created_at,
            }
          : null,
        error,
      };
    },

    async listInvitations(familyId) {
      const { data, error } = await client
        .from('family_invitations')
        .select('id, family_id, code, role, created_at, expires_at, redeemed_at')
        .eq('family_id', familyId)
        .order('created_at', { ascending: false })
        .returns<InvitationRow[]>();

      return { data: data ? data.map(toInvitation) : null, error };
    },

    async revokeInvitation(id) {
      const { error } = await client.from('family_invitations').delete().eq('id', id);
      return { error };
    },
  };
}
