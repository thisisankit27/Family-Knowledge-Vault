import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../src/components/Button';
import { Screen } from '../../../src/components/Screen';
import { getSupabase } from '../../../src/lib/supabase';
import { MORE_DOMAINS, type Domain } from '../../../src/navigation/domains';
import { useAuth } from '../../../src/providers/AuthProvider';
import { useFamily } from '../../../src/providers/FamilyProvider';
import { createSupabaseAccessGateway, leaveFamily } from '../../../src/services/access';
import { signOut } from '../../../src/services/auth';
import { checkConnection, type ConnectionStatus } from '../../../src/services/connection';
import { canManageFamily } from '../../../src/services/role';
import { theme } from '../../../src/theme';

type Check =
  | { phase: 'checking' }
  | { phase: 'done'; status: ConnectionStatus }
  | { phase: 'error'; reason: string };

/**
 * The eight domains that have no tab, plus the account.
 *
 * Rows are rendered from `MORE_DOMAINS`, so a domain added to the registry
 * appears here without touching this file — that is what makes IA §12's
 * "integrate without restructuring" true in practice rather than in principle.
 *
 * The rows are not pressable yet. A row that navigates to a blank screen is
 * worse than one that plainly states when it arrives.
 */
export default function MoreScreen() {
  const { session } = useAuth();
  const { family, role, refresh } = useFamily();
  const [check, setCheck] = useState<Check>({ phase: 'checking' });
  const [signingOut, setSigningOut] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const runCheck = useCallback(async () => {
    setCheck({ phase: 'checking' });
    try {
      setCheck({ phase: 'done', status: await checkConnection() });
    } catch (error) {
      setCheck({
        phase: 'error',
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, []);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  async function handleSignOut() {
    setSigningOut(true);
    // Clearing the session is what returns us to the auth stack — the layout
    // guards react to it. Nothing here navigates.
    await signOut(getSupabase().auth);
    setSigningOut(false);
  }

  function confirmLeave() {
    if (!family) return;
    Alert.alert(
      `Leave ${family.name}?`,
      "You will lose access to everything in it. You stay in the family as a person, and nothing you added is deleted — someone still in it can invite you back.",
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => void handleLeave() },
      ],
    );
  }

  async function handleLeave() {
    if (!family) return;
    setLeaving(true);
    setLeaveError(null);
    try {
      // The sole-owner case is not pre-checked here on purpose. The owner count
      // can change on another device between this screen rendering and the tap,
      // and `useFamily()` does not expose it. Let the database answer, then turn
      // its answer into the two routes out.
      const result = await leaveFamily(createSupabaseAccessGateway(getSupabase()), {
        familyId: family.id,
      });
      if (!result.ok) {
        setLeaveError(result.message);
        return;
      }
      await refresh();
    } finally {
      setLeaving(false);
    }
  }

  const stuckAsSoleOwner = !!leaveError && leaveError.includes('only owner');

  return (
    <Screen title="More" subtitle="Everything else in your vault.">
      <View style={styles.list}>
        {MORE_DOMAINS.map((domain, index) => (
          <DomainRow
            key={domain.id}
            domain={domain}
            isLast={index === MORE_DOMAINS.length - 1}
          />
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Account</Text>
        <Text style={styles.email}>{session?.user.email ?? 'Unknown'}</Text>
        <ConnectionRow check={check} />

        {!!family && (
          <>
            <View style={styles.divider} />
            <Pressable
              onPress={confirmLeave}
              disabled={leaving}
              accessibilityRole="button"
              accessibilityLabel={`Leave ${family.name}`}
              style={styles.destructive}
            >
              <Text style={styles.destructiveText}>
                {leaving ? 'Leaving…' : `Leave ${family.name}`}
              </Text>
            </Pressable>

            {!!leaveError && (
              <Text style={styles.leaveError} accessibilityRole="alert">
                {leaveError}
              </Text>
            )}

            {/* The refusal is not a dead end. Both ways out of it are real
                actions, so both are offered rather than described. */}
            {stuckAsSoleOwner && (
              <>
                <Button
                  label="Choose a new owner"
                  variant="quiet"
                  onPress={() => router.push('/(app)/(tabs)/family')}
                />
                {canManageFamily(role) && (
                  <Button
                    label="Delete this family instead"
                    variant="quiet"
                    onPress={() => router.push('/(app)/(tabs)/family/delete')}
                  />
                )}
              </>
            )}
          </>
        )}
      </View>

      <Button label="Check connection" onPress={runCheck} variant="quiet" />
      <Button label="Sign out" onPress={handleSignOut} busy={signingOut} />
    </Screen>
  );
}

function DomainRow({ domain, isLast }: { domain: Domain; isLast: boolean }) {
  return (
    <View style={[styles.row, !isLast && styles.rowDivider]}>
      <View style={styles.rowIcon}>
        <Ionicons name={domain.icon} size={20} color={theme.colors.primary} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{domain.label}</Text>
        <Text style={styles.rowSummary}>{domain.summary}</Text>
      </View>
      <Text style={styles.rowBadge}>{domain.arrivesIn}</Text>
    </View>
  );
}

function ConnectionRow({ check }: { check: Check }) {
  if (check.phase === 'checking') {
    return (
      <View style={styles.statusRow}>
        <ActivityIndicator color={theme.colors.primary} />
        <Text style={styles.statusText}>Checking…</Text>
      </View>
    );
  }

  const failure =
    check.phase === 'error'
      ? check.reason
      : check.status.ok
        ? null
        : check.status.reason;

  return (
    <View style={styles.statusRow}>
      {/* Colour is never the only signal (NFR-018) — the text says it too. */}
      <View
        style={[
          styles.dot,
          { backgroundColor: failure ? theme.colors.error : theme.colors.success },
        ]}
      />
      <Text style={[styles.statusText, !!failure && styles.statusError]}>
        {failure ??
          `Connected · ${check.phase === 'done' && check.status.ok ? check.status.latencyMs : 0} ms`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    minHeight: theme.touchTarget,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: theme.colors.text,
  },
  rowSummary: {
    fontSize: theme.typography.caption,
    color: theme.colors.textMuted,
  },
  rowBadge: {
    fontSize: theme.typography.caption,
    fontWeight: '600',
    color: theme.colors.textMuted,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  cardLabel: {
    fontSize: theme.typography.caption,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: theme.colors.textMuted,
  },
  email: {
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: theme.colors.text,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  statusText: {
    flex: 1,
    fontSize: theme.typography.body,
    color: theme.colors.text,
  },
  statusError: {
    color: theme.colors.error,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginTop: theme.spacing.xs,
  },
  destructive: {
    minHeight: theme.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destructiveText: {
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: theme.colors.error,
  },
  leaveError: {
    fontSize: theme.typography.body,
    lineHeight: 24,
    color: theme.colors.error,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: theme.radius.full,
  },
});
