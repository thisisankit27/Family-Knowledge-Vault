import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '../../../src/components/EmptyState';
import { Screen } from '../../../src/components/Screen';
import { useAuth } from '../../../src/providers/AuthProvider';
import { useFamily } from '../../../src/providers/FamilyProvider';
import { theme } from '../../../src/theme';

/**
 * The Dashboard.
 *
 * `docs/10-ui-ux-design.md` §11 calls this "the emotional center", answering
 * one question: *what's happening in my family's world today?* Right now the
 * honest answer is "nothing yet, because there is no family" — so the screen
 * says that and points at what comes next, rather than filling itself with
 * invented sample data.
 */
export default function DashboardScreen() {
  const { session } = useAuth();
  const { family } = useFamily();
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

/** From `docs/10-ui-ux-design.md` §11 and `docs/06-information-architecture.md` §4. */
const PLANNED_SECTIONS = [
  'Upcoming events and birthdays',
  'Recent memories',
  'Family activity',
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
});
