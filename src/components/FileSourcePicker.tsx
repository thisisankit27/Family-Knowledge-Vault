import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File as DeviceFile } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { UploadCandidate } from '../services/storage';
import { theme } from '../theme';

/**
 * Turns whichever picker the user chose into one shape the service understands.
 *
 * **Both pickers report `mimeType` and size as optional**, which is easy to miss
 * and awkward to discover on a device — an Android gallery will hand back a HEIC
 * with no MIME type at all. The size comes from the file itself rather than the
 * picker's guess, since it is the number the 10MB check depends on.
 *
 * A missing MIME type is refused rather than guessed. Inferring it from the
 * filename would put user input back into a decision the storage path contract
 * works hard to keep it out of.
 *
 * Lives here rather than in `services/storage.ts` deliberately: it needs
 * `expo-file-system`, and the service layer is unit-tested without a device.
 */
export function toCandidate(asset: {
  uri: string;
  mimeType?: string | null;
  name?: string | null;
}): UploadCandidate | { error: string } {
  if (!asset.mimeType) {
    return { error: 'That file did not say what kind it is. Try a photo or a PDF.' };
  }

  let sizeBytes: number | null = null;
  try {
    sizeBytes = new DeviceFile(asset.uri).size;
  } catch {
    sizeBytes = null;
  }

  if (sizeBytes === null || sizeBytes <= 0) {
    return { error: 'That file could not be read from your device.' };
  }

  return {
    uri: asset.uri,
    mimeType: asset.mimeType,
    sizeBytes,
    originalFilename: asset.name ?? null,
  };
}

/**
 * The three ways a file gets in, and nothing about where it goes.
 *
 * **Extracted because filing a document now attaches files too**, and the
 * document does not exist yet at that point — so this cannot be the thing that
 * uploads. It reports a `UploadCandidate` and lets the caller decide whether that
 * means "upload now" (the detail screen, where a document id exists) or "hold it
 * until the document is created" (the filing form).
 *
 * That split is the whole reason the two-phase write in `docs/15` §9.1 is visible
 * from the UI at all: the storage path embeds the document id, so bytes cannot
 * move before the row exists.
 *
 * **An inline chooser rather than `Alert.alert`, and not for taste: Android's
 * dialog takes at most three buttons.** Four — camera, library, files, cancel —
 * silently dropped the cancel, leaving no way out except the hardware back
 * button. Found on a device in PR-14a. Inline also means the three sources are
 * visible before committing to anything, which is more discoverable anyway.
 */
export function FileSourcePicker({
  label = 'Add a file',
  multiple,
  onPicked,
  onError,
  disabled,
}: {
  label?: string;
  /**
   * Whether the gallery and file browser let several be chosen at once.
   *
   * Both callers pass it. It stayed a prop rather than becoming the only
   * behaviour because the camera genuinely cannot honour it — you take one
   * photograph at a time — and because a future caller attaching a single avatar
   * would want it off.
   *
   * It was briefly off on the document detail screen, on the grounds that a
   * batch there would mean concurrent uploads behind one progress bar. That
   * argued for uploading sequentially, not for refusing the batch, and it made
   * one action behave two ways depending on the screen.
   */
  multiple?: boolean;
  onPicked: (candidates: UploadCandidate[]) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const [choosing, setChoosing] = useState(false);

  /**
   * Convert a batch, keeping what worked.
   *
   * One HEIC with no MIME type among four photos should cost that one photo, not
   * the selection. The refusals are reported together so the message is one
   * sentence rather than a queue of alerts.
   */
  function accept(
    assets: { uri: string; mimeType?: string | null; name?: string | null }[],
  ) {
    const accepted: UploadCandidate[] = [];
    const refused: string[] = [];

    for (const asset of assets) {
      const candidate = toCandidate(asset);
      if ('error' in candidate) refused.push(candidate.error);
      else accepted.push(candidate);
    }

    if (accepted.length > 0) onPicked(accepted);
    if (refused.length > 0) {
      onError(
        refused.length === 1
          ? refused[0]
          : `${refused.length} of ${assets.length} could not be added. Try photos or PDFs.`,
      );
    }
  }

  async function pickFrom(source: 'camera' | 'library' | 'files') {
    if (source === 'files') {
      const picked = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple,
      });
      if (picked.canceled) return;
      return accept(picked.assets);
    }

    // Permission is requested at the moment it is needed rather than on mount:
    // a prompt that appears before the user has asked for anything reads as the
    // app taking, not the user giving.
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      onError(
        source === 'camera'
          ? 'Camera access is off. Turn it on in Settings to photograph a document.'
          : 'Photo access is off. Turn it on in Settings to choose a photo.',
      );
      return;
    }

    const picked =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsMultipleSelection: multiple,
          });

    if (picked.canceled) return;
    // `fileName` rather than `name` — the two pickers disagree about what the
    // field is called, which is exactly the sort of thing `toCandidate` exists
    // to absorb before it reaches anything else.
    return accept(
      picked.assets.map((asset) => ({
        uri: asset.uri,
        mimeType: asset.mimeType,
        name: asset.fileName,
      })),
    );
  }

  if (disabled) return null;

  if (!choosing) {
    return (
      <Pressable
        onPress={() => setChoosing(true)}
        style={styles.row}
        accessibilityRole="button"
      >
        <Ionicons name="add-circle-outline" size={18} color={theme.colors.primary} />
        <Text style={styles.action}>{label}</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.sourceList}>
      {(
        [
          ['camera', 'camera-outline', 'Take a photo'],
          ['library', 'images-outline', 'Choose a photo'],
          ['files', 'document-outline', 'Choose a file'],
        ] as const
      ).map(([source, icon, text]) => (
        <Pressable
          key={source}
          onPress={() => {
            setChoosing(false);
            void pickFrom(source);
          }}
          style={styles.row}
          accessibilityRole="button"
        >
          <Ionicons name={icon} size={18} color={theme.colors.primary} />
          <Text style={styles.action}>{text}</Text>
        </Pressable>
      ))}
      <Pressable
        onPress={() => setChoosing(false)}
        style={styles.row}
        accessibilityRole="button"
      >
        <Ionicons name="close-outline" size={18} color={theme.colors.textMuted} />
        <Text style={styles.cancel}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sourceList: {
    gap: theme.spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    minHeight: theme.touchTarget,
  },
  action: {
    color: theme.colors.primary,
    fontSize: theme.typography.body,
    fontWeight: '500',
  },
  cancel: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.body,
  },
});
