import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import type { IconName } from '../navigation/domains';
import { theme } from '../theme';

interface EmptyStateProps {
  icon: IconName;
  title: string;
  body: string;
  /** When this section becomes real, e.g. "Phase 3". */
  arrivesIn?: string;
}

/**
 * What a section looks like before it holds anything.
 *
 * `docs/10-ui-ux-design.md` §15 treats empty states as designed screens rather
 * than blank space, and the reason applies literally here: for most of this
 * build, most sections *are* empty. An empty state that says what will live
 * here and when reads as a product being built; a blank screen reads as broken.
 *
 * Deliberately no fake sample data — inventing a placeholder passport would
 * make the app look further along than it is, which is the opposite of what a
 * build-in-public project should show.
 */
export function EmptyState({ icon, title, body, arrivesIn }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <View style={styles.iconRing}>
        <Ionicons name={icon} size={26} color={theme.colors.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {!!arrivesIn && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>Arriving in {arrivesIn}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.xl,
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  iconRing: {
    width: 56,
    height: 56,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.xs,
  },
  title: {
    fontSize: theme.typography.subheading,
    fontWeight: '600',
    color: theme.colors.text,
    textAlign: 'center',
  },
  body: {
    fontSize: theme.typography.body,
    lineHeight: 24,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  badge: {
    marginTop: theme.spacing.xs,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceSunken,
  },
  badgeText: {
    fontSize: theme.typography.caption,
    fontWeight: '600',
    color: theme.colors.textMuted,
  },
});
