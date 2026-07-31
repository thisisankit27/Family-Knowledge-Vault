import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from './Button';
import { TextField } from './TextField';
import type { AuthOutcome, Credentials } from '../services/auth';
import { theme } from '../theme';

interface CredentialsFormProps {
  submitLabel: string;
  onSubmit: (credentials: Credentials) => Promise<AuthOutcome>;
  /** Shown under the password field, e.g. the minimum length on sign-up. */
  passwordHint?: string;
  /** Sign-up wants a fresh password; sign-in wants the saved one. */
  passwordAutoComplete: 'current-password' | 'new-password';
}

/**
 * Email + password, shared by sign-in and sign-up.
 *
 * The form owns input state and the busy flag; it owns no *rules*. Validation
 * and error wording come back from `src/services/auth.ts`, so what the person
 * reads on screen is decided by tested code rather than by a component.
 *
 * Nothing here navigates on success either — the session changes, and the
 * layouts react. One mechanism moves people between the two stacks.
 */
export function CredentialsForm({
  submitLabel,
  onSubmit,
  passwordHint,
  passwordAutoComplete,
}: CredentialsFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<AuthOutcome | null>(null);

  const failure = outcome && !outcome.ok ? outcome : null;
  const notice = outcome?.ok ? outcome.message : undefined;

  async function handleSubmit() {
    setBusy(true);
    setOutcome(null);
    try {
      setOutcome(await onSubmit({ email, password }));
    } catch (error) {
      // A thrown error means something outside the expected failure modes —
      // no network, a malformed URL. Still has to reach the person.
      setOutcome({
        ok: false,
        message: error instanceof Error ? error.message : 'Something went wrong.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={failure?.field === 'email' ? failure.message : undefined}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        editable={!busy}
        placeholder="you@example.com"
      />

      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        error={failure?.field === 'password' ? failure.message : undefined}
        secureTextEntry
        autoCapitalize="none"
        autoComplete={passwordAutoComplete}
        textContentType={
          passwordAutoComplete === 'new-password' ? 'newPassword' : 'password'
        }
        editable={!busy}
        onSubmitEditing={handleSubmit}
        returnKeyType="go"
      />

      {!!passwordHint && !failure && <Text style={styles.hint}>{passwordHint}</Text>}

      {/* Errors with no field of their own (wrong credentials, network) */}
      {!!failure && !failure.field && (
        <Text style={styles.error} accessibilityRole="alert">
          {failure.message}
        </Text>
      )}

      {!!notice && (
        <Text style={styles.notice} accessibilityRole="alert">
          {notice}
        </Text>
      )}

      <Button label={submitLabel} onPress={handleSubmit} busy={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: theme.spacing.md,
  },
  hint: {
    fontSize: theme.typography.caption,
    color: theme.colors.textMuted,
  },
  error: {
    fontSize: theme.typography.body,
    color: theme.colors.error,
  },
  notice: {
    fontSize: theme.typography.body,
    color: theme.colors.success,
  },
});
