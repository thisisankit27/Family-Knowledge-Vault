/**
 * What happened in the family, turned into sentences.
 *
 * Same shape as every other service — rules here, UI-free, gateway injected.
 *
 * **The database stores references, never prose.** A row holds an action, an
 * actor and a subject id; the sentence is assembled here from the current
 * member list. Two things follow, and the second is the reason for the first:
 *
 * 1. Renaming somebody rewrites their history. A stored "Ankit added Nani"
 *    would still say Nani after she became Sunita.
 * 2. A row **cannot** contain a record title, so from Phase 3 a feed entry can
 *    never leak a private document through its own name
 *    (`docs/15-permission-matrix.md` §9.5). Storing it nowhere beats
 *    remembering not to show it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { GatewayResult } from './family';
import type { Member } from './member';
import { ROLE_LABELS, isFamilyRole } from './role';

/** Mirrors the check constraint on `family_activity.action`. */
export const ACTIVITY_ACTIONS = [
  'family_created',
  'person_added',
  'person_updated',
  'access_granted',
  'access_revoked',
  'role_changed',
  'relationship_added',
  'relationship_removed',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export interface ActivityEvent {
  id: string;
  action: string;
  actorUserId: string | null;
  subjectMemberId: string | null;
  detail: { role?: string } | null;
  createdAt: string;
}

export interface ActivityGateway {
  listActivity(familyId: string, limit: number): Promise<GatewayResult<ActivityEvent[]>>;
}

export interface ActivityContext {
  people: Member[];
  /** The signed-in account, so the feed can say "You" instead of a name. */
  viewerUserId: string | null;
}

/** How many rows the Dashboard asks for. A feed, not an audit log. */
export const ACTIVITY_PAGE_SIZE = 10;

function actorName(event: ActivityEvent, context: ActivityContext): string {
  if (!event.actorUserId) return 'Someone';
  if (event.actorUserId === context.viewerUserId) return 'You';

  const person = context.people.find((candidate) => candidate.userId === event.actorUserId);
  // Not "an unknown user": the account may simply have been deleted, and the
  // event still happened. Degrading the name is honest; dropping the row is not.
  return person?.displayName ?? 'Someone';
}

/**
 * The person an event was about, from the reader's point of view.
 *
 * "you", not their name, when it is them — the same courtesy the actor already
 * got. Being told "Ankit made Nani an admin" when you *are* Nani reads like
 * news about somebody else, and this is the half of the feed a person most
 * wants to notice.
 *
 * Always lowercase: the actor opens every sentence, so the subject is never
 * the first word.
 */
function subjectName(event: ActivityEvent, context: ActivityContext): string {
  const person = findSubject(event, context);
  if (!person) return 'someone';
  if (person.userId && person.userId === context.viewerUserId) return 'you';
  return person.displayName;
}

/**
 * The same, possessive. Needed because "you" does not take an apostrophe-s —
 * `${subject}'s details` would render "you's details".
 */
function subjectPossessive(event: ActivityEvent, context: ActivityContext): string {
  const person = findSubject(event, context);
  if (!person) return "someone's";
  if (person.userId && person.userId === context.viewerUserId) return 'your';
  return `${person.displayName}'s`;
}

function findSubject(event: ActivityEvent, context: ActivityContext): Member | undefined {
  if (!event.subjectMemberId) return undefined;
  return context.people.find((candidate) => candidate.id === event.subjectMemberId);
}

function roleWord(event: ActivityEvent): string {
  const role = event.detail?.role;
  if (!role || !isFamilyRole(role)) return 'a member';
  const label = ROLE_LABELS[role].toLowerCase();
  return /^[aeiou]/.test(label) ? `an ${label}` : `a ${label}`;
}

/**
 * One row, as a sentence.
 *
 * Returns `null` for an action this build has never heard of — a later phase
 * adding a ninth action must not make older installs render "undefined". The
 * screen skips those rows.
 */
export function describeActivity(
  event: ActivityEvent,
  context: ActivityContext,
): string | null {
  const actor = actorName(event, context);
  const subject = subjectName(event, context);
  const subjects = subjectPossessive(event, context);

  switch (event.action as ActivityAction) {
    case 'family_created':
      return `${actor} created the family`;

    case 'person_added':
      return `${actor} added ${subject}`;

    case 'person_updated':
      return `${actor} updated ${subjects} details`;

    case 'access_granted':
      // Only ever the joiner's own act — creating a family or redeeming a code —
      // so this reads in the first person rather than as something done to them.
      return `${actor} joined as ${roleWord(event)}`;

    case 'access_revoked':
      // The one place the feed can tell leaving from being removed, which the
      // people list deliberately cannot: it compares actor to subject, and the
      // database recorded both.
      return isSelf(event, context)
        ? `${actor} left the family`
        : `${actor} removed ${subjects} access`;

    case 'role_changed':
      return `${actor} made ${subject} ${roleWord(event)}`;

    case 'relationship_added':
      return `${actor} added a relationship for ${subject}`;

    case 'relationship_removed':
      return `${actor} removed a relationship for ${subject}`;

    default:
      return null;
  }
}

/** Whether the actor and the subject are the same person. */
function isSelf(event: ActivityEvent, context: ActivityContext): boolean {
  if (!event.actorUserId || !event.subjectMemberId) return false;
  const subject = context.people.find((person) => person.id === event.subjectMemberId);
  return subject?.userId === event.actorUserId;
}

export async function listActivity(
  gateway: ActivityGateway,
  familyId: string,
  limit: number = ACTIVITY_PAGE_SIZE,
): Promise<ActivityEvent[]> {
  const { data, error } = await gateway.listActivity(familyId, limit);
  // A feed is the least important thing on the Dashboard. It should go quiet on
  // failure, not take the screen with it.
  if (error || !data) return [];
  return data;
}

interface ActivityRow {
  id: string;
  action: string;
  actor_user_id: string | null;
  subject_member_id: string | null;
  detail: { role?: string } | null;
  created_at: string;
}

/** The only place that knows how activity is stored. */
export function createSupabaseActivityGateway(client: SupabaseClient): ActivityGateway {
  return {
    async listActivity(familyId, limit) {
      // The `eq` is for the multi-family future rather than for safety — RLS is
      // the boundary, and the policy is a single can_see_record call.
      const { data, error } = await client
        .from('family_activity')
        .select('id, action, actor_user_id, subject_member_id, detail, created_at')
        .eq('family_id', familyId)
        .order('created_at', { ascending: false })
        .limit(limit)
        .returns<ActivityRow[]>();

      return {
        data: data
          ? data.map((row) => ({
              id: row.id,
              action: row.action,
              actorUserId: row.actor_user_id,
              subjectMemberId: row.subject_member_id,
              detail: row.detail,
              createdAt: row.created_at,
            }))
          : null,
        error,
      };
    },
  };
}
