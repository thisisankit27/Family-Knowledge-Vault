import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../../../src/components/Button';
import { getSupabase } from '../../../../../src/lib/supabase';
import { useAuth } from '../../../../../src/providers/AuthProvider';
import { useFamily } from '../../../../../src/providers/FamilyProvider';
import {
  createSupabaseMemberGateway,
  hasFamilyAccess,
  listMembers,
  type Member,
} from '../../../../../src/services/member';
import {
  createSupabaseRoleGateway,
  ROLES_BY_RANK,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  setRole,
  type FamilyRole,
} from '../../../../../src/services/role';
import { theme } from '../../../../../src/theme';

/**
 * Changing what somebody may do in the family.
 *
 * Every role is offered, ownership included, and demoting the last owner is
 * refused by the database rather than hidden here — the count that decides it
 * can change on another device between this screen loading and the button
 * being pressed. Hiding the option would only mean the refusal arrives as a
 * missing button with no explanation instead of as a sentence.
 */
export default function ChangeRoleScreen() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const { family, refresh } = useFamily();
  const { session } = useAuth();

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [choice, setChoice] = useState<FamilyRole | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!family) return;
    try {
      const people = await listMembers(createSupabaseMemberGateway(getSupabase()), family.id);
      setMembers(people);
      setChoice(people.find((person) => person.id === memberId)?.role ?? null);
    } finally {
      setLoading(false);
    }
  }, [family, memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  const member = members.find((person) => person.id === memberId) ?? null;
  const isYou = !!member?.userId && member.userId === session?.user.id;

  async function handleSave() {
    if (!family || !member?.userId || !choice) return;

    setBusy(true);
    setError(null);
    try {
      const result = await setRole(createSupabaseRoleGateway(getSupabase()), {
        familyId: family.id,
        userId: member.userId,
        role: choice,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // Your own role gates what the rest of the app draws, so it has to be
      // re-read before leaving — an owner who just made themselves a guest
      // must not go back to a screen still showing the invite controls.
      if (isYou) await refresh();
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

  // Two different reasons there may be no role to change, and they need
  // different sentences: nobody ever signed in as this person, or somebody did
  // and no longer has access. Both end here rather than at a picker that saves
  // into a refusal.
  if (!member || !hasFamilyAccess(member)) {
    return (
      <View style={styles.centre}>
        <Text style={styles.empty}>
          {member?.userId
            ? 'This person no longer has access to the family, so there is no role to change. Send them a new invite code first.'
            : 'This person does not have an account in this family, so there is no role to change. Invite them first.'}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.sentence}>
        <Text style={styles.subject}>{member.displayName}</Text>
        {isYou ? ' (you) is a…' : ' is a…'}
      </Text>

      <View style={styles.list}>
        {ROLES_BY_RANK.map((option, index) => {
          const selected = option === choice;
          return (
            <Pressable
              key={option}
              onPress={() => setChoice(option)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.option,
                index < ROLES_BY_RANK.length - 1 && styles.optionDivider,
                selected && styles.optionSelected,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                  {ROLE_LABELS[option]}
                </Text>
                <Text style={styles.optionDescription}>{ROLE_DESCRIPTIONS[option]}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {isYou && (
        <Text style={styles.warning}>
          Giving yourself a smaller role takes away what you can do here, and
          only another owner can give it back.
        </Text>
      )}

      {!!error && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}

      <Button
        label="Save role"
        onPress={handleSave}
        busy={busy}
        disabled={!choice || choice === member.role}
      />
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
  list: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  option: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    minHeight: theme.touchTarget,
  },
  optionDivider: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  optionSelected: {
    backgroundColor: theme.colors.primarySoft,
  },
  pressed: {
    opacity: 0.7,
  },
  optionText: {
    gap: 2,
  },
  optionLabel: {
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: theme.colors.text,
  },
  optionLabelSelected: {
    color: theme.colors.primary,
  },
  optionDescription: {
    fontSize: theme.typography.caption,
    lineHeight: 20,
    color: theme.colors.textMuted,
  },
  warning: {
    fontSize: theme.typography.caption,
    lineHeight: 20,
    color: theme.colors.textMuted,
  },
  error: {
    fontSize: theme.typography.body,
    color: theme.colors.error,
  },
});
