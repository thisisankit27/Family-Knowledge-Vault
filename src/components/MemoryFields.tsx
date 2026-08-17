import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  AI_PROCESSING_LABELS,
  MEMORY_PRECISIONS,
  MEMORY_VISIBILITIES,
  PRECISION_LABELS,
  PRECISION_PLACEHOLDERS,
  UNKNOWN_DATE_LABEL,
  VISIBILITY_HINTS,
  VISIBILITY_LABELS,
  type AiProcessing,
  type MemoryPrecision,
  type MemoryVisibility,
} from '../services/memory';
import { theme } from '../theme';
import { ChipGroup, type ChipOption } from './ChipGroup';
import { TextField } from './TextField';

/**
 * The settings a memory carries, each owned by exactly one component.
 *
 * The same arrangement `DocumentFields.tsx` arrived at in PR-15b, and for the
 * same reason: two screens (the create form and the detail screen) offer the
 * same choices, and the last time each decided independently what a record has,
 * they drifted — consent could only be set after filing, and visibility existed
 * on only one of them.
 *
 * Every field is **controlled** and none of them touches a gateway. The screens
 * keep owning what *saving* means, which is the part that genuinely differs: a
 * memory that does not exist yet cannot be written to per-field.
 *
 * **On the duplication with `DocumentFields.tsx`.** `MemorySubjectField` and
 * `MemoryAiConsentField` are near-twins of their document counterparts. They are
 * not shared yet, deliberately: the two differ in vocabulary that matters
 * ("filed" vs "kept"), extracting a common component would mean editing the
 * document screens inside a PR that is about memories, and two callers is the
 * point at which a shared abstraction is a guess. PR-20 adds albums and with
 * them the third caller — that is the moment to extract, and it is recorded in
 * `docs/18` rather than left to be noticed.
 */

/** Who may open this memory. */
export function MemoryVisibilityField({
  value,
  onChange,
  disabled,
}: {
  value: MemoryVisibility;
  onChange: (next: MemoryVisibility) => void;
  disabled?: boolean;
}) {
  const options: ChipOption<MemoryVisibility>[] = MEMORY_VISIBILITIES.map((visibility) => ({
    value: visibility,
    label: VISIBILITY_LABELS[visibility],
    hint: VISIBILITY_HINTS[visibility],
    accessibilityLabel: `${VISIBILITY_LABELS[visibility]}. ${VISIBILITY_HINTS[visibility]}`,
  }));

  return (
    <ChipGroup
      options={options}
      value={value}
      // Never clearable: a memory always has a visibility, and "none" would be a
      // state the column cannot hold. The guard is what makes the type safe.
      onChange={(next) => next && onChange(next)}
      disabled={disabled}
    />
  );
}

/**
 * When it happened, and how much of that anybody actually knows.
 *
 * Four choices where the column has three values, because "I don't remember" is
 * the absence of a date rather than a coarser one — it clears `occurred_on` and
 * leaves the precision alone.
 *
 * The text field changes shape with the choice above it, which is the whole
 * point: asking for `YYYY-MM-DD` when somebody only knows the year is how a form
 * talks a person out of recording what they do know.
 */
export function MemoryDateField({
  text,
  precision,
  onChange,
  error,
  disabled,
}: {
  text: string;
  /** `null` means the date is unknown. */
  precision: MemoryPrecision | null;
  onChange: (next: { text: string; precision: MemoryPrecision | null }) => void;
  error?: string;
  disabled?: boolean;
}) {
  const UNKNOWN = '__unknown__';

  const options: ChipOption<string>[] = [
    ...MEMORY_PRECISIONS.map((value) => ({
      value: value as string,
      label: PRECISION_LABELS[value],
    })),
    { value: UNKNOWN, label: UNKNOWN_DATE_LABEL },
  ];

  return (
    <>
      <ChipGroup
        options={options}
        value={precision ?? UNKNOWN}
        onChange={(next) => {
          if (!next || next === UNKNOWN) {
            // Clear the text too. Leaving "1998" behind an "I don't remember"
            // chip is a form quietly holding a value it is no longer showing.
            onChange({ text: '', precision: null });
            return;
          }
          onChange({ text, precision: next as MemoryPrecision });
        }}
        disabled={disabled}
      />

      {precision ? (
        <TextField
          label={`When (${PRECISION_PLACEHOLDERS[precision]})`}
          value={text}
          onChangeText={(next) => onChange({ text: next, precision })}
          placeholder={PRECISION_PLACEHOLDERS[precision]}
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!disabled}
          error={error}
        />
      ) : (
        <Text style={styles.hint}>
          It will sit at the end of the list, under &ldquo;Date unknown&rdquo;.
        </Text>
      )}
    </>
  );
}

/**
 * Who this memory is about — a label, and nothing more.
 *
 * "The whole family" leads and is a real answer rather than an escape hatch: a
 * holiday belongs to everyone who was there.
 *
 * The sentence underneath is the same one documents carry, for the same reason.
 * `can_see_record` has a branch that would give a private record to its subject,
 * and `20260810090000` proved what happens when a record table uses it. Memories
 * pass `null` in that position, so this grants nothing — and saying so is
 * cheaper than letting the next person rediscover it the way the last one did.
 */
export function MemorySubjectField({
  value,
  people,
  onChange,
  disabled,
}: {
  value: string | null;
  people: { id: string; displayName: string }[];
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  const WHOLE_FAMILY = '__family__';

  const options: ChipOption<string>[] = [
    { value: WHOLE_FAMILY, label: 'The whole family' },
    ...people.map((person) => ({ value: person.id, label: person.displayName })),
  ];

  return (
    <>
      <ChipGroup
        options={options}
        value={value ?? WHOLE_FAMILY}
        onChange={(next) => onChange(next === WHOLE_FAMILY || next === null ? null : next)}
        disabled={disabled}
      />
      <Text style={styles.hint}>Just a label. It does not change who can open this.</Text>
    </>
  );
}

/**
 * Whether AI may read this memory.
 *
 * Two presentations, and which one you get depends on whether the decision is
 * yours. **The author is asked; everybody else is told.** A disabled checkbox
 * tries to be both and manages neither — it asks a question, shows an answer,
 * and refuses the interaction it just invited.
 *
 * That was a real defect found on a device during PR-15a, and it is why this
 * takes `readOnly` rather than `disabled`. Memories reach a second audience more
 * often than documents do, because they default to `family` — so this is the
 * first table where the read-only path is the common one rather than the
 * exception.
 *
 * Never says "AI cannot read this". The server can read the words; this is a
 * consent flag kept by code.
 */
export function MemoryAiConsentField({
  value,
  onChange,
  readOnly,
}: {
  value: AiProcessing;
  onChange: (next: AiProcessing) => void;
  readOnly?: boolean;
}) {
  if (readOnly) {
    return (
      <>
        <Text style={styles.value}>{AI_PROCESSING_LABELS[value]}</Text>
        <Text style={styles.hint}>Chosen by whoever kept it. Nothing reads it yet.</Text>
      </>
    );
  }

  const on = value === 'allowed';

  return (
    <Pressable
      onPress={() => onChange(on ? 'denied' : 'allowed')}
      style={styles.toggle}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
    >
      <Ionicons
        name={on ? 'checkbox' : 'square-outline'}
        size={22}
        color={on ? theme.colors.primary : theme.colors.textMuted}
      />
      <View style={styles.toggleText}>
        <Text style={styles.value}>Let AI read this</Text>
        <Text style={styles.hint}>Used later to search and organise. Nothing reads it yet.</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  value: {
    color: theme.colors.text,
    fontSize: theme.typography.body,
  },
  hint: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    marginTop: 2,
    marginBottom: theme.spacing.sm,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.sm,
  },
  toggleText: {
    flex: 1,
  },
});
