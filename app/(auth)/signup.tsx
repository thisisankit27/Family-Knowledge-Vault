import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AuthScreen } from '../../src/components/AuthScreen';
import { CredentialsForm } from '../../src/components/CredentialsForm';
import { getSupabase } from '../../src/lib/supabase';
import { signUp, MIN_PASSWORD_LENGTH, type Credentials } from '../../src/services/auth';
import { theme } from '../../src/theme';

export default function SignupScreen() {
  return (
    <AuthScreen
      title="Create your account"
      subtitle="One account per person. You'll set up your family next."
      footer={
        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account?</Text>
          <Link href="/(auth)/login" style={styles.footerLink}>
            Sign in
          </Link>
        </View>
      }
    >
      <CredentialsForm
        submitLabel="Create account"
        passwordAutoComplete="new-password"
        passwordHint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        onSubmit={(credentials: Credentials) =>
          signUp(getSupabase().auth, credentials)
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
