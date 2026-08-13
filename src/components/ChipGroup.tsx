import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '../theme';

/**
 * A row of single-select options, and the hint for whichever one is chosen.
 *
 * **Extracted because three near-identical copies had accumulated** — the
 * documents library's filing form, the document detail screen's two pickers, and
 * `VisibilityPicker` — each with its own `StyleSheet` block spelling out the same
 * five rules. That is how two screens come to look subtly different while
 * claiming to offer the same choice, which is the drift PR-15b exists to close.
 *
 * **Controlled, and it stores nothing.** That is what lets the same component
 * serve a form that saves once at the end and a detail screen that saves on every
 * tap: the caller owns what "chosen" means. A version that saved for itself could
 * only ever have served the second, and the first is where these settings belong.
 *
 * `value` may be `null` so a caller can express "nothing picked yet". Tapping the
 * active option calls `onChange(null)` when `clearable`, which the filing form
 * wants (a mis-tap should be undoable before saving) and the detail screen does
 * not (a document already has a category; there is no un-filing it).
 */
export interface ChipOption<T extends string> {
  value: T;
  label: string;
  /** Shown under the row when this option is the selected one. */
  hint?: string;
  /** Read out in place of `label` where the label alone is not self-explanatory. */
  accessibilityLabel?: string;
}

export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  clearable,
  disabled,
}: {
  options: ChipOption<T>[];
  value: T | null;
  onChange: (next: T | null) => void;
  clearable?: boolean;
  disabled?: boolean;
}) {
  const selected = options.find((option) => option.value === value) ?? null;

  return (
    <>
      <View style={styles.row}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => {
                if (disabled) return;
                if (!active) {
                  onChange(option.value);
                  return;
                }
                // Re-tapping the active option clears it when the caller allows
                // that, and is otherwise a no-op rather than a write that
                // changes nothing.
                if (clearable) onChange(null);
              }}
              style={[
                styles.chip,
                active ? styles.chipActive : null,
                disabled ? styles.chipDisabled : null,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: Boolean(disabled) }}
              accessibilityLabel={option.accessibilityLabel ?? option.label}
            >
              <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/*
        The hint describes the choice already made rather than listing all of
        them, which is the moment a person actually wants to read it — and it
        keeps a six-option row from arriving as a wall of explanatory text.
      */}
      {selected?.hint ? <Text style={styles.hint}>{selected.hint}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
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
    marginBottom: theme.spacing.sm,
  },
});
