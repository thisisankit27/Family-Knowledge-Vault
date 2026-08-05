import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../../../../src/components/Button';
import { getSupabase } from '../../../../../src/lib/supabase';
import { useFamily } from '../../../../../src/providers/FamilyProvider';
import {
  createSupabaseMemberGateway,
  listMembers,
  type Member,
} from '../../../../../src/services/member';
import {
  createSupabaseRelationshipGateway,
  listRelationships,
  relationshipsFor,
  removeRelationship,
  type RelationshipView,
} from '../../../../../src/services/relationship';
import { canChangeRoles, canEditPeople, ROLE_LABELS } from '../../../../../src/services/role';
import { theme } from '../../../../../src/theme';

/**
 * A person's page.
 *
 * A detail view rather than the edit form it replaced, because this is where
 * Phase 3 onward hangs everything a person owns — documents, medical records,
 * memories. The landing page calls it "a living profile"; a form is not that.
 */
export default function MemberDetailScreen() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const { family, role: myRole } = useFamily();

  const [members, setMembers] = useState<Member[]>([]);
  const [relationships, setRelationships] = useState<RelationshipView[]>([]);
  const [loading, setLoading] = useState(true);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!family) return;
    const supabase = getSupabase();
    setLoading(true);
    try {
      // Two requests regardless of how many relatives are on the page: the
      // whole family's relationships come back once and are filtered locally.
      const [people, all] = await Promise.all([
        listMembers(createSupabaseMemberGateway(supabase), family.id),
        listRelationships(createSupabaseRelationshipGateway(supabase), family.id),
      ]);
      setMembers(people);
      setRelationships(relationshipsFor(memberId, all));
    } finally {
      setLoading(false);
    }
  }, [family, memberId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const member = members.find((person) => person.id === memberId) ?? null;
  const nameOf = (id: string) =>
    members.find((person) => person.id === id)?.displayName ?? 'Someone';

  function confirmRemove(view: RelationshipView) {
    Alert.alert(
      'Remove this relationship?',
      `${member?.displayName} and ${nameOf(view.otherMemberId)} will no longer be linked. Nobody is deleted.`,
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void handleRemove(view.id) },
      ],
    );
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    setError(null);
    try {
      const result = await removeRelationship(
        createSupabaseRelationshipGateway(getSupabase()),
        id,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setRelationships((current) => current.filter((view) => view.id !== id));
    } finally {
      setRemovingId(null);
    }
  }

  if (loading) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  if (!member) {
    return (
      <View style={styles.centre}>
        <Text style={styles.missing}>That person is no longer in this family.</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: member.displayName }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.name}>{member.displayName}</Text>
          <Text style={styles.facts}>{describeFacts(member)}</Text>
          {!!member.email && (
            <Text style={styles.account}>
              Signs in as {member.email}
              {member.role ? ` · ${ROLE_LABELS[member.role]}` : ''}
            </Text>
          )}
          {canEditPeople(myRole) && (
            <Button
              label="Edit details"
              variant="quiet"
              onPress={() => router.push(`/(app)/(tabs)/family/${member.id}/edit`)}
            />
          )}
          {/* Only for people who have an account: a role is a property of
              signing in, and most people in a family never will. */}
          {canChangeRoles(myRole) && !!member.userId && (
            <Button
              label="Change role"
              variant="quiet"
              onPress={() => router.push(`/(app)/(tabs)/family/${member.id}/role`)}
            />
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Relationships</Text>

          {relationships.length === 0 ? (
            <Text style={styles.body}>
              {canEditPeople(myRole)
                ? 'No relationships recorded yet. Linking people is what lets the family tree and "everything about this person" work later.'
                : 'No relationships recorded yet.'}
            </Text>
          ) : (
            relationships.map((view) => (
              <View key={view.id} style={styles.relationshipRow}>
                <View style={styles.avatar}>
                  <Ionicons name="git-compare-outline" size={16} color={theme.colors.primary} />
                </View>
                <View style={styles.relationshipText}>
                  <Text style={styles.relationshipName} numberOfLines={1}>
                    {nameOf(view.otherMemberId)}
                  </Text>
                  <Text style={styles.relationshipLabel}>{view.label}</Text>
                </View>
                {canEditPeople(myRole) && (
                  <Pressable
                    onPress={() => confirmRemove(view)}
                    disabled={removingId === view.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove relationship with ${nameOf(view.otherMemberId)}`}
                    style={styles.remove}
                  >
                    <Ionicons name="close" size={18} color={theme.colors.textMuted} />
                  </Pressable>
                )}
              </View>
            ))
          )}

          {!!error && (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          )}

          {canEditPeople(myRole) && (
            <Button
              label="Add relationship"
              variant={relationships.length === 0 ? 'primary' : 'quiet'}
              onPress={() => router.push(`/(app)/(tabs)/family/${member.id}/relationship`)}
            />
          )}
        </View>
      </ScrollView>
    </>
  );
}

/** Only what is recorded — an empty birthday should read as absent, not blank. */
function describeFacts(member: Member): string {
  const parts: string[] = [];

  if (member.dateOfBirth) {
    parts.push(
      new Date(`${member.dateOfBirth}T00:00:00Z`).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    );
  }
  if (member.bloodGroup) parts.push(member.bloodGroup);

  return parts.length > 0 ? parts.join(' · ') : 'No birthday or blood group recorded yet';
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
  missing: {
    fontSize: theme.typography.body,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  content: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  cardLabel: {
    fontSize: theme.typography.caption,
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: theme.colors.textMuted,
  },
  name: {
    fontSize: theme.typography.heading,
    fontWeight: '700',
    color: theme.colors.text,
  },
  facts: {
    fontSize: theme.typography.body,
    color: theme.colors.textMuted,
  },
  account: {
    fontSize: theme.typography.caption,
    color: theme.colors.textMuted,
  },
  body: {
    fontSize: theme.typography.body,
    lineHeight: 24,
    color: theme.colors.textMuted,
  },
  error: {
    fontSize: theme.typography.body,
    color: theme.colors.error,
  },
  relationshipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    minHeight: theme.touchTarget,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  relationshipText: {
    flex: 1,
    gap: 2,
  },
  relationshipName: {
    fontSize: theme.typography.body,
    fontWeight: '600',
    color: theme.colors.text,
  },
  relationshipLabel: {
    fontSize: theme.typography.caption,
    color: theme.colors.textMuted,
  },
  remove: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
