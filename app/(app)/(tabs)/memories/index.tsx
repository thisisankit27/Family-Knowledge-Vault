import { Ionicons } from '@expo/vector-icons';
import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '../../../../src/components/EmptyState';
import { LockedNotice } from '../../../../src/components/LockedNotice';
import { Screen } from '../../../../src/components/Screen';
import { getSupabase } from '../../../../src/lib/supabase';
import { TAB_DOMAINS } from '../../../../src/navigation/domains';
import { useAuth } from '../../../../src/providers/AuthProvider';
import { useFamily } from '../../../../src/providers/FamilyProvider';
import {
  createSupabaseMemberGateway,
  listMembers,
  type Member,
} from '../../../../src/services/member';
import {
  createSupabaseMemoryGateway,
  describeMemoryAuthor,
  describeMemoryMoment,
  describeMemorySubject,
  groupByYear,
  listMemories,
  partitionMemories,
  type FamilyMemory,
} from '../../../../src/services/memory';
import { canReadRecords, canWriteRecords } from '../../../../src/services/role';
import { theme } from '../../../../src/theme';

const domain = TAB_DOMAINS.find((entry) => entry.id === 'memories')!;

export default function MemoriesScreen() {
  const { family, role, loading } = useFamily();

  if (loading) {
    return (
      <Screen title={domain.label} subtitle={domain.summary}>
        <ActivityIndicator color={theme.colors.primary} />
      </Screen>
    );
  }

  if (!family) {
    return (
      <Screen title={domain.label} subtitle={domain.summary}>
        <EmptyState
          icon={domain.icon}
          title="No family yet"
          body="Memories belong to a family. Create or join one first, and this is where your story will live."
        />
      </Screen>
    );
  }

  // Asked before the query, not after it. RLS *filters* rather than errors, so a
  // Guest's read succeeds and returns nothing — the same answer a family with no
  // memories gives. The role is the only thing that can tell them apart.
  if (!canReadRecords(role)) {
    return (
      <Screen title={domain.label} subtitle={domain.summary}>
        <LockedNotice body="Memories are not shared with guests. Ask an owner or admin if you need access to something here." />
      </Screen>
    );
  }

  return <MemoryList familyId={family.id} canKeep={canWriteRecords(role)} />;
}

function MemoryList({ familyId, canKeep }: { familyId: string; canKeep: boolean }) {
  const { session } = useAuth();
  const viewerUserId = session?.user.id ?? null;
  const [memories, setMemories] = useState<FamilyMemory[]>([]);
  const [people, setPeople] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    const client = getSupabase();

    const result = await listMemories(createSupabaseMemoryGateway(client), familyId);
    if (!result.ok) {
      // Not the Guest case — that is handled by the role check above, because a
      // filtered read is not a failed one. This branch is a real failure.
      setError(result.message);
      setMemories([]);
    } else {
      setError(null);
      setMemories(result.memories);
    }

    setPeople(await listMembers(createSupabaseMemberGateway(client), familyId));
    setLoading(false);
  }, [familyId]);

  // Refetch on focus rather than on mount: keeping a memory and coming back
  // should show it, and there is no realtime subscription in this phase.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const peopleById = new Map(people.map((person) => [person.id, person.displayName]));
  const { active, archived } = partitionMemories(memories);
  const years = groupByYear(active);

  if (loading) {
    return (
      <Screen title={domain.label} subtitle={domain.summary}>
        <ActivityIndicator color={theme.colors.primary} />
      </Screen>
    );
  }

  return (
    <Screen title={domain.label} subtitle={domain.summary}>
      {canKeep ? (
        <Pressable
          onPress={() => router.push('/(app)/(tabs)/memories/new')}
          style={styles.keepAction}
          accessibilityRole="button"
        >
          <Ionicons name="add-circle-outline" size={20} color={theme.colors.primary} />
          <Text style={styles.keepActionText}>Keep a memory</Text>
        </Pressable>
      ) : null}

      {error ? (
        <View style={styles.notice}>
          <Ionicons name="alert-circle-outline" size={18} color={theme.colors.error} />
          <Text style={styles.noticeText}>{error}</Text>
        </View>
      ) : null}

      {!error && active.length === 0 ? (
        <EmptyState
          icon={domain.icon}
          title="Nothing kept yet"
          body="A holiday, a first day at school, the story behind a photograph — written down while somebody still remembers it."
        />
      ) : null}

      {/*
        Grouped by the year it happened, not the year it was typed.

        This is the whole of "displayed chronologically" (FR-024). It is not the
        Timeline domain — that is Phase 7, spans every domain that has dated
        rows, and building a narrower version of it here would mean building it
        twice (docs/18 §3.2).
      */}
      {years.map((group) => (
        <View key={group.year} style={styles.yearGroup}>
          <Text style={styles.yearHeading} accessibilityRole="header">
            {group.year}
          </Text>
          {group.memories.map((memory) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              peopleById={peopleById}
              people={people}
              viewerUserId={viewerUserId}
            />
          ))}
        </View>
      ))}

      {archived.length > 0 ? (
        <>
          <Pressable
            onPress={() => setShowArchived((shown) => !shown)}
            style={styles.archiveToggle}
            accessibilityRole="button"
          >
            <Ionicons
              name={showArchived ? 'chevron-down' : 'chevron-forward'}
              size={16}
              color={theme.colors.textMuted}
            />
            <Text style={styles.archiveToggleText}>
              {archived.length} archived
            </Text>
          </Pressable>

          {showArchived
            ? archived.map((memory) => (
                <MemoryCard
                  key={memory.id}
                  memory={memory}
                  peopleById={peopleById}
                  people={people}
                  viewerUserId={viewerUserId}
                />
              ))
            : null}
        </>
      ) : null}
    </Screen>
  );
}

/**
 * One memory, as a card with no controls on it.
 *
 * Badges mark only the *exceptions*. A memory is normally readable by the whole
 * family, so "Only me" is worth saying and "shared with the family" is not —
 * which is the mirror image of the documents card, where private is the norm.
 * A badge on every row would say nothing.
 */
function MemoryCard({
  memory,
  peopleById,
  people,
  viewerUserId,
}: {
  memory: FamilyMemory;
  peopleById: Map<string, string>;
  people: Member[];
  viewerUserId: string | null;
}) {
  return (
    <Link
      href={{
        pathname: '/(app)/(tabs)/memories/[memoryId]',
        params: { memoryId: memory.id },
      }}
      asChild
    >
      <Pressable style={styles.card} accessibilityRole="button">
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {memory.title}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
        </View>

        <Text style={styles.cardMoment}>{describeMemoryMoment(memory)}</Text>

        {memory.story ? (
          <Text style={styles.cardStory} numberOfLines={2}>
            {memory.story}
          </Text>
        ) : null}

        <Text style={styles.cardMeta}>
          {describeMemorySubject(memory, peopleById)} ·{' '}
          {describeMemoryAuthor(memory, people, viewerUserId)}
        </Text>

        {memory.visibility === 'private' || memory.aiProcessing === 'allowed' ? (
          <View style={styles.badges}>
            {memory.visibility === 'private' ? (
              <View style={styles.badge}>
                <Ionicons name="lock-closed-outline" size={12} color={theme.colors.textMuted} />
                <Text style={styles.badgeText}>Only me</Text>
              </View>
            ) : null}
            {memory.aiProcessing === 'allowed' ? (
              <View style={styles.badge}>
                <Ionicons name="sparkles-outline" size={12} color={theme.colors.textMuted} />
                <Text style={styles.badgeText}>AI may read this</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  keepAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  keepActionText: {
    color: theme.colors.primary,
    fontSize: theme.typography.body,
    fontWeight: '600',
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceSunken,
  },
  noticeText: {
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.typography.caption,
  },
  yearGroup: {
    gap: theme.spacing.sm,
  },
  yearHeading: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: theme.spacing.sm,
  },
  card: {
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    gap: theme.spacing.xs,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  cardTitle: {
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.typography.body,
    fontWeight: '600',
  },
  cardMoment: {
    color: theme.colors.primary,
    fontSize: theme.typography.caption,
  },
  cardStory: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    lineHeight: 20,
  },
  cardMeta: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surfaceSunken,
  },
  badgeText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
  },
  archiveToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
  },
  archiveToggleText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
  },
});
