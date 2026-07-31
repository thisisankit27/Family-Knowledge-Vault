import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { theme } from '../theme';

interface TextFieldProps extends TextInputProps {
  label: string;
  /** Shown under the field and announced to screen readers. */
  error?: string;
}

/**
 * A labelled input. The label is a real `<Text>` tied to the field rather than
 * a placeholder, because placeholder-only labels vanish the moment someone
 * starts typing — which is exactly when an older or distracted user needs to
 * check what the field was asking for (NFR-018, docs/10-ui-ux-design.md).
 */
export function TextField({ label, error, style, ...props }: TextFieldProps) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, !!error && styles.inputError, style]}
        placeholderTextColor={theme.colors.textMuted}
        accessibilityLabel={label}
        {...props}
      />
      {!!error && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: theme.spacing.sm,
  },
  label: {
    fontSize: theme.typography.caption,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: theme.colors.textMuted,
  },
  input: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    fontSize: theme.typography.body,
    color: theme.colors.text,
  },
  inputError: {
    borderColor: theme.colors.error,
  },
  error: {
    fontSize: theme.typography.caption,
    color: theme.colors.error,
  },
});
