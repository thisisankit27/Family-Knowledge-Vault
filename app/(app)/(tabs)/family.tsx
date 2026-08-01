import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../src/components/Button';
import { Screen } from '../../../src/components/Screen';
import { TextField } from '../../../src/components/TextField';
import { getSupabase } from '../../../src/lib/supabase';
import { TAB_DOMAINS } from '../../../src/navigation/domains';
import { useFamily } from '../../../src/providers/FamilyProvider';
import {
  createFamily,
  createSupabaseFamilyGateway,
  MAX_FAMILY_NAME_LENGTH,
  type Family,
} from '../../../src/services/family';
import { theme } from '../../../src/theme';

const domain = TAB_DOMAINS.find((entry) => entry.id === 'family')!;

export default function FamilyScreen() {
  const { family, loading } = useFamily();

  if (loading) {
    return (
      <Screen title={domain.label} subtitle={domain.summary}>
        <ActivityIndicator color={theme.colors.primary} />
      </Screen>
    );
  }

  return family ? <FamilyProfile family={family} /> : <CreateFamily />;
}

/**
 * Creation lives inline on this tab rather than behind its own route. There is
 * exactly one family to make and it is the first thing anyone does — a
 * separate screen would add a tap to a one-time action.
 */
function CreateFamily() {
  const { refresh } = useFamily();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      // No creator passed: the database reads it from the session, so this
      // screen cannot create a family in anyone else's name even if it tried.
      const result = await createFamily(
        createSupabaseFamilyGateway(getSupabase()),
        { name },
      );

      if (!result.ok) {
        setError(result.message);
        return;
      }
      // The provider holds the answer, so tell it rather than setting local
      // state — the Dashboard is reading the same value.
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Create your family"
      subtitle="Everything in the vault belongs to a family. This is the container for all of it."
    >
      <View style={styles.form}>
        <TextField
          label="Family name"
          value={name}
          onChangeText={setName}
          placeholder="The Srivastavas"
          maxLength={MAX_FAMILY_NAME_LENGTH}
          editable={!busy}
          autoCapitalize="words"
          onSubmitEditing={handleCreate}
          returnKeyType="go"
        />
        {!!error && (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        )}
        <Button label="Create family" onPress={handleCreate} busy={busy} />
      </View>

      <Text style={styles.footnote}>
        You'll be its owner. Inviting the rest of your family comes next.
      </Text>
    </Screen>
  );
}

function FamilyProfile({ family }: { family: Family }) {
  const created = new Date(family.createdAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <Screen title={family.name} subtitle={domain.summary}>
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Your family</Text>
        <Row label="Name" value={family.name} />
        <Row label="Created" value={created} />
        <Row label="Your role" value="Owner" />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Members</Text>
        <Text style={styles.body}>
          Just you for now. Invitations arrive in PR-6, and each member becomes
          a profile that documents, memories and medical records attach to.
        </Text>
      </View>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: theme.spacing.md,
  },
  error: {
    fontSize: theme.typography.body,
    color: theme.colors.error,
  },
  footnote: {
    fontSize: theme.typography.caption,
    color: theme.colors.textMuted,
    textAlign: 'center',
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
    marginBottom: theme.spacing.xs,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  rowLabel: {
    fontSize: theme.typography.body,
    color: theme.colors.textMuted,
  },
  rowValue: {
    flex: 1,
    textAlign: 'right',
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: theme.colors.text,
  },
  body: {
    fontSize: theme.typography.body,
    lineHeight: 24,
    color: theme.colors.textMuted,
  },
});
