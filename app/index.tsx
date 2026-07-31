import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../src/providers/AuthProvider';
import { theme } from '../src/theme';

/**
 * The entry route: the only job here is deciding which stack the person belongs
 * in. Reading the stored session off the device keychain is asynchronous, so
 * this holds a loading state rather than guessing — guessing would flash the
 * login screen at somebody who is already signed in.
 */
export default function Index() {
  const { session, initialising, configError } = useAuth();

  if (configError) {
    return (
      <View style={styles.centre}>
        <Text style={styles.errorTitle}>Configuration problem</Text>
        <Text style={styles.errorBody}>{configError}</Text>
        <Text style={styles.errorHint}>
          Copy .env.example to .env and fill in your Supabase values, then
          restart the dev server.
        </Text>
      </View>
    );
  }

  if (initialising) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  return <Redirect href={session ? '/(app)' : '/(auth)/login'} />;
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  errorTitle: {
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: theme.colors.error,
  },
  errorBody: {
    fontSize: theme.typography.body,
    color: theme.colors.text,
    textAlign: 'center',
  },
  errorHint: {
    fontSize: theme.typography.caption,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
});
