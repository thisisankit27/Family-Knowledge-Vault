import { Ionicons } from '@expo/vector-icons';
import { Directory, File, Paths } from 'expo-file-system';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../../../src/components/Button';
import { LockedNotice } from '../../../../../src/components/LockedNotice';
import { getSupabaseEnv } from '../../../../../src/lib/env';
import { formatRelativeTime } from '../../../../../src/lib/relativeTime';
import { getSupabase } from '../../../../../src/lib/supabase';
import { useAuth } from '../../../../../src/providers/AuthProvider';
import { useFamily } from '../../../../../src/providers/FamilyProvider';
import {
  createSupabaseDocumentGateway,
  getDocument,
  type FamilyDocument,
} from '../../../../../src/services/document';
import { canWriteRecords } from '../../../../../src/services/role';
import {
  createSupabaseStorageGateway,
  downloadFilenameFor,
  fileUrl,
  formatBytes,
  isPreviewable,
  listRecordFiles,
  removeRecordFile,
  shareRecordFile,
  type RecordFile,
} from '../../../../../src/services/storage';
import { theme } from '../../../../../src/theme';

/**
 * One attached file: what it is, and the two ways it leaves.
 *
 * The structure deliberately echoes the document detail screen — content, then
 * meta, then actions with the destructive one last — because a file is a
 * smaller version of the same idea and should not need relearning.
 *
 * **Not a dark full-bleed lightbox.** `src/theme.ts` is light-only by decision
 * ("a dark palette doubles every colour decision and belongs in a polish PR"),
 * and a viewer that went dark would be the first screen in the app to break
 * that. The stack header and the tab bar stay for the same reason the documents
 * layout gives: opening something should not feel like leaving the section.
 */
export default function FileViewerScreen() {
  const { documentId, fileId } = useLocalSearchParams<{ documentId: string; fileId: string }>();
  const { role } = useFamily();
  const { session } = useAuth();

  const [file, setFile] = useState<RecordFile | null>(null);
  /*
    Only ever read for its author, which is why it holds the whole row rather
    than a boolean: a screen that stored `canEdit` would be storing a conclusion,
    and the next person to need the document for anything else would fetch it a
    second time.

    Sharing is what makes this necessary. Before it, reaching this screen at all
    meant you had filed the document, so `canWriteRecords(role)` was a safe stand-in
    for authorship. Now a member can be looking at somebody else's file, and the
    role answers the wrong question — see the same correction on the detail screen.

    Hiding the control is not decoration. Under RLS a delete that matches no
    visible row **reports success**, so a Remove button left on screen for a
    reader would appear to work, remove nothing, and leave the file sitting there
    on the next load.
  */
  const [document, setDocument] = useState<FamilyDocument | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One retry, not a loop. A signed URL that expired while the screen was open
  // deserves a second attempt; one that fails twice is a real failure.
  const [retried, setRetried] = useState(false);

  const gateway = useCallback(
    () => createSupabaseStorageGateway(getSupabase(), { url: getSupabaseEnv().url }),
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

  useEffect(() => {
    void (async () => {
      // The file comes from the document's list rather than a fetch by id: the
      // rows are already governed by the author-only policy, and one query is
      // cheaper than adding a second read path for a single row.
      const result = await listRecordFiles(gateway(), documentId);
      if (!result.ok) {
        setError(result.message);
        setLoading(false);
        return;
      }

      const found = result.files.find((candidate) => candidate.id === fileId) ?? null;
      if (!found) {
        setError('That file is no longer available.');
        setLoading(false);
        return;
      }

      setFile(found);

      // Failure here is deliberately not an error the reader sees. The file
      // loaded, so it is theirs to open; not knowing who filed it costs them
      // only the Remove control, and the policy would refuse the removal anyway.
      const owning = await getDocument(createSupabaseDocumentGateway(getSupabase()), documentId);
      setDocument(owning.ok ? owning.document : null);

      if (isPreviewable(found.mimeType)) await mint(found);
      setLoading(false);
    })();
  }, [documentId, fileId, gateway, mint]);

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
    Alert.alert('Remove this file?', 'The document stays; only the file goes.', [
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
            // Back to the document: there is nothing left on this screen.
            router.back();
          })();
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (!file) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <LockedNotice body={error ?? 'That file is no longer available.'} />
      </ScrollView>
    );
  }

  const previewable = isPreviewable(file.mimeType);
  // The same two-part test the detail screen and the UPDATE policy both make:
  // you filed it, and your role still lets you write records.
  const isAuthor = document?.createdBy != null && document.createdBy === session?.user.id;
  const canEdit = isAuthor && canWriteRecords(role);

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Stack.Screen options={{ title: downloadFilenameFor(file) }} />

      {previewable ? (
        url ? (
          <Image
            source={{ uri: url }}
            style={styles.image}
            resizeMode="contain"
            accessibilityLabel={downloadFilenameFor(file)}
            // A signed URL can expire between minting and rendering. Re-mint
            // once — the TTL concept stays inside this handler rather than
            // spreading into every screen that shows a file (docs/17 §10.1).
            onError={() => {
              if (retried) {
                setError('That file could not be loaded.');
                return;
              }
              setRetried(true);
              void mint(file);
            }}
          />
        ) : (
          <View style={styles.imagePlaceholder}>
            <ActivityIndicator color={theme.colors.primary} />
          </View>
        )
      ) : (
        /*
          No blank box and no apology. Android's WebView cannot render a PDF,
          and Google's document viewer — the usual workaround — would send a
          family's private papers to Google. Opening in the reader the user
          already has is the honest answer, so it is stated as a fact rather
          than as a limitation.
        */
        <View style={styles.pdf}>
          <Ionicons name="document-text-outline" size={48} color={theme.colors.textMuted} />
          <Text style={styles.pdfTitle}>PDFs open in your own reader</Text>
          <Text style={styles.pdfBody}>
            Nothing is sent anywhere else — the file goes straight from your vault to the app you
            already use.
          </Text>
        </View>
      )}

      <Text style={styles.meta}>
        {formatBytes(file.sizeBytes)} · added {formatRelativeTime(file.createdAt)}
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        <Button
          label={previewable ? 'Share' : 'Open'}
          variant={previewable ? 'quiet' : 'primary'}
          onPress={handleShare}
          busy={busy}
          disabled={busy}
        />

        {canEdit ? (
          <Pressable onPress={confirmRemove} accessibilityRole="button">
            <Text style={styles.remove}>Remove this file</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
  },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: 420,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSunken,
  },
  imagePlaceholder: {
    width: '100%',
    height: 420,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pdf: {
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.xl,
    backgroundColor: theme.colors.surfaceSunken,
    borderRadius: theme.radius.md,
  },
  pdfTitle: {
    color: theme.colors.text,
    fontSize: theme.typography.subheading,
    fontWeight: '600',
  },
  pdfBody: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    textAlign: 'center',
    paddingHorizontal: theme.spacing.lg,
  },
  meta: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    marginTop: theme.spacing.md,
  },
  error: {
    color: theme.colors.error,
    fontSize: theme.typography.caption,
    marginTop: theme.spacing.sm,
  },
  actions: {
    gap: theme.spacing.md,
    marginTop: theme.spacing.lg,
  },
  remove: {
    color: theme.colors.error,
    fontSize: theme.typography.body,
    textAlign: 'center',
    paddingVertical: theme.spacing.sm,
  },
});
