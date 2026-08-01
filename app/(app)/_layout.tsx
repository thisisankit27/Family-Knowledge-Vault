import { Redirect, Stack } from 'expo-router';

import { useAuth } from '../../src/providers/AuthProvider';
import { FamilyProvider } from '../../src/providers/FamilyProvider';

/**
 * The signed-in stack — everything behind the login wall lives under this
 * folder from PR-4 onward.
 *
 * Note this is a *convenience* boundary, not a security boundary: it only
 * decides what is drawn. Actual protection of family data is Row-Level
 * Security in Postgres (PR-5), because a client-side check protects nothing
 * from anyone talking to the API directly.
 */
export default function AppLayout() {
  const { session, initialising } = useAuth();

  if (!initialising && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  // Scoped to the signed-in stack rather than the app root: there is no family
  // to load before somebody signs in, and this way the auth screens carry none
  // of its state.
  return (
    <FamilyProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </FamilyProvider>
  );
}
