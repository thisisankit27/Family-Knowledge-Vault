import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../src/components/Button';
import { getSupabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/providers/AuthProvider';
import { signOut } from '../../src/services/auth';
import { checkConnection, type ConnectionStatus } from '../../src/services/connection';
import { theme } from '../../src/theme';

type Check =
  | { phase: 'checking' }
  | { phase: 'done'; status: ConnectionStatus }
  | { phase: 'error'; reason: string };

/**
 * Placeholder home for the signed-in stack. PR-4 replaces this with the bottom
 * tab shell; it exists now so PR-3 has somewhere to land and something to show.
 *
 * The Supabase connection check from PR-1 moves here rather than being deleted
 * — it is still the fastest way to tell a broken environment from a broken
 * feature when something misbehaves live.
 */
export default function HomeScreen() {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const [check, setCheck] = useState<Check>({ phase: 'checking' });
  const [signingOut, setSigningOut] = useState(false);

  const runCheck = useCallback(async () => {
    setCheck({ phase: 'checking' });
    try {
      setCheck({ phase: 'done', status: await checkConnection() });
    } catch (error) {
      setCheck({
        phase: 'error',
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, []);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  async function handleSignOut() {
    setSigningOut(true);
    // No navigation call: clearing the session is what moves us back to the
    // auth stack, via the layout guards.
    await signOut(getSupabase().auth);
    setSigningOut(false);
  }

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + theme.spacing.xl, paddingBottom: insets.bottom + theme.spacing.xl },
      ]}
    >
      <Text style={styles.title}>Family Knowledge Vault</Text>
      <Text style={styles.subtitle}>
        You're signed in. Your family workspace arrives in PR-5.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Signed in as</Text>
        <Text style={styles.email}>{session?.user.email ?? 'Unknown'}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Supabase connection</Text>
        <ConnectionRow check={check} />
      </View>

      <Button label="Check again" onPress={runCheck} variant="quiet" />
      <Button label="Sign out" onPress={handleSignOut} busy={signingOut} />
    </ScrollView>
  );
}

function ConnectionRow({ check }: { check: Check }) {
  if (check.phase === 'checking') {
    return (
      <View style={styles.row}>
        <ActivityIndicator color={theme.colors.primary} />
        <Text style={styles.statusText}>Connecting…</Text>
      </View>
    );
  }

  const failure =
    check.phase === 'error'
      ? check.reason
      : check.status.ok
        ? null
        : check.status.reason;

  return (
    <View style={styles.row}>
      <Dot color={failure ? theme.colors.error : theme.colors.success} />
      <Text style={[styles.statusText, !!failure && styles.errorText]}>
        {failure ??
          `Connected · ${check.phase === 'done' && check.status.ok ? check.status.latencyMs : 0} ms`}
      </Text>
    </View>
  );
}

/** Always paired with text — colour is never the only signal (NFR-018). */
function Dot({ color }: { color: string }) {
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  title: {
    fontSize: theme.typography.title,
    fontWeight: '700',
    color: theme.colors.text,
  },
  subtitle: {
    fontSize: theme.typography.body,
    lineHeight: 24,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.sm,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  cardLabel: {
    fontSize: theme.typography.caption,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: theme.colors.textMuted,
  },
  email: {
    fontSize: theme.typography.body,
    color: theme.colors.text,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  statusText: {
    flex: 1,
    fontSize: theme.typography.body,
    color: theme.colors.text,
  },
  errorText: {
    color: theme.colors.error,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
