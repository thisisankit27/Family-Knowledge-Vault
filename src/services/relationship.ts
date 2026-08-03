/**
 * How the people in a family are connected.
 *
 * Three stored types — `parent_of`, `spouse_of`, `sibling_of` — because
 * grandparent, cousin, aunt and in-law are all derivable from them. Enumerating
 * relationship names is a list that grows forever and still misses cases;
 * derivation ships with the tree view in Phase 6+.
 *
 * Same shape as the other services: rules here, UI-free, gateway injected.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { GatewayResult } from './family';

export const RELATIONSHIP_TYPES = ['parent_of', 'spouse_of', 'sibling_of'] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export interface Relationship {
  id: string;
  familyId: string;
  fromMemberId: string;
  toMemberId: string;
  type: RelationshipType;
}

/** A relationship seen from one person's point of view. */
export interface RelationshipView {
  id: string;
  /** The person at the other end. */
  otherMemberId: string;
  /** What that person is *to* the viewer: "Parent", "Child", "Spouse", "Sibling". */
  label: string;
}

export interface RelationshipGateway {
  listRelationships(familyId: string): Promise<GatewayResult<Relationship[]>>;
  addRelationship(input: {
    firstMemberId: string;
    secondMemberId: string;
    type: RelationshipType;
  }): Promise<GatewayResult<Relationship>>;
  removeRelationship(id: string): Promise<{ error: { message: string } | null }>;
}

export type RelationshipOutcome =
  | { ok: true; relationship: Relationship }
  | { ok: false; message: string };

export interface RelationshipChoice {
  key: string;
  /** Completes the sentence "{subject} is the ___ of {other}". */
  label: string;
  type: RelationshipType;
  /** False when the *other* person is the `from` side — i.e. "child of". */
  subjectIsFrom: boolean;
}

/**
 * Four choices over three stored types.
 *
 * "Child of" is the same row as "Parent of" with the two people swapped, and it
 * exists because standing on your grandmother's page and recording that she is
 * your parent's parent should not require working out which way the arrow
 * points. Making somebody reason backwards is how the data gets entered wrong.
 */
export const RELATIONSHIP_CHOICES: RelationshipChoice[] = [
  { key: 'parent', label: 'Parent of', type: 'parent_of', subjectIsFrom: true },
  { key: 'child', label: 'Child of', type: 'parent_of', subjectIsFrom: false },
  { key: 'spouse', label: 'Spouse of', type: 'spouse_of', subjectIsFrom: true },
  { key: 'sibling', label: 'Sibling of', type: 'sibling_of', subjectIsFrom: true },
];

/**
 * Turns "{subject} is the {choice} of {other}" into the pair the database
 * expects. The only place direction is decided, so the screens never have to.
 */
export function resolveRelationshipArguments(
  choice: RelationshipChoice,
  subjectId: string,
  otherId: string,
): { firstMemberId: string; secondMemberId: string; type: RelationshipType } {
  return choice.subjectIsFrom
    ? { firstMemberId: subjectId, secondMemberId: otherId, type: choice.type }
    : { firstMemberId: otherId, secondMemberId: subjectId, type: choice.type };
}

/**
 * What the person at the other end is *to* the viewer.
 *
 * `parent_of` is the only directed type, and it is the only place this can go
 * wrong: stored as "from is the parent of to", so the viewer being `from` means
 * the other person is their child, not their parent.
 */
export function relationshipLabel(type: RelationshipType, viewerIsFrom: boolean): string {
  switch (type) {
    case 'parent_of':
      return viewerIsFrom ? 'Child' : 'Parent';
    case 'spouse_of':
      return 'Spouse';
    case 'sibling_of':
      return 'Sibling';
  }
}

/**
 * Every relationship involving one person, from their point of view.
 *
 * Filtering client-side rather than querying per person: a family is small
 * enough that one fetch beats N round trips, and the person page then costs two
 * requests no matter how many relatives are on it.
 */
export function relationshipsFor(
  memberId: string,
  relationships: Relationship[],
): RelationshipView[] {
  return relationships
    .filter(
      (relationship) =>
        relationship.fromMemberId === memberId || relationship.toMemberId === memberId,
    )
    .map((relationship) => {
      const viewerIsFrom = relationship.fromMemberId === memberId;
      return {
        id: relationship.id,
        otherMemberId: viewerIsFrom ? relationship.toMemberId : relationship.fromMemberId,
        label: relationshipLabel(relationship.type, viewerIsFrom),
      };
    });
}

export function validateRelationship(input: {
  firstMemberId: string;
  secondMemberId: string;
  type: RelationshipType;
}): { message: string } | null {
  if (!input.firstMemberId || !input.secondMemberId) {
    return { message: 'Choose both people.' };
  }
  if (input.firstMemberId === input.secondMemberId) {
    return { message: 'A person cannot be related to themselves.' };
  }
  if (!RELATIONSHIP_TYPES.includes(input.type)) {
    return { message: 'Choose a relationship.' };
  }
  return null;
}

export function describeRelationshipError(message: string): string {
  const normalised = message.toLowerCase();

  if (normalised.includes('already exists')) {
    return 'That relationship is already recorded.';
  }
  if (normalised.includes('circular parent')) {
    return 'They are already recorded as this person’s parent, so it cannot go both ways.';
  }
  if (normalised.includes('related to themselves')) {
    return 'A person cannot be related to themselves.';
  }
  if (normalised.includes('not in the same family')) {
    return 'Those two people are not in the same family.';
  }
  if (normalised.includes('unknown relationship type')) {
    return 'Choose a relationship.';
  }
  if (normalised.includes('not allowed to edit')) {
    return 'You do not have permission to do that.';
  }
  if (normalised.includes('row-level security') || normalised.includes('permission denied')) {
    return 'You do not have permission to do that.';
  }
  if (normalised.includes('network') || normalised.includes('fetch')) {
    return 'Cannot reach the server. Check your connection and try again.';
  }
  return message;
}

export async function listRelationships(
  gateway: RelationshipGateway,
  familyId: string,
): Promise<Relationship[]> {
  const { data, error } = await gateway.listRelationships(familyId);
  if (error || !data) return [];
  return data;
}

export async function addRelationship(
  gateway: RelationshipGateway,
  input: { firstMemberId: string; secondMemberId: string; type: RelationshipType },
): Promise<RelationshipOutcome> {
  const invalid = validateRelationship(input);
  if (invalid) return { ok: false, message: invalid.message };

  const { data, error } = await gateway.addRelationship(input);
  if (error) return { ok: false, message: describeRelationshipError(error.message) };
  if (!data) {
    return { ok: false, message: 'That relationship was not recorded. Please try again.' };
  }
  return { ok: true, relationship: data };
}

export async function removeRelationship(
  gateway: RelationshipGateway,
  id: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await gateway.removeRelationship(id);
  if (error) return { ok: false, message: describeRelationshipError(error.message) };
  return { ok: true };
}

interface RelationshipRow {
  id: string;
  family_id: string;
  from_member: string;
  to_member: string;
  type: RelationshipType;
}

function toRelationship(row: RelationshipRow): Relationship {
  return {
    id: row.id,
    familyId: row.family_id,
    fromMemberId: row.from_member,
    toMemberId: row.to_member,
    type: row.type,
  };
}

/** The only place that knows how relationships are stored. */
export function createSupabaseRelationshipGateway(
  client: SupabaseClient,
): RelationshipGateway {
  return {
    async listRelationships(familyId) {
      const { data, error } = await client
        .from('family_relationships')
        .select('id, family_id, from_member, to_member, type')
        .eq('family_id', familyId)
        .returns<RelationshipRow[]>();

      return { data: data ? data.map(toRelationship) : null, error };
    },

    // An RPC rather than an insert: symmetric pairs have to be stored in a
    // canonical order, and making the client responsible for that is a rule it
    // would eventually get wrong. The function also derives family_id from the
    // people, so the caller cannot assert which family this belongs to.
    async addRelationship({ firstMemberId, secondMemberId, type }) {
      const { data, error } = await client.rpc('add_family_relationship', {
        first_member: firstMemberId,
        second_member: secondMemberId,
        relationship_type: type,
      });
      const row = (data ?? null) as RelationshipRow | null;
      return { data: row ? toRelationship(row) : null, error };
    },

    async removeRelationship(id) {
      const { error } = await client.from('family_relationships').delete().eq('id', id);
      return { error };
    },
  };
}
