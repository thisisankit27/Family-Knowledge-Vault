import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '../src/providers/AuthProvider';
import { theme } from '../src/theme';

/**
 * Root layout. Everything the whole app needs, and nothing else.
 *
 * The navigator is rendered unconditionally — Expo Router needs a mounted root
 * navigator before any route can redirect, so the "are we signed in yet?"
 * decision is made one level down in `app/index.tsx` and in each group layout,
 * not here.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.background },
          }}
        />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
