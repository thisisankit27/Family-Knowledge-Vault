import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';

import { TAB_DOMAINS } from '../../../src/navigation/domains';
import { theme } from '../../../src/theme';

/**
 * The tab shell.
 *
 * Tab identity comes from `src/navigation/domains.ts` rather than being typed
 * out here, so the registry the tests check is the same data the UI renders —
 * a domain cannot be renamed in one place and not the other.
 *
 * Route file names must stay in step with the domain ids: Expo Router matches
 * `<Tabs.Screen name="family">` to `family.tsx`. `dashboard` is the exception,
 * since Expo Router's first tab is always `index`.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          height: 64,
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.spacing.sm,
        },
        tabBarLabelStyle: {
          fontSize: theme.typography.caption,
          fontWeight: '600',
        },
        sceneStyle: { backgroundColor: theme.colors.background },
      }}
    >
      {TAB_DOMAINS.map((domain) => (
        <Tabs.Screen
          key={domain.id}
          name={domain.id === 'dashboard' ? 'index' : domain.id}
          options={{
            title: domain.label,
            tabBarIcon: ({ color, size }) => (
              <Ionicons name={domain.icon} size={size} color={color} />
            ),
          }}
        />
      ))}

      {/* Not an IA domain — a way into the eight that have no tab. */}
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="ellipsis-horizontal" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
