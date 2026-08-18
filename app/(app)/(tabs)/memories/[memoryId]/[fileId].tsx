import { Ionicons } from '@expo/vector-icons';
import { Directory, File, Paths } from 'expo-file-system';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '../../../../../src/components/Button';
import { VoicePlayer } from '../../../../../src/components/VoiceNote';
import { getSupabaseEnv } from '../../../../../src/lib/env';
import { formatRelativeTime } from '../../../../../src/lib/relativeTime';
import { getSupabase } from '../../../../../src/lib/supabase';
import { useAuth } from '../../../../../src/providers/AuthProvider';
import { useFamily } from '../../../../../src/providers/FamilyProvider';
import {
  createSupabaseMemoryGateway,
  getMemory,
  type FamilyMemory,
} from '../../../../../src/services/memory';
import { canWriteRecords } from '../../../../../src/services/role';
import {
  MEMORY_FILES,
  createSupabaseStorageGateway,
  downloadFilenameFor,
  fileUrl,
  formatBytes,
  isAudio,
  listRecordFiles,
  removeRecordFile,
  shareRecordFile,
  type RecordFile,
} from '../../../../../src/services/storage';
import { theme } from '../../../../../src/theme';

/**
 * One photograph, full width, and the two ways it leaves.
 *
 * Follows `documents/[documentId]/[fileId].tsx` closely, because the problems
 * are the same ones and they were solved there: mint a URL rather than store
 * one, re-mint exactly once when the image fails, download into the cache rather
 * than into documents, and hand the file to the share sheet rather than
 * inventing a "download" a phone has no folder for.
 *
 * Two differences, both because a photograph is not a document. There is no
 * `isPreviewable` branch — everything a memory accepts is an image, enforced by
 * `MEMORY_FILES.acceptedMimeTypes`, so the PDF fallback that screen needs cannot
 * arise here. And the picture is the screen rather than a preview above the
 * metadata: `docs/10` §4 asks for a family album, and an album shows you the
 * photograph.
 *
 * **Not a dark lightbox.** `theme.ts` is light-only by decision (PR-14b), and a
 * dark viewer would be the first screen to break it.
 */
export default function MemoryPhotoScreen() {
  const { memoryId, fileId } = useLocalSearchParams<{ memoryId: string; fileId: string }>();
  const { role } = useFamily();
  const { session } = useAuth();

  const [memory, setMemory] = useState<FamilyMemory | null>(null);
  const [file, setFile] = useState<RecordFile | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [retried, setRetried] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gateway = useCallback(
    () => createSupabaseStorageGateway(getSupabase(), { url: getSupabaseEnv().url }, MEMORY_FILES),
    [],
  );

  const mint = useCallback(
    async (target: RecordFile) => {
      const minted = await fileUrl(gateway(), target);
      if (!minted.ok) {
        setError(minted.message);
        return;
      }
      setUrl(minted.url);
    },
    [gateway],
  );

  // Loads once. There is no route back into this screen without remounting it,
  // so `useFocusEffect` would only re-mint a URL that has not expired.
  useEffect(() => {
    void (async () => {
      const owning = await getMemory(createSupabaseMemoryGateway(getSupabase()), memoryId);
      if (!owning.ok) {
        setError(owning.message);
        setLoading(false);
        return;
      }
      setMemory(owning.memory);

      const listed = await listRecordFiles(gateway(), memoryId);
      if (!listed.ok) {
        setError(listed.message);
        setLoading(false);
        return;
      }

      const found = listed.files.find((candidate) => candidate.id === fileId) ?? null;
      if (!found) {
        setError('That photo is no longer available.');
        setLoading(false);
        return;
      }

      setFile(found);
      await mint(found);
      setLoading(false);
    })();
  }, [memoryId, fileId, gateway, mint]);

  async function handleShare() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await shareRecordFile(
        gateway(),
        file,
        async (signedUrl, filename) => {
          // Into the cache, not documents: this copy exists to hand to another
          // app, and the OS may reclaim it whenever it likes.
          const downloaded = await File.downloadFileAsync(
            signedUrl,
            new File(new Directory(Paths.cache), filename),
            { idempotent: true },
          );
          return downloaded.uri;
        },
        async (localUri, mimeType) => {
          if (!(await Sharing.isAvailableAsync())) {
            throw new Error('sharing unavailable');
          }
          await Sharing.shareAsync(localUri, { mimeType, UTI: mimeType });
        },
      );
      if (!result.ok) setError(result.message);
    } finally {
      setBusy(false);
    }
  }

  function confirmRemove() {
    if (!file) return;
    Alert.alert('Remove this photo?', 'The memory stays; only the photograph goes.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const result = await removeRecordFile(gateway(), file);
            if (!result.ok) {
              setError(result.message);
              return;
            }
            // Back to the memory: there is nothing left on this screen.
            router.back();
          })();
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (!file) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.error}>{error ?? 'That photo is no longer available.'}</Text>
      </ScrollView>
    );
  }

  // Author-only, matching the row policies. A reader of a family memory may open
  // this photograph and share it out; removing it is the author's alone, and the
  // storage DELETE policy would refuse anyone else regardless.
  const isAuthor = memory?.createdBy != null && memory.createdBy === session?.user.id;
  const canEdit = isAuthor && canWriteRecords(role);

  return (
    <>
      <Stack.Screen options={{ title: memory?.title ?? 'Photo' }} />
      <ScrollView contentContainerStyle={styles.content}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/*
          Voice notes normally play inline on the memory screen and never route
          here. This branch exists so a hand-typed or stale link lands on a
          player rather than on a blank frame trying to render audio as a
          picture — a broken state nobody would understand.
        */}
        {isAudio(file.mimeType) ? (
          <VoicePlayer url={url} durationSeconds={file.durationSeconds} />
        ) : (
        <View style={styles.frame}>
          {url ? (
            <Image
              source={{ uri: url }}
              style={styles.image}
              resizeMode="contain"
              onError={() => {
                // One re-mint, then stop. A signed URL lasts 300 seconds and a
                // screen left open outlives it; a second failure is a real one,
                // and retrying forever would hammer storage behind a broken image.
                if (retried) {
                  setError('That photo could not be loaded.');
                  return;
                }
                setRetried(true);
                void mint(file);
              }}
            />
          ) : (
            <ActivityIndicator color={theme.colors.primary} />
          )}
        </View>
        )}

        <Text style={styles.meta}>
          {formatBytes(file.sizeBytes)} · added {formatRelativeTime(file.createdAt)}
        </Text>

        <Button label="Share" onPress={() => void handleShare()} busy={busy} />

        {canEdit ? (
          <Pressable onPress={confirmRemove} style={styles.remove} accessibilityRole="button">
            <Ionicons name="trash-outline" size={18} color={theme.colors.error} />
            <Text style={styles.removeText}>Remove this photo</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </>
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
  frame: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  meta: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
  },
  remove: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.md,
  },
  removeText: {
    color: theme.colors.error,
    fontSize: theme.typography.body,
  },
  error: {
    color: theme.colors.error,
    fontSize: theme.typography.caption,
  },
});
