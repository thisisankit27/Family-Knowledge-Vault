import { Redirect, Stack } from 'expo-router';

import { useAuth } from '../../src/providers/AuthProvider';

/**
 * The signed-out stack.
 *
 * The guard is here rather than in each screen so a new auth screen (password
 * reset in PR-3b) inherits it by being placed in this folder — there is no
 * per-screen check for someone to forget.
 */
export default function AuthLayout() {
  const { session, initialising } = useAuth();

  // Signing in flips this, which is what moves the person into the app stack.
  if (!initialising && session) {
    return <Redirect href="/(app)" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
