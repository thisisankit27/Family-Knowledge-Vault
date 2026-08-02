import { Stack } from 'expo-router';

import { theme } from '../../../../src/theme';

/**
 * The Family tab is the first to need more than one screen: a list, and a
 * person. A nested stack keeps that inside the tab, so the tab bar stays
 * visible while you move between them.
 *
 * Headers are shown here, unlike everywhere else in the app — a screen you can
 * navigate *into* needs a way back out, and the platform back affordance is
 * better than one invented here.
 */
export default function FamilyLayout() {
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
      <Stack.Screen name="new" options={{ title: 'Add someone', presentation: 'modal' }} />
      <Stack.Screen name="[memberId]" options={{ title: 'Edit person' }} />
    </Stack>
  );
}
