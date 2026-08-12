import { Stack } from 'expo-router';

import { theme } from '../../../../src/theme';

/**
 * The Documents tab gains a second screen: the library, and one document.
 *
 * Same shape as the Family tab's stack, for the same reason — a screen you can
 * navigate *into* needs a way back out, and the platform's own back affordance
 * beats one invented here. The tab bar stays visible throughout, so opening a
 * document never feels like leaving the section.
 */
export default function DocumentsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: theme.colors.background },
        headerShadowVisible: false,
        headerTintColor: theme.colors.primary,
        headerTitleStyle: { color: theme.colors.text, fontWeight: '600' },
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      {/* The library draws its own title inside the scroll area. */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[documentId]/index" options={{ title: 'Document' }} />
      {/* The viewer sets its own title to the file's name, the way the Family
          tab's member screen sets a person's. A generic "File" would be worse
          than the filename it replaced. */}
      <Stack.Screen name="[documentId]/[fileId]" />
    </Stack>
  );
}
