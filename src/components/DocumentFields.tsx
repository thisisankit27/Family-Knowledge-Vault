import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  AI_PROCESSING_LABELS,
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  DOCUMENT_CATEGORIES,
  DOCUMENT_VISIBILITIES,
  VISIBILITY_HINTS,
  VISIBILITY_LABELS,
  type AiProcessing,
  type DocumentCategory,
  type DocumentVisibility,
} from '../services/document';
import { theme } from '../theme';
import { ChipGroup, type ChipOption } from './ChipGroup';

/**
 * The four settings a document carries, each owned by exactly one component.
 *
 * **This file is the answer to a defect, not a refactor for its own sake.** Two
 * screens independently decided what settings a document has — the filing form
 * (title and category) and the detail screen (subject, category, AI consent, and
 * after PR-15a visibility). They had already drifted: consent could only be set
 * *after* filing, and visibility only ever existed on one of them. Duplicated
 * ownership of one decision always ends there.
 *
 * So each field is one component, and the two screens compose the same four. The
 * screens keep owning what *saving* means, which is the part that genuinely
 * differs: a document that does not exist yet cannot be written to per-field, and
 * one that does should not need a Save button to move it between shelves.
 *
 * Every field is **controlled** for that reason. None of them touches a gateway.
 */

export function CategoryField({
  value,
  onChange,
  clearable,
  disabled,
}: {
  value: DocumentCategory | null;
  onChange: (next: DocumentCategory | null) => void;
  clearable?: boolean;
  disabled?: boolean;
}) {
  /*
    All six are always offered, unlike the library's filter row which hides
    empty shelves. Filtering is about what exists; filing is about what could,
    and hiding an unused shelf here would make the first document of a kind
    impossible to file.
  */
  const options: ChipOption<DocumentCategory>[] = DOCUMENT_CATEGORIES.map((category) => ({
    value: category,
    label: CATEGORY_LABELS[category],
    hint: CATEGORY_HINTS[category],
  }));

  return (
    <ChipGroup
      options={options}
      value={value}
      onChange={onChange}
      clearable={clearable}
      disabled={disabled}
    />
  );
}

export function VisibilityField({
  value,
  onChange,
  disabled,
}: {
  value: DocumentVisibility;
  onChange: (next: DocumentVisibility) => void;
  disabled?: boolean;
}) {
  const options: ChipOption<DocumentVisibility>[] = DOCUMENT_VISIBILITIES.map((visibility) => ({
    value: visibility,
    label: VISIBILITY_LABELS[visibility],
    hint: VISIBILITY_HINTS[visibility],
    accessibilityLabel: `${VISIBILITY_LABELS[visibility]}. ${VISIBILITY_HINTS[visibility]}`,
  }));

  return (
    <ChipGroup
      options={options}
      value={value}
      // Never clearable: a document always has a visibility, and "none" would be
      // a state the column cannot hold. The non-null cast is safe for exactly
      // that reason — `clearable` is not passed, so null cannot be produced.
      onChange={(next) => next && onChange(next)}
      disabled={disabled}
    />
  );
}

/**
 * Whose document it is — a label, and nothing more.
 *
 * "The whole family" is offered first and is a real answer rather than an escape
 * hatch: a deed or a utility connection belongs to no one person, and forcing it
 * onto somebody would be worse than leaving it unattributed.
 *
 * The sentence underneath is the fix for the confusion that caused a privilege
 * escalation. Until `20260810090000` this field granted read *and* write to
 * whoever it named. Saying plainly that it no longer does is cheaper than letting
 * the next person rediscover it the way the last one did — and after PR-15a there
 * is a control directly below it that *does* decide access, which makes the
 * distinction worth stating twice rather than once.
 */
export function SubjectField({
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
      <Text style={styles.hint}>
        Just a label. It does not change who can open this.
      </Text>
    </>
  );
}

/**
 * Whether AI may read this document.
 *
 * Two presentations, and which one you get depends on whether the decision is
 * yours. **The author is asked; everybody else is told.** A disabled checkbox
 * tries to be both and manages neither — it asks a question, shows an answer,
 * and refuses the interaction it just invited, leaving a reader unable to tell it
 * from one that is broken or still loading.
 *
 * That was a real defect, found on a device during PR-15a's review, and it is the
 * reason this component takes `readOnly` rather than `disabled`. The two words
 * describe different intents and only one of them is ever right here.
 *
 * Never says "AI cannot read this". The server can read the bytes; this is a
 * consent flag kept by code, and the control that would be a guarantee is
 * Phase 11's encryption.
 */
export function AiConsentField({
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
        <Text style={styles.hint}>Chosen by whoever filed it. Nothing reads it yet.</Text>
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
