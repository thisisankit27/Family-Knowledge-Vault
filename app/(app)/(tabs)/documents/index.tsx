import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '../../../../src/components/Button';
import { EmptyState } from '../../../../src/components/EmptyState';
import { LockedNotice } from '../../../../src/components/LockedNotice';
import { Screen } from '../../../../src/components/Screen';
import { TextField } from '../../../../src/components/TextField';
import { formatRelativeTime } from '../../../../src/lib/relativeTime';
import { getSupabase } from '../../../../src/lib/supabase';
import { TAB_DOMAINS } from '../../../../src/navigation/domains';
import { useAuth } from '../../../../src/providers/AuthProvider';
import { useFamily } from '../../../../src/providers/FamilyProvider';
import {
  AI_PROCESSING_LABELS,
  CATEGORY_HINTS,
  CATEGORY_LABELS,
  DOCUMENT_CATEGORIES,
  countByCategory,
  createDocument,
  createSupabaseDocumentGateway,
  describeDocumentAuthor,
  describeDocumentSubject,
  filterByCategory,
  listDocuments,
  partitionDocuments,
  MAX_DOCUMENT_TITLE_LENGTH,
  type DocumentCategory,
  type FamilyDocument,
} from '../../../../src/services/document';
import { createSupabaseMemberGateway, listMembers, type Member } from '../../../../src/services/member';
import { canReadRecords, canWriteRecords } from '../../../../src/services/role';
import { theme } from '../../../../src/theme';

const domain = TAB_DOMAINS.find((entry) => entry.id === 'documents')!;

export default function DocumentsScreen() {
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
          body="Documents belong to a family. Create or join one first, and this is where its papers will live."
        />
      </Screen>
    );
  }

  // Asked before the query, not after it. RLS *filters* rather than errors, so
  // a Guest's read succeeds and returns nothing — the same answer a family with
  // no documents gives. The role is the only thing that can tell them apart.
  if (!canReadRecords(role)) {
    return (
      <Screen title={domain.label} subtitle={domain.summary}>
        <LockedNotice body="Documents are not shared with guests. Ask an owner or admin if you need access to something here." />
      </Screen>
    );
  }

  return <DocumentLibrary familyId={family.id} canFile={canWriteRecords(role)} />;
}

function DocumentLibrary({ familyId, canFile }: { familyId: string; canFile: boolean }) {
  const { session } = useAuth();
  const viewerUserId = session?.user.id ?? null;
  const [documents, setDocuments] = useState<FamilyDocument[]>([]);
  const [people, setPeople] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  // null is "All". A filter is a view of the list, never a second query.
  const [filter, setFilter] = useState<DocumentCategory | null>(null);

  const load = useCallback(async () => {
    const client = getSupabase();

    const result = await listDocuments(createSupabaseDocumentGateway(client), familyId);
    if (!result.ok) {
      // Not the Guest case — that is handled by the role check above, because a
      // filtered read is not a failed one. This branch is a real failure: a
      // missing grant, an expired session, or no network.
      setError(result.message);
      setDocuments([]);
    } else {
      setError(null);
      setDocuments(result.documents);
    }

    // Returns [] on failure rather than throwing — a Guest cannot read this
    // either, and a document list with unnamed subjects is still worth showing.
    setPeople(await listMembers(createSupabaseMemberGateway(client), familyId));

    setLoading(false);
  }, [familyId]);

  // Refetch on focus rather than on mount: filing a document and coming back
  // should show it, and there is no realtime subscription in this phase.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const peopleById = new Map(people.map((person) => [person.id, person.displayName]));
  const { active, archived } = partitionDocuments(filterByCategory(documents, filter));
  // Counted over everything, not over the filtered view — a chip has to show
  // what it *would* reveal, which is the opposite of what is on screen now.
  const counts = countByCategory(documents);

  if (loading) {
    return (
      <Screen title={domain.label} subtitle={domain.summary}>
        <ActivityIndicator color={theme.colors.primary} />
      </Screen>
    );
  }

  return (
    <Screen title={domain.label} subtitle={domain.summary}>
      {canFile ? <FileDocument familyId={familyId} onFiled={load} /> : null}

      {error ? (
        <View style={styles.notice}>
          <Ionicons name="alert-circle-outline" size={18} color={theme.colors.error} />
          <Text style={styles.noticeText}>{error}</Text>
        </View>
      ) : null}

      {documents.length > 0 ? (
        <CategoryFilter selected={filter} counts={counts} onSelect={setFilter} />
      ) : null}

      {!error && active.length === 0 ? (
        filter ? (
          // Different from an empty library, and it must not borrow that copy:
          // the family does own documents, just none on this shelf.
          <Text style={styles.emptyShelf}>
            Nothing filed under {CATEGORY_LABELS[filter]} yet.
          </Text>
        ) : (
          <EmptyState
            icon={domain.icon}
            title="Nothing filed yet"
            body="Passports, policies, deeds, certificates and warranties — filed by what they mean rather than where they happened to be saved."
          />
        )
      ) : null}

      {active.map((document) => (
        <DocumentCard
          key={document.id}
          document={document}
          peopleById={peopleById}
          people={people}
          viewerUserId={viewerUserId}
        />
      ))}

      {archived.length > 0 ? (
        <>
          <Pressable
            onPress={() => setShowArchived((shown) => !shown)}
            style={styles.archiveToggle}
            accessibilityRole="button"
          >
            <Text style={styles.archiveToggleText}>
              {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
            </Text>
            <Ionicons
              name={showArchived ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={theme.colors.textMuted}
            />
          </Pressable>

          {showArchived
            ? archived.map((document) => (
                <DocumentCard
          key={document.id}
          document={document}
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
 * The shelf selector, and the only navigation this screen has.
 *
 * A chip is shown for every category the family actually uses, plus All. Empty
 * shelves are hidden rather than shown greyed out: six chips over two documents
 * makes a library look emptier than it is, and a chip that reveals nothing is
 * an invitation to a dead end. They reappear the moment something is filed
 * there, which is also how a family learns the vocabulary exists.
 */
function CategoryFilter({
  selected,
  counts,
  onSelect,
}: {
  selected: DocumentCategory | null;
  counts: Record<DocumentCategory, number>;
  onSelect: (category: DocumentCategory | null) => void;
}) {
  const used = DOCUMENT_CATEGORIES.filter((category) => counts[category] > 0);
  if (used.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.filterRow}
    >
      <Chip label="All" active={selected === null} onPress={() => onSelect(null)} />
      {used.map((category) => (
        <Chip
          key={category}
          label={`${CATEGORY_LABELS[category]} ${counts[category]}`}
          active={selected === category}
          // Tapping the active chip clears it. Without this the only way back
          // to All is to find a chip at the far left of a scrolled row.
          onPress={() => onSelect(selected === category ? null : category)}
        />
      ))}
    </ScrollView>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active ? styles.chipActive : null]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A card is now a link, and carries no controls of its own.
 *
 * Archive, restore and delete moved to the detail screen. Piling icons onto a
 * list row is what makes an app feel like a file manager, which `docs/10` §2
 * names as the thing this product must not feel like — and NFR-014's "minimal
 * navigation" is about the actions a family reaches for often, which is finding
 * a document rather than archiving one.
 */
function DocumentCard({
  document,
  peopleById,
  people,
  viewerUserId,
}: {
  document: FamilyDocument;
  peopleById: Map<string, string>;
  people: Member[];
  viewerUserId: string | null;
}) {
  return (
    <Pressable
      onPress={() => router.push(`/(app)/(tabs)/documents/${document.id}`)}
      style={[styles.card, document.archivedAt ? styles.cardArchived : null]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${document.title}`}
    >
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{document.title}</Text>

        {/*
          Subject and age, never a filename or a byte count. docs/10 §13:
          "context is more valuable than filenames". There are no files at all
          until PR-14, and even then this line should not become "1 file, 2.4MB".
        */}
        <Text style={styles.cardMeta}>
          {CATEGORY_LABELS[document.category]} · {describeDocumentSubject(document, peopleById)}
        </Text>

        {/*
          Filed-by read "You" for every document until PR-15 shipped sharing, and
          was built then so the card would not change shape once it stopped doing
          so. It does not: `describeDocumentAuthor` already resolves other
          people's names, and this line is the only thing distinguishing your
          library from the household's.
        */}
        <Text style={styles.cardMeta}>
          Filed by {describeDocumentAuthor(document, people, viewerUserId)} ·{' '}
          {formatRelativeTime(document.createdAt)}
        </Text>

        <View style={styles.badges}>
          {/*
            **The badge PR-11 removed, back for the opposite reason.** A "Private"
            badge was dropped because every document was private and a badge that
            is always on says nothing. Now the two states both exist, and the one
            worth marking is the exception rather than the default: this is how an
            author sees at a glance which of their documents they have published.
            Marking `private` instead would put a badge on almost every card and
            leave the interesting one unlabelled.
          */}
          {document.visibility === 'family' ? (
            <View style={styles.badge}>
              <Ionicons name="people-outline" size={12} color={theme.colors.textMuted} />
              <Text style={styles.badgeText}>Shared</Text>
            </View>
          ) : null}

          {/*
            The wording comes from the service rather than being typed here, so
            the card and the detail screen cannot come to describe the same flag
            differently. Only the `allowed` case gets a badge, on the same
            argument as "Shared" above: mark the exception, not the default.
          */}
          {document.aiProcessing === 'allowed' ? (
            <View style={styles.badge}>
              <Ionicons name="sparkles-outline" size={12} color={theme.colors.textMuted} />
              <Text style={styles.badgeText}>{AI_PROCESSING_LABELS.allowed}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
    </Pressable>
  );
}

/**
 * Filing a document with no file attached is the honest shape of this PR.
 *
 * A record can exist before its scan does — a passport you know the number of
 * but have not photographed yet is still worth recording — so this is not a
 * placeholder for upload so much as the thing upload will later attach to.
 */
function FileDocument({ familyId, onFiled }: { familyId: string; onFiled: () => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<DocumentCategory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile() {
    if (!category) {
      setError('Choose where this belongs.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await createDocument(createSupabaseDocumentGateway(getSupabase()), {
        familyId,
        title,
        category,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setTitle('');
      setCategory(null);
      await onFiled();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <TextField
        label="File a document"
        value={title}
        onChangeText={setTitle}
        placeholder="Dad's Passport"
        maxLength={MAX_DOCUMENT_TITLE_LENGTH}
        editable={!busy}
      />

      {/*
        All six are always offered here, unlike the filter row above. Filtering
        is about what exists; filing is about what could. Hiding an unused shelf
        at this point would make the first document of a kind impossible to file.
      */}
      <View style={styles.picker}>
        {DOCUMENT_CATEGORIES.map((option) => (
          <Chip
            key={option}
            label={CATEGORY_LABELS[option]}
            active={category === option}
            onPress={() => setCategory(category === option ? null : option)}
          />
        ))}
      </View>

      {/*
        The hint is the reason the six read as obvious rather than as a quiz.
        Shown only once a shelf is picked, so the form stays quiet until then.
      */}
      {category ? <Text style={styles.hint}>{CATEGORY_HINTS[category]}</Text> : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="File it" onPress={handleFile} busy={busy} disabled={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    marginBottom: theme.spacing.lg,
  },
  picker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  hint: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    marginBottom: theme.spacing.sm,
  },
  filterRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
  },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  chipActive: {
    backgroundColor: theme.colors.primarySoft,
    borderColor: theme.colors.primary,
  },
  chipText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
  },
  chipTextActive: {
    color: theme.colors.primary,
    fontWeight: '600',
  },
  emptyShelf: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
    textAlign: 'center',
    paddingVertical: theme.spacing.lg,
  },
  error: {
    color: theme.colors.error,
    fontSize: theme.typography.caption,
    marginBottom: theme.spacing.sm,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.surfaceSunken,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  noticeText: {
    flex: 1,
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  cardArchived: {
    backgroundColor: theme.colors.surfaceSunken,
  },
  cardBody: {
    flex: 1,
    gap: 2,
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
  badges: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  badgeText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
  },
  archiveToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.md,
  },
  archiveToggleText: {
    color: theme.colors.textMuted,
    fontSize: theme.typography.caption,
  },
});
