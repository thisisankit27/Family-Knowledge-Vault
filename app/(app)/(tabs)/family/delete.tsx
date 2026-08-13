import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../../src/components/Button';
import { TextField } from '../../../../src/components/TextField';
import { getSupabase } from '../../../../src/lib/supabase';
import { useFamily } from '../../../../src/providers/FamilyProvider';
import {
  createSupabaseFamilyGateway,
  deleteFamily,
} from '../../../../src/services/family';
import {
  createSupabaseInvitationGateway,
  listUsableInvitations,
} from '../../../../src/services/invitation';
import { createSupabaseMemberGateway, listMembers } from '../../../../src/services/member';
import {
  createSupabaseRelationshipGateway,
  listRelationships,
} from '../../../../src/services/relationship';
import { canManageFamily } from '../../../../src/services/role';
import { theme } from '../../../../src/theme';

/**
 * The most destructive thing the app can do.
 *
 * A screen rather than an `Alert`, because the two dialogs elsewhere in the app
 * guard actions that can be redone — a revoked code can be reissued, a removed
 * relationship re-added. This one cannot. `families` has no `deleted_at`; the
 * cascade is real and nothing comes back, so the confirmation has to cost more
 * than a tap, and `Alert.alert` cannot ask anyone to type anything.
 *
 * It exists because without it a sole owner has no way out at all: the
 * last-owner guarantee correctly refuses their attempt to leave, and the only
 * other door is this one.
 */
export default function DeleteFamilyScreen() {
  const { family, role, refresh } = useFamily();

  const [counts, setCounts] = useState<{
    people: number;
    relationships: number;
    invitations: number;
  } | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!family) return;
    const supabase = getSupabase();
    const [people, relationships, invitations] = await Promise.all([
      listMembers(createSupabaseMemberGateway(supabase), family.id),
      listRelationships(createSupabaseRelationshipGateway(supabase), family.id),
      listUsableInvitations(createSupabaseInvitationGateway(supabase), family.id),
    ]);
    setCounts({
      people: people.length,
      relationships: relationships.length,
      invitations: invitations.length,
    });
  }, [family]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete() {
    if (!family) return;
    setBusy(true);
    setError(null);
    try {
      const result = await deleteFamily(createSupabaseFamilyGateway(getSupabase()), family.id);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      /*
        **Dismiss first, refresh second. The order is the whole fix.**

        It used to `await refresh()` and then dismiss, which logged
        *"POP_TO_TOP was not handled by any navigator"* on every successful
        delete. `refresh()` sets `family` to `null`, the Family tab re-renders
        into its join-or-create state, and this modal's own stack goes with it —
        so the dismissal that follows is dispatched at a navigator that is no
        longer there to handle it.

        Dismissing while the navigator is still mounted, and letting the provider
        catch up afterwards, costs nothing: the delete has already succeeded by
        this line, and the Family tab re-reads on focus anyway.
      */
      router.dismissAll();

      // Not awaited before navigating, and deliberately still awaited: the
      // provider is the app's single source of truth for the current family, and
      // leaving it holding a family that no longer exists would let any screen
      // reading it query a deleted id.
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (!family) {
    return (
      <View style={styles.centre}>
        <Text style={styles.empty}>There is no family to delete.</Text>
      </View>
    );
  }

  if (!canManageFamily(role)) {
    // Hidden everywhere it could be reached from, but a screen has its own
    // address and the guard belongs on the screen too.
    return (
      <View style={styles.centre}>
        <Text style={styles.empty}>Only an owner can delete this family.</Text>
      </View>
    );
  }

  const confirmed = typed.trim() === family.name;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Delete {family.name}</Text>

      <Text style={styles.body}>
        This deletes the family and everything in it, for everyone — not just
        for you.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>What goes</Text>
        {counts === null ? (
          <ActivityIndicator color={theme.colors.primary} />
        ) : (
          <>
            <Text style={styles.item}>The family itself, and everyone's access to it</Text>
            <Text style={styles.item}>
              {counts.people === 1 ? '1 person' : `${counts.people} people`}, with their
              birthdays and blood groups
            </Text>
            <Text style={styles.item}>
              {counts.relationships === 1
                ? '1 relationship'
                : `${counts.relationships} relationships`}
            </Text>
            <Text style={styles.item}>
              {counts.invitations === 1
                ? '1 unused invite code'
                : `${counts.invitations} unused invite codes`}
            </Text>
          </>
        )}
      </View>

      <Text style={styles.warning}>
        This cannot be undone. There is no trash and no backup — once it is
        gone, nobody can bring it back, including us.
      </Text>

      <TextField
        label={`Type "${family.name}" to confirm`}
        value={typed}
        onChangeText={setTyped}
        placeholder={family.name}
        editable={!busy}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {!!error && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}

      <Button
        label="Delete this family forever"
        onPress={handleDelete}
        busy={busy}
        disabled={!confirmed}
      />
      <Button label="Keep it" variant="quiet" onPress={() => router.back()} disabled={busy} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  empty: {
    fontSize: theme.typography.body,
    lineHeight: 24,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  content: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  heading: {
    fontSize: theme.typography.heading,
    fontWeight: '700',
    color: theme.colors.text,
  },
  body: {
    fontSize: theme.typography.body,
    lineHeight: 24,
    color: theme.colors.text,
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
  item: {
    fontSize: theme.typography.body,
    lineHeight: 22,
    color: theme.colors.text,
  },
  warning: {
    fontSize: theme.typography.body,
    lineHeight: 24,
    fontWeight: '600',
    color: theme.colors.error,
  },
  error: {
    fontSize: theme.typography.body,
    color: theme.colors.error,
  },
});
