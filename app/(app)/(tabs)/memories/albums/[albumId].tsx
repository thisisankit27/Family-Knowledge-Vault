import { Ionicons } from '@expo/vector-icons';
import { Link, Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '../../../../../src/components/Button';
import { ChipGroup, type ChipOption } from '../../../../../src/components/ChipGroup';
import { TextField } from '../../../../../src/components/TextField';
import { getSupabase } from '../../../../../src/lib/supabase';
import { useAuth } from '../../../../../src/providers/AuthProvider';
import { useFamily } from '../../../../../src/providers/FamilyProvider';
import {
  ALBUM_VISIBILITIES,
  ALBUM_VISIBILITY_HINTS,
  ALBUM_VISIBILITY_LABELS,
  createSupabaseAlbumGateway,
  deleteAlbum,
  describeAlbumSize,
  getAlbum,
  listAlbumEntries,
  memoriesInAlbum,
  removeMemoryFromAlbum,
  renameAlbum,
  setAlbumVisibility,
  type Album,
  type AlbumEntry,
  type AlbumVisibility,
} from '../../../../../src/services/album';
import { describeMemoryDate } from '../../../../../src/services/memory';
import { canWriteRecords } from '../../../../../src/services/role';
import { theme } from '../../../../../src/theme';

/**
 * One album, and what is in it *for this reader*.
 *
 * The list is whatever the both-ends policy returns — so an album containing
 * memories you may not read simply shows fewer, and the count above it is
 * computed from the same list rather than stored. There is nothing on this
 * screen that says "and 3 more you cannot see", because that sentence is the
 * disclosure the whole design avoids.
 */
export default function AlbumScreen() {
  const { albumId } = useLocalSearchParams<{ albumId: string }>();
  const { family, role } = useFamily();
  const { session } = useAuth();

  const [album, setAlbum] = useState<Album | null>(null);
  const [entries, setEntries] = useState<AlbumEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const familyId = family?.id ?? null;

  const load = useCallback(async () => {
    const gateway = createSupabaseAlbumGateway(getSupabase());
    const found = await getAlbum(gateway, albumId);

    if (!found.ok) {
      setError(found.message);
      setAlbum(null);
      setLoading(false);
      return;
    }

    setError(null);
    setAlbum(found.album);

    if (familyId) {
      const contents = await listAlbumEntries(gateway, familyId);
      setEntries(contents.ok ? contents.entries : []);
    }
    setLoading(false);
  }, [albumId, familyId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (!album) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.error}>{error ?? 'That album is no longer available.'}</Text>
      </ScrollView>
    );
  }

  const isAuthor = album.createdBy !== null && album.createdBy === session?.user.id;
  const canEdit = isAuthor && canWriteRecords(role);
  const contents = memoriesInAlbum(entries, album.id);

  const visibilityOptions: ChipOption<AlbumVisibility>[] = ALBUM_VISIBILITIES.map((value) => ({
    value,
    label: ALBUM_VISIBILITY_LABELS[value],
    hint: ALBUM_VISIBILITY_HINTS[value],
  }));

  function confirmDelete() {
    Alert.alert(
      'Delete this album?',
      // The sentence people most need before tapping. It is also true: the
      // cascade is on the link table, and memories are referenced, not owned.
      'The memories in it are kept — only the album goes.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const outcome = await deleteAlbum(createSupabaseAlbumGateway(getSupabase()), album!.id);
              if (!outcome.ok) {
                setError(outcome.message);
                return;
              }
              router.back();
            })();
          },
        },
      ],
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: album.title }} />
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {editingTitle ? (
          <Field label="Name">
            <TextField
              label="Name"
              value={draftTitle}
              onChangeText={setDraftTitle}
              editable={!busy}
              autoFocus
            />
            <View style={styles.editActions}>
              <Button
                label="Save"
                busy={busy}
                onPress={() => {
                  void (async () => {
                    setBusy(true);
                    const outcome = await renameAlbum(
                      createSupabaseAlbumGateway(getSupabase()),
                      album.id,
                      draftTitle,
                    );
                    setBusy(false);
                    if (!outcome.ok) {
                      setError(outcome.message);
                      return;
                    }
                    setError(null);
                    setEditingTitle(false);
                    await load();
                  })();
                }}
              />
              <Button label="Cancel" variant="quiet" onPress={() => setEditingTitle(false)} />
            </View>
          </Field>
        ) : (
          <Pressable
            onPress={() => {
              if (!canEdit) return;
              setDraftTitle(album.title);
              setEditingTitle(true);
            }}
            accessibilityRole={canEdit ? 'button' : undefined}
          >
            <Text style={styles.title}>{album.title}</Text>
          </Pressable>
        )}

        <Text style={styles.count}>{describeAlbumSize(contents.length)}</Text>

        <Field label="Who can see it">
          {canEdit ? (
            <ChipGroup
              options={visibilityOptions}
              value={album.visibility}
              onChange={(next) => {
                if (!next) return;
                void (async () => {
                  const outcome = await setAlbumVisibility(
                    createSupabaseAlbumGateway(getSupabase()),
                    album.id,
                    next,
                  );
                  if (!outcome.ok) {
                    setError(outcome.message);
                    return;
                  }
                  setError(null);
                  await load();
                })();
              }}
            />
          ) : (
            // Told, not asked — the two-audience rule. An album defaults to
            // `family`, so a reader who is not the author is the common case.
            <Text style={styles.value}>{ALBUM_VISIBILITY_LABELS[album.visibility]}</Text>
          )}
        </Field>

        {contents.length === 0 ? (
          <Text style={styles.empty}>
            Nothing in this album yet. Open a memory and add it from there.
          </Text>
        ) : null}

        {contents.map((entry) => (
          <View key={entry.memoryId} style={styles.row}>
            <Link
              href={{
                pathname: '/(app)/(tabs)/memories/[memoryId]',
                params: { memoryId: entry.memoryId },
              }}
              asChild
            >
              <Pressable style={styles.rowBody} accessibilityRole="button">
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {entry.memoryTitle}
                </Text>
                <Text style={styles.rowMeta}>
                  {describeMemoryDate({
                    occurredOn: entry.occurredOn,
                    occurredPrecision: entry.occurredPrecision,
                  })}
                  {entry.memoryVisibility === 'private' ? ' · Only me' : ''}
                </Text>
              </Pressable>
            </Link>

            {canEdit ? (
              <Pressable
                onPress={() => {
                  void (async () => {
                    const outcome = await removeMemoryFromAlbum(
                      createSupabaseAlbumGateway(getSupabase()),
                      album.id,
                      entry.memoryId,
                    );
                    if (!outcome.ok) {
                      setError(outcome.message);
                      return;
                    }
                    setError(null);
                    await load();
                  })();
                }}
                style={styles.remove}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${entry.memoryTitle} from this album`}
              >
                <Ionicons name="close" size={18} color={theme.colors.textMuted} />
              </Pressable>
            ) : null}
          </View>
        ))}

        {canEdit ? (
          <Pressable onPress={confirmDelete} style={styles.delete} accessibilityRole="button">
            <Ionicons name="trash-outline" size={18} color={theme.colors.error} />
            <Text style={styles.deleteText}>Delete this album</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </>
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
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.xxl,
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.typography.title,
    fontWeight: '700',
  },
  count: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    marginTop: -theme.spacing.sm,
  },
  value: {
    color: theme.colors.text,
    fontSize: theme.typography.body,
  },
  empty: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.body,
    fontStyle: 'italic',
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
  editActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  rowBody: {
    flex: 1,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  rowTitle: {
    color: theme.colors.text,
    fontSize: theme.typography.body,
    fontWeight: '600',
  },
  rowMeta: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
  },
  remove: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  delete: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.md,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingVertical: theme.spacing.md,
  },
  deleteText: {
    color: theme.colors.error,
    fontSize: theme.typography.body,
  },
  error: {
    color: theme.colors.error,
    fontSize: theme.typography.caption,
  },
});
