/**
 * The people in a family.
 *
 * Distinct from `family_users`, which is who can sign in. Most people in a
 * family never will — a grandmother, a child, an ancestor in the tree — and
 * every one of them can still own documents, medical records and memories from
 * Phase 3 onward (`docs/08-database-design.md` §8, FR-011).
 *
 * Same shape as the other services: rules here, UI-free, gateway injected.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { FamilyRole, GatewayResult } from './family';
import { ROLE_LABELS } from './role';

export type { FamilyRole };

/** Mirrors the check constraint on `family_members.blood_group`. */
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export const MAX_NAME_LENGTH = 80;

/** A person in the family, whether or not they have an account. */
export interface Person {
  id: string;
  familyId: string;
  displayName: string;
  dateOfBirth: string | null;
  bloodGroup: BloodGroup | null;
}

/** A person, plus their account details when they have one. */
export interface Member extends Person {
  userId: string | null;
  email: string | null;
  role: FamilyRole | null;
  joinedAt: string | null;
}

export interface MemberInput {
  displayName: string;
  dateOfBirth?: string | null;
  bloodGroup?: BloodGroup | null;
}

/**
 * Having an account and having access to *this family* are different things,
 * and there are three states rather than two.
 *
 * `none` is a person somebody typed in — a grandmother, a child, an ancestor —
 * who may never sign in at all. `revoked` is somebody who had access and lost
 * it, by leaving or by being removed in PR-9b: the account still exists, the
 * person is still in the family, and only the grant is gone.
 *
 * Collapsing the two reads as "No account" for a person who plainly has one,
 * and — worse — leaves role controls on screen that the database will refuse.
 */
export type MemberAccess = 'none' | 'active' | 'revoked';

type AccessFields = Pick<Member, 'userId' | 'role'>;

export function memberAccess(member: AccessFields): MemberAccess {
  if (!member.userId) return 'none';
  return member.role ? 'active' : 'revoked';
}

/** The only gate for anything that acts on somebody's role. */
export function hasFamilyAccess(member: AccessFields): boolean {
  return memberAccess(member) === 'active';
}

export function describeMemberAccess(member: AccessFields): string {
  switch (memberAccess(member)) {
    case 'none':
      return 'No account';
    case 'revoked':
      // Deliberately not "Left the family" or "Removed": nothing in the schema
      // records which one it was, and guessing would be a claim about a person.
      // The activity feed in PR-10 is where that distinction can come from.
      return 'No longer has access';
    default:
      return ROLE_LABELS[member.role!];
  }
}

export interface MemberGateway {
  listMembers(familyId: string): Promise<GatewayResult<Member[]>>;
  addMember(familyId: string, input: MemberInput): Promise<GatewayResult<Person>>;
  updateMember(memberId: string, input: MemberInput): Promise<GatewayResult<Person>>;
}

export type MemberOutcome =
  | { ok: true; person: Person }
  | { ok: false; message: string; field?: 'displayName' | 'dateOfBirth' };

/** `YYYY-MM-DD`, which is what a `date` column round-trips as. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateMemberInput(
  input: MemberInput,
  today: Date = new Date(),
): { message: string; field: 'displayName' | 'dateOfBirth' } | null {
  const name = input.displayName.trim();

  if (name.length === 0) {
    return { message: 'Enter a name.', field: 'displayName' };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { message: `Keep it under ${MAX_NAME_LENGTH} characters.`, field: 'displayName' };
  }

  const dob = input.dateOfBirth;
  if (dob) {
    if (!ISO_DATE.test(dob)) {
      return { message: 'Use the format YYYY-MM-DD, e.g. 1948-03-12.', field: 'dateOfBirth' };
    }
    const parsed = new Date(`${dob}T00:00:00Z`);
    // Round-tripping is the check that matters. `new Date('2026-02-31')` does
    // not produce NaN — JavaScript rolls it forward to 3 March — so testing
    // for NaN alone silently accepts dates that do not exist.
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dob) {
      return { message: 'That is not a real date.', field: 'dateOfBirth' };
    }
    // Compared as UTC dates so a device in a positive offset cannot reject
    // today's date as being in the future.
    const startOfToday = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    );
    if (parsed.getTime() > startOfToday.getTime()) {
      return { message: 'A birthday cannot be in the future.', field: 'dateOfBirth' };
    }
  }

  return null;
}

export function describeMemberError(message: string): string {
  const normalised = message.toLowerCase();

  if (normalised.includes('not allowed to edit')) {
    return 'You do not have permission to do that.';
  }
  if (normalised.includes('date of birth is in the future')) {
    return 'A birthday cannot be in the future.';
  }
  if (normalised.includes('display_name_check')) {
    return `Use between 1 and ${MAX_NAME_LENGTH} characters.`;
  }
  if (normalised.includes('blood_group_check')) {
    return 'That is not a recognised blood group.';
  }
  if (normalised.includes('account_unique')) {
    return 'That person is already linked to an account in this family.';
  }
  if (normalised.includes('row-level security') || normalised.includes('permission denied')) {
    return 'You do not have permission to do that.';
  }
  if (normalised.includes('network') || normalised.includes('fetch')) {
    return 'Cannot reach the server. Check your connection and try again.';
  }
  return message;
}

/**
 * Everyone in the family, including people with no account.
 *
 * No filter is passed: the database function checks the caller shares the
 * family. Reading `auth.users` is not possible from a client, so email
 * addresses can only arrive this way.
 */
export async function listMembers(
  gateway: MemberGateway,
  familyId: string,
): Promise<Member[]> {
  const { data, error } = await gateway.listMembers(familyId);
  if (error || !data) return [];
  return data;
}

export async function addMember(
  gateway: MemberGateway,
  familyId: string,
  input: MemberInput,
): Promise<MemberOutcome> {
  const invalid = validateMemberInput(input);
  if (invalid) return { ok: false, ...invalid };

  const { data, error } = await gateway.addMember(familyId, normalise(input));
  if (error) return { ok: false, message: describeMemberError(error.message) };
  if (!data) return { ok: false, message: 'That person was not added. Please try again.' };
  return { ok: true, person: data };
}

export async function updateMember(
  gateway: MemberGateway,
  memberId: string,
  input: MemberInput,
): Promise<MemberOutcome> {
  const invalid = validateMemberInput(input);
  if (invalid) return { ok: false, ...invalid };

  const { data, error } = await gateway.updateMember(memberId, normalise(input));
  if (error) return { ok: false, message: describeMemberError(error.message) };
  if (!data) return { ok: false, message: 'Those changes were not saved. Please try again.' };
  return { ok: true, person: data };
}

/** Empty strings from a text input mean "not set", not "the empty string". */
function normalise(input: MemberInput): MemberInput {
  return {
    displayName: input.displayName.trim(),
    dateOfBirth: input.dateOfBirth?.trim() || null,
    bloodGroup: input.bloodGroup || null,
  };
}

interface MemberRow {
  id: string;
  user_id: string | null;
  display_name: string;
  date_of_birth: string | null;
  blood_group: BloodGroup | null;
  email: string | null;
  role: FamilyRole | null;
  joined_at: string | null;
}

interface PersonRow {
  id: string;
  family_id: string;
  display_name: string;
  date_of_birth: string | null;
  blood_group: BloodGroup | null;
}

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    familyId: row.family_id,
    displayName: row.display_name,
    dateOfBirth: row.date_of_birth,
    bloodGroup: row.blood_group,
  };
}

/** The only place that knows how people are stored. */
export function createSupabaseMemberGateway(client: SupabaseClient): MemberGateway {
  return {
    async listMembers(familyId) {
      const { data, error } = await client.rpc('list_family_members', {
        target_family: familyId,
      });
      const rows = (data ?? null) as MemberRow[] | null;

      return {
        data: rows
          ? rows.map((row) => ({
              id: row.id,
              familyId,
              userId: row.user_id,
              displayName: row.display_name,
              dateOfBirth: row.date_of_birth,
              bloodGroup: row.blood_group,
              email: row.email,
              role: row.role,
              joinedAt: row.joined_at,
            }))
          : null,
        error,
      };
    },

    // Writes go through definer functions rather than an INSERT policy: a
    // policy cannot express "you may set every column except user_id", and
    // user_id is what links a person to an account.
    async addMember(familyId, input) {
      const { data, error } = await client.rpc('add_family_member', {
        target_family: familyId,
        member_name: input.displayName,
        member_dob: input.dateOfBirth ?? null,
        member_blood_group: input.bloodGroup ?? null,
      });
      const row = (data ?? null) as PersonRow | null;
      return { data: row ? toPerson(row) : null, error };
    },

    async updateMember(memberId, input) {
      const { data, error } = await client.rpc('update_family_member', {
        member: memberId,
        member_name: input.displayName,
        member_dob: input.dateOfBirth ?? null,
        member_blood_group: input.bloodGroup ?? null,
      });
      const row = (data ?? null) as PersonRow | null;
      return { data: row ? toPerson(row) : null, error };
    },
  };
}
