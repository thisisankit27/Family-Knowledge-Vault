import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AuthScreen } from '../../src/components/AuthScreen';
import { CredentialsForm } from '../../src/components/CredentialsForm';
import { getSupabase } from '../../src/lib/supabase';
import { signIn, type Credentials } from '../../src/services/auth';
import { theme } from '../../src/theme';

export default function LoginScreen() {
  return (
    <AuthScreen
      title="Welcome back"
      subtitle="Sign in to your family's vault."
      footer={
        <View style={styles.footer}>
          <Text style={styles.footerText}>Don't have an account?</Text>
          <Link href="/(auth)/signup" style={styles.footerLink}>
            Create one
          </Link>
        </View>
      }
    >
      <CredentialsForm
        submitLabel="Sign in"
        passwordAutoComplete="current-password"
        onSubmit={(credentials: Credentials) =>
          signIn(getSupabase().auth, credentials)
        }
      />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  footerText: {
    fontSize: theme.typography.body,
    color: theme.colors.textMuted,
  },
  footerLink: {
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: theme.colors.primary,
  },
});
