import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../src/components/Button';
import { Screen } from '../../../src/components/Screen';
import { getSupabase } from '../../../src/lib/supabase';
import { MORE_DOMAINS, type Domain } from '../../../src/navigation/domains';
import { useAuth } from '../../../src/providers/AuthProvider';
import { signOut } from '../../../src/services/auth';
import { checkConnection, type ConnectionStatus } from '../../../src/services/connection';
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
  const [check, setCheck] = useState<Check>({ phase: 'checking' });
  const [signingOut, setSigningOut] = useState(false);

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
  dot: {
    width: 10,
    height: 10,
    borderRadius: theme.radius.full,
  },
});
