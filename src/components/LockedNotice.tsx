import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';

/**
 * Shown where a reader has access to the family but not to this kind of record.
 *
 * **This exists because Row-Level Security filters rather than errors.** A Guest
 * holds the `select` grant, so their query succeeds and returns zero rows —
 * indistinguishable, at the query layer, from a family that genuinely owns
 * nothing. The screen cannot tell the two apart by looking at the result, so it
 * has to ask the role instead (`canReadRecords`).
 *
 * Getting this wrong is not cosmetic. "Nothing filed yet" and "Nothing has
 * happened yet" are claims about the *family's* data, and for a Guest both are
 * false: the documents exist and the history exists. The landing page commits
 * this project to not making claims that do not survive checking, and a screen
 * is no different from a stats row in that respect.
 *
 * It deliberately does not name what is hidden or how much of it there is —
 * "3 documents you cannot see" is itself a disclosure.
 */
export function LockedNotice({ body }: { body: string }) {
  return (
    <View style={styles.notice}>
      <Ionicons name="lock-closed-outline" size={18} color={theme.colors.textMuted} />
      <Text style={styles.text}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceSunken,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
  },
  text: {
    flex: 1,
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
  },
});
