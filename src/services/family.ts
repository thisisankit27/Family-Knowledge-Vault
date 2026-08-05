/**
 * Family business logic.
 *
 * Same shape as `src/services/auth.ts`: rules live here, UI-free, with the
 * data access injected — so validation and error wording are tested without a
 * network or a device.
 *
 * The gateway interface is narrow on purpose. It keeps PostgREST query syntax
 * in one adapter (`createSupabaseFamilyGateway`) instead of spreading
 * `.from('families').select()` through screens, which is what makes the rest
 * of this file testable at all.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A person's level of access to a family.
 *
 * Mirrors `family_users_role_check`. A role answers "what may you do *to* the
 * family"; it deliberately says nothing about what you may *see* inside it —
 * that is record visibility, a separate axis. Collapsing the two is how a role
 * model grows a Child role and a Restricted role and an Emergency role and
 * still fits nobody. See `docs/15-permission-matrix.md` §2.
 *
 * Labels, ranking and the permission predicates live in `./role`.
 */
export const FAMILY_ROLES = ['owner', 'admin', 'member', 'guest'] as const;
export type FamilyRole = (typeof FAMILY_ROLES)[number];

export interface Family {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
}

/**
 * Only a name. The creator is taken from the authenticated session inside the
 * database function, so there is no request shape that creates a family in
 * somebody else's name — see the `create_family` comment in the migration.
 */
export interface CreateFamilyInput {
  name: string;
}

export interface GatewayResult<T> {
  data: T | null;
  error: { message: string } | null;
}

export interface FamilyGateway {
  createFamily(input: CreateFamilyInput): Promise<GatewayResult<Family>>;
  listMyFamilies(): Promise<GatewayResult<Family[]>>;
  getMyRole(familyId: string, userId: string): Promise<GatewayResult<FamilyRole>>;
  deleteFamily(familyId: string): Promise<{ error: { message: string } | null }>;
}

export type FamilyOutcome =
  | { ok: true; family: Family }
  | { ok: false; message: string };

/** Mirrors the check constraint on `families.name` in the migration. */
export const MAX_FAMILY_NAME_LENGTH = 80;

export function validateFamilyName(raw: string): { message: string } | null {
  const name = raw.trim();

  if (name.length === 0) {
    return { message: 'Give your family a name.' };
  }
  if (name.length > MAX_FAMILY_NAME_LENGTH) {
    return {
      message: `Keep it under ${MAX_FAMILY_NAME_LENGTH} characters.`,
    };
  }
  return null;
}

/**
 * Postgres speaks to developers. This speaks to whoever is holding the phone.
 *
 * The row-level-security case matters most: if a policy ever rejects a write,
 * the raw message is "new row violates row-level security policy", which reads
 * like a bug rather than a rule. Anyone seeing it should be told what actually
 * went wrong.
 */
export function describeFamilyError(message: string): string {
  const normalised = message.toLowerCase();

  if (normalised.includes('row-level security') || normalised.includes('permission denied')) {
    // `permission denied` is the privilege layer rather than a policy, and it
    // became a realistic answer when PR-9a started revoking grants. Every other
    // service already handled both; this one did not.
    return 'You do not have permission to do that.';
  }
  if (normalised.includes('not authenticated')) {
    // Raised by create_family() when auth.uid() is null — the session expired
    // between opening the screen and submitting it.
    return 'Your session has expired. Sign in again.';
  }
  if (normalised.includes('families_name_check')) {
    return `Use between 1 and ${MAX_FAMILY_NAME_LENGTH} characters.`;
  }
  if (normalised.includes('duplicate key')) {
    return 'That already exists.';
  }
  if (normalised.includes('network') || normalised.includes('fetch')) {
    return 'Cannot reach the server. Check your connection and try again.';
  }
  return message;
}

export async function createFamily(
  gateway: FamilyGateway,
  input: CreateFamilyInput,
): Promise<FamilyOutcome> {
  const invalid = validateFamilyName(input.name);
  if (invalid) return { ok: false, message: invalid.message };

  const { data, error } = await gateway.createFamily({ name: input.name.trim() });

  if (error) return { ok: false, message: describeFamilyError(error.message) };
  if (!data) {
    // Insert reported success but returned no row — the RLS SELECT policy
    // declined to hand it back. Treating that as success would leave the UI
    // showing a family it cannot read.
    return { ok: false, message: 'The family was not created. Please try again.' };
  }

  return { ok: true, family: data };
}

/**
 * Every family the signed-in user belongs to.
 *
 * There is no `where` clause and there does not need to be one: the RLS SELECT
 * policy restricts this to the caller's families. That is the whole point of
 * putting the boundary in the database — a forgotten filter in application
 * code cannot leak another household's data.
 */
export async function listMyFamilies(gateway: FamilyGateway): Promise<Family[]> {
  const { data, error } = await gateway.listMyFamilies();
  if (error || !data) return [];
  return data;
}

/**
 * The caller's role in a family, read from the access table.
 *
 * Deliberately not derived from the member list. It was, and a migration that
 * left a family with access rows but no people made every owner look like a
 * non-member — the invite controls simply disappeared, with no error anywhere.
 * Permission must come from the record that grants it.
 *
 * Null means no access, which is also what a failed read returns: from the
 * UI's point of view they are the same thing, and assuming a role on failure
 * is the dangerous direction to guess in.
 */
export async function getMyRole(
  gateway: FamilyGateway,
  familyId: string,
  userId: string,
): Promise<FamilyRole | null> {
  const { data, error } = await gateway.getMyRole(familyId, userId);
  if (error || !data) return null;
  return data;
}

/**
 * Deletes the family and everything hanging off it.
 *
 * Confirmation belongs to the screen, not here — but note what "everything"
 * means: `families` has no `deleted_at`, so this is a hard cascade through
 * people, relationships and invitations, and nothing is recoverable. Any copy
 * that suggests otherwise would be a lie.
 *
 * The caller must already know they want this. The name is typed out on the
 * delete screen for that reason.
 */
export async function deleteFamily(
  gateway: FamilyGateway,
  familyId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await gateway.deleteFamily(familyId);
  if (error) return { ok: false, message: describeFamilyError(error.message) };
  return { ok: true };
}

interface FamilyRow {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
}

function toFamily(row: FamilyRow): Family {
  return {
    id: row.id,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/** The only place that knows how families are stored. */
export function createSupabaseFamilyGateway(client: SupabaseClient): FamilyGateway {
  return {
    async createFamily({ name }) {
      // An RPC rather than an insert: creating a family also has to create its
      // owner-membership row, and both must happen before RLS decides whether
      // the caller may see the result. The migration explains why.
      const { data, error } = await client.rpc('create_family', { family_name: name });

      // `create_family` is declared `returns public.families`, so PostgREST
      // sends one object rather than an array. Without generated database
      // types supabase-js cannot know that, hence the assertion — the shape is
      // guaranteed by the migration, not assumed here.
      const row = (data ?? null) as FamilyRow | null;
      return { data: row ? toFamily(row) : null, error };
    },

    async listMyFamilies() {
      const { data, error } = await client
        .from('families')
        .select('id, name, created_by, created_at')
        .order('created_at', { ascending: true })
        .returns<FamilyRow[]>();

      return { data: data ? data.map(toFamily) : null, error };
    },

    async getMyRole(familyId, userId) {
      // `maybeSingle` rather than `single`: no access is a legitimate answer,
      // not an error, and `single` would turn it into one.
      const { data, error } = await client
        .from('family_users')
        .select('role')
        .eq('family_id', familyId)
        .eq('user_id', userId)
        .maybeSingle<{ role: FamilyRole }>();

      return { data: data?.role ?? null, error };
    },

    // A plain delete, not an RPC. Unlike removing somebody's access, the whole
    // rule is expressible as a policy — `can_manage_family(id)`, owner-only —
    // so a definer function would add a layer and no precondition. The policy
    // and its grant have been in place since PR-5; PR-9b only gives them a way
    // in. Everything else goes with it by `on delete cascade`.
    async deleteFamily(familyId) {
      const { error } = await client.from('families').delete().eq('id', familyId);
      return { error };
    },
  };
}
