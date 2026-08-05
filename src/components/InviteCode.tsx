import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import type { FamilyRole } from '../services/family';
import { ROLE_LABELS } from '../services/role';
import { theme } from '../theme';

interface InviteCodeProps {
  code: string;
  expiresAt: string;
  role: FamilyRole;
  /** Omitted for anyone who cannot revoke. */
  onRevoke?: () => void;
  revoking?: boolean;
}

/**
 * A code someone has to read off a screen and type into another device.
 *
 * Displayed as two groups of four in a monospace face for the same reason
 * bank cards and postcodes are grouped: eight unbroken characters are read
 * back wrong. Tapping copies, because most of the time it is going straight
 * into a message rather than being read aloud.
 */
export function InviteCode({
  code,
  expiresAt,
  role,
  onRevoke,
  revoking = false,
}: InviteCodeProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleRevoke() {
    // Confirmed because it cannot be undone, and because the person holding
    // the code has no way of knowing it stopped working.
    Alert.alert(
      'Revoke this code?',
      'Anyone still holding it will no longer be able to join. You can create a new one.',
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Revoke', style: 'destructive', onPress: onRevoke },
      ],
    );
  }

  const days = Math.max(
    0,
    Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000),
  );

  return (
    <View style={styles.container}>
      <Pressable
        onPress={handleCopy}
        style={({ pressed }) => [styles.codeBox, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Invitation code ${code.split('').join(' ')}. Tap to copy.`}
      >
        <Text style={styles.code}>
          {code.slice(0, 4)} {code.slice(4)}
        </Text>
      </Pressable>

      <Text style={styles.meta}>
        {copied ? 'Copied' : 'Tap to copy'} · joins as {ROLE_LABELS[role].toLowerCase()} · expires in{' '}
        {days === 1 ? '1 day' : `${days} days`}
      </Text>

      {!!onRevoke && (
        <Pressable
          onPress={handleRevoke}
          disabled={revoking}
          accessibilityRole="button"
          accessibilityLabel={`Revoke invitation code ${code.split('').join(' ')}`}
          style={({ pressed }) => [styles.revoke, pressed && styles.pressed]}
        >
          <Text style={[styles.revokeText, revoking && styles.revoking]}>
            {revoking ? 'Revoking…' : 'Revoke'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: theme.spacing.sm,
    alignItems: 'center',
  },
  codeBox: {
    backgroundColor: theme.colors.surfaceSunken,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    minHeight: theme.touchTarget,
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 26,
    letterSpacing: 3,
    fontWeight: '700',
    color: theme.colors.text,
    textAlign: 'center',
  },
  meta: {
    fontSize: theme.typography.caption,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  revoke: {
    minHeight: theme.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
  },
  revokeText: {
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: theme.colors.error,
  },
  revoking: {
    opacity: 0.5,
  },
});
