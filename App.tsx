import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { checkConnection, type ConnectionStatus } from './src/services/connection';
import { theme } from './src/theme';

type Screen =
  | { phase: 'checking' }
  | { phase: 'done'; status: ConnectionStatus }
  | { phase: 'error'; reason: string };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ phase: 'checking' });

  const runCheck = useCallback(async () => {
    setScreen({ phase: 'checking' });
    try {
      setScreen({ phase: 'done', status: await checkConnection() });
    } catch (error) {
      // Missing or invalid env throws before any request is attempted.
      setScreen({
        phase: 'error',
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, []);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.content}>
        <Text style={styles.title}>Family Knowledge Vault</Text>
        <Text style={styles.subtitle}>
          A digital home for everything your family knows, owns, celebrates, and
          wants to pass on.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Supabase connection</Text>
          <ConnectionRow screen={screen} />
        </View>

        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={runCheck}
          disabled={screen.phase === 'checking'}
          accessibilityRole="button"
          accessibilityLabel="Re-run the Supabase connection check"
        >
          <Text style={styles.buttonText}>Check again</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function ConnectionRow({ screen }: { screen: Screen }) {
  if (screen.phase === 'checking') {
    return (
      <View style={styles.row}>
        <ActivityIndicator color={theme.colors.primary} />
        <Text style={styles.statusText}>Connecting…</Text>
      </View>
    );
  }

  if (screen.phase === 'error') {
    return (
      <View style={styles.row}>
        <Dot color={theme.colors.error} />
        <Text style={[styles.statusText, styles.errorText]}>{screen.reason}</Text>
      </View>
    );
  }

  if (screen.status.ok) {
    return (
      <View style={styles.row}>
        <Dot color={theme.colors.success} />
        <Text style={styles.statusText}>
          Connected · {screen.status.latencyMs} ms
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Dot color={theme.colors.error} />
      <Text style={[styles.statusText, styles.errorText]}>
        {screen.status.reason}
      </Text>
    </View>
  );
}

/** Always paired with text — colour is never the only signal (NFR-018). */
function Dot({ color }: { color: string }) {
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    flex: 1,
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
    marginBottom: theme.spacing.md,
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
  button: {
    alignSelf: 'flex-start',
    paddingVertical: theme.spacing.sm + 4,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.primary,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: theme.typography.body,
    fontWeight: '600',
  },
});
