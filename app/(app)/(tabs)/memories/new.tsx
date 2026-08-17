import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../../src/components/Button';
import { LockedNotice } from '../../../../src/components/LockedNotice';
import {
  MemoryAiConsentField,
  MemoryDateField,
  MemorySubjectField,
  MemoryVisibilityField,
} from '../../../../src/components/MemoryFields';
import { TextField } from '../../../../src/components/TextField';
import { getSupabase } from '../../../../src/lib/supabase';
import { useFamily } from '../../../../src/providers/FamilyProvider';
import {
  createSupabaseMemberGateway,
  listMembers,
  type Member,
} from '../../../../src/services/member';
import {
  createMemory,
  createSupabaseMemoryGateway,
  parseOccurredOn,
  type AiProcessing,
  type MemoryPrecision,
  type MemoryVisibility,
} from '../../../../src/services/memory';
import { canWriteRecords } from '../../../../src/services/role';
import { theme } from '../../../../src/theme';

/**
 * Keeping a memory: one screen, one act, one save.
 *
 * The field order is deliberate and reads as a sentence somebody would say:
 * *what happened → when → where → who it is about → who may see it → may a
 * machine read it.* The story sits directly under the title because it is the
 * memory; everything below it is filing.
 *
 * **Nothing is written until "Keep it".** No draft row, no autosave. A half-
 * written memory that already exists in the list is worse than one that does
 * not exist yet, and the detail screen — which saves per field — is where a
 * memory that *does* exist gets edited.
 */
export default function NewMemoryScreen() {
  const { family, role } = useFamily();

  const [title, setTitle] = useState('');
  const [story, setStory] = useState('');
  const [dateText, setDateText] = useState('');
  const [precision, setPrecision] = useState<MemoryPrecision | null>('day');
  const [location, setLocation] = useState('');
  const [memberId, setMemberId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<MemoryVisibility>('family');
  const [aiProcessing, setAiProcessing] = useState<AiProcessing>('denied');

  const [people, setPeople] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | undefined>(undefined);

  // Loads once. This screen cannot be returned to without being remounted, so
  // `useFocusEffect` would buy nothing here.
  useEffect(() => {
    if (!family) return;
    void (async () => {
      setPeople(await listMembers(createSupabaseMemberGateway(getSupabase()), family.id));
    })();
  }, [family]);

  if (!family) return null;

  if (!canWriteRecords(role)) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <LockedNotice body="Guests cannot keep memories. Ask an owner or admin if you would like to add to this family's story." />
      </ScrollView>
    );
  }

  const handleKeep = async () => {
    setBusy(true);
    setError(null);
    setDateError(undefined);

    // Parsed before the round trip so the message names what was typed rather
    // than what Postgres makes of it, and so a bad date lands on the field that
    // produced it instead of in the banner at the bottom.
    let occurredOn: string | null = null;
    if (precision) {
      const parsed = parseOccurredOn(dateText, precision);
      if ('message' in parsed) {
        setDateError(parsed.message);
        setBusy(false);
        return;
      }
      occurredOn = parsed.occurredOn;
    }

    const outcome = await createMemory(createSupabaseMemoryGateway(getSupabase()), {
      familyId: family.id,
      title,
      story,
      occurredOn,
      occurredPrecision: precision ?? 'day',
      location,
      memberId,
      visibility,
      aiProcessing,
    });

    setBusy(false);

    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }

    // `replace`, not `push`: going back from the memory should return to the
    // list, not to a form still holding what was just saved.
    router.replace({
      pathname: '/(app)/(tabs)/memories/[memoryId]',
      params: { memoryId: outcome.memory.id },
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TextField
        label="What happened"
        value={title}
        onChangeText={setTitle}
        placeholder="Diwali at Nani's house"
        editable={!busy}
      />

      <TextField
        label="The story"
        value={story}
        onChangeText={setStory}
        placeholder="Write as much or as little as you like."
        multiline
        numberOfLines={6}
        style={styles.story}
        textAlignVertical="top"
        editable={!busy}
      />

      <Field label="When">
        <MemoryDateField
          text={dateText}
          precision={precision}
          onChange={(next) => {
            setDateText(next.text);
            setPrecision(next.precision);
            setDateError(undefined);
          }}
          error={dateError}
          disabled={busy}
        />
      </Field>

      <TextField
        label="Where"
        value={location}
        onChangeText={setLocation}
        placeholder="Nani's house"
        editable={!busy}
      />

      <Field label="Who it is about">
        <MemorySubjectField
          value={memberId}
          people={people}
          onChange={setMemberId}
          disabled={busy}
        />
      </Field>

      <Field label="Who can see it">
        <MemoryVisibilityField value={visibility} onChange={setVisibility} disabled={busy} />
      </Field>

      <Field label="AI">
        <MemoryAiConsentField value={aiProcessing} onChange={setAiProcessing} />
      </Field>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button label="Keep it" onPress={() => void handleKeep()} busy={busy} />
    </ScrollView>
  );
}

/**
 * The same label-over-content row the detail screen uses.
 *
 * Duplicated in both screens rather than extracted, matching what `documents`
 * already does — three callers is when this becomes a component, and PR-20 is
 * where the third arrives.
 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
  },
  story: {
    minHeight: 120,
  },
  field: {
    gap: theme.spacing.sm,
  },
  fieldLabel: {
    fontSize: theme.typography.caption,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: theme.colors.textMuted,
  },
  error: {
    color: theme.colors.error,
    fontSize: theme.typography.caption,
  },
});
