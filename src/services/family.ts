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

  if (normalised.includes('row-level security')) {
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
  };
}
