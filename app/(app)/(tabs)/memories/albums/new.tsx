import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../../../src/components/Button';
import { ChipGroup, type ChipOption } from '../../../../../src/components/ChipGroup';
import { LockedNotice } from '../../../../../src/components/LockedNotice';
import { TextField } from '../../../../../src/components/TextField';
import { getSupabase } from '../../../../../src/lib/supabase';
import { useFamily } from '../../../../../src/providers/FamilyProvider';
import {
  ALBUM_VISIBILITIES,
  ALBUM_VISIBILITY_HINTS,
  ALBUM_VISIBILITY_LABELS,
  createAlbum,
  createSupabaseAlbumGateway,
  type AlbumVisibility,
} from '../../../../../src/services/album';
import { canWriteRecords } from '../../../../../src/services/role';
import { theme } from '../../../../../src/theme';

/**
 * Making an album: a name, and who may look through it.
 *
 * Two fields, and it stays two. Memories are added from a memory — that is
 * where somebody already is when they think "this belongs with the others" —
 * and a picker here would ask them to remember what is in a list they are not
 * looking at.
 */
export default function NewAlbumScreen() {
  const { family, role } = useFamily();

  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<AlbumVisibility>('family');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!family) return null;

  if (!canWriteRecords(role)) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <LockedNotice body="Guests cannot make albums. Ask an owner or admin if you would like to gather memories together." />
      </ScrollView>
    );
  }

  const options: ChipOption<AlbumVisibility>[] = ALBUM_VISIBILITIES.map((value) => ({
    value,
    label: ALBUM_VISIBILITY_LABELS[value],
    hint: ALBUM_VISIBILITY_HINTS[value],
  }));

  const handleCreate = async () => {
    setBusy(true);
    setError(null);

    const outcome = await createAlbum(createSupabaseAlbumGateway(getSupabase()), {
      familyId: family.id,
      title,
      visibility,
    });

    setBusy(false);

    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }

    // `replace`, so going back lands on the album list rather than on a form
    // still holding what was just created.
    router.replace({
      pathname: '/(app)/(tabs)/memories/albums/[albumId]',
      params: { albumId: outcome.album.id },
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TextField
        label="Name"
        value={title}
        onChangeText={setTitle}
        placeholder="Summer at the lake"
        editable={!busy}
      />

      <Field label="Who can see it">
        <ChipGroup
          options={options}
          value={visibility}
          onChange={(next) => next && setVisibility(next)}
          disabled={busy}
        />
      </Field>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button label="Make it" onPress={() => void handleCreate()} busy={busy} />
    </ScrollView>
  );
}

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
