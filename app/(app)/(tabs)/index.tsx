import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '../../../src/components/EmptyState';
import { LockedNotice } from '../../../src/components/LockedNotice';
import { Screen } from '../../../src/components/Screen';
import { formatRelativeTime } from '../../../src/lib/relativeTime';
import { getSupabase } from '../../../src/lib/supabase';
import { useAuth } from '../../../src/providers/AuthProvider';
import { useFamily } from '../../../src/providers/FamilyProvider';
import {
  createSupabaseActivityGateway,
  describeActivity,
  listActivity,
  type ActivityEvent,
} from '../../../src/services/activity';
import {
  createSupabaseMemberGateway,
  listMembers,
  type Member,
} from '../../../src/services/member';
import { canReadRecords } from '../../../src/services/role';
import { theme } from '../../../src/theme';

/**
 * The Dashboard.
 *
 * `docs/10-ui-ux-design.md` §11 calls this "the emotional center", answering
 * one question: *what's happening in my family's world today?* Until PR-10 the
 * honest answer was "nothing yet", so the screen said so rather than filling
 * itself with invented sample data. The activity feed is the first part of it
 * that is real.
 */
export default function DashboardScreen() {
  const { session } = useAuth();
  const { family, role } = useFamily();
  const name = session?.user.email?.split('@')[0] ?? 'there';

  return (
    <Screen
      title={`Hello, ${name}`}
      subtitle={
        family
          ? `${family.name} — this is where your family's day will appear.`
          : "This is where your family's day will appear."
      }
    >
      {!family && (
        <EmptyState
          icon="people-outline"
          title="Start with your family"
          body="Nothing lives here until a family workspace exists. Create one from the Family tab."
        />
      )}

      {!!family &&
        (canReadRecords(role) ? (
          <ActivityCard familyId={family.id} viewerUserId={session?.user.id ?? null} />
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Recent activity</Text>
            <LockedNotice body="The family's history is not shared with guests." />
          </View>
        ))}

      <View style={styles.card}>
        <Text style={styles.cardLabel}>What this screen will show</Text>
        {PLANNED_SECTIONS.map((section) => (
          <View key={section} style={styles.row}>
            <Ionicons
              name="ellipse-outline"
              size={14}
              color={theme.colors.textMuted}
            />
            <Text style={styles.rowText}>{section}</Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

function ActivityCard({
  familyId,
  viewerUserId,
}: {
  familyId: string;
  viewerUserId: string | null;
}) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [people, setPeople] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    try {
      // The member list is not decoration: a feed row stores ids, and the
      // sentence is assembled from these names. That is what stops a row ever
      // holding text it should not — see `src/services/activity.ts`.
      const [nextEvents, nextPeople] = await Promise.all([
        listActivity(createSupabaseActivityGateway(supabase), familyId),
        listMembers(createSupabaseMemberGateway(supabase), familyId),
      ]);
      setEvents(nextEvents);
      setPeople(nextPeople);
    } finally {
      setLoading(false);
    }
  }, [familyId]);

  // On focus, not on mount: almost everything in this feed happens on somebody
  // else's device, so a screen that loaded once would go quietly stale.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // This card is only rendered for a reader who passes `canReadRecords`, so the
  // empty copy below now means what it says: nothing has happened yet.
  //
  // PR-10 originally let a Guest fall through to that copy, reasoning it was
  // "the truth from where they are standing". It was not — the family's history
  // exists, and telling a Guest otherwise is a claim about somebody else's data.
  // Reversed in PR-11, once the same shape appeared in the document list.
  const lines = events
    .map((event) => ({
      id: event.id,
      when: formatRelativeTime(event.createdAt),
      // Null for an action this build does not recognise, so a later phase
      // cannot make an older install render "undefined".
      sentence: describeActivity(event, { people, viewerUserId }),
    }))
    .filter((line): line is typeof line & { sentence: string } => line.sentence !== null);

  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>Recent activity</Text>

      {loading ? (
        <ActivityIndicator color={theme.colors.primary} />
      ) : lines.length === 0 ? (
        // Deliberately not `EmptyState`: its badge reads "Arriving in …", which
        // would be a lie about something that has arrived and simply has
        // nothing to say yet.
        <Text style={styles.empty}>
          Nothing has happened yet. Adding someone to the family or inviting
          them will show up here.
        </Text>
      ) : (
        lines.map((line) => (
          <View key={line.id} style={styles.event}>
            <View style={styles.eventIcon}>
              <Ionicons name="time-outline" size={14} color={theme.colors.primary} />
            </View>
            <View style={styles.eventText}>
              <Text style={styles.eventSentence}>{line.sentence}</Text>
              {!!line.when && <Text style={styles.eventWhen}>{line.when}</Text>}
            </View>
          </View>
        ))
      )}
    </View>
  );
}

/**
 * From `docs/10-ui-ux-design.md` §11 and `docs/06-information-architecture.md` §4.
 *
 * "Family activity" left this list in PR-10 — it is above, and a roadmap that
 * still promises what has shipped is the same dishonesty as a landing page that
 * does.
 */
const PLANNED_SECTIONS = [
  'Upcoming events and birthdays',
  'Recent memories',
  'Medical reminders',
  'Recently added documents',
  'Quick actions',
  'Emergency access',
];

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  cardLabel: {
    fontSize: theme.typography.caption,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  rowText: {
    fontSize: theme.typography.body,
    color: theme.colors.text,
  },
  empty: {
    fontSize: theme.typography.body,
    lineHeight: 24,
    color: theme.colors.textMuted,
  },
  event: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  eventIcon: {
    width: 28,
    height: 28,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventText: {
    flex: 1,
    gap: 2,
  },
  eventSentence: {
    fontSize: theme.typography.body,
    lineHeight: 22,
    color: theme.colors.text,
  },
  eventWhen: {
    fontSize: theme.typography.caption,
    color: theme.colors.textMuted,
  },
});
