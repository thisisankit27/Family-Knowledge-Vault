import { Ionicons } from '@expo/vector-icons';
import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '../../../../../src/components/EmptyState';
import { getSupabaseEnv } from '../../../../../src/lib/env';
import { getSupabase } from '../../../../../src/lib/supabase';
import { useFamily } from '../../../../../src/providers/FamilyProvider';
import {
  countByAlbum,
  coverForAlbum,
  createSupabaseAlbumGateway,
  describeAlbumSize,
  listAlbumEntries,
  listAlbums,
  type Album,
  type AlbumEntry,
} from '../../../../../src/services/album';
import { canWriteRecords } from '../../../../../src/services/role';
import {
  MEMORY_FILES,
  createSupabaseStorageGateway,
  fileUrl,
} from '../../../../../src/services/storage';
import { theme } from '../../../../../src/theme';

/**
 * The family's albums.
 *
 * Counts and covers are **derived from what this viewer can see**, never
 * stored. An album holding a memory you may not read simply looks smaller to
 * you — which is the correct answer and discloses nothing, including by
 * arithmetic (`docs/18` §4.4 as amended).
 */
export default function AlbumsScreen() {
  const { family, role, loading } = useFamily();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [entries, setEntries] = useState<AlbumEntry[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const familyId = family?.id ?? null;

  const load = useCallback(async () => {
    if (!familyId) {
      setBusy(false);
      return;
    }
    const gateway = createSupabaseAlbumGateway(getSupabase());
    const [listed, contents] = await Promise.all([
      listAlbums(gateway, familyId),
      listAlbumEntries(gateway, familyId),
    ]);

    if (!listed.ok) {
      setError(listed.message);
      setAlbums([]);
    } else {
      setError(null);
      setAlbums(listed.albums);
    }
    setEntries(contents.ok ? contents.entries : []);
    setBusy(false);
  }, [familyId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (loading || busy) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  const counts = countByAlbum(entries);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {canWriteRecords(role) ? (
        <Pressable
          onPress={() => router.push('/(app)/(tabs)/memories/albums/new')}
          style={styles.newAction}
          accessibilityRole="button"
        >
          <Ionicons name="add-circle-outline" size={20} color={theme.colors.primary} />
          <Text style={styles.newActionText}>Make an album</Text>
        </Pressable>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {albums.length === 0 && !error ? (
        <EmptyState
          icon="images-outline"
          title="No albums yet"
          body="A holiday, a wedding, a year — a way of gathering memories that belong together."
        />
      ) : null}

      {albums.map((album) => (
        <AlbumCard
          key={album.id}
          album={album}
          count={counts.get(album.id) ?? 0}
          cover={coverForAlbum(entries, album.id)}
        />
      ))}
    </ScrollView>
  );
}

function AlbumCard({
  album,
  count,
  cover,
}: {
  album: Album;
  count: number;
  cover: AlbumEntry['cover'] | null;
}) {
  return (
    <Link
      href={{ pathname: '/(app)/(tabs)/memories/albums/[albumId]', params: { albumId: album.id } }}
      asChild
    >
      <Pressable style={styles.card} accessibilityRole="button">
        <Cover cover={cover} />

        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {album.title}
          </Text>
          <Text style={styles.cardMeta}>{describeAlbumSize(count)}</Text>
          {album.visibility === 'private' ? (
            <View style={styles.badge}>
              <Ionicons name="lock-closed-outline" size={12} color={theme.colors.textMuted} />
              <Text style={styles.badgeText}>Only me</Text>
            </View>
          ) : null}
        </View>

        <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
      </Pressable>
    </Link>
  );
}

/**
 * The derived cover, or a placeholder.
 *
 * `null` covers three different situations — an empty album, one whose memories
 * are all hidden from this reader, and one whose visible memories have no
 * photographs — and deliberately renders the same for all three. Distinguishing
 * them on screen is exactly the disclosure the derived cover exists to avoid.
 */
function Cover({ cover }: { cover: AlbumEntry['cover'] | null }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!cover) return;
    void (async () => {
      const gateway = createSupabaseStorageGateway(
        getSupabase(),
        { url: getSupabaseEnv().url },
        MEMORY_FILES,
      );
      const minted = await fileUrl(gateway, cover);
      if (minted.ok) setUrl(minted.url);
    })();
  }, [cover]);

  if (cover && url) {
    return <Image source={{ uri: url }} style={styles.cover} resizeMode="cover" />;
  }

  return (
    <View style={[styles.cover, styles.coverEmpty]}>
      <Ionicons name="images-outline" size={20} color={theme.colors.textMuted} />
    </View>
  );
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.xxl,
  },
  newAction: {
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
  newActionText: {
    color: theme.colors.primary,
    fontSize: theme.typography.body,
    fontWeight: '600',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  cover: {
    width: 64,
    height: 64,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceSunken,
  },
  coverEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  cardTitle: {
    color: theme.colors.text,
    fontSize: theme.typography.body,
    fontWeight: '600',
  },
  cardMeta: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
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
  error: {
    color: theme.colors.error,
    fontSize: theme.typography.caption,
  },
});
