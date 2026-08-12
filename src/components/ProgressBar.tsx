import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';

/**
 * A real percentage, because NFR-007 asks for one.
 *
 * `Button`'s `busy` prop renders a spinner, which is a binary state — it says
 * something is happening, never how much is left. That is the right control for
 * a request that takes half a second and the wrong one for a ten-megabyte
 * upload over mobile data.
 *
 * **The fraction must come from real upload events.** A bar animated on a timer
 * would look identical and mean nothing, and this project's landing page
 * carries an honesty standard that does not stop at the marketing copy. The
 * storage gateway uses `XMLHttpRequest` rather than `supabase-js` for exactly
 * this reason — `xhr.upload.onprogress` is the only place a genuine number
 * comes from.
 */
export function ProgressBar({ fraction, label }: { fraction: number; label?: string }) {
  // Clamped because a provider reporting loaded > total should not render a bar
  // wider than its track.
  const clamped = Math.max(0, Math.min(1, fraction));
  const percent = Math.round(clamped * 100);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={styles.container}
    >
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${percent}%` }]} />
      </View>
      <Text style={styles.label}>{label ? `${label} ${percent}%` : `${percent}%`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
  },
  track: {
    height: 6,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceSunken,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.primary,
  },
  label: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
  },
});
