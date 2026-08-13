import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  DOCUMENT_VISIBILITIES,
  VISIBILITY_HINTS,
  VISIBILITY_LABELS,
  type DocumentVisibility,
} from '../services/document';
import { theme } from '../theme';

/**
 * Who can open this document.
 *
 * **Controlled, deliberately.** It reports a choice and stores nothing, so the
 * two screens that need it can disagree about what "choosing" means: the detail
 * screen saves immediately, and the filing form holds the answer until the
 * document exists to attach it to. A component that saved for itself could only
 * serve the first of those, and the second is where the setting belongs.
 *
 * It lives here rather than inside the documents screens for the same reason:
 * one component owns how this question is asked, so the two places cannot drift
 * into asking it differently. That drift is exactly what put AI consent on one
 * screen and nothing on the other.
 *
 * The hint under the chips describes **the selected option**, not all of them.
 * It is the consequence of a choice already made, which is the moment a person
 * actually wants to read it — and `docs/15` §8.4 is the reason the `private`
 * wording says "not even an owner" rather than something vaguer. The copy has to
 * be as true as the policy, or the word "private" is doing the lying the policy
 * refuses to do.
 *
 * Two options. Specific-person sharing would be a third, and it is not missing —
 * `docs/15` §10 places per-record ACLs in Phase 10, and §8.1 makes them a change
 * to one function body plus one more entry in `DOCUMENT_VISIBILITIES`. This
 * renders whatever that list holds, so it will not need editing when it grows.
 */
export function VisibilityPicker({
  value,
  onChange,
  disabled,
}: {
  value: DocumentVisibility;
  onChange: (next: DocumentVisibility) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <View style={styles.picker}>
        {DOCUMENT_VISIBILITIES.map((visibility) => {
          const active = visibility === value;
          return (
            <Pressable
              key={visibility}
              // Re-selecting the current value is a no-op rather than a write.
              // On the detail screen that write would be a round trip to change
              // nothing; here it is one line and saves both callers the check.
              onPress={() => !disabled && !active && onChange(visibility)}
              style={[
                styles.chip,
                active ? styles.chipActive : null,
                disabled ? styles.chipDisabled : null,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: Boolean(disabled) }}
              accessibilityLabel={`${VISIBILITY_LABELS[visibility]}. ${VISIBILITY_HINTS[visibility]}`}
            >
              <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                {VISIBILITY_LABELS[visibility]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.hint}>{VISIBILITY_HINTS[value]}</Text>
    </>
  );
}

const styles = StyleSheet.create({
  picker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  chipActive: {
    backgroundColor: theme.colors.primarySoft,
    borderColor: theme.colors.primary,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
  },
  chipTextActive: {
    color: theme.colors.primary,
    fontWeight: '600',
  },
  hint: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    marginTop: 2,
  },
});
