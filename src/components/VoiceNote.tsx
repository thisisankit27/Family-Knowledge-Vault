import { Ionicons } from '@expo/vector-icons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { File as DeviceFile } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { UploadCandidate } from '../services/storage';
import { theme } from '../theme';

/**
 * Recording and playing a voice note.
 *
 * **On `expo-audio` rather than `expo-av`.** `docs/14`'s roadmap said Expo AV —
 * the only mention of it anywhere in this project — and it was already wrong
 * when written: `expo-av` is unmaintained from SDK 54 and **removed in SDK 55**,
 * and this app pins `expo ~54.0.0`. Following that line would have meant new
 * code with a published removal date one SDK ahead. `expo-audio` is stable and
 * is included in Expo Go, so the demo needs no dev build.
 *
 * **The audio session is set at the point of use, not once at startup.** iOS
 * needs `allowsRecording` while recording and refuses playback through the
 * silent switch without `playsInSilentMode` — and a family listening to a
 * grandparent's story with the ringer off is the normal case, not the edge one.
 * Recording mode is turned back off afterwards, because leaving it on routes
 * playback through the earpiece on iOS rather than the speaker.
 */

/** The cap, and the arithmetic behind it. */
export const MAX_RECORDING_SECONDS = 5 * 60;

/**
 * `mm:ss`. Long enough for the cap, and nobody records an hour into a phone.
 */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * Record a voice note, and hand the result up as an upload candidate.
 *
 * Reports rather than uploads, exactly as `FileSourcePicker` does, so the parent
 * owns what "attach" means and this component owns nothing but the microphone.
 *
 * **Capped at five minutes.** The preset records 128 kbit/s, so the 10MB bucket
 * limit is about ten minutes of audio; five lands near 4.8MB. The cap is
 * enforced here rather than discovered at upload, because failing after somebody
 * has told a story is the worst possible moment to mention a size limit.
 */
export function VoiceRecorder({
  onRecorded,
  onError,
  disabled,
}: {
  onRecorded: (candidate: UploadCandidate) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [preparing, setPreparing] = useState(false);
  // Ref rather than state: the unmount cleanup below reads it after the last
  // render, when a state value would be the stale one.
  const recording = useRef(false);

  const elapsedSeconds = Math.floor((state.durationMillis ?? 0) / 1000);

  async function stopAndReport() {
    recording.current = false;
    try {
      await recorder.stop();
    } catch {
      onError('That recording could not be saved. Try again.');
      return;
    } finally {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    }

    const uri = recorder.uri;
    if (!uri) {
      onError('That recording could not be saved. Try again.');
      return;
    }

    let sizeBytes: number | null = null;
    try {
      sizeBytes = new DeviceFile(uri).size;
    } catch {
      sizeBytes = null;
    }
    if (sizeBytes === null || sizeBytes <= 0) {
      onError('That recording came out empty. Try again.');
      return;
    }

    onRecorded({
      uri,
      // What the preset actually writes — `.m4a`, MPEG-4 container, AAC, on both
      // platforms. Sent explicitly rather than guessed from the extension.
      mimeType: 'audio/mp4',
      sizeBytes,
      originalFilename: null,
      // Measured by the recorder rather than read back from the file: nothing in
      // this stack decodes audio, and an invented duration is worse than none.
      durationSeconds: elapsedSeconds > 0 ? elapsedSeconds : null,
    });
  }

  // Reaching the cap stops the recording rather than refusing the upload later.
  useEffect(() => {
    if (state.isRecording && elapsedSeconds >= MAX_RECORDING_SECONDS) {
      void stopAndReport();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isRecording, elapsedSeconds]);

  /**
   * A phone call, or the OS taking the microphone away.
   *
   * `mediaServicesDidReset` is the platform saying the session is gone. The
   * bytes so far are not recoverable, so this says so rather than leaving a
   * timer running against a recorder that stopped existing.
   */
  useEffect(() => {
    if (state.mediaServicesDidReset && recording.current) {
      recording.current = false;
      onError('Something interrupted the recording. Nothing was saved.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mediaServicesDidReset]);

  /**
   * Leaving the screen mid-recording stops and discards.
   *
   * Keeping the microphone open behind a screen nobody is looking at is the
   * behaviour a person would least expect from a family vault, and a recording
   * they did not finish is not one they asked to keep.
   */
  useEffect(() => {
    return () => {
      if (recording.current) {
        recording.current = false;
        void recorder.stop().catch(() => undefined);
        void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    setPreparing(true);
    try {
      // Asked at the moment it is needed rather than on mount: a microphone
      // prompt before the user has asked for anything reads as the app taking.
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        onError(
          'Microphone access is off. Turn it on in Settings to record a voice note.',
        );
        return;
      }

      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recording.current = true;
    } catch {
      onError('The recorder could not start. Try again.');
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } finally {
      setPreparing(false);
    }
  }

  if (disabled) return null;

  if (state.isRecording) {
    const remaining = MAX_RECORDING_SECONDS - elapsedSeconds;

    return (
      <View style={styles.recordingRow}>
        <View style={styles.recordingDot} />
        <Text style={styles.recordingTime}>{formatDuration(elapsedSeconds)}</Text>
        <Text style={styles.recordingHint}>
          {remaining <= 30 ? `${remaining}s left` : 'Recording'}
        </Text>
        <Pressable
          onPress={() => void stopAndReport()}
          style={styles.stop}
          accessibilityRole="button"
          accessibilityLabel="Stop recording"
        >
          <Ionicons name="stop" size={16} color={theme.colors.surface} />
          <Text style={styles.stopText}>Stop</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => void start()}
      style={styles.action}
      accessibilityRole="button"
      disabled={preparing}
    >
      {preparing ? (
        <ActivityIndicator color={theme.colors.primary} />
      ) : (
        <Ionicons name="mic-outline" size={18} color={theme.colors.primary} />
      )}
      <Text style={styles.actionText}>Record a voice note</Text>
    </Pressable>
  );
}

/**
 * Play one voice note.
 *
 * Takes a URL the caller minted and does not keep it — `docs/17` §10.1 again:
 * signed-URL expiry must not reach a component, so this is handed a URL and has
 * no idea it can go stale. The parent re-mints.
 *
 * Progress was `docs/18` §9's cut line for this PR. It stayed because
 * `useAudioPlayerStatus` already reports `currentTime` and `duration`, so the
 * bar is a division rather than a feature — but the *recorded* duration is
 * preferred over the player's, since it is known before the audio loads and does
 * not shift as buffering resolves.
 */
export function VoicePlayer({
  url,
  durationSeconds,
}: {
  url: string | null;
  durationSeconds: number | null;
}) {
  const player = useAudioPlayer(url ?? undefined);
  const status = useAudioPlayerStatus(player);

  const total = durationSeconds ?? (status.duration || 0);
  const elapsed = status.currentTime || 0;
  const fraction = total > 0 ? Math.min(1, elapsed / total) : 0;

  // Playing to the end leaves the head at the end; a second tap should replay
  // rather than do nothing, which is what a person expects from a play button.
  useEffect(() => {
    if (status.didJustFinish) void player.seekTo(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.didJustFinish]);

  if (!url) {
    return <ActivityIndicator color={theme.colors.primary} />;
  }

  return (
    <View style={styles.playerRow}>
      <Pressable
        onPress={() => {
          if (status.playing) player.pause();
          else player.play();
        }}
        style={styles.play}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Pause' : 'Play'}
        accessibilityState={{ busy: !status.isLoaded }}
      >
        <Ionicons
          name={status.playing ? 'pause' : 'play'}
          size={18}
          color={theme.colors.primary}
        />
      </Pressable>

      <View style={styles.playerBody}>
        <View
          style={styles.track}
          accessibilityRole="progressbar"
          accessibilityValue={{ now: Math.round(fraction * 100), min: 0, max: 100 }}
        >
          <View style={[styles.trackFill, { width: `${fraction * 100}%` }]} />
        </View>
        <Text style={styles.playerTime}>
          {total > 0 ? `${formatDuration(elapsed)} / ${formatDuration(total)}` : 'Voice note'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.md,
  },
  actionText: {
    color: theme.colors.primary,
    fontSize: theme.typography.body,
    fontWeight: '600',
  },
  recordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.error,
  },
  recordingTime: {
    color: theme.colors.text,
    fontSize: theme.typography.body,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
  },
  recordingHint: {
    flex: 1,
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
  },
  stop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.error,
  },
  stopText: {
    color: theme.colors.surface,
    fontSize: theme.typography.caption,
    fontWeight: '600',
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  play: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.primarySoft,
  },
  playerBody: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  track: {
    height: 4,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceSunken,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    backgroundColor: theme.colors.primary,
  },
  playerTime: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    fontVariant: ['tabular-nums'],
  },
});
