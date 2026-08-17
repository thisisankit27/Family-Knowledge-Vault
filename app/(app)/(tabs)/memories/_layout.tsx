import { Stack } from 'expo-router';

import { theme } from '../../../../src/theme';

/**
 * The Memories tab, which until now was a single placeholder screen.
 *
 * Same shape as the Documents and Family stacks, for the same reason: a screen
 * you can navigate *into* needs a way back out, and the platform's own back
 * affordance beats one invented here. The tab bar stays visible throughout.
 */
export default function MemoriesLayout() {
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
      {/* The list draws its own title inside the scroll area. */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      {/* A modal, matching `documents/new`. Keeping a memory is a self-contained
          act with a clear end, and a modal is the shape that says so. */}
      <Stack.Screen name="new" options={{ title: 'Keep a memory', presentation: 'modal' }} />
      <Stack.Screen name="[memoryId]/index" options={{ title: 'Memory' }} />
      {/* The viewer sets its own title to the memory's name, the way the
          documents viewer sets the file's. A generic "Photo" would say less
          than the screen already shows. */}
      <Stack.Screen name="[memoryId]/[fileId]" />
    </Stack>
  );
}
