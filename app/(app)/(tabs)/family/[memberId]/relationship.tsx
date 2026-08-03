import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../../../src/components/Button';
import { getSupabase } from '../../../../../src/lib/supabase';
import { useFamily } from '../../../../../src/providers/FamilyProvider';
import {
  createSupabaseMemberGateway,
  listMembers,
  type Member,
} from '../../../../../src/services/member';
import {
  addRelationship,
  createSupabaseRelationshipGateway,
  RELATIONSHIP_CHOICES,
  resolveRelationshipArguments,
  type RelationshipChoice,
} from '../../../../../src/services/relationship';
import { theme } from '../../../../../src/theme';

/**
 * Records one relationship, phrased as a sentence.
 *
 * "{This person} is the [Parent of] [Sunita]" — the subject is fixed by which
 * page you came from, so the only two decisions are the kind of link and who it
 * is with. "Child of" exists so nobody has to reason backwards about which way
 * the arrow points; the service turns it into the same row as "Parent of"
 * stated from the other side.
 */
export default function AddRelationshipScreen() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const { family } = useFamily();

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [choice, setChoice] = useState<RelationshipChoice>(RELATIONSHIP_CHOICES[0]);
  const [otherId, setOtherId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!family) return;
    try {
      setMembers(await listMembers(createSupabaseMemberGateway(getSupabase()), family.id));
    } finally {
      setLoading(false);
    }
  }, [family]);

  useEffect(() => {
    void load();
  }, [load]);

  const subject = members.find((person) => person.id === memberId) ?? null;
  const candidates = members.filter((person) => person.id !== memberId);

  async function handleSave() {
    if (!otherId) {
      setError('Choose who the relationship is with.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await addRelationship(
        createSupabaseRelationshipGateway(getSupabase()),
        resolveRelationshipArguments(choice, memberId, otherId),
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.back();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (candidates.length === 0) {
    return (
      <View style={styles.centre}>
        <Text style={styles.empty}>
          There is nobody else in this family yet. Add another person first.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.sentence}>
        <Text style={styles.subject}>{subject?.displayName ?? 'This person'}</Text> is the…
      </Text>

      <View style={styles.choices}>
        {RELATIONSHIP_CHOICES.map((entry) => {
          const selected = entry.key === choice.key;
          return (
            <Pressable
              key={entry.key}
              onPress={() => setChoice(entry)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.choice,
                selected && styles.choiceSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
                {entry.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.cardLabel}>…of</Text>

      <View style={styles.list}>
        {candidates.map((person, index) => {
          const selected = person.id === otherId;
          return (
            <Pressable
              key={person.id}
              onPress={() => setOtherId(person.id)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.person,
                index < candidates.length - 1 && styles.personDivider,
                pressed && styles.pressed,
              ]}
            >
              <View style={[styles.avatar, selected && styles.avatarSelected]}>
                <Ionicons
                  name={selected ? 'checkmark' : 'person-outline'}
                  size={18}
                  color={selected ? '#FFFFFF' : theme.colors.primary}
                />
              </View>
              <Text style={styles.personName} numberOfLines={1}>
                {person.displayName}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {!!error && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}

      <Button label="Record relationship" onPress={handleSave} busy={busy} />
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
  sentence: {
    fontSize: theme.typography.subheading,
    color: theme.colors.textMuted,
  },
  subject: {
    fontWeight: '700',
    color: theme.colors.text,
  },
  cardLabel: {
    fontSize: theme.typography.caption,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: theme.colors.textMuted,
  },
  choices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  choice: {
    minHeight: theme.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  choiceSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primarySoft,
  },
  choiceText: {
    fontSize: theme.typography.body,
    color: theme.colors.text,
  },
  choiceTextSelected: {
    fontWeight: '700',
    color: theme.colors.primary,
  },
  pressed: {
    opacity: 0.7,
  },
  list: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    minHeight: theme.touchTarget + 8,
  },
  personDivider: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSelected: {
    backgroundColor: theme.colors.primary,
  },
  personName: {
    flex: 1,
    fontSize: theme.typography.body,
    color: theme.colors.text,
  },
  error: {
    fontSize: theme.typography.body,
    color: theme.colors.error,
  },
});
