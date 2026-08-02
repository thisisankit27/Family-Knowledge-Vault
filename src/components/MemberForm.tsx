import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from './Button';
import { TextField } from './TextField';
import {
  BLOOD_GROUPS,
  MAX_NAME_LENGTH,
  type BloodGroup,
  type MemberInput,
  type MemberOutcome,
} from '../services/member';
import { theme } from '../theme';

interface MemberFormProps {
  initial?: MemberInput;
  submitLabel: string;
  onSubmit: (input: MemberInput) => Promise<MemberOutcome>;
  onSaved: () => void;
}

/**
 * Add or edit a person. One form, both jobs — the fields are identical and the
 * only difference is which service function it calls.
 *
 * Only a name is required. Most people recorded here are relatives somebody is
 * adding on their behalf, and demanding a birthday for a great-grandmother
 * nobody has the date for would simply stop them being added at all.
 */
export function MemberForm({ initial, submitLabel, onSubmit, onSaved }: MemberFormProps) {
  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [dateOfBirth, setDateOfBirth] = useState(initial?.dateOfBirth ?? '');
  const [bloodGroup, setBloodGroup] = useState<BloodGroup | null>(initial?.bloodGroup ?? null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Extract<MemberOutcome, { ok: false }> | null>(null);

  async function handleSubmit() {
    setBusy(true);
    setFailure(null);
    try {
      const result = await onSubmit({ displayName, dateOfBirth, bloodGroup });
      if (!result.ok) {
        setFailure(result);
        return;
      }
      onSaved();
    } catch (error) {
      setFailure({
        ok: false,
        message: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <TextField
        label="Name"
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="Nani"
        error={failure?.field === 'displayName' ? failure.message : undefined}
        maxLength={MAX_NAME_LENGTH}
        editable={!busy}
        autoCapitalize="words"
      />

      <TextField
        label="Date of birth (optional)"
        value={dateOfBirth ?? ''}
        onChangeText={setDateOfBirth}
        placeholder="1948-03-12"
        error={failure?.field === 'dateOfBirth' ? failure.message : undefined}
        editable={!busy}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="numbers-and-punctuation"
      />

      <View style={styles.group}>
        <Text style={styles.groupLabel}>Blood group (optional)</Text>
        <View style={styles.pills}>
          {BLOOD_GROUPS.map((group) => {
            const selected = bloodGroup === group;
            return (
              <Pressable
                key={group}
                // Tapping the selected one clears it — otherwise a mistaken
                // choice can never be undone without leaving the screen.
                onPress={() => setBloodGroup(selected ? null : group)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Blood group ${group}`}
                style={({ pressed }) => [
                  styles.pill,
                  selected && styles.pillSelected,
                  pressed && styles.pillPressed,
                ]}
              >
                <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                  {group}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Errors with no field of their own — permissions, network. */}
      {!!failure && !failure.field && (
        <Text style={styles.error} accessibilityRole="alert">
          {failure.message}
        </Text>
      )}

      <Button label={submitLabel} onPress={handleSubmit} busy={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: theme.spacing.md,
  },
  group: {
    gap: theme.spacing.sm,
  },
  groupLabel: {
    fontSize: theme.typography.caption,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: theme.colors.textMuted,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  pill: {
    minWidth: 56,
    minHeight: theme.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  pillSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primarySoft,
  },
  pillPressed: {
    opacity: 0.7,
  },
  pillText: {
    fontSize: theme.typography.body,
    color: theme.colors.text,
  },
  pillTextSelected: {
    fontWeight: '700',
    color: theme.colors.primary,
  },
  error: {
    fontSize: theme.typography.body,
    color: theme.colors.error,
  },
});
