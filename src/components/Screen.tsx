import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { theme } from '../theme';

interface ScreenProps {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}

/**
 * Standard chrome for a tab screen: safe-area padding, a scrolling body, and a
 * title block in a consistent position.
 *
 * The tab bar draws its own header state, so headers are turned off in the
 * layout and rendered here instead — that keeps the title inside the scroll
 * area, which reads better on a small screen than a fixed bar eating vertical
 * space.
 *
 * Bottom padding clears the tab bar; without it the last card sits underneath
 * it and looks cut off.
 */
export function Screen({ title, subtitle, children }: ScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + theme.spacing.lg,
          paddingBottom: theme.spacing.xxl,
        },
      ]}
    >
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      </View>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  header: {
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
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
  },
});
